-- ═════════════════════════════════════════════════════════════════════════════
-- 08 · shifts and tip_reports
--
-- Instants are authoritative; the business day is stored, not inferred; area
-- and role may be overridden per shift. An 18:00–02:00 shift is one row whose
-- ends_at falls on the next calendar day, and whose work_date is the night it
-- belongs to.
-- ═════════════════════════════════════════════════════════════════════════════

-- Instant → business date, in the workplace's own timezone and cut-off.
-- A shift starting 01:00 on Sunday with a 05:00 cut-off is Saturday's night.
create or replace function app.business_day(p_ts timestamptz, p_workplace_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ((p_ts at time zone w.timezone)
          - pg_catalog.make_interval(hours => w.business_day_start_hour))::date
  from public.workplaces w
  where w.id = p_workplace_id
$$;

revoke all on function app.business_day(timestamptz, uuid) from public;
grant execute on function app.business_day(timestamptz, uuid) to authenticated, service_role;

create table public.shifts (
  id                uuid primary key default gen_random_uuid(),
  workplace_id      uuid not null references public.workplaces (id) on delete cascade,
  member_id         uuid not null references public.workplace_members (id) on delete restrict,

  -- Derived by trigger from starts_at. Clients never set it.
  work_date         date not null,

  starts_at         timestamptz not null,
  ends_at           timestamptz not null,

  -- Range form, so overlap is an indexable intersection rather than arithmetic.
  during            tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,

  break_minutes     integer not null default 0 check (break_minutes >= 0 and break_minutes < 1440),

  worked_minutes    integer generated always as (
                      greatest(0, floor(extract(epoch from (ends_at - starts_at)) / 60)::integer
                                  - break_minutes)
                    ) stored,

  -- Overrides. Null means "use the member's default".
  area_id           uuid references public.workplace_areas (id) on delete restrict,
  workplace_role_id uuid references public.workplace_roles (id) on delete restrict,

  status            public.shift_status not null default 'draft',
  source            public.shift_source not null default 'employee',
  locked            boolean not null default false,

  submitted_at      timestamptz,
  reviewed_by       uuid references public.workplace_members (id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  created_by        uuid references public.workplace_members (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint shifts_end_after_start check (ends_at > starts_at),
  -- Catches the wrong-day entry that would otherwise pay someone for 30 hours.
  constraint shifts_max_length check (ends_at - starts_at < interval '24 hours')
);

comment on column public.shifts.work_date is
  'Business day, derived from starts_at with the workplace timezone and cut-off hour.';
comment on column public.shifts.area_id is
  'Per-shift area override. Null falls back to workplace_members.area_id.';

-- One person cannot be in two places at once.
alter table public.shifts
  add constraint shifts_no_member_overlap
  exclude using gist (member_id with =, during with &&)
  where (status <> 'rejected');

create index shifts_day_idx on public.shifts (workplace_id, work_date);
create index shifts_member_idx on public.shifts (member_id, work_date desc);
create index shifts_overlap_idx on public.shifts using gist (workplace_id, during);
create index shifts_review_idx on public.shifts (workplace_id, status) where status = 'submitted';

create trigger shifts_touch_updated_at
  before update on public.shifts
  for each row execute function app.touch_updated_at();

-- ── derive the business day, and keep every reference in one workplace ──────
create or replace function app.shifts_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member         public.workplace_members%rowtype;
  v_effective_area uuid;
  v_role_area      uuid;
begin
  select * into v_member from public.workplace_members m where m.id = new.member_id;
  if v_member.id is null then
    raise exception 'unknown member' using errcode = '23503';
  end if;
  if v_member.workplace_id <> new.workplace_id then
    raise exception 'shift member belongs to a different workplace' using errcode = '23514';
  end if;

  new.work_date := app.business_day(new.starts_at, new.workplace_id);

  if new.area_id is not null then
    if not exists (select 1 from public.workplace_areas a
                   where a.id = new.area_id and a.workplace_id = new.workplace_id) then
      raise exception 'area belongs to a different workplace' using errcode = '23514';
    end if;
  end if;

  -- A shift-level area override also decides the weighting context. If a role
  -- is named it must belong to the effective area, so nobody is moved into
  -- another area while still carrying their old area's points.
  if new.workplace_role_id is not null then
    v_effective_area := coalesce(new.area_id, v_member.area_id);
    select r.area_id into v_role_area
    from public.workplace_roles r
    where r.id = new.workplace_role_id and r.workplace_id = new.workplace_id;

    if v_role_area is null then
      raise exception 'role belongs to a different workplace' using errcode = '23514';
    end if;
    if v_effective_area is not null and v_role_area <> v_effective_area then
      raise exception 'shift role must belong to the effective area of the shift'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger shifts_before_write
  before insert or update on public.shifts
  for each row execute function app.shifts_before_write();

-- A locked shift is frozen. A manager unlocks first, then corrects.
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_locked_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if old.locked and new.locked then
    raise exception 'this shift is locked; a manager must unlock it before it can change'
      using errcode = '42501';
  end if;
  if old.locked and not new.locked and not app.is_manager(old.workplace_id) then
    raise exception 'only a manager may unlock a shift' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger shifts_locked_guard
  before update on public.shifts
  for each row execute function app.guard_locked_shift();

alter table public.shifts enable row level security;
revoke all on public.shifts from public, anon;
grant select, insert, update, delete on public.shifts to authenticated;

create policy shifts_select on public.shifts
  for select to authenticated
  using (app.is_manager(workplace_id) or member_id = app.member_id(workplace_id));

create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    app.is_manager(workplace_id)
    or (member_id = app.member_id(workplace_id) and status in ('draft', 'submitted'))
  );

create policy shifts_update on public.shifts
  for update to authenticated
  using (
    app.is_manager(workplace_id)
    or (member_id = app.member_id(workplace_id) and not locked and status <> 'approved')
  )
  with check (
    app.is_manager(workplace_id)
    or (member_id = app.member_id(workplace_id) and status in ('draft', 'submitted'))
  );

create policy shifts_delete_own_draft on public.shifts
  for delete to authenticated
  using (member_id = app.member_id(workplace_id) and status = 'draft' and not locked);

-- ── what staff counted at the end of their shift ────────────────────────────
create table public.tip_reports (
  id           uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces (id) on delete cascade,
  member_id    uuid not null references public.workplace_members (id) on delete restrict,
  work_date    date not null,
  card_cents   bigint not null default 0 check (card_cents >= 0),
  cash_cents   bigint not null default 0 check (cash_cents >= 0),
  total_cents  bigint generated always as (card_cents + cash_cents) stored,
  note         text,
  reported_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index tip_reports_member_day_key
  on public.tip_reports (workplace_id, member_id, work_date);
create index tip_reports_day_idx on public.tip_reports (workplace_id, work_date desc);

create trigger tip_reports_touch_updated_at
  before update on public.tip_reports
  for each row execute function app.touch_updated_at();

alter table public.tip_reports enable row level security;
revoke all on public.tip_reports from public, anon;
grant select, insert, update, delete on public.tip_reports to authenticated;

create policy tip_reports_select on public.tip_reports
  for select to authenticated
  using (app.is_manager(workplace_id) or member_id = app.member_id(workplace_id));

create policy tip_reports_insert_own on public.tip_reports
  for insert to authenticated
  with check (app.is_manager(workplace_id) or member_id = app.member_id(workplace_id));

create policy tip_reports_update on public.tip_reports
  for update to authenticated
  using (app.is_manager(workplace_id) or member_id = app.member_id(workplace_id))
  with check (app.is_manager(workplace_id) or member_id = app.member_id(workplace_id));

create policy tip_reports_delete_own on public.tip_reports
  for delete to authenticated
  using (member_id = app.member_id(workplace_id));
