-- ═════════════════════════════════════════════════════════════════════════════
-- 10 · tip_pools, tip_distributions, tip_distribution_areas,
--      tip_distribution_entries, and the calculation engine.
--
-- Money is integer cents throughout; no float touches an amount. The engine
-- runs here rather than in the client, because the client is not authoritative
-- about money: there is no INSERT policy on distributions or entries at all.
--
-- Area subtotals live in their own table rather than on the entry. That is a
-- deliberate refinement of architecture v2: it means the pool total cannot be
-- reconstructed from a row an employee is allowed to read, so the visibility
-- rule is structural instead of depending on a view masking a column.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.tip_pools (
  id            uuid primary key default gen_random_uuid(),
  workplace_id  uuid not null references public.workplaces (id) on delete cascade,
  period        public.pool_period not null default 'shift',
  period_start  date not null,
  period_end    date not null,
  label         text not null default '',
  card_cents    bigint not null default 0 check (card_cents >= 0),
  cash_cents    bigint not null default 0 check (cash_cents >= 0),
  total_cents   bigint generated always as (card_cents + cash_cents) stored,
  source        text not null default 'manual'
                  check (source in ('manual', 'staff_reports', 'pos_import')),
  status        public.pool_status not null default 'open',
  note          text,
  created_by    uuid references public.workplace_members (id) on delete set null,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pools_period_order check (period_end >= period_start)
);

create unique index tip_pools_period_key
  on public.tip_pools (workplace_id, period_start, period_end, label)
  where status <> 'void';
create index tip_pools_recent_idx on public.tip_pools (workplace_id, period_start desc);
create index tip_pools_status_idx on public.tip_pools (workplace_id, status);

create trigger tip_pools_touch_updated_at
  before update on public.tip_pools
  for each row execute function app.touch_updated_at();

-- Amounts freeze the moment the pool leaves `open`.
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_pool_amounts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if old.status <> 'open'
     and (new.card_cents is distinct from old.card_cents
          or new.cash_cents is distinct from old.cash_cents) then
    raise exception 'this pool is % and its amounts can no longer change', old.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tip_pools_amount_guard
  before update on public.tip_pools
  for each row execute function app.guard_pool_amounts();

-- ── the distribution ────────────────────────────────────────────────────────
create table public.tip_distributions (
  id                  uuid primary key default gen_random_uuid(),
  workplace_id        uuid not null references public.workplaces (id) on delete cascade,
  tip_pool_id         uuid not null references public.tip_pools (id) on delete restrict,
  rule_id             uuid not null references public.distribution_rules (id) on delete restrict,
  rule_version        integer not null,
  period_start        date not null,
  period_end          date not null,
  pool_cents          bigint not null check (pool_cents >= 0),
  people_count        integer not null default 0,
  status              public.distribution_status not null default 'draft',
  method              public.rule_method not null,
  min_overlap_minutes integer not null,
  overlap_basis       public.overlap_basis not null,

  rules_snapshot      jsonb not null,
  inputs_snapshot     jsonb not null,
  engine_version      text not null,

  entries_total_cents bigint not null default 0,
  supersedes_id       uuid references public.tip_distributions (id) on delete set null,

  calculated_by       uuid references public.workplace_members (id) on delete set null,
  calculated_at       timestamptz not null default now(),
  sent_by             uuid references public.workplace_members (id) on delete set null,
  sent_at             timestamptz,
  confirmed_at        timestamptz,
  cancelled_by        uuid references public.workplace_members (id) on delete set null,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now()
);

-- One live distribution per pool.
create unique index tip_distributions_pool_live_key
  on public.tip_distributions (tip_pool_id)
  where status in ('draft', 'sent', 'confirmed');
create index tip_distributions_recent_idx
  on public.tip_distributions (workplace_id, period_start desc);
create index tip_distributions_status_idx
  on public.tip_distributions (workplace_id, status);

-- ── per-area block: percentage, units and the area's pot ────────────────────
-- Manager-only unless the workplace releases pool amounts. Kept apart from the
-- entries so an employee's own row can never be used to derive the total.
create table public.tip_distribution_areas (
  id              uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.tip_distributions (id) on delete cascade,
  workplace_id    uuid not null references public.workplaces (id) on delete cascade,
  area_id         uuid not null references public.workplace_areas (id) on delete restrict,
  area_key        text not null,
  area_name       text not null,
  percentage      numeric(5,2) not null,
  units           numeric(14,4) not null default 0,
  total_cents     bigint not null default 0 check (total_cents >= 0),
  people_count    integer not null default 0
);

create unique index tip_distribution_areas_key
  on public.tip_distribution_areas (distribution_id, area_id);
create index tip_distribution_areas_dist_idx
  on public.tip_distribution_areas (distribution_id);

-- ── one person's line, per area ─────────────────────────────────────────────
create table public.tip_distribution_entries (
  id                        uuid primary key default gen_random_uuid(),
  distribution_id           uuid not null references public.tip_distributions (id) on delete cascade,
  workplace_id              uuid not null references public.workplaces (id) on delete cascade,
  member_id                 uuid not null references public.workplace_members (id) on delete restrict,
  member_name               text not null,

  -- The area actually used, and where it came from.
  area_id                   uuid not null references public.workplace_areas (id) on delete restrict,
  area_key                  text not null,
  area_name                 text not null,
  area_source               public.area_source not null default 'member',

  role_key                  text,
  role_name                 text,
  points                    numeric(4,2) not null default 1.00,
  multiplier                numeric(4,2) not null default 1.00,

  worked_minutes            integer not null default 0,
  overlap_minutes           integer not null default 0,
  units                     numeric(12,4) not null default 0,
  amount_cents              bigint not null default 0 check (amount_cents >= 0),
  rounding_adjustment_cents integer not null default 0,

  shift_ids                 uuid[] not null default '{}',

  ack_status                public.entry_ack_status not null default 'pending',
  acknowledged_at           timestamptz,
  queried_at                timestamptz,
  query_note                text,
  created_at                timestamptz not null default now()
);

-- A person may appear twice in one distribution when they worked two areas.
-- Approved decision: keep the breakdown per area rather than blending it.
create unique index tip_distribution_entries_key
  on public.tip_distribution_entries (distribution_id, member_id, area_id);
create index tip_distribution_entries_member_idx
  on public.tip_distribution_entries (member_id, created_at desc);
create index tip_distribution_entries_dist_idx
  on public.tip_distribution_entries (distribution_id);
create index tip_distribution_entries_pending_idx
  on public.tip_distribution_entries (workplace_id, ack_status)
  where ack_status = 'pending';

comment on index public.tip_distribution_entries_key is
  'One entry per member per area: a member who worked Bar and Service gets two lines.';

-- ── immutability ────────────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_sent_distribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if old.status <> 'draft' then
    raise exception 'a distribution that has been sent cannot be edited; cancel and reissue'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tip_distributions_immutable
  before update on public.tip_distributions
  for each row execute function app.guard_sent_distribution();

-- An employee may only ever touch the acknowledgement columns of their own row.
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_entry_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;

  if (new.distribution_id, new.workplace_id, new.member_id, new.member_name,
      new.area_id, new.area_key, new.area_name, new.area_source,
      new.role_key, new.role_name, new.points, new.multiplier,
      new.worked_minutes, new.overlap_minutes, new.units,
      new.amount_cents, new.rounding_adjustment_cents, new.shift_ids)
     is distinct from
     (old.distribution_id, old.workplace_id, old.member_id, old.member_name,
      old.area_id, old.area_key, old.area_name, old.area_source,
      old.role_key, old.role_name, old.points, old.multiplier,
      old.worked_minutes, old.overlap_minutes, old.units,
      old.amount_cents, old.rounding_adjustment_cents, old.shift_ids)
  then
    raise exception 'distribution entries are calculated; only the acknowledgement can change'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tip_distribution_entries_guard
  before update on public.tip_distribution_entries
  for each row execute function app.guard_entry_columns();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.tip_pools enable row level security;
alter table public.tip_distributions enable row level security;
alter table public.tip_distribution_areas enable row level security;
alter table public.tip_distribution_entries enable row level security;

revoke all on public.tip_pools from public, anon;
revoke all on public.tip_distributions from public, anon;
revoke all on public.tip_distribution_areas from public, anon;
revoke all on public.tip_distribution_entries from public, anon;

grant select, insert, update on public.tip_pools to authenticated;
grant select, update, delete on public.tip_distributions to authenticated;
grant select on public.tip_distribution_areas to authenticated;
grant select, update on public.tip_distribution_entries to authenticated;
-- No INSERT anywhere on distributions, areas or entries: the engine writes them.

-- Pools are manager-only, full stop. The released total reaches employees
-- through member_distributions in migration 11, never from this table.
create policy pools_select_manager on public.tip_pools
  for select to authenticated using (app.is_manager(workplace_id));
create policy pools_insert_manager on public.tip_pools
  for insert to authenticated with check (app.is_manager(workplace_id));
create policy pools_update_manager on public.tip_pools
  for update to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));

create policy distributions_select_manager on public.tip_distributions
  for select to authenticated using (app.is_manager(workplace_id));
create policy distributions_update_manager on public.tip_distributions
  for update to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));
create policy distributions_delete_draft on public.tip_distributions
  for delete to authenticated
  using (app.is_manager(workplace_id) and status = 'draft');

-- Is this distribution published? Employees have no SELECT policy on
-- tip_distributions, so a policy subquery against it would always be false for
-- them. This helper answers the question without granting them the table.
create or replace function app.distribution_is_published(p_distribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tip_distributions d
    where d.id = p_distribution_id and d.status <> 'draft'
  )
$$;

revoke all on function app.distribution_is_published(uuid) from public;
grant execute on function app.distribution_is_published(uuid) to authenticated, service_role;

-- Area subtotals: managers always; members only once the workplace releases
-- pool amounts, because sum(total_cents) is the pool.
create policy distribution_areas_select on public.tip_distribution_areas
  for select to authenticated
  using (
    app.is_manager(workplace_id)
    or (
      app.is_member(workplace_id)
      and exists (
        select 1 from public.workplaces w
        where w.id = workplace_id and w.pool_amount_visible_to_members
      )
      and app.distribution_is_published(distribution_id)
    )
  );

-- Peer visibility is decided here, in one place, rather than in a view.
create or replace function app.can_see_entry(
  p_workplace_id uuid, p_distribution_id uuid, p_member_id uuid, p_area_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.member_id(p_workplace_id) is null then false
    when not app.distribution_is_published(p_distribution_id) then false
    when p_member_id = app.member_id(p_workplace_id) then true
    else (
      select case w.peer_entry_visibility
        when 'none' then false
        when 'workplace' then true
        when 'area' then exists (
          select 1 from public.tip_distribution_entries e
          where e.distribution_id = p_distribution_id
            and e.member_id = app.member_id(p_workplace_id)
            and e.area_id = p_area_id
        )
      end
      from public.workplaces w where w.id = p_workplace_id
    )
  end
$$;

comment on function app.can_see_entry(uuid, uuid, uuid, uuid) is
  'Own entry always; peers only per workplaces.peer_entry_visibility. SECURITY DEFINER so the "same area" test does not recurse into the entries policy.';

revoke all on function app.can_see_entry(uuid, uuid, uuid, uuid) from public;
grant execute on function app.can_see_entry(uuid, uuid, uuid, uuid) to authenticated, service_role;

create policy entries_select on public.tip_distribution_entries
  for select to authenticated
  using (
    app.is_manager(workplace_id)
    or app.can_see_entry(workplace_id, distribution_id, member_id, area_id)
  );

create policy entries_update_own_ack on public.tip_distribution_entries
  for update to authenticated
  using (
    member_id = app.member_id(workplace_id)
    and app.distribution_is_published(distribution_id)
  )
  with check (member_id = app.member_id(workplace_id));
