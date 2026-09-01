-- ═════════════════════════════════════════════════════════════════════════════
-- 19 · area and role management
-- ═════════════════════════════════════════════════════════════════════════════
-- Phase 2 seeds six areas and eleven roles and then never touches them again.
-- The tables were built for editing — `sort_order`, `archived_at`, a per-
-- workplace unique `key`, `on delete restrict` on every reference — but nothing
-- enforced the rules that make editing safe. This migration adds those rules and
-- the RPCs the app calls.
--
-- What the audit found, and what follows from it
-- ----------------------------------------------
-- 1 · EVERY foreign key into workplace_areas / workplace_roles is `on delete
--     restrict` (the two exceptions, invitations.proposed_area_id and
--     distribution_rules.rounding_area_id, are `set null`). So a hard DELETE of
--     anything referenced is already refused by the database: financial history
--     cannot be cascade-deleted, whatever the client asks for. Delete therefore
--     stays available and needs no new guard — it is safe exactly when the
--     database says it is.
--
-- 2 · Renaming is always safe. tip_distribution_areas and
--     tip_distribution_entries store `area_key`, `area_name`, `role_key`,
--     `role_name` and `points` as snapshot columns at calculation time, so a
--     past payslip keeps the words it was issued with.
--
-- 3 · Nothing stopped a NEW reference to an ARCHIVED area or role. Archiving is
--     supposed to mean "no longer offered", and that has to be enforced where
--     the reference is written, not only in the lists the UI draws.
--
-- 4 · Nothing stopped archiving something still in use, which would strand a
--     member with no area or leave an unfinished shift pointing at a
--     configuration that no longer exists.
--
-- The archive policy
-- ------------------
-- Archiving is refused while the thing is still part of live operations:
--
--   an area   · an active member has it as their default area
--             · an unfinished shift references it (draft, submitted, or
--               approved but not yet locked into a distribution)
--             · the ACTIVE rule or the open DRAFT gives it a share above 0
--             · a non-archived role still belongs to it
--   a role    · an active member has it as their default role
--             · an unfinished shift references it
--
-- Deliberately NOT blocking: locked shifts, superseded rule versions, and
-- anything in a distribution. Those are history, they keep their own snapshot,
-- and blocking on them would make archiving impossible after the first month.
--
-- Roles under an archived area are NOT archived automatically and NOT
-- reassigned. The manager archives them first, explicitly, one at a time — a
-- silent cascade over something that carries a pay weight is exactly what this
-- product exists to avoid.
--
-- Everything here is new. No already-applied migration is touched.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── slugs ───────────────────────────────────────────────────────────────────
-- `key` is the stable identifier the frontend maps to an icon and the engine
-- copies into its snapshots. A manager types a name; the database derives the
-- key, so a rename never moves it and a typo never produces an invalid one.
create or replace function app.slugify(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.length(s) = 0 then null
    when s !~ '^[a-z]' then pg_catalog.left('x_' || s, 31)
    when pg_catalog.length(s) < 2 then s || '_1'
    else s
  end
  from (
    select pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.replace(
                pg_catalog.replace(pg_catalog.lower(pg_catalog.btrim(coalesce(p_name, ''))),
                  'ä', 'ae'),
                'ö', 'oe'),
              'ü', 'ue'),
            'ß', 'ss'),
          '[^a-z0-9]+', '_', 'g'),
        '_+', '_', 'g'),
      '_') as s
  ) t
$$;

comment on function app.slugify(text) is
  'A name to a key the workplace_areas/workplace_roles key check accepts. Null when nothing usable is left.';

-- Suffixes until the key is free in this workplace. Archived rows keep their
-- key, so a new "Bar" after an archived "Bar" becomes bar_2 rather than
-- colliding with history.
create or replace function app.unique_area_key(p_workplace_id uuid, p_base text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := pg_catalog.left(coalesce(p_base, 'area'), 28);
  v_try text := v_key;
  v_n   integer := 1;
begin
  while exists (
    select 1 from public.workplace_areas a
    where a.workplace_id = p_workplace_id and a.key = v_try
  ) loop
    v_n := v_n + 1;
    v_try := v_key || '_' || v_n;
    if v_n > 200 then
      raise exception 'could not find a free key for this area' using errcode = '22023';
    end if;
  end loop;
  return v_try;
end;
$$;

create or replace function app.unique_role_key(p_workplace_id uuid, p_base text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := pg_catalog.left(coalesce(p_base, 'role'), 28);
  v_try text := v_key;
  v_n   integer := 1;
begin
  while exists (
    select 1 from public.workplace_roles r
    where r.workplace_id = p_workplace_id and r.key = v_try
  ) loop
    v_n := v_n + 1;
    v_try := v_key || '_' || v_n;
    if v_n > 200 then
      raise exception 'could not find a free key for this role' using errcode = '22023';
    end if;
  end loop;
  return v_try;
end;
$$;

-- ── two names alike ─────────────────────────────────────────────────────────
-- No unique index, because an archived "Bar" and a live "Bar" must be able to
-- coexist. A trigger says the useful thing instead: two *live* areas cannot
-- share a name, and neither can two live roles in one area.
create or replace function app.guard_area_name_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null then
    return new;
  end if;
  if exists (
    select 1 from public.workplace_areas a
    where a.workplace_id = new.workplace_id
      and a.id <> new.id
      and a.archived_at is null
      and pg_catalog.lower(pg_catalog.btrim(a.name)) = pg_catalog.lower(pg_catalog.btrim(new.name))
  ) then
    raise exception 'this workplace already has an area called %', pg_catalog.btrim(new.name)
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger workplace_areas_name_unique
  before insert or update on public.workplace_areas
  for each row execute function app.guard_area_name_unique();

create or replace function app.guard_role_name_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null then
    return new;
  end if;
  if exists (
    select 1 from public.workplace_roles r
    where r.workplace_id = new.workplace_id
      and r.area_id = new.area_id
      and r.id <> new.id
      and r.archived_at is null
      and pg_catalog.lower(pg_catalog.btrim(r.name)) = pg_catalog.lower(pg_catalog.btrim(new.name))
  ) then
    raise exception 'this area already has a role called %', pg_catalog.btrim(new.name)
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger workplace_roles_name_unique
  before insert or update on public.workplace_roles
  for each row execute function app.guard_role_name_unique();

-- ── an archived area or role cannot be newly chosen ─────────────────────────
create or replace function app.area_is_live(p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workplace_areas a
    where a.id = p_area_id and a.archived_at is null
  )
$$;

create or replace function app.role_is_live(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workplace_roles r
    where r.id = p_role_id and r.archived_at is null
  )
$$;

-- Members and shifts. Only a NEW or CHANGED reference is checked, so a row that
-- already points at something since archived keeps working and keeps rendering.
create or replace function app.guard_live_area_role_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.area_id is not null
     and (TG_OP = 'INSERT' or new.area_id is distinct from old.area_id)
     and not app.area_is_live(new.area_id) then
    raise exception 'that area has been archived and cannot be assigned' using errcode = '23514';
  end if;
  if new.workplace_role_id is not null
     and (TG_OP = 'INSERT' or new.workplace_role_id is distinct from old.workplace_role_id)
     and not app.role_is_live(new.workplace_role_id) then
    raise exception 'that role has been archived and cannot be assigned' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workplace_members_live_refs
  before insert or update on public.workplace_members
  for each row execute function app.guard_live_area_role_ref();

create trigger shifts_live_refs
  before insert or update on public.shifts
  for each row execute function app.guard_live_area_role_ref();

-- A rule share. Zero is allowed for an archived area, because
-- create_rule_draft() copies the active rule's rows forward and an area can
-- only reach `archived` while its share is already zero — so the copy is a
-- record of "not in the pool", not a new allocation.
create or replace function app.guard_live_rule_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.percentage > 0 and not app.area_is_live(new.area_id) then
    raise exception 'that area has been archived and cannot be given a share of the pool'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rule_areas_live
  before insert or update on public.distribution_rule_areas
  for each row execute function app.guard_live_rule_area();

create or replace function app.guard_live_rounding_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rounding_area_id is not null
     and (TG_OP = 'INSERT' or new.rounding_area_id is distinct from old.rounding_area_id)
     and not app.area_is_live(new.rounding_area_id) then
    raise exception 'that area has been archived and cannot take the rounding remainder'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rules_live_rounding_area
  before insert or update on public.distribution_rules
  for each row execute function app.guard_live_rounding_area();

-- A role must sit in a live area of its own workplace. Migration 05 already
-- checks the workplace; this adds the archived half, on the same terms as
-- above — only a new or changed pairing.
create or replace function app.guard_role_area_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (TG_OP = 'INSERT' or new.area_id is distinct from old.area_id
      or (old.archived_at is not null and new.archived_at is null))
     and not app.area_is_live(new.area_id) then
    raise exception 'that area has been archived; restore it before putting a role in it'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workplace_roles_area_live
  before insert or update on public.workplace_roles
  for each row execute function app.guard_role_area_live();

-- ── what is still using this ────────────────────────────────────────────────
-- Counts only. No amount, no name, nothing an employee could not already read
-- about themselves — and manager-only regardless, because a shift count across
-- the whole workplace is not an employee's to see.
create or replace function public.area_usage(p_area_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workplace uuid;
begin
  select workplace_id into v_workplace from public.workplace_areas where id = p_area_id;
  if v_workplace is null then
    raise exception 'area not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_workplace) then
    raise exception 'only a manager of this workplace may read this' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'members', (select count(*) from public.workplace_members m
                where m.area_id = p_area_id and m.status = 'active'),
    'open_shifts', (select count(*) from public.shifts s
                    where s.area_id = p_area_id and not s.locked
                      and s.status in ('draft', 'submitted', 'approved')),
    'roles', (select count(*) from public.workplace_roles r
              where r.area_id = p_area_id and r.archived_at is null),
    'funded_rules', (select count(*) from public.distribution_rule_areas ra
                     join public.distribution_rules ru on ru.id = ra.rule_id
                     where ra.area_id = p_area_id and ra.percentage > 0
                       and ru.status in ('active', 'draft')),
    'distributions', (select count(distinct e.distribution_id)
                      from public.tip_distribution_entries e where e.area_id = p_area_id),
    -- Every key that RESTRICTS a delete, zero-share rule rows included. Zero
    -- here is the only state in which the database will let the row go.
    'references', (
        (select count(*) from public.workplace_members m where m.area_id = p_area_id)
      + (select count(*) from public.shifts s where s.area_id = p_area_id)
      + (select count(*) from public.workplace_roles r where r.area_id = p_area_id)
      + (select count(*) from public.distribution_rule_areas ra where ra.area_id = p_area_id)
      + (select count(*) from public.tip_distribution_areas da where da.area_id = p_area_id)
      + (select count(*) from public.tip_distribution_entries e2 where e2.area_id = p_area_id)
    )
  );
end;
$$;

create or replace function public.role_usage(p_role_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workplace uuid;
begin
  select workplace_id into v_workplace from public.workplace_roles where id = p_role_id;
  if v_workplace is null then
    raise exception 'role not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_workplace) then
    raise exception 'only a manager of this workplace may read this' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'members', (select count(*) from public.workplace_members m
                where m.workplace_role_id = p_role_id and m.status = 'active'),
    'open_shifts', (select count(*) from public.shifts s
                    where s.workplace_role_id = p_role_id and not s.locked
                      and s.status in ('draft', 'submitted', 'approved')),
    'rule_versions', (select count(*) from public.distribution_rule_roles rr
                      where rr.workplace_role_id = p_role_id),
    'references', (
        (select count(*) from public.workplace_members m where m.workplace_role_id = p_role_id)
      + (select count(*) from public.shifts s where s.workplace_role_id = p_role_id)
      + (select count(*) from public.distribution_rule_roles rr2 where rr2.workplace_role_id = p_role_id)
    )
  );
end;
$$;

-- ── create ──────────────────────────────────────────────────────────────────
create or replace function public.create_workplace_area(
  p_workplace_id uuid, p_name text, p_pool_eligible boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_next smallint;
  v_id   uuid;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may add an area' using errcode = '42501';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'an area needs a name' using errcode = '22023';
  end if;

  v_slug := app.slugify(p_name);
  if v_slug is null then
    raise exception 'that name has no letters or digits in it' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_next
  from public.workplace_areas where workplace_id = p_workplace_id;
  if v_next > 32000 then v_next := 32000; end if;

  insert into public.workplace_areas (workplace_id, key, name, sort_order, is_pool_eligible)
  values (p_workplace_id, app.unique_area_key(p_workplace_id, v_slug),
          pg_catalog.btrim(p_name), v_next, coalesce(p_pool_eligible, true))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_workplace_role(
  p_workplace_id uuid, p_area_id uuid, p_name text, p_points numeric default 1.00
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_next smallint;
  v_id   uuid;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may add a role' using errcode = '42501';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'a role needs a name' using errcode = '22023';
  end if;

  v_slug := app.slugify(p_name);
  if v_slug is null then
    raise exception 'that name has no letters or digits in it' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_next
  from public.workplace_roles where workplace_id = p_workplace_id and area_id = p_area_id;
  if v_next > 32000 then v_next := 32000; end if;

  -- The workplace and archived checks live in the triggers on the table, so a
  -- foreign or archived area is refused here for exactly the same reason it
  -- would be refused on a direct insert.
  insert into public.workplace_roles (workplace_id, area_id, key, name, points, sort_order)
  values (p_workplace_id, p_area_id, app.unique_role_key(p_workplace_id, v_slug),
          pg_catalog.btrim(p_name), coalesce(p_points, 1.00), v_next)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── archive and restore ─────────────────────────────────────────────────────
create or replace function public.archive_workplace_area(p_area_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area  public.workplace_areas%rowtype;
  v_usage jsonb;
begin
  select * into v_area from public.workplace_areas where id = p_area_id;
  if v_area.id is null then
    raise exception 'area not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_area.workplace_id) then
    raise exception 'only a manager of this workplace may archive an area' using errcode = '42501';
  end if;
  if v_area.archived_at is not null then
    return jsonb_build_object('archived', true, 'already', true);
  end if;

  v_usage := public.area_usage(p_area_id);

  if (v_usage ->> 'members')::int > 0 then
    raise exception 'this area is still the default for % team member(s); move them first',
      v_usage ->> 'members' using errcode = '23514';
  end if;
  if (v_usage ->> 'open_shifts')::int > 0 then
    raise exception 'this area is on % shift(s) that are not finished yet',
      v_usage ->> 'open_shifts' using errcode = '23514';
  end if;
  if (v_usage ->> 'roles')::int > 0 then
    raise exception 'this area still has % role(s) in it; archive them first',
      v_usage ->> 'roles' using errcode = '23514';
  end if;
  if (v_usage ->> 'funded_rules')::int > 0 then
    raise exception 'this area has a share of the pool in the rules; set it to 0%% first'
      using errcode = '23514';
  end if;

  update public.workplace_areas set archived_at = now() where id = p_area_id;
  return jsonb_build_object('archived', true, 'already', false);
end;
$$;

create or replace function public.restore_workplace_area(p_area_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_workplace uuid;
begin
  select workplace_id into v_workplace from public.workplace_areas where id = p_area_id;
  if v_workplace is null then
    raise exception 'area not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_workplace) then
    raise exception 'only a manager of this workplace may restore an area' using errcode = '42501';
  end if;
  update public.workplace_areas set archived_at = null where id = p_area_id;
end;
$$;

create or replace function public.archive_workplace_role(p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  public.workplace_roles%rowtype;
  v_usage jsonb;
begin
  select * into v_role from public.workplace_roles where id = p_role_id;
  if v_role.id is null then
    raise exception 'role not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_role.workplace_id) then
    raise exception 'only a manager of this workplace may archive a role' using errcode = '42501';
  end if;
  if v_role.archived_at is not null then
    return jsonb_build_object('archived', true, 'already', true);
  end if;

  v_usage := public.role_usage(p_role_id);

  if (v_usage ->> 'members')::int > 0 then
    raise exception 'this role is still the default for % team member(s); move them first',
      v_usage ->> 'members' using errcode = '23514';
  end if;
  if (v_usage ->> 'open_shifts')::int > 0 then
    raise exception 'this role is on % shift(s) that are not finished yet',
      v_usage ->> 'open_shifts' using errcode = '23514';
  end if;

  update public.workplace_roles set archived_at = now() where id = p_role_id;
  return jsonb_build_object('archived', true, 'already', false);
end;
$$;

create or replace function public.restore_workplace_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_workplace uuid;
begin
  select workplace_id into v_workplace from public.workplace_roles where id = p_role_id;
  if v_workplace is null then
    raise exception 'role not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_workplace) then
    raise exception 'only a manager of this workplace may restore a role' using errcode = '42501';
  end if;
  -- app.guard_role_area_live() refuses this when the area is still archived.
  update public.workplace_roles set archived_at = null where id = p_role_id;
end;
$$;

-- ── order ───────────────────────────────────────────────────────────────────
-- The array is the new order. Anything not named keeps its place after them, so
-- a stale client cannot silently reshuffle rows it never saw.
create or replace function public.reorder_workplace_areas(p_workplace_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_bad integer;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may reorder its areas' using errcode = '42501';
  end if;
  select count(*) into v_bad
  from unnest(p_ids) as t(id)
  where not exists (
    select 1 from public.workplace_areas a
    where a.id = t.id and a.workplace_id = p_workplace_id
  );
  if v_bad > 0 then
    raise exception 'that list contains % area(s) from another workplace', v_bad
      using errcode = '42501';
  end if;

  update public.workplace_areas a
  set sort_order = (t.ord * 10)::smallint
  from (select id, row_number() over () as ord from unnest(p_ids) as id) t
  where a.id = t.id and a.workplace_id = p_workplace_id;
end;
$$;

create or replace function public.reorder_workplace_roles(p_area_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workplace uuid;
  v_bad integer;
begin
  select workplace_id into v_workplace from public.workplace_areas where id = p_area_id;
  if v_workplace is null then
    raise exception 'area not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_workplace) then
    raise exception 'only a manager of this workplace may reorder its roles' using errcode = '42501';
  end if;
  select count(*) into v_bad
  from unnest(p_ids) as t(id)
  where not exists (
    select 1 from public.workplace_roles r
    where r.id = t.id and r.area_id = p_area_id and r.workplace_id = v_workplace
  );
  if v_bad > 0 then
    raise exception 'that list contains % role(s) from another area', v_bad using errcode = '42501';
  end if;

  update public.workplace_roles r
  set sort_order = (t.ord * 10)::smallint
  from (select id, row_number() over () as ord from unnest(p_ids) as id) t
  where r.id = t.id and r.area_id = p_area_id;
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function
  public.area_usage(uuid), public.role_usage(uuid),
  public.create_workplace_area(uuid, text, boolean),
  public.create_workplace_role(uuid, uuid, text, numeric),
  public.archive_workplace_area(uuid), public.restore_workplace_area(uuid),
  public.archive_workplace_role(uuid), public.restore_workplace_role(uuid),
  public.reorder_workplace_areas(uuid, uuid[]), public.reorder_workplace_roles(uuid, uuid[])
from public;

grant execute on function
  public.area_usage(uuid), public.role_usage(uuid),
  public.create_workplace_area(uuid, text, boolean),
  public.create_workplace_role(uuid, uuid, text, numeric),
  public.archive_workplace_area(uuid), public.restore_workplace_area(uuid),
  public.archive_workplace_role(uuid), public.restore_workplace_role(uuid),
  public.reorder_workplace_areas(uuid, uuid[]), public.reorder_workplace_roles(uuid, uuid[])
to authenticated;

revoke all on function app.slugify(text), app.area_is_live(uuid), app.role_is_live(uuid),
  app.unique_area_key(uuid, text), app.unique_role_key(uuid, text) from public;
grant execute on function app.slugify(text), app.area_is_live(uuid), app.role_is_live(uuid)
  to authenticated, service_role;

comment on function public.archive_workplace_area(uuid) is
  'Archives an area once nothing live depends on it. Never deletes, never reassigns.';
comment on function public.archive_workplace_role(uuid) is
  'Archives a role once no active member and no unfinished shift uses it.';
