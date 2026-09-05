-- ─────────────────────────────────────────────────────────────────────────────
-- 32 · Phase 3P · the manager dashboard, as one authoritative answer
--
-- A hospitality manager opens the app and wants to know what needs them: hours
-- to review, questions to answer, a correction they agreed to and never sent, a
-- draft they never published. Then what tonight looks like, what the last night
-- they sent is doing, what is still to pay, and where the books stand. One RPC
-- answers all of that in one round trip, and every figure in it is a definition
-- this schema already had.
--
-- ── WHAT IS DELIBERATELY REUSED, NOT RECREATED ────────────────────────────
-- · The business day is app.business_day(now(), workplace) — migration 08's
--   definition, computed HERE, so the browser never decides what day it is.
-- · Settlement figures come from public.distribution_settlement (migration 27):
--   settlement_due_cents and payout_status are read off the view, so the
--   dashboard and the distribution screen cannot disagree about what is owed.
-- · "Agreed but not sent" is migration 29's predicate, sent_at is not null,
--   without the period bound. Anything else would re-open the defect 29 fixed.
-- · The acknowledgement tally is src/distribution/ack.ts's tally() in SQL:
--   PEOPLE, never entries, with exactly its precedence.
--
-- ── WHAT IS CURRENT ────────────────────────────────────────────────────────
-- A night's financial truth is its sent-or-confirmed version and nothing else.
-- Down a chain A <- B <- C, only C is counted: A and B are 'cancelled' and are
-- filtered out of every sum, every count and every "latest" here. The week's
-- figure and the outstanding figure therefore count a corrected night once.
--
-- ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
-- No period readiness: financial_period_readiness() takes a period, and the
-- period is the manager's decision on that screen. The blockers it would name
-- are the attention items below, so the manager sees them first anyway. No
-- "missing report": the schema does not know who was expected to file one. No
-- names, no emails, no auth ids, no question text — counts, ids, dates and
-- amounts a manager may already read, and that is all.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.manager_dashboard(p_workplace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today      date;
  v_week_start date;
  v_week_end   date;

  -- attention
  v_submitted   integer;
  v_open_q      integer;
  v_open_q_dist uuid;
  v_agreed      integer;
  v_agreed_dist uuid;
  v_drafts      integer;
  v_draft_dist  uuid;
  v_draft_corr  integer;
  v_draft_corr_dist uuid;
  v_join_req    integer;

  -- tonight
  v_appr_people   integer;
  v_appr_minutes  integer;
  v_sub_today     integer;
  v_rep_count     integer;
  v_rep_cents     bigint;
  v_pool          jsonb;
  v_tonight_dist  jsonb;

  -- latest
  v_latest_id     uuid;
  v_latest        jsonb;

  -- week, settlement, close, team, recent
  v_week_n        integer;
  v_week_cents    bigint;
  v_unpaid        integer;
  v_outstanding   bigint;
  v_close         jsonb;
  v_active        integer;
  v_recent        jsonb;
begin
  -- The browser names a workplace because it must say which one it means.
  -- Naming one is not being let into it: an employee, a manager of somewhere
  -- else, a suspended manager and an anonymous caller all fail here.
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may read its dashboard'
      using errcode = '42501';
  end if;

  -- ── the day, decided by the server ───────────────────────────────────────
  v_today      := app.business_day(now(), p_workplace_id);
  -- ISO week: PostgreSQL's date_trunc('week') lands on Monday.
  v_week_start := pg_catalog.date_trunc('week', v_today::timestamp)::date;
  v_week_end   := v_week_start + 6;

  -- ── attention ────────────────────────────────────────────────────────────
  select count(*) into v_submitted
  from public.shifts s
  where s.workplace_id = p_workplace_id and s.status = 'submitted';

  -- Joined through tip_distributions, as financial_period_readiness() does,
  -- because that is the indexed path to a workplace's questions.
  select count(*),
         (select d2.id from public.distribution_queries q2
            join public.tip_distributions d2 on d2.id = q2.distribution_id
           where d2.workplace_id = p_workplace_id and q2.status = 'open'
           order by d2.period_start desc, d2.created_at desc limit 1)
  into v_open_q, v_open_q_dist
  from public.distribution_queries q
  join public.tip_distributions d on d.id = q.distribution_id
  where d.workplace_id = p_workplace_id and q.status = 'open';

  -- Migration 29's definition: a correction counts as dealt with once a
  -- successor was SENT, whether or not that successor is still the live one.
  select count(*),
         (select d2.id from public.distribution_queries q2
            join public.tip_distributions d2 on d2.id = q2.distribution_id
           where d2.workplace_id = p_workplace_id
             and q2.status = 'resolved' and q2.outcome = 'correction_required'
             and not exists (select 1 from public.tip_distributions r
                              where r.supersedes_id = d2.id and r.sent_at is not null)
           order by d2.period_start desc, d2.created_at desc limit 1)
  into v_agreed, v_agreed_dist
  from public.distribution_queries q
  join public.tip_distributions d on d.id = q.distribution_id
  where d.workplace_id = p_workplace_id
    and q.status = 'resolved' and q.outcome = 'correction_required'
    and not exists (select 1 from public.tip_distributions r
                     where r.supersedes_id = d.id and r.sent_at is not null);

  select count(*) filter (where d.supersedes_id is null),
         (select d2.id from public.tip_distributions d2
           where d2.workplace_id = p_workplace_id and d2.status = 'draft' and d2.supersedes_id is null
           order by d2.period_start desc, d2.created_at desc limit 1),
         count(*) filter (where d.supersedes_id is not null),
         (select d2.id from public.tip_distributions d2
           where d2.workplace_id = p_workplace_id and d2.status = 'draft' and d2.supersedes_id is not null
           order by d2.period_start desc, d2.created_at desc limit 1)
  into v_drafts, v_draft_dist, v_draft_corr, v_draft_corr_dist
  from public.tip_distributions d
  where d.workplace_id = p_workplace_id and d.status = 'draft';

  -- The same rows pending_join_requests() lists, counted.
  select count(*) into v_join_req
  from public.invitations i
  where i.workplace_id = p_workplace_id and i.kind = 'join_request' and i.status = 'pending';

  -- ── tonight ──────────────────────────────────────────────────────────────
  select count(distinct s.member_id), coalesce(sum(s.worked_minutes), 0)
  into v_appr_people, v_appr_minutes
  from public.shifts s
  where s.workplace_id = p_workplace_id and s.work_date = v_today and s.status = 'approved';

  select count(*) into v_sub_today
  from public.shifts s
  where s.workplace_id = p_workplace_id and s.work_date = v_today and s.status = 'submitted';

  select count(*), coalesce(sum(r.total_cents), 0)
  into v_rep_count, v_rep_cents
  from public.tip_reports r
  where r.workplace_id = p_workplace_id and r.work_date = v_today;

  -- The night's pool, exactly as the wizard looks it up: one business day,
  -- start and end alike.
  select jsonb_build_object('id', p.id, 'status', p.status, 'total_cents', p.total_cents)
  into v_pool
  from public.tip_pools p
  where p.workplace_id = p_workplace_id
    and p.period_start = v_today and p.period_end = v_today
    and p.status <> 'void'
  order by p.created_at desc
  limit 1;

  -- The night's distribution: the published one if there is one, else the
  -- draft. A draft correction beside a sent original is an attention item,
  -- not tonight's headline.
  if v_pool is not null then
    select jsonb_build_object(
             'id', d.id, 'status', d.status,
             'is_correction', d.supersedes_id is not null)
    into v_tonight_dist
    from public.tip_distributions d
    where d.tip_pool_id = (v_pool ->> 'id')::uuid
      and d.status in ('draft', 'sent', 'confirmed')
    order by (d.status = 'draft'), d.created_at desc
    limit 1;
  end if;

  -- ── the latest published night ───────────────────────────────────────────
  -- A correction shares its original's period_start, so ordering by the date
  -- alone can hand back the retired version. sent_at breaks the tie the right
  -- way, and cancelled versions are excluded before it matters.
  select d.id into v_latest_id
  from public.tip_distributions d
  where d.workplace_id = p_workplace_id and d.status in ('sent', 'confirmed')
  order by d.period_start desc, d.sent_at desc nulls last, d.created_at desc
  limit 1;

  if v_latest_id is not null then
    -- tally(), in SQL: group entries by member; a member with any entry that
    -- cannot be acknowledged (a placeholder with no account) is not answerable
    -- at all; otherwise pending if ANY entry is pending, else queried if ANY is
    -- queried, else confirmed. People, never entries — somebody who worked two
    -- areas is one person owing one answer.
    with per_member as (
      select e.member_id,
             bool_and(m.user_id is not null)         as answerable,
             bool_or(e.ack_status = 'pending')       as any_pending,
             bool_or(e.ack_status = 'queried')       as any_queried
      from public.tip_distribution_entries e
      join public.workplace_members m on m.id = e.member_id
      where e.distribution_id = v_latest_id
      group by e.member_id
    ),
    tally as (
      select count(*)                                                    as participants,
             count(*) filter (where answerable)                          as answerable,
             count(*) filter (where answerable and any_pending)          as pending,
             count(*) filter (where answerable and not any_pending
                                                and any_queried)         as queried,
             count(*) filter (where answerable and not any_pending
                                                and not any_queried)     as confirmed
      from per_member
    )
    select jsonb_build_object(
             'id', d.id,
             'period_start', d.period_start,
             'period_end', d.period_end,
             'status', d.status,
             'is_correction', d.supersedes_id is not null,
             'people_count', d.people_count,
             'entitlement_cents', d.entries_total_cents,
             'acknowledgement_required',
               coalesce((d.rules_snapshot ->> 'acknowledgement_required')::boolean, true),
             'participants', t.participants,
             'answerable_people', t.answerable,
             'confirmed_people', t.confirmed,
             'pending_people', t.pending,
             'queried_people', t.queried,
             'open_questions', (select count(*) from public.distribution_queries q
                                 where q.distribution_id = d.id and q.status = 'open'),
             -- Off the settlement view, so this is migration 27's answer and
             -- not a second opinion about it.
             'payout_state', s.payout_status,
             'settlement_due_cents', s.settlement_due_cents)
    into v_latest
    from public.tip_distributions d
    join public.distribution_settlement s on s.distribution_id = d.id
    cross join tally t
    where d.id = v_latest_id;
  end if;

  -- ── this week ────────────────────────────────────────────────────────────
  -- Current versions only. A corrected night contributes its correction and
  -- nothing else, because the original is 'cancelled' and not in this set.
  select count(*), coalesce(sum(d.entries_total_cents), 0)
  into v_week_n, v_week_cents
  from public.tip_distributions d
  where d.workplace_id = p_workplace_id
    and d.status in ('sent', 'confirmed')
    and d.period_start between v_week_start and v_week_end;

  -- ── settlement ───────────────────────────────────────────────────────────
  -- settlement_due_cents is zero once an effective payout stands and the
  -- entitlement minus what the lineage already settled otherwise; payout_status
  -- is read off the effective event. Both are the view's, not restated here.
  select count(*) filter (where s.payout_status <> 'paid'),
         coalesce(sum(s.settlement_due_cents), 0)
  into v_unpaid, v_outstanding
  from public.distribution_settlement s
  where s.workplace_id = p_workplace_id and s.status in ('sent', 'confirmed');

  -- ── the last close ───────────────────────────────────────────────────────
  select jsonb_build_object('id', c.id, 'period_start', c.period_start,
                            'period_end', c.period_end, 'closed_at', c.closed_at)
  into v_close
  from public.financial_period_closes c
  where c.workplace_id = p_workplace_id
  order by c.period_start desc
  limit 1;

  -- ── the team ─────────────────────────────────────────────────────────────
  select count(*) into v_active
  from public.workplace_members m
  where m.workplace_id = p_workplace_id and m.status = 'active';

  -- ── four recent nights, current versions ─────────────────────────────────
  select coalesce(jsonb_agg(row order by ps desc, ca desc), '[]'::jsonb)
  into v_recent
  from (
    select d.period_start as ps,
           d.created_at   as ca,
           jsonb_build_object(
             'id', d.id,
             'period_start', d.period_start,
             'status', d.status,
             'is_correction', d.supersedes_id is not null,
             'people_count', d.people_count,
             'entitlement_cents', d.entries_total_cents,
             'payout_state', s.payout_status) as row
    from public.tip_distributions d
    left join public.distribution_settlement s on s.distribution_id = d.id
    where d.workplace_id = p_workplace_id
      and d.status in ('sent', 'confirmed')
    order by d.period_start desc, d.created_at desc
    limit 4
  ) recent;

  return jsonb_build_object(
    'business_date', v_today,
    'week_start',    v_week_start,
    'week_end',      v_week_end,
    'attention', jsonb_build_object(
      'submitted_shifts',            v_submitted,
      'open_questions',              v_open_q,
      'open_question_distribution_id', v_open_q_dist,
      'agreed_corrections_not_sent', v_agreed,
      'agreed_correction_distribution_id', v_agreed_dist,
      'draft_distributions',         v_drafts,
      'draft_distribution_id',       v_draft_dist,
      'draft_corrections',           v_draft_corr,
      'draft_correction_id',         v_draft_corr_dist,
      'pending_join_requests',       v_join_req),
    'tonight', jsonb_build_object(
      'approved_people',     v_appr_people,
      'approved_minutes',    v_appr_minutes,
      'submitted_shifts',    v_sub_today,
      'reports_count',       v_rep_count,
      'reports_total_cents', v_rep_cents,
      'pool',                v_pool,
      'distribution',        v_tonight_dist),
    'latest', v_latest,
    'week', jsonb_build_object(
      'distributions',     v_week_n,
      'entitlement_cents', v_week_cents),
    'settlement', jsonb_build_object(
      'unpaid_distributions', v_unpaid,
      'outstanding_cents',    v_outstanding),
    'close',  v_close,
    'team',   jsonb_build_object('active_members', v_active),
    'recent', v_recent);
end;
$$;

revoke all on function public.manager_dashboard(uuid) from public;
grant execute on function public.manager_dashboard(uuid) to authenticated;

comment on function public.manager_dashboard(uuid) is
  'Phase 3P: the manager overview in one call. Manager-only. The business day is decided '
  'by app.business_day(now(), workplace); settlement figures are read off '
  'distribution_settlement; only sent/confirmed versions count as current, so a corrected '
  'night is counted once; acknowledgement is tallied per PERSON exactly as ack.ts tally().';
