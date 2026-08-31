-- ═════════════════════════════════════════════════════════════════════════════
-- 12 · The member read layer.
--
-- Employees have no SELECT policy on tip_pools or tip_distributions. Their only
-- route to a distribution is `member_distributions`, which is the single
-- SECURITY DEFINER relation in this schema.
--
-- Why exactly one, and why definer:
--   * tip_distributions carries columns an employee must never see —
--     pool_cents and inputs_snapshot (which holds every colleague's hours).
--     RLS is row-level and cannot mask a column, and column GRANTs cannot help
--     because managers and employees are both the `authenticated` role.
--   * Everything else is plain RLS. Area subtotals live in their own table with
--     their own policy; entry visibility is decided by the entries policy.
--     Those are invoker relations, so RLS still applies to them.
--
-- The definer view is therefore small enough to audit line by line: it takes no
-- parameters, filters on auth.uid() through an existence test, and exposes a
-- fixed column list. Its WHERE clause is the security boundary; the tests in
-- supabase/tests/ assert that it leaks nothing.
-- ═════════════════════════════════════════════════════════════════════════════

create view public.member_distributions
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
  -- Released by the manager, per workplace. Null until then.
  case when w.pool_amount_visible_to_members then d.pool_cents end as pool_cents,
  w.pool_amount_visible_to_members as pool_amount_visible
from public.tip_distributions d
join public.workplaces w on w.id = d.workplace_id
where d.status <> 'draft'
  and exists (
    select 1
    from public.tip_distribution_entries e
    join public.workplace_members m on m.id = e.member_id
    where e.distribution_id = d.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );

comment on view public.member_distributions is
  'Employee-facing list of distributions they took part in. SECURITY DEFINER: '
  'the WHERE clause is the security boundary, and pool_cents is null unless the '
  'workplace has released it.';

-- Entries: a plain invoker view, so the entries RLS policy — which is where
-- peer visibility is decided — still applies in full.
create view public.member_distribution_entries
with (security_invoker = true) as
select
  e.id,
  e.distribution_id,
  e.workplace_id,
  e.member_id,
  e.member_name,
  e.area_id,
  e.area_key,
  e.area_name,
  e.area_source,
  e.role_key,
  e.role_name,
  e.points,
  e.multiplier,
  e.worked_minutes,
  e.overlap_minutes,
  e.units,
  e.amount_cents,
  e.rounding_adjustment_cents,
  e.ack_status,
  e.acknowledged_at,
  e.queried_at,
  e.query_note,
  (e.member_id = app.member_id(e.workplace_id)) as is_own
from public.tip_distribution_entries e;

comment on view public.member_distribution_entries is
  'Invoker view: row visibility comes from the entries RLS policy, which honours '
  'workplaces.peer_entry_visibility.';

revoke all on public.member_distributions from public, anon;
revoke all on public.member_distribution_entries from public, anon;
grant select on public.member_distributions to authenticated;
grant select on public.member_distribution_entries to authenticated;
