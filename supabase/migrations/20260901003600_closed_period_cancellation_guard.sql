-- ─────────────────────────────────────────────────────────────────────────────
-- 36 · Phase 3R-B · a closed period is not rewritten by a standalone cancellation
--
-- ── WHAT THE 3R FINANCIAL AUDIT PROVED, LIVE ──────────────────────────────
--
-- One call, against a development project, as a signed-in manager holding
-- nothing but the anon key and their own JWT:
--
--     POST /rest/v1/rpc/cancel_distribution   → HTTP 204
--
-- aimed at a distribution that was sent and paid IN FULL, on a business date
-- inside an already closed period. The closed week's export moved:
--
--     current entitlement   €1300.00 → €400.00
--     effective settled     €1300.00 → €1300.00   (the payout still counts)
--     outstanding              €0.00 → €-900.00
--     records_after_close          0 → 0          ← nothing said it happened
--
-- The close row was untouched, the payout stayed on the books, and re-exporting
-- the same closed period produced different authoritative figures with nothing
-- anywhere to say so.
--
-- ── WHY THE EXPORT COULD NOT SEE IT ───────────────────────────────────────
-- Migration 28 marks a record as belonging after the close by comparing a
-- CREATION time: `d.created_at > closed_at` for a distribution, `p.paid_at` for
-- a payout, `r.reversed_at` for a reversal. Every deliberate post-close event in
-- this product is a NEW ROW, so that test finds all of them. A cancellation is
-- not a new row — it is a state change on a row that existed before the close —
-- so it slips past a test that only ever looks at when things were born.
--
-- Two fixes were possible: teach the export to notice the state change, or stop
-- the state change. The product model decides it. Migration 28 is explicit that
-- a close never blocks a correction, and that what it buys is a LABEL: "the
-- export marks every record that arrived after the close so nobody is left
-- believing the closed figures already contained it." A standalone cancellation
-- carries no such record — it retires money and puts nothing in its place. So
-- the honest fix is not to label it better; it is to refuse it, and to leave the
-- one path that does create an explicit, labelled record: a correction.
--
-- ── THE RULE ──────────────────────────────────────────────────────────────
-- public.cancel_distribution() refuses a distribution whose business period is
-- covered by a close. Nothing else changes:
--
--   · a correction still works, closed or not. send_distribution() retires the
--     predecessor with its OWN update (migration 23) and has never called
--     cancel_distribution(), so guarding this function does not touch it. The
--     replacement is a new row, so `created_at > closed_at` marks it and
--     records_after_close counts it — which is exactly the post-close event the
--     model asks for.
--   · a payout after the close still works, and is still flagged.
--   · a reversal after the close still works, and is still flagged.
--   · cancelling in an OPEN period still works, unchanged.
--   · cancelling an already-cancelled distribution is still a quiet no-op, so a
--     retry inside a closed period does not start raising.
--
-- ── WHY THE GUARD IS IN THE RPC AND NOT IN A TRIGGER ──────────────────────
-- A trigger on tip_distributions would fire for send_distribution() too — it
-- runs as the table owner, and the row it retires is in the same closed period.
-- The correction path and the standalone path write the identical column; the
-- only thing that separates them is WHICH FUNCTION IS RUNNING. So the guard
-- belongs where that is known. This costs nothing in defence-in-depth: migration
-- 33 revoked UPDATE on tip_distributions from authenticated and dropped its
-- policy, so a client cannot reach the column at all — proved live, a direct
-- PATCH of status returns 42501 before RLS is even consulted. The RPC is the
-- whole surface.
--
-- Migrations 1–35 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── is this distribution's period closed? ──────────────────────────────────
/**
 * Containment on period_start, not overlap, and deliberately so: this must
 * answer the question "would cancelling this rewrite a closed period's figures",
 * and migration 28's export gathers a distribution into a period with
 *
 *     d.period_start between p_period_start and p_period_end
 *
 * A distribution that starts outside a close is not in that close's scope, so
 * cancelling it rewrites nothing there and must not be refused on its account.
 * Same predicate, same answer — the date arithmetic is not restated here and
 * certainly not in the browser.
 *
 * SECURITY DEFINER because it reads financial_period_closes, which is
 * manager-only by RLS; its callers have already established who is asking.
 */
create or replace function app.distribution_is_in_closed_period(p_distribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tip_distributions d
    join public.financial_period_closes c
      on c.workplace_id = d.workplace_id
     and d.period_start between c.period_start and c.period_end
    where d.id = p_distribution_id
  )
$$;

comment on function app.distribution_is_in_closed_period(uuid) is
  'Migration 36: true when a close covers this distribution''s business period, by the same '
  'period_start containment financial_period_export() uses to gather one. Internal: no grant, '
  'because the only caller is cancel_distribution() and answering it for an arbitrary id is '
  'not something a client needs to be able to ask.';

-- Internal. Not granted to authenticated: nothing in the product asks a client
-- to test an arbitrary distribution id for closedness, and the screens that
-- need the fact already read financial_period_closes through their own manager
-- policy.
revoke all on function app.distribution_is_in_closed_period(uuid) from public;

-- ── cancel_distribution, with the close in the way ─────────────────────────
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
  -- Resolve the workplace before locking anything, so the workplace row can be
  -- taken FIRST — the order close_financial_period() takes. A cancellation and
  -- a close of the same workplace are therefore serialised, and cannot decide
  -- on stale views of each other: whichever commits first, the other sees it.
  -- No new lock order is introduced, because nothing in the financial functions
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

  -- Before the close check on purpose: cancelling a cancelled distribution has
  -- always been a quiet no-op, and a period closing afterwards must not turn a
  -- retry into an error about something that already happened.
  if v_dist.status = 'cancelled' then
    return;
  end if;
  if v_dist.status = 'draft' then
    raise exception 'a draft is discarded, not cancelled: delete it, or calculate again'
      using errcode = '42501';
  end if;

  -- The guard. A closed period may still be corrected — that is what the
  -- replacement architecture is for, and the correction arrives as its own row
  -- that the export marks and counts. What it may not do is have money quietly
  -- leave it with nothing put in its place.
  if app.distribution_is_in_closed_period(p_distribution_id) then
    raise exception
      'this period is closed; correct this distribution instead, so the export can show the correction'
      using errcode = '42501';
  end if;

  update public.tip_distributions
  set status = 'cancelled', cancelled_at = pg_catalog.now(),
      cancelled_by = app.member_id(v_dist.workplace_id),
      cancel_reason = nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
  where id = p_distribution_id;

  update public.tip_pools set status = 'locked' where id = v_dist.tip_pool_id;
end;
$$;

comment on function public.cancel_distribution(uuid, text) is
  'Migration 36: retires a SENT or CONFIRMED distribution without a replacement, keeping '
  'sent_at so the team''s history stays readable — unless a close covers its period, in which '
  'case it is refused and the correction path is the way through. A draft is refused: it is '
  'deleted or recalculated, never turned into a cancelled row that was never sent.';
