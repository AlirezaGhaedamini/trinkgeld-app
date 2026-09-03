-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3N · period close and the read-only financial export
--
-- A close records that a manager reviewed and closed a period at a point in
-- time. It deletes nothing, recalculates nothing, moves no money, hides no
-- history and files nothing with anybody. The export is a read-only view of
-- what the database already says.
--
-- ── WHAT THE AUDIT FOUND ──────────────────────────────────────────────────
--
-- 1. A FINANCIAL PERIOD IS ALREADY MODELLED, in business dates. A pool is built
--    from tip_reports.work_date; a distribution copies the pool's period_start
--    and period_end; and work_date is written by app.shifts_before_write() via
--    app.business_day(), which is the workplace's own timezone minus its
--    business_day_start_hour. So "1 Sep – 7 Sep" already means seven business
--    days of that workplace, and a close over those dates lands on columns that
--    exist. No new date arithmetic is added here, and none belongs in the
--    browser.
--
-- 2. THE FINANCIAL ROWS ARE ALREADY IMMUTABLE OR VERSIONED. A sent distribution
--    cannot change; its entries cannot change; a payout and a reversal each have
--    a guard with no escape. So a close does not need to freeze anything, and
--    does not need a snapshot of rows that cannot move. It is a checkpoint.
--
-- 3. btree_gist IS ALREADY INSTALLED, for the shift overlap constraint. So
--    "closed periods must not overlap" can be an EXCLUDE constraint — an
--    index-backed guarantee rather than a trigger that races.
--
-- 4. NOTHING LIKE THIS EXISTS YET. No close table, no period table, no export.
--    The one "Export" in the product is a demo-mode toast on the employee
--    profile screen, backed by nothing.
--
-- 5. SETTLEMENT EVENTS BELONG TO THE DISTRIBUTION'S PERIOD, not to the date they
--    were recorded. A payout entered in October for a distribution of 3
--    September is September's money. The export follows the distribution, never
--    paid_at, which is why a period stays complete as it is settled.
--
-- ── WHAT A CLOSE DOES NOT DO ──────────────────────────────────────────────
-- It does not stop a correction. A mistake found in October about a September
-- shift is still a mistake, and the replacement architecture is how this product
-- fixes one. The close stays exactly as it was, the correction is allowed, and
-- the export marks every record that arrived after the close so nobody is left
-- believing the closed figures already contained it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the checkpoint ─────────────────────────────────────────────────────────
create table public.financial_period_closes (
  id           uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces (id) on delete cascade,

  -- Business dates, the same ones tip_distributions.period_start carries.
  period_start date not null,
  period_end   date not null,

  note         text,
  closed_at    timestamptz not null default now(),
  closed_by    uuid references public.workplace_members (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint closes_period_order check (period_end >= period_start),
  -- Migration 25's definition of blank, not a second opinion about it.
  constraint closes_note_shape
    check (note is null or length(app.trimmed_note(note)) between 1 and 500),

  -- Closed periods for one workplace may not overlap. Inclusive on both ends,
  -- so 1–7 and 8–14 are neighbours and 1–7 and 5–10 are not allowed. The
  -- constraint is an index, so two managers closing overlapping ranges at the
  -- same instant is decided by the database rather than by whoever's button
  -- was disabled last.
  constraint closes_no_overlap exclude using gist (
    workplace_id with =,
    daterange(period_start, period_end, '[]') with &&)
);

create index financial_period_closes_recent_idx
  on public.financial_period_closes (workplace_id, period_start desc);

comment on table public.financial_period_closes is
  'Phase 3N: one immutable row per closed period. A checkpoint over records that are '
  'already immutable — never a freeze, and never a snapshot.';

-- ── a close is a record of a decision ──────────────────────────────────────
create or replace function app.guard_close_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a period close is a record of a decision; it cannot be edited'
      using errcode = '42501';
  end if;
  raise exception 'a period close cannot be deleted; close the next period instead'
    using errcode = '42501';
end;
$$;

create trigger closes_are_immutable
  before update or delete on public.financial_period_closes
  for each row execute function app.guard_close_immutable();

create trigger audit_financial_period_closes
  after insert or update or delete on public.financial_period_closes
  for each row execute function app.write_audit();

-- ── who may see one ────────────────────────────────────────────────────────
alter table public.financial_period_closes enable row level security;

create policy closes_read_manager on public.financial_period_closes
  for select to authenticated
  using (app.is_manager(workplace_id));

-- No insert, update or delete policy. The definer RPC is the only way in.

revoke all on public.financial_period_closes from public, anon;
grant select on public.financial_period_closes to authenticated;

-- ── is this period ready to close? ─────────────────────────────────────────
/**
 * What stands in the way, and what is merely worth knowing.
 *
 * BLOCKING, because each one means the period's financial result is not yet
 * decided:
 *   · a draft distribution — a night calculated and never sent
 *   · a draft correction — a replacement prepared and never published
 *   · an unresolved question — somebody asked and nobody has answered
 *   · an agreed correction with nothing sent — the manager said "yes, this is
 *     wrong" and the corrected version does not exist yet
 *
 * NOT BLOCKING, deliberately:
 *   · unpaid distributions. A workplace routinely closes the calculation for a
 *     week and pays it out with the monthly payroll run. Refusing to close until the
 *     money has moved would make the feature useless to exactly the businesses
 *     it is for. The count is surfaced as a warning instead.
 *   · unacknowledged shares. A person on holiday should not hold up a close.
 */
create or replace function public.financial_period_readiness(
  p_workplace_id uuid,
  p_period_start date,
  p_period_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_drafts     integer;
  v_repl       integer;
  v_open_q     integer;
  v_agreed_q   integer;
  v_unpaid     integer;
  v_unack      integer;
  v_overlap    integer;
  v_dists      integer;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may read this' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'a period needs a start and an end' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'the period ends before it starts' using errcode = '22023';
  end if;

  select count(*) into v_dists from public.tip_distributions d
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end;

  select count(*) into v_drafts from public.tip_distributions d
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and d.status = 'draft' and d.supersedes_id is null;

  select count(*) into v_repl from public.tip_distributions d
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and d.status = 'draft' and d.supersedes_id is not null;

  select count(*) into v_open_q from public.distribution_queries q
  join public.tip_distributions d on d.id = q.distribution_id
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and q.status = 'open';

  -- Agreed to be wrong, and the corrected version has not been published.
  select count(*) into v_agreed_q from public.distribution_queries q
  join public.tip_distributions d on d.id = q.distribution_id
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and q.status = 'resolved' and q.outcome = 'correction_required'
    and not exists (
      select 1 from public.tip_distributions r
      where r.supersedes_id = d.id and r.status not in ('draft', 'cancelled'));

  select count(*) into v_unpaid from public.tip_distributions d
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and d.status in ('sent', 'confirmed')
    and app.effective_payout(d.id) is null;

  select count(*) into v_unack from public.tip_distribution_entries e
  join public.tip_distributions d on d.id = e.distribution_id
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and d.status in ('sent', 'confirmed')
    and e.ack_status = 'pending';

  select count(*) into v_overlap from public.financial_period_closes c
  where c.workplace_id = p_workplace_id
    and daterange(c.period_start, c.period_end, '[]')
        && daterange(p_period_start, p_period_end, '[]');

  return jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'distributions', v_dists,
    'blocking', jsonb_build_object(
      'draft_distributions', v_drafts,
      'draft_corrections', v_repl,
      'open_questions', v_open_q,
      'agreed_corrections_not_sent', v_agreed_q,
      'overlapping_close', v_overlap),
    'warnings', jsonb_build_object(
      'unpaid_distributions', v_unpaid,
      'unacknowledged_shares', v_unack),
    'can_close', (v_drafts + v_repl + v_open_q + v_agreed_q + v_overlap) = 0);
end;
$$;

revoke all on function public.financial_period_readiness(uuid, date, date) from public;
grant execute on function public.financial_period_readiness(uuid, date, date) to authenticated;

-- ── closing it ─────────────────────────────────────────────────────────────
create or replace function public.close_financial_period(
  p_workplace_id uuid,
  p_period_start date,
  p_period_end   date,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note  text := app.trimmed_note(p_note);
  v_ready jsonb;
  v_actor uuid;
  v_id    uuid;
begin
  -- The browser sends a workplace id, so the workplace id is checked. It sends
  -- no actor and no timestamp; both come from the session and the server.
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may close a period'
      using errcode = '42501';
  end if;
  v_actor := app.member_id(p_workplace_id);

  if p_period_start is null or p_period_end is null then
    raise exception 'a period needs a start and an end' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'the period ends before it starts' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'that note is too long; 500 characters is the limit' using errcode = '22023';
  end if;

  -- Lock the workplace row so two managers closing overlapping ranges at the
  -- same instant are ordered here. The exclusion constraint would catch it
  -- anyway; this makes the message the readable one rather than a constraint
  -- name.
  perform 1 from public.workplaces w where w.id = p_workplace_id for update;

  v_ready := public.financial_period_readiness(p_workplace_id, p_period_start, p_period_end);
  if (v_ready -> 'blocking' ->> 'overlapping_close')::int > 0 then
    raise exception 'part of that period has already been closed' using errcode = '23505';
  end if;
  if not (v_ready ->> 'can_close')::boolean then
    raise exception
      'this period still has work in it: % draft distribution(s), % draft correction(s), % unanswered question(s), % agreed correction(s) not yet sent',
      v_ready -> 'blocking' ->> 'draft_distributions',
      v_ready -> 'blocking' ->> 'draft_corrections',
      v_ready -> 'blocking' ->> 'open_questions',
      v_ready -> 'blocking' ->> 'agreed_corrections_not_sent'
      using errcode = '42501';
  end if;

  insert into public.financial_period_closes
    (workplace_id, period_start, period_end, note, closed_by)
  values (p_workplace_id, p_period_start, p_period_end, v_note, v_actor)
  returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'part of that period has already been closed' using errcode = '23505';
end;
$$;

revoke all on function public.close_financial_period(uuid, date, date, text) from public;
grant execute on function public.close_financial_period(uuid, date, date, text) to authenticated;

comment on function public.close_financial_period(uuid, date, date, text) is
  'Phase 3N: records a period close. Derives the actor from the session and the time '
  'from the server; refuses an overlap and a period whose financial result is not yet '
  'decided. Never freezes anything.';

-- ── the export ─────────────────────────────────────────────────────────────
/**
 * ONE authoritative dataset. CSV is formatted from this and nothing else, so a
 * total on a spreadsheet and a total on a screen cannot disagree — there is only
 * one place either could come from.
 *
 * THE TOTALS, each with exactly one definition:
 *
 *   current_entitlement_cents   what the team is owed for this period, summed
 *                               over the versions that are CURRENT. A replaced
 *                               version contributes nothing.
 *   replaced_entitlement_cents  what the superseded versions said, reported
 *                               beside it and never added to it.
 *   payout_total_cents          every payout event, including ones later reversed.
 *   reversal_total_cents        what those reversals took back, as a positive number.
 *   effective_settled_cents     payouts that still count. This is the money.
 *   outstanding_cents           current entitlement minus what still counts.
 *
 * The one thing this must never do is add an original and its replacement
 * together as though the workplace owed both.
 */
create or replace function public.financial_period_export(
  p_workplace_id uuid,
  p_period_start date,
  p_period_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wp        public.workplaces%rowtype;
  v_close     public.financial_period_closes%rowtype;
  v_closed_at timestamptz;
  v_dists     jsonb;
  v_summary   jsonb;
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may export it' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'that is not a period' using errcode = '22023';
  end if;

  select * into v_wp from public.workplaces w where w.id = p_workplace_id;

  -- The close that covers this range exactly, if there is one. A partial
  -- overlap is not this period's close and is deliberately not shown as one.
  select * into v_close from public.financial_period_closes c
  where c.workplace_id = p_workplace_id
    and c.period_start = p_period_start and c.period_end = p_period_end;
  v_closed_at := v_close.closed_at;

  -- ── the distributions, each with its people and its settlement events ────
  select coalesce(jsonb_agg(row order by row ->> 'sort_key'), '[]'::jsonb)
  into v_dists
  from (
    select jsonb_build_object(
      'sort_key', to_char(d.period_start, 'YYYY-MM-DD') || ' ' ||
                  to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'id', d.id,
      'period_start', d.period_start,
      'period_end', d.period_end,
      'status', d.status,
      'is_current', d.status in ('sent', 'confirmed'),
      'is_correction', d.supersedes_id is not null,
      'supersedes_id', d.supersedes_id,
      'correction_source', case
        when d.supersedes_id is null then null
        when d.trigger_query_id is not null then 'employee_query'
        when d.correction_reason is not null then 'manager'
        else null end,
      'correction_reason', d.correction_reason,
      'correction_note', d.correction_note,
      'trigger_query_note', (select q.note from public.distribution_queries q
                              where q.id = d.trigger_query_id),
      'rule_version', d.rule_version,
      'method', d.method,
      'overlap_basis', d.overlap_basis,
      'min_overlap_minutes', d.min_overlap_minutes,
      'people_count', d.people_count,
      'pool_cents', d.pool_cents,
      'entitlement_cents', d.entries_total_cents,
      'created_at', d.created_at,
      'sent_at', d.sent_at,
      -- Arrived after the manager closed this period. The close is not rewritten
      -- and does not pretend to have contained it.
      'after_close', v_closed_at is not null and d.created_at > v_closed_at,
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          -- Snapshot names, frozen when the distribution was calculated. A later
          -- rename does not rewrite what a person was paid under, and no profile
          -- row, email or auth id is read here at all.
          'member_name', e.member_name,
          'area_name', e.area_name,
          'role_name', e.role_name,
          'worked_minutes', e.worked_minutes,
          'overlap_minutes', e.overlap_minutes,
          'points', e.points,
          'multiplier', e.multiplier,
          'units', e.units,
          'amount_cents', e.amount_cents,
          'rounding_adjustment_cents', e.rounding_adjustment_cents,
          'ack_status', e.ack_status,
          'acknowledged_at', e.acknowledged_at
        ) order by e.area_name, e.member_name), '[]'::jsonb)
        from public.tip_distribution_entries e where e.distribution_id = d.id),
      'settlement', (
        select coalesce(jsonb_agg(ev order by ev ->> 'event_at'), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'kind', 'payout', 'payout_id', p.id, 'reversal_id', null,
            'event_at', p.paid_at, 'amount_cents', p.amount_cents,
            'entitlement_cents', p.entitlement_cents,
            'previous_entitlement_cents', p.previous_entitlement_cents,
            'method', p.method, 'reason', null, 'note', p.note,
            'actor_name', (select m.display_name from public.workplace_members m
                            where m.id = p.paid_by),
            'still_counts', app.payout_is_effective(p.id),
            'after_close', v_closed_at is not null and p.paid_at > v_closed_at) as ev
          from public.distribution_payouts p where p.distribution_id = d.id
          union all
          select jsonb_build_object(
            'kind', 'reversal', 'payout_id', r.payout_id, 'reversal_id', r.id,
            'event_at', r.reversed_at, 'amount_cents', -p2.amount_cents,
            'entitlement_cents', null, 'previous_entitlement_cents', null,
            'method', null, 'reason', r.reason, 'note', r.note,
            'actor_name', (select m.display_name from public.workplace_members m
                            where m.id = r.reversed_by),
            'still_counts', true,
            'after_close', v_closed_at is not null and r.reversed_at > v_closed_at)
          from public.distribution_payout_reversals r
          join public.distribution_payouts p2 on p2.id = r.payout_id
          where r.distribution_id = d.id
        ) events)
    ) as row
    from public.tip_distributions d
    where d.workplace_id = p_workplace_id
      and d.period_start between p_period_start and p_period_end
      and d.status <> 'draft'
  ) rows;

  -- ── the totals ──────────────────────────────────────────────────────────
  with scope as (
    select d.* from public.tip_distributions d
    where d.workplace_id = p_workplace_id
      and d.period_start between p_period_start and p_period_end
      and d.status <> 'draft'
  )
  select jsonb_build_object(
    'distributions_current', (select count(*) from scope where status in ('sent','confirmed')),
    'distributions_replaced', (select count(*) from scope where status = 'cancelled'),
    'corrections', (select count(*) from scope where supersedes_id is not null),
    'current_entitlement_cents',
      (select coalesce(sum(entries_total_cents), 0) from scope where status in ('sent','confirmed')),
    'replaced_entitlement_cents',
      (select coalesce(sum(entries_total_cents), 0) from scope where status = 'cancelled'),
    'payout_events', (select count(*) from public.distribution_payouts p
                       join scope s on s.id = p.distribution_id),
    'payout_total_cents', (select coalesce(sum(p.amount_cents), 0)
                            from public.distribution_payouts p join scope s on s.id = p.distribution_id),
    'reversal_events', (select count(*) from public.distribution_payout_reversals r
                         join scope s on s.id = r.distribution_id),
    'reversal_total_cents', (select coalesce(sum(p.amount_cents), 0)
                              from public.distribution_payout_reversals r
                              join public.distribution_payouts p on p.id = r.payout_id
                              join scope s on s.id = r.distribution_id),
    'effective_settled_cents', (select coalesce(sum(p.amount_cents), 0)
                                 from public.distribution_payouts p join scope s on s.id = p.distribution_id
                                 where app.payout_is_effective(p.id)),
    'outstanding_cents',
      (select coalesce(sum(entries_total_cents), 0) from scope where status in ('sent','confirmed'))
      - (select coalesce(sum(p.amount_cents), 0)
          from public.distribution_payouts p join scope s on s.id = p.distribution_id
          where app.payout_is_effective(p.id)),
    'unresolved_questions', (select count(*) from public.distribution_queries q
                              join scope s on s.id = q.distribution_id where q.status = 'open'),
    'unacknowledged_shares', (select count(*) from public.tip_distribution_entries e
                               join scope s on s.id = e.distribution_id
                               where s.status in ('sent','confirmed') and e.ack_status = 'pending'),
    'records_after_close', (
      case when v_closed_at is null then 0 else (
        (select count(*) from scope where created_at > v_closed_at)
        + (select count(*) from public.distribution_payouts p join scope s on s.id = p.distribution_id
            where p.paid_at > v_closed_at)
        + (select count(*) from public.distribution_payout_reversals r join scope s on s.id = r.distribution_id
            where r.reversed_at > v_closed_at)) end)
  ) into v_summary;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'workplace_id', v_wp.id,
      'workplace_name', v_wp.name,
      'city', v_wp.city,
      'currency', v_wp.currency,
      'timezone', v_wp.timezone,
      'business_day_start_hour', v_wp.business_day_start_hour,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'generated_at', now(),
      -- Deliberately named: this is what TipCrew says NOW, not a reconstruction
      -- of what it said at the moment of closing. See records_after_close.
      'basis', 'current',
      'close', case when v_close.id is null then null else jsonb_build_object(
        'id', v_close.id,
        'closed_at', v_close.closed_at,
        'closed_by_name', (select m.display_name from public.workplace_members m
                            where m.id = v_close.closed_by),
        'note', v_close.note) end),
    'summary', v_summary,
    'distributions', v_dists);
end;
$$;

revoke all on function public.financial_period_export(uuid, date, date) from public;
grant execute on function public.financial_period_export(uuid, date, date) to authenticated;

comment on function public.financial_period_export(uuid, date, date) is
  'Phase 3N: the one authoritative export dataset. Manager-only. Lineage-aware totals: '
  'a replaced version never adds to what is owed. basis = current, never as-of-close.';
