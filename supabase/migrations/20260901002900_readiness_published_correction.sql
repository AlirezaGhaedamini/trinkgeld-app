-- ─────────────────────────────────────────────────────────────────────────────
-- 29 · a correction that was published stays published
--
-- THE DEFECT. financial_period_readiness() decides whether an agreed correction
-- has been dealt with by asking whether the direct replacement of the queried
-- distribution is CURRENTLY live:
--
--     and not exists (
--       select 1 from public.tip_distributions r
--       where r.supersedes_id = d.id and r.status not in ('draft', 'cancelled'))
--
-- That is the wrong question, and send_distribution() is what makes it wrong.
-- Publishing a replacement RETIRES its predecessor:
--
--     update public.tip_distributions set status = 'cancelled' ...
--     where id = v_dist.supersedes_id and status in ('sent', 'confirmed');
--
-- So down a chain A <- B <- C, sending C cancels B — and B was the only row
-- superseding A. The `not exists` becomes true again and A's long-since-answered
-- query re-arms `agreed_corrections_not_sent`. The period can then never be
-- closed, and nothing can clear it:
--
--   · resolve_query() refuses a query that is not 'open'
--   · create_replacement_distribution() refuses a cancelled original
--   · app.guard_query_immutable() refuses to move the query, with no
--     trusted-context escape
--   · a fresh question needs app.distribution_is_actionable(), which admits
--     only 'sent' and 'confirmed'
--
-- It compounds: in a chain of length n every query-driven link older than the
-- newest one re-arms, so the count grows with the depth of the chain.
--
-- THE FIX, one predicate. The comment on this block has always said what it
-- means — "the corrected version has not been published" — so the test becomes
-- whether the replacement was EVER published rather than whether it is still
-- the live one:
--
--     and r.sent_at is not null
--
-- `sent_at` is written only by send_distribution() and is never cleared:
-- cancel_distribution() touches status, cancelled_at, cancelled_by and
-- cancel_reason and nothing else, and app.guard_sent_distribution() stops a
-- client editing a non-draft row at all. It is therefore a durable record that
-- a version was once shown to the team.
--
-- The change is strictly a widening, so nothing that used to block stops
-- blocking for any other reason: a row that is 'sent' or 'confirmed' always has
-- sent_at set, since 'confirmed' is only reachable from 'sent'. The only rows
-- the new predicate adds are the ones that were published and later retired,
-- which is exactly the set that was wrongly excluded.
--
-- WHAT STILL BLOCKS. A replacement prepared and abandoned as a draft has
-- sent_at null, so an agreed correction nobody ever published still blocks the
-- close — and that case stays recoverable, because the original is still 'sent'
-- and can be replaced again.
--
-- DELIBERATELY NOT ADDRESSED HERE. A correction that was sent and then
-- explicitly cancelled by cancel_distribution(), rather than superseded, now
-- clears the blocker although the lineage is left with no live version at all.
-- That state is already unguarded — nothing in this function blocks a lineage
-- with no live head — so covering it is a separate concern and a separate
-- migration, not a rider on a one-predicate fix.
--
-- Migration 28 is applied and is not touched. Everything below the changed
-- predicate is byte-for-byte the function migration 28 published.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Migration 29: "published" means it was sent at some point, not that it is
  -- still the live version. Sending a further correction cancels this one, and
  -- that must not un-answer the question this one already answered.
  select count(*) into v_agreed_q from public.distribution_queries q
  join public.tip_distributions d on d.id = q.distribution_id
  where d.workplace_id = p_workplace_id
    and d.period_start between p_period_start and p_period_end
    and q.status = 'resolved' and q.outcome = 'correction_required'
    and not exists (
      select 1 from public.tip_distributions r
      where r.supersedes_id = d.id and r.sent_at is not null);

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

comment on function public.financial_period_readiness(uuid, date, date) is
  'Phase 3N, corrected by migration 29: an agreed correction counts as dealt with once '
  'the replacement has been SENT, not only while it is still the live version — otherwise '
  'a second correction down the same chain re-arms a question that was already answered.';
