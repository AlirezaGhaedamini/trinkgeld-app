-- ─────────────────────────────────────────────────────────────────────────────
-- 31 · a replaced version stays traversable down a chain
--
-- THE DEFECT, and it is migration 29's defect in a second place. The
-- member_distributions view resolves the successor of a distribution with
--
--     (select r.id from public.tip_distributions r
--       where r.supersedes_id = d.id and r.status not in ('draft', 'cancelled')
--       limit 1) as superseded_by
--
-- which asks whether the direct replacement is CURRENTLY live. send_distribution()
-- retires the predecessor, so down a chain A <- B <- C, sending C cancels B, and
-- B was the only row superseding A. superseded_by then returns NULL for A even
-- though A was certainly replaced.
--
-- WHAT THAT BREAKS TODAY. src/distribution/ack.ts derives lineage from this
-- column: `if (d.supersededBy) return 'replaced'` before falling through to
-- `if (d.status === 'cancelled') return 'cancelled'`. So an original corrected
-- twice is shown to the employee as "Cancelled" rather than "Replaced" — which
-- reads as though their night was abandoned rather than superseded by a version
-- they were paid under. It also leaves the lineage untraversable, so nothing can
-- follow a chain forward to the version that is current.
--
-- THE FIX is the one migration 29 proved: durable publication evidence. sent_at
-- is written only by send_distribution() and is never cleared —
-- cancel_distribution() touches status, cancelled_at, cancelled_by and
-- cancel_reason and nothing else, and app.guard_sent_distribution() stops a
-- client editing a non-draft row at all. So it is a permanent record that a
-- version was once published.
--
-- Strictly a widening, exactly as in migration 29: a row that is 'sent' or
-- 'confirmed' always has sent_at set, because 'confirmed' is only reachable from
-- 'sent'. The only rows the new predicate adds are those published and later
-- retired, which is precisely the set that was wrongly dropped. A draft
-- replacement still has sent_at null and still does not count, so a correction
-- nobody published never claims to have replaced anything.
--
-- NOTHING ELSE ABOUT THIS VIEW MOVES. Every other column, the security_invoker
-- setting, the joins and the WHERE clause are byte-for-byte what migration 27
-- published. `create or replace` is safe here because no column type changes.
-- Migrations 1–30 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.member_distributions
with (security_invoker = false) as
select
  d.id,
  d.workplace_id,
  d.period_start,
  d.period_end,
  d.status,
  d.rule_version,
  d.people_count,
  d.sent_at,
  d.confirmed_at,
  d.method,
  d.min_overlap_minutes,
  case when w.pool_amount_visible_to_members then d.pool_cents end as pool_cents,
  w.pool_amount_visible_to_members as pool_amount_visible,
  coalesce((d.rules_snapshot ->> 'acknowledgement_required')::boolean, true)
    as acknowledgement_required,
  d.supersedes_id,
  -- Migration 31: "was replaced" means a successor was SENT at some point, not
  -- that it is still the live one. Ordered by sent_at so a chain is walked in
  -- the order it actually happened.
  (select r.id from public.tip_distributions r
    where r.supersedes_id = d.id and r.sent_at is not null
    order by r.sent_at
    limit 1) as superseded_by,
  d.correction_reason,
  d.correction_note,
  (case
     when p.id is not null then 'paid'
     when exists (select 1 from public.distribution_payouts q
                  where q.distribution_id = d.id) then 'reversed'
     else 'unpaid'
   end)::public.payout_state as payout_status,
  p.method  as payout_method,
  p.paid_at as paid_at,
  app.settled_basis(d.id) as settled_basis_id
from public.tip_distributions d
join public.workplaces w on w.id = d.workplace_id
left join public.distribution_payouts p on p.id = app.effective_payout(d.id)
where d.status <> 'draft'
  and exists (
    select 1 from public.tip_distribution_entries e
    where e.distribution_id = d.id
      and e.member_id = app.member_id(d.workplace_id)
  );

comment on view public.member_distributions is
  'Definer view: a member sees the distributions they have an entry in. payout_status is the '
  'CURRENT state — paid, reversed, or never paid. superseded_by names the version that '
  'replaced this one, read from durable publication evidence (migration 31), so a chain '
  'A <- B <- C stays traversable after B is retired.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;
