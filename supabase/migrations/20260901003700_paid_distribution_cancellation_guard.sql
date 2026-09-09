-- ─────────────────────────────────────────────────────────────────────────────
-- 37 · Phase 3R-B · money that has gone out is not abandoned
--
-- ── WHAT THE 3R AUDIT MEASURED ────────────────────────────────────────────
--
-- Migration 36 stopped a standalone cancellation from silently rewriting a
-- CLOSED period. The same call in an OPEN period was still allowed, and it is
-- wrong there too. Measured on a full local rebuild — one week, one night of
-- €900 paid in full, one of €400 not:
--
--     before                owed €1300.00   settled €900.00   outstanding €400.00
--     after cancelling      owed  €400.00   settled €900.00   outstanding €-500.00
--
-- Outstanding goes negative because app.effective_payout() and
-- app.payout_is_effective() (migration 27) never look at the distribution's
-- status: the payment stays effective, so the export keeps counting it as
-- settled while the entitlement it settled walks out of the current figures.
-- The employee's own row reads it the same way — status `cancelled`, payout
-- `paid`, with a payment date on it. A night the team was told is retracted,
-- still telling them they were paid for it.
--
-- ── WHY REFUSE RATHER THAN RECONCILE ──────────────────────────────────────
-- Because of what a standalone cancellation MEANS. Migration 26 names the two
-- kinds of cancelled row: "a cancelled one is either abandoned or already
-- replaced" (…002600:349). A replacement is a correction — send_distribution()
-- retires the predecessor and puts a new version in its place, so the money is
-- accounted for. A standalone cancel is the other one: abandonment. And
-- abandonment is a claim you cannot make about a night whose money has already
-- gone out of the till.
--
-- The product already reasons this way everywhere else. void_pool (migration
-- 33) refuses a pool with a payout on it — "settled money pins the pool" —
-- and states that guard even where its author believed it unreachable.
-- record_distribution_payout and reverse_distribution_payout both refuse a
-- cancelled distribution. This function was simply never revisited: it was
-- written in migration 11, in the first backend commit, FIFTEEN migrations
-- before payouts existed (migration 26). There was nothing to pay with when
-- the rule was made.
--
-- Migration 29 saw the gap and wrote it down: a version "sent and then
-- explicitly cancelled by cancel_distribution(), rather than superseded …
-- That state is already unguarded … a separate concern and a separate
-- migration, not a rider on a one-predicate fix" (…002900:57-62). This is that
-- separate migration.
--
-- ── THE RULE ──────────────────────────────────────────────────────────────
-- A distribution with an EFFECTIVE payout cannot be cancelled. To retire one
-- that has been paid, the manager reverses the payment first — which is an
-- audited event of its own — and then cancels. That ordering is not a
-- workaround; it is the record saying, in the right order, that the money came
-- back before the night was abandoned.
--
-- "Effective" is app.effective_payout() (migration 27): a payout with no
-- reversal pointing at it. That is the product's one definition of paid, and
-- this migration does not write a second opinion about it — a night that was
-- paid and then fully reversed has no effective payout, so it may still be
-- cancelled, and the arithmetic stays coherent when it is. Measured: owed and
-- outstanding both fall by the night's amount, settled stays at zero,
-- outstanding never goes negative.
--
-- ── WHAT DOES NOT CHANGE ──────────────────────────────────────────────────
--   · corrections. send_distribution() retires its predecessor with its own
--     inline UPDATE (migration 23) and has never called this function — proved
--     from the catalog, not from grep: no pg_proc body in public or app
--     mentions cancel_distribution. A settled original is still correctable.
--   · the closed-period refusal (migration 36) still comes FIRST, so a row that
--     is both closed and paid still says the period is closed. Migration 36's
--     tests read that message; its meaning is unchanged.
--   · a retry on an already-cancelled row is still a quiet no-op, ahead of both
--     refusals, so a period closing or a payment landing afterwards cannot turn
--     an idempotent retry into an error about something already done.
--   · a draft is still refused as a draft.
--   · authorisation, the workplace-then-row lock order, and the pool returning
--     to 'locked' are all exactly as migration 36 left them.
--
-- Migrations 1–36 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cancel_distribution(p_distribution_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workplace uuid;
  v_dist      public.tip_distributions%rowtype;
begin
  -- 1 · authorisation and the row. Resolve the workplace before locking
  -- anything, so the workplace row can be taken FIRST — the order
  -- close_financial_period() takes. A cancellation and a close of the same
  -- workplace are therefore serialised and cannot decide on stale views of each
  -- other. No new lock order is introduced: nothing in the financial functions
  -- takes a distribution before a workplace.
  select d.workplace_id into v_workplace
  from public.tip_distributions d where d.id = p_distribution_id;
  if v_workplace is null or not app.is_manager(v_workplace) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  perform 1 from public.workplaces w where w.id = v_workplace for update;

  select * into v_dist from public.tip_distributions
  where id = p_distribution_id for update;
  if v_dist.id is null then
    raise exception 'distribution not found' using errcode = '42501';
  end if;

  -- 2 · ahead of every refusal on purpose: cancelling a cancelled distribution
  -- has always been a quiet no-op, and neither a close nor a payment arriving
  -- afterwards may turn a retry into an error about something already done.
  if v_dist.status = 'cancelled' then
    return;
  end if;

  -- 3 · a draft is discarded, never turned into a cancelled row that was never
  -- sent.
  if v_dist.status = 'draft' then
    raise exception 'a draft is discarded, not cancelled: delete it, or calculate again'
      using errcode = '42501';
  end if;

  -- 4 · migration 36. A closed period may still be corrected — the correction
  -- arrives as its own row that the export marks and counts. What it may not do
  -- is have money quietly leave it with nothing put in its place. This stays
  -- ahead of the payment check so a row that is both closed and paid still
  -- names the close, which is the more fundamental refusal and the one the
  -- manager can do least about.
  if app.distribution_is_in_closed_period(p_distribution_id) then
    raise exception
      'this period is closed; correct this distribution instead, so the export can show the correction'
      using errcode = '42501';
  end if;

  -- 5 · migration 37. Abandoning a night whose money has gone out would leave
  -- the payment counting as settled against an entitlement that no longer
  -- exists, and drive outstanding below zero. Reversing first is an audited
  -- event; it is also the truth, in the right order.
  if app.effective_payout(p_distribution_id) is not null then
    raise exception
      'this distribution has been paid; reverse the payment before cancelling it'
      using errcode = '42501';
  end if;

  -- 6 · the cancellation itself, exactly as migration 36 left it.
  update public.tip_distributions
  set status = 'cancelled', cancelled_at = pg_catalog.now(),
      cancelled_by = app.member_id(v_dist.workplace_id),
      cancel_reason = nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
  where id = p_distribution_id;

  update public.tip_pools set status = 'locked' where id = v_dist.tip_pool_id;
end;
$$;

comment on function public.cancel_distribution(uuid, text) is
  'Migration 37: retires a SENT or CONFIRMED distribution without a replacement — an '
  'abandonment, not a correction. Refused when a close covers its period (migration 36), '
  'and refused while an effective payout stands: reverse the payment first, so the money '
  'comes back before the night is abandoned. A draft is refused; a repeat is a quiet no-op.';
