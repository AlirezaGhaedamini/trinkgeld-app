-- ═════════════════════════════════════════════════════════════════════════════
-- 15 · three defects found auditing the Phase 2 distribution path
--
-- ── F1 · the engine ignores overlap_basis ───────────────────────────────────
-- public.overlap_basis has three values. calculate_distribution() implements
-- exactly one of them — the longest shift of the period as the anchor — and
-- never reads the column. A rule set to 'pairwise' therefore computes
-- longest_shift, and then writes 'pairwise' into tip_distributions.overlap_basis
-- and into rules_snapshot. The permanent record would describe a calculation
-- that never happened, which is worse than the missing feature.
--
-- The fix is not to invent pairwise overlap — that is a product decision, and
-- it changes who gets paid. The fix is to refuse: a rule whose basis the engine
-- cannot honour cannot be activated, and cannot be calculated with.
--
-- ── F2 · send_distribution() finalises a stale draft ────────────────────────
-- A manager calculates, a colleague approves another shift, the manager presses
-- send. The draft is sent unchanged: the new shift is silently left out of a
-- final, immutable payment record, and nothing anywhere says so.
--
-- Fixed with a fingerprint over every input the result depends on, taken at
-- calculation and re-derived at send. Different → refuse and ask for a
-- recalculation. Option (B) of the two honest choices; including the new state
-- silently at send would mean finalising numbers no one previewed.
--
-- ── F3 · a tip report can fund two pools ────────────────────────────────────
-- tip_pools.source can say 'staff_reports', but nothing derives a pool from
-- them and nothing records which reports a pool consumed. Two pools with
-- overlapping periods could both count the same report, and the money would be
-- paid out twice with no trace.
--
-- Fixed with a server-side derivation and a link table whose unique index makes
-- double counting impossible rather than merely discouraged.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── F1 ──────────────────────────────────────────────────────────────────────

create or replace function app.engine_supports_basis(p_basis public.overlap_basis)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_basis = 'longest_shift' $$;

comment on function app.engine_supports_basis(public.overlap_basis) is
  'Which overlap models app.calculate_distribution actually implements. Extend '
  'this and the engine together, never one without the other.';

revoke all on function app.engine_supports_basis(public.overlap_basis) from public;
grant execute on function app.engine_supports_basis(public.overlap_basis)
  to authenticated, service_role;

-- ── F3 · which reports a pool was built from ────────────────────────────────

create table public.tip_pool_sources (
  pool_id       uuid not null references public.tip_pools (id) on delete cascade,
  tip_report_id uuid not null references public.tip_reports (id) on delete restrict,
  workplace_id  uuid not null references public.workplaces (id) on delete cascade,
  card_cents    bigint not null,
  cash_cents    bigint not null,
  created_at    timestamptz not null default now(),
  primary key (pool_id, tip_report_id)
);

comment on table public.tip_pool_sources is
  'The tip reports a pool was derived from, with the amounts as they stood. The '
  'unique index below is what makes double counting impossible.';

-- One live pool per report. Voiding a pool releases its reports (trigger below),
-- so a mistake can be corrected without the report being stranded.
create unique index tip_pool_sources_report_key on public.tip_pool_sources (tip_report_id);
create index tip_pool_sources_pool_idx on public.tip_pool_sources (pool_id);

create or replace function app.release_void_pool_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tip_pool_sources where pool_id = new.id;
  return null;
end;
$$;

create trigger tip_pools_release_sources
  after update on public.tip_pools
  for each row
  when (new.status = 'void' and old.status is distinct from 'void')
  execute function app.release_void_pool_sources();

alter table public.tip_pool_sources enable row level security;
revoke all on public.tip_pool_sources from public, anon;
grant select on public.tip_pool_sources to authenticated;
-- No INSERT: only create_pool_from_reports() writes here.

create policy pool_sources_select_manager on public.tip_pool_sources
  for select to authenticated using (app.is_manager(workplace_id));

/**
 * Build a pool from what the team actually reported.
 *
 * The total is summed here, not sent by the browser: the client has no business
 * asserting how much money there is when the database is holding the receipts.
 * Reports already consumed by a live pool are excluded, and the unique index
 * turns a concurrent second attempt into a constraint violation rather than a
 * double payout.
 */
create or replace function public.create_pool_from_reports(
  p_workplace_id uuid,
  p_period_start date,
  p_period_end   date,
  p_label        text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool  uuid;
  v_card  bigint;
  v_cash  bigint;
  v_count integer;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may open a pool' using errcode = '42501';
  end if;
  if p_period_end < p_period_start then
    raise exception 'the period ends before it starts' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('pool_from_reports:' || p_workplace_id::text));

  create temp table tmp_pool_reports on commit drop as
  select r.id, r.card_cents, r.cash_cents
  from public.tip_reports r
  where r.workplace_id = p_workplace_id
    and r.work_date between p_period_start and p_period_end
    and not exists (select 1 from public.tip_pool_sources s where s.tip_report_id = r.id);

  select count(*), coalesce(sum(card_cents), 0), coalesce(sum(cash_cents), 0)
  into v_count, v_card, v_cash
  from tmp_pool_reports;

  if v_count = 0 then
    raise exception 'there are no unused tip reports in that period' using errcode = '22023';
  end if;

  insert into public.tip_pools
    (workplace_id, period, period_start, period_end, label,
     card_cents, cash_cents, source, status, created_by)
  values
    (p_workplace_id,
     (case when p_period_start = p_period_end then 'day' else 'custom' end)::public.pool_period,
     p_period_start, p_period_end, coalesce(btrim(p_label), ''),
     v_card, v_cash, 'staff_reports', 'open', app.member_id(p_workplace_id))
  returning id into v_pool;

  insert into public.tip_pool_sources (pool_id, tip_report_id, workplace_id, card_cents, cash_cents)
  select v_pool, id, p_workplace_id, card_cents, cash_cents from tmp_pool_reports;

  return v_pool;
end;
$$;

revoke all on function public.create_pool_from_reports(uuid, date, date, text) from public;
grant execute on function public.create_pool_from_reports(uuid, date, date, text) to authenticated;

-- ── F2 · the fingerprint ────────────────────────────────────────────────────

alter table public.tip_distributions add column if not exists inputs_fingerprint text;

comment on column public.tip_distributions.inputs_fingerprint is
  'Digest of every input the amounts depend on, taken at calculation. '
  'send_distribution() re-derives it and refuses if it has moved.';

/**
 * A digest of everything that could change the numbers.
 *
 * The pool's amounts, the active rule and its area shares and role points, and
 * every approved shift in the period with the member facts that weight it. If
 * any of that moves between calculating and sending, the draft on screen is no
 * longer a description of the world and must not become a payment record.
 */
create or replace function app.distribution_fingerprint(p_pool_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pool public.tip_pools%rowtype;
  v_rule public.distribution_rules%rowtype;
  v_text text;
begin
  select * into v_pool from public.tip_pools where id = p_pool_id;
  if v_pool.id is null then
    return null;
  end if;

  select * into v_rule from public.distribution_rules
  where workplace_id = v_pool.workplace_id and status = 'active';

  v_text :=
    coalesce(v_pool.card_cents::text, '') || '|' ||
    coalesce(v_pool.cash_cents::text, '') || '|' ||
    coalesce(v_rule.id::text, 'no-rule') || '|' ||
    coalesce(v_rule.version::text, '') || '|' ||
    coalesce(v_rule.method::text, '') || '|' ||
    coalesce(v_rule.min_overlap_minutes::text, '') || '|' ||
    coalesce(v_rule.overlap_basis::text, '') || '|' ||
    coalesce(v_rule.rounding_area_id::text, '') || '||' ||
    coalesce((
      select pg_catalog.string_agg(ra.area_id::text || ':' || ra.percentage::text, ',' order by ra.area_id)
      from public.distribution_rule_areas ra where ra.rule_id = v_rule.id
    ), '') || '||' ||
    coalesce((
      select pg_catalog.string_agg(rr.workplace_role_id::text || ':' || rr.points::text, ',' order by rr.workplace_role_id)
      from public.distribution_rule_roles rr where rr.rule_id = v_rule.id
    ), '') || '||' ||
    coalesce((
      select pg_catalog.string_agg(
               sh.id::text || ':' || sh.member_id::text || ':' ||
               coalesce(sh.area_id::text, '-') || ':' ||
               coalesce(sh.workplace_role_id::text, '-') || ':' ||
               sh.worked_minutes::text || ':' ||
               pg_catalog.date_part('epoch', sh.starts_at)::bigint::text || ':' ||
               pg_catalog.date_part('epoch', sh.ends_at)::bigint::text || ':' ||
               coalesce(m.area_id::text, '-') || ':' ||
               coalesce(m.workplace_role_id::text, '-') || ':' ||
               m.multiplier::text,
               ',' order by sh.id)
      from public.shifts sh
      join public.workplace_members m on m.id = sh.member_id
      where sh.workplace_id = v_pool.workplace_id
        and sh.work_date between v_pool.period_start and v_pool.period_end
        and sh.status = 'approved'
        and sh.worked_minutes > 0
    ), '');

  return pg_catalog.md5(v_text);
end;
$$;

revoke all on function app.distribution_fingerprint(uuid) from public;
grant execute on function app.distribution_fingerprint(uuid) to authenticated, service_role;

-- ── the two functions, republished with the checks in place ─────────────────
-- Only the guard clauses and the fingerprint are new; the arithmetic below the
-- authorisation block is migration 11's, unchanged.

create or replace function public.send_distribution(p_distribution_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dist public.tip_distributions%rowtype;
  v_now  text;
begin
  select * into v_dist from public.tip_distributions where id = p_distribution_id for update;
  if v_dist.id is null or not app.is_manager(v_dist.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  if v_dist.status <> 'draft' then
    -- Includes the second click, the retried request and the second tab. The
    -- FOR UPDATE above serialises them; the first one through wins.
    raise exception 'only a draft can be sent' using errcode = '42501';
  end if;

  v_now := app.distribution_fingerprint(v_dist.tip_pool_id);
  if v_dist.inputs_fingerprint is not null and v_now is distinct from v_dist.inputs_fingerprint then
    raise exception
      'the hours or the rule changed since this distribution was calculated; recalculate before sending'
      using errcode = '23514';
  end if;

  update public.tip_distributions
  set status = 'sent', sent_at = now(), sent_by = app.member_id(v_dist.workplace_id)
  where id = p_distribution_id;

  update public.tip_pools set status = 'distributed' where id = v_dist.tip_pool_id;
end;
$$;

-- activate_rule: refuse a basis the engine cannot honour, at the moment the
-- manager tries to make it real rather than at the moment money is calculated.
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
  if not app.engine_supports_basis(v_rule.overlap_basis) then
    raise exception
      'the % overlap model is not implemented; the engine measures overlap against the longest shift',
      v_rule.overlap_basis using errcode = '0A000';
  end if;

  perform pg_advisory_xact_lock(hashtext('activate_rule:' || v_rule.workplace_id::text));

  select coalesce(sum(percentage), 0) into v_total
  from public.distribution_rule_areas where rule_id = p_rule_id;

  if v_total <> 100.00 then
    raise exception 'area shares must total exactly 100%%, got %', v_total
      using errcode = '23514';
  end if;

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

-- calculate_distribution() itself is left exactly as migration 11 wrote it.
-- Both new invariants belong to the table rather than to one function, so they
-- are enforced by a trigger: any future path that writes a distribution gets
-- them too, and two hundred lines of arithmetic do not have to be duplicated
-- into this migration to add six.
create or replace function app.stamp_distribution_inputs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- F1: never record a basis the engine did not actually use.
  if not app.engine_supports_basis(new.overlap_basis) then
    raise exception
      'the % overlap model is not implemented; the engine measures overlap against the longest shift',
      new.overlap_basis using errcode = '0A000';
  end if;

  -- F2: take the fingerprint in the same transaction as the calculation.
  if new.inputs_fingerprint is null then
    new.inputs_fingerprint := app.distribution_fingerprint(new.tip_pool_id);
  end if;

  return new;
end;
$$;

create trigger tip_distributions_stamp_inputs
  before insert on public.tip_distributions
  for each row execute function app.stamp_distribution_inputs();
