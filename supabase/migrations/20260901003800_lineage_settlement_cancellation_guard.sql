-- ─────────────────────────────────────────────────────────────────────────────
-- 38 · Phase 3S-B · a paid CHAIN is not abandoned either
--
-- ── WHAT THE 3S-A AUDIT MEASURED ──────────────────────────────────────────
--
-- Migration 37 refused to cancel a distribution with an effective payout. It
-- asked the question of the ROW. A correction moves the money's anchor without
-- moving the money: send_distribution() retires the predecessor, and the payout
-- stays attached to the retired ancestor, because that is where it was made.
-- So the live head of a settled chain answers "no, I have not been paid", and
-- the guard let it go. Measured on a full local rebuild:
--
--     A sent, paid €600  →  corrected by B  →  B sent, A retired
--         app.effective_payout(B) = false          ← the guard saw nothing
--         cancel_distribution(B)  →  ALLOWED
--
--         owed €600.00 → €0.00
--         settled      → €600.00   (unchanged: the payout is on A)
--         outstanding  → €-600.00
--
-- The same defect migrations 36 and 37 each closed once, reached one step up
-- the chain. Abandoning the head of a lineage abandons the whole lineage, so
-- the question has to be asked of the whole lineage.
--
-- ── THE RULE ──────────────────────────────────────────────────────────────
-- A standalone cancellation is refused while ANY effective payout still
-- supports the lineage being abandoned — on this version, on any ancestor it
-- replaced, or on any descendant that replaced it.
--
-- Nothing new is invented to decide that. The three questions already have
-- three answers in this schema, and this migration only puts them together:
--
--   app.effective_payout(id)          migration 27 · is THIS row paid, unreversed
--   app.settled_basis(id)             migration 27 · the nearest ANCESTOR whose
--                                     payout still counts, walking supersedes_id
--   app.has_settled_descendant(id)    migration 27 · any DESCENDANT still paid,
--                                     walking the chain forward
--
-- Together they cover A, A←B and A←B←C from any point in the chain, and they
-- inherit the product's one definition of paid: a reversed payment is history,
-- so reversing unblocks the cancellation exactly as it did in migration 37.
--
-- ── WHAT DOES NOT CHANGE ──────────────────────────────────────────────────
--   · send_distribution() is untouched. Retiring a predecessor while publishing
--     its replacement is a CORRECTION, not an abandonment: the money stays
--     accounted for, the lineage keeps a live head, and app.settled_basis()
--     goes on pointing at the version the payment was made against. A paid
--     night may still be corrected — that is the whole replacement architecture.
--   · the closed-period refusal (migration 36) still comes first, so a row that
--     is both closed and paid still names the close.
--   · an already-cancelled row is still a quiet no-op, ahead of every refusal.
--   · a draft is still refused as a draft.
--   · a night with nothing paid anywhere in its chain still cancels.
--   · the own-row refusal keeps migration 37's wording, so what a manager is
--     told about their own unreversed payment does not change.
--
-- Migrations 1–37 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── one question, asked of the whole chain ─────────────────────────────────
/**
 * Does any effective payout still stand anywhere in this distribution's
 * lineage — on it, behind it, or in front of it?
 *
 * SECURITY DEFINER because the three walkers it composes are, and because it
 * reads distribution_payouts, which employees cannot select. Its callers have
 * already established who is asking.
 *
 * Not granted to authenticated: the only caller is cancel_distribution(), and
 * answering this for an arbitrary id is not a question a client needs to ask.
 */
create or replace function app.lineage_has_effective_payout(p_distribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.effective_payout(p_distribution_id) is not null
      or app.settled_basis(p_distribution_id) is not null
      or app.has_settled_descendant(p_distribution_id);
$$;

comment on function app.lineage_has_effective_payout(uuid) is
  'Migration 38: true while money that has not been reversed still stands anywhere in this '
  'correction chain — this version, an ancestor it replaced, or a descendant that replaced '
  'it. Composed from migration 27''s own walkers so there is one definition of paid.';

revoke all on function app.lineage_has_effective_payout(uuid) from public;

-- ── cancel_distribution, asked of the chain ────────────────────────────────
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
  -- 1 · authorisation and the row. The workplace lock is taken FIRST, the order
  -- close_financial_period() takes, so a close and a cancellation of the same
  -- workplace are serialised and cannot decide on stale views of each other.
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

  -- 2 · ahead of every refusal: cancelling a cancelled distribution has always
  -- been a quiet no-op, and nothing arriving afterwards may turn a retry into
  -- an error about something already done.
  if v_dist.status = 'cancelled' then
    return;
  end if;

  -- 3 · a draft is discarded, never turned into a cancelled row never sent.
  if v_dist.status = 'draft' then
    raise exception 'a draft is discarded, not cancelled: delete it, or calculate again'
      using errcode = '42501';
  end if;

  -- 4 · migration 36. A closed period may still be corrected; what it may not
  -- do is have money quietly leave it with nothing put in its place. Ahead of
  -- the payment checks because it is the more fundamental refusal, and the one
  -- a manager can do least about.
  if app.distribution_is_in_closed_period(p_distribution_id) then
    raise exception
      'this period is closed; correct this distribution instead, so the export can show the correction'
      using errcode = '42501';
  end if;

  -- 5 · migration 37, unchanged in wording: this version's own money.
  if app.effective_payout(p_distribution_id) is not null then
    raise exception
      'this distribution has been paid; reverse the payment before cancelling it'
      using errcode = '42501';
  end if;

  -- 6 · migration 38: the rest of the chain. Abandoning the head abandons the
  -- lineage, so a payment made against any version of it still stands in the
  -- way — and says so, because "this one was never paid" is true and unhelpful.
  if app.lineage_has_effective_payout(p_distribution_id) then
    raise exception
      'a payment on this correction chain has not been reversed; reverse it before cancelling this version'
      using errcode = '42501';
  end if;

  -- 7 · the cancellation itself, exactly as migration 37 left it.
  update public.tip_distributions
  set status = 'cancelled', cancelled_at = pg_catalog.now(),
      cancelled_by = app.member_id(v_dist.workplace_id),
      cancel_reason = nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
  where id = p_distribution_id;

  update public.tip_pools set status = 'locked' where id = v_dist.tip_pool_id;
end;
$$;

comment on function public.cancel_distribution(uuid, text) is
  'Migration 38: retires a SENT or CONFIRMED distribution without a replacement — an '
  'abandonment, not a correction. Refused when a close covers its period (36), and refused '
  'while an unreversed payment stands anywhere in its correction chain (37, 38): reverse the '
  'payment first. A draft is refused; a repeat is a quiet no-op. Corrections are unaffected — '
  'send_distribution() retires its own predecessor and never calls this.';
