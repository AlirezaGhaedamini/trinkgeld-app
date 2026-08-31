-- ═════════════════════════════════════════════════════════════════════════════
-- 09 · distribution rules, versioned and immutable
--
-- A rule is not a settings row that gets edited. It is an append-only sequence
-- of versions: exactly one `active` per workplace, at most one `draft`, and a
-- trigger that refuses to touch anything past draft. Editing produces version
-- n+1; a distribution names the version it used and also copies it.
--
-- The agreement metadata (adopted_by, agreement_reference, agreement_date) is
-- optional, has no default, and nothing validates or depends on it. It is
-- recorded because someone may want it later, not because the database has an
-- opinion about it.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.distribution_rules (
  id                       uuid primary key default gen_random_uuid(),
  workplace_id             uuid not null references public.workplaces (id) on delete cascade,
  version                  integer,
  status                   public.rule_status not null default 'draft',

  method                   public.rule_method not null default 'hours_points',
  min_overlap_minutes      integer not null default 15
                             check (min_overlap_minutes >= 0 and min_overlap_minutes <= 720),
  overlap_basis            public.overlap_basis not null default 'longest_shift',

  -- Unused by the MVP engine. Present so a second overlap strategy is data
  -- rather than a schema change.
  service_window_start     time,
  service_window_end       time,

  acknowledgement_required boolean not null default true,
  rounding_area_id         uuid references public.workplace_areas (id) on delete set null,

  -- Optional, neutral metadata. No checks, no dependent logic.
  adopted_by               public.rule_adopted_by,
  agreement_reference      text,
  agreement_date           date,

  note                     text,
  effective_from           timestamptz,
  effective_to             timestamptz,
  created_by               uuid references public.workplace_members (id) on delete set null,
  activated_by             uuid references public.workplace_members (id) on delete set null,
  created_at               timestamptz not null default now(),

  constraint rules_version_when_not_draft
    check (status = 'draft' or version is not null)
);

comment on column public.distribution_rules.adopted_by is
  'Optional metadata only. Nothing in the database validates or acts on this.';

create unique index rules_version_key on public.distribution_rules (workplace_id, version)
  where version is not null;
create unique index rules_one_active on public.distribution_rules (workplace_id)
  where status = 'active';
create unique index rules_one_draft on public.distribution_rules (workplace_id)
  where status = 'draft';
create index rules_lookup_idx on public.distribution_rules (workplace_id, version desc);

create table public.distribution_rule_areas (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid not null references public.distribution_rules (id) on delete cascade,
  workplace_id uuid not null references public.workplaces (id) on delete cascade,
  area_id      uuid not null references public.workplace_areas (id) on delete restrict,
  area_key     text not null,
  percentage   numeric(5,2) not null default 0 check (percentage >= 0 and percentage <= 100)
);

create unique index rule_areas_key on public.distribution_rule_areas (rule_id, area_id);
create index rule_areas_rule_idx on public.distribution_rule_areas (rule_id);

create table public.distribution_rule_roles (
  id                uuid primary key default gen_random_uuid(),
  rule_id           uuid not null references public.distribution_rules (id) on delete cascade,
  workplace_id      uuid not null references public.workplaces (id) on delete cascade,
  workplace_role_id uuid not null references public.workplace_roles (id) on delete restrict,
  role_key          text not null,
  points            numeric(4,2) not null default 1.00 check (points > 0 and points <= 5)
);

create unique index rule_roles_key on public.distribution_rule_roles (rule_id, workplace_role_id);
create index rule_roles_rule_idx on public.distribution_rule_roles (rule_id);

-- ── immutability ────────────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_rule_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if old.status <> 'draft' then
    raise exception 'rule version % is % and cannot be edited; create a new draft instead',
      old.version, old.status using errcode = '42501';
  end if;
  if new.status <> old.status then
    raise exception 'use activate_rule() to change a rule''s status' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger rules_immutable
  before update on public.distribution_rules
  for each row execute function app.guard_rule_immutable();

-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_rule_child_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.rule_status;
  v_rule   uuid := coalesce(new.rule_id, old.rule_id);
begin
  if app.is_trusted_context() then
    return coalesce(new, old);
  end if;
  select r.status into v_status from public.distribution_rules r where r.id = v_rule;
  if v_status is distinct from 'draft' then
    raise exception 'this rule version is frozen' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger rule_areas_immutable
  before insert or update or delete on public.distribution_rule_areas
  for each row execute function app.guard_rule_child_immutable();

create trigger rule_roles_immutable
  before insert or update or delete on public.distribution_rule_roles
  for each row execute function app.guard_rule_child_immutable();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.distribution_rules enable row level security;
alter table public.distribution_rule_areas enable row level security;
alter table public.distribution_rule_roles enable row level security;

revoke all on public.distribution_rules from public, anon;
revoke all on public.distribution_rule_areas from public, anon;
revoke all on public.distribution_rule_roles from public, anon;
grant select, insert, update, delete on public.distribution_rules to authenticated;
grant select, insert, update, delete on public.distribution_rule_areas to authenticated;
grant select, insert, update, delete on public.distribution_rule_roles to authenticated;

-- Employees may read the rules they are paid under. Percentages without a pool
-- total are not amounts.
create policy rules_select_member on public.distribution_rules
  for select to authenticated using (app.is_member(workplace_id));
create policy rules_insert_manager on public.distribution_rules
  for insert to authenticated
  with check (app.is_manager(workplace_id) and status = 'draft');
create policy rules_update_manager on public.distribution_rules
  for update to authenticated
  using (app.is_manager(workplace_id) and status = 'draft')
  with check (app.is_manager(workplace_id));
create policy rules_delete_manager on public.distribution_rules
  for delete to authenticated
  using (app.is_manager(workplace_id) and status = 'draft');

create policy rule_areas_select_member on public.distribution_rule_areas
  for select to authenticated using (app.is_member(workplace_id));
create policy rule_areas_write_manager on public.distribution_rule_areas
  for all to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));

create policy rule_roles_select_member on public.distribution_rule_roles
  for select to authenticated using (app.is_member(workplace_id));
create policy rule_roles_write_manager on public.distribution_rule_roles
  for all to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));

-- ── create a draft from whatever is live ────────────────────────────────────
create or replace function public.create_rule_draft(p_workplace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft  uuid;
  v_active public.distribution_rules%rowtype;
  v_actor  uuid;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may edit rules' using errcode = '42501';
  end if;
  v_actor := app.member_id(p_workplace_id);

  select id into v_draft from public.distribution_rules
  where workplace_id = p_workplace_id and status = 'draft';
  if v_draft is not null then
    return v_draft;
  end if;

  select * into v_active from public.distribution_rules
  where workplace_id = p_workplace_id and status = 'active';

  insert into public.distribution_rules (
    workplace_id, status, method, min_overlap_minutes, overlap_basis,
    service_window_start, service_window_end, acknowledgement_required,
    rounding_area_id, adopted_by, agreement_reference, agreement_date, created_by
  )
  values (
    p_workplace_id, 'draft',
    coalesce(v_active.method, 'hours_points'),
    coalesce(v_active.min_overlap_minutes, 15),
    coalesce(v_active.overlap_basis, 'longest_shift'),
    v_active.service_window_start, v_active.service_window_end,
    coalesce(v_active.acknowledgement_required, true),
    v_active.rounding_area_id, v_active.adopted_by,
    v_active.agreement_reference, v_active.agreement_date, v_actor
  )
  returning id into v_draft;

  if v_active.id is not null then
    insert into public.distribution_rule_areas (rule_id, workplace_id, area_id, area_key, percentage)
    select v_draft, workplace_id, area_id, area_key, percentage
    from public.distribution_rule_areas where rule_id = v_active.id;
  else
    insert into public.distribution_rule_areas (rule_id, workplace_id, area_id, area_key, percentage)
    select v_draft, a.workplace_id, a.id, a.key, 0
    from public.workplace_areas a
    where a.workplace_id = p_workplace_id and a.archived_at is null and a.is_pool_eligible;
  end if;

  return v_draft;
end;
$$;

-- ── activation ──────────────────────────────────────────────────────────────
create or replace function public.activate_rule(p_rule_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule    public.distribution_rules%rowtype;
  v_total   numeric(7,2);
  v_version integer;
  v_actor   uuid;
begin
  select * into v_rule from public.distribution_rules where id = p_rule_id for update;
  if v_rule.id is null then
    raise exception 'rule not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_rule.workplace_id) then
    raise exception 'only a manager of this workplace may activate a rule' using errcode = '42501';
  end if;
  if v_rule.status <> 'draft' then
    raise exception 'only a draft can be activated' using errcode = '42501';
  end if;

  -- Serialise activations for this workplace.
  perform pg_advisory_xact_lock(hashtext('activate_rule:' || v_rule.workplace_id::text));

  select coalesce(sum(percentage), 0) into v_total
  from public.distribution_rule_areas where rule_id = p_rule_id;

  if v_total <> 100.00 then
    raise exception 'area shares must total exactly 100%%, got %', v_total
      using errcode = '23514';
  end if;

  -- Freeze the role weighting as it stands right now.
  delete from public.distribution_rule_roles where rule_id = p_rule_id;
  insert into public.distribution_rule_roles (rule_id, workplace_id, workplace_role_id, role_key, points)
  select p_rule_id, r.workplace_id, r.id, r.key, r.points
  from public.workplace_roles r
  where r.workplace_id = v_rule.workplace_id and r.archived_at is null;

  select coalesce(max(version), 0) + 1 into v_version
  from public.distribution_rules where workplace_id = v_rule.workplace_id;

  update public.distribution_rules
  set status = 'superseded', effective_to = now()
  where workplace_id = v_rule.workplace_id and status = 'active';

  v_actor := app.member_id(v_rule.workplace_id);

  update public.distribution_rules
  set status = 'active', version = v_version, effective_from = now(), activated_by = v_actor
  where id = p_rule_id;

  return v_version;
end;
$$;

revoke all on function public.create_rule_draft(uuid), public.activate_rule(uuid) from public;
grant execute on function public.create_rule_draft(uuid), public.activate_rule(uuid) to authenticated;

-- ── create_workplace now also leaves a draft rule ready to edit ─────────────
create or replace function public.create_workplace(
  p_name         text,
  p_city         text default null,
  p_timezone     text default 'Europe/Berlin',
  p_country_code char(2) default 'DE',
  p_currency     char(3) default 'EUR',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_workplace uuid;
  v_mgmt_area uuid;
  v_mgmt_role uuid;
  v_name      text;
  v_draft     uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a workplace needs a name' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;

  insert into public.workplaces (name, city, timezone, country_code, currency, join_code, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_city, '')), ''), p_timezone,
          upper(p_country_code), upper(p_currency), app.generate_join_code(), v_user)
  returning id into v_workplace;

  perform app.seed_workplace_defaults(v_workplace);

  select a.id into v_mgmt_area from public.workplace_areas a
  where a.workplace_id = v_workplace and a.key = 'management';
  select r.id into v_mgmt_role from public.workplace_roles r
  where r.workplace_id = v_workplace and r.key = 'manager';

  select coalesce(nullif(btrim(coalesce(p_display_name, '')), ''),
                  nullif(btrim(coalesce(pr.full_name, '')), ''),
                  split_part(coalesce(pr.email::text, 'manager'), '@', 1))
  into v_name from public.profiles pr where pr.id = v_user;

  insert into public.workplace_members
    (workplace_id, user_id, display_name, role, area_id, workplace_role_id, status, joined_at)
  values
    (v_workplace, v_user, coalesce(v_name, 'Manager'), 'manager', v_mgmt_area, v_mgmt_role, 'active', now());

  update public.profiles set last_workplace_id = v_workplace where id = v_user;

  -- A draft with every poolable area at 0%. The manager sets the split before
  -- the first distribution; nothing is decided on their behalf.
  insert into public.distribution_rules (workplace_id, status)
  values (v_workplace, 'draft')
  returning id into v_draft;

  insert into public.distribution_rule_areas (rule_id, workplace_id, area_id, area_key, percentage)
  select v_draft, a.workplace_id, a.id, a.key, 0
  from public.workplace_areas a
  where a.workplace_id = v_workplace and a.is_pool_eligible;

  return v_workplace;
end;
$$;

revoke all on function public.create_workplace(text, text, text, char, char, text) from public;
grant execute on function public.create_workplace(text, text, text, char, char, text) to authenticated;
