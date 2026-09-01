-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3D: the money path.
--
-- A fixture of its own, with numbers chosen so every total can be checked by
-- hand: one workplace, three people in one area, equal weights, so €10 split
-- three ways is the classic 333 / 333 / 334.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── a workplace built for arithmetic ────────────────────────────────────────
-- The two auth rows are created as the owner, the way Supabase Auth would.
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'lab.manager@test.local'),
  ('d0000000-0000-0000-0000-000000000002', 'lab.ann@test.local')
on conflict do nothing;

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select public.create_workplace('Rounding Lab', 'Marburg') as wid \gset
commit;

select id as a_service from public.workplace_areas
  where workplace_id = :'wid' and key = 'service' \gset
select id as a_bar from public.workplace_areas
  where workplace_id = :'wid' and key = 'bar' \gset
select id as r_server from public.workplace_roles
  where workplace_id = :'wid' and key = 'server' \gset
select id as r_senior from public.workplace_roles
  where workplace_id = :'wid' and key = 'senior_server' \gset
select id as m_boss from public.workplace_members
  where workplace_id = :'wid' and role = 'manager' \gset

-- Three servers, same area, same role, so only the hours can differ.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'wid', 'Ann', 'employee', :'a_service', :'r_server', 'active') returning id as m_ann \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'wid', 'Ben', 'employee', :'a_service', :'r_server', 'active') returning id as m_ben \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'wid', 'Cara', 'employee', :'a_service', :'r_server', 'active') returning id as m_cara \gset
commit;

-- 100% to service, so the second rounding level is the only one in play.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select id as rule1 from public.distribution_rules
    where workplace_id = :'wid' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours', min_overlap_minutes = 15 where id = :'rule1';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'rule1' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'rule1' and area_id <> :'a_service';
  select public.activate_rule(:'rule1') as v1 \gset
commit;

select tests.ok(:'v1'::integer = 1, 'D1  the first rule activates as version 1');

-- Three identical four-hour shifts: equal units, so the split is exactly even.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wid', :'m_ann',  '2026-07-01 18:00+02', '2026-07-01 22:00+02', 0, 'approved'),
         (:'wid', :'m_ben',  '2026-07-01 18:00+02', '2026-07-01 22:00+02', 0, 'approved'),
         (:'wid', :'m_cara', '2026-07-01 18:00+02', '2026-07-01 22:00+02', 0, 'approved');
commit;

-- ── €10 among three ─────────────────────────────────────────────────────────
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'wid', 'day', '2026-07-01', '2026-07-01', 'ten', 1000, :'m_boss') returning id as pool10 \gset
  select public.calculate_distribution(:'pool10') as dist10 \gset
commit;

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'dist10') = 1000,
  'D2  €10 among three reconciles to exactly 1000 cents');

select tests.ok(
  (select array_agg(amount_cents order by amount_cents)
   from public.tip_distribution_entries where distribution_id = :'dist10') = array[333, 333, 334]::bigint[],
  'D3  …as 333 / 333 / 334, not three times 333 with a cent lost');

select tests.ok(
  (select count(*) from public.tip_distribution_entries
   where distribution_id = :'dist10' and rounding_adjustment_cents = 1) = 1,
  'D4  the entry that absorbed the remainder says so');

-- Deterministic: the same inputs must produce the same winner every time.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select member_id as winner1 from public.tip_distribution_entries
    where distribution_id = :'dist10' and amount_cents = 334 \gset
  delete from public.tip_distributions where id = :'dist10';
  update public.tip_pools set status = 'open' where id = :'pool10';
  select public.calculate_distribution(:'pool10') as dist10b \gset
commit;

select tests.ok(
  (select member_id from public.tip_distribution_entries
   where distribution_id = :'dist10b' and amount_cents = 334) = :'winner1',
  'D5  recalculating picks the same person for the extra cent');

-- ── a single cent ───────────────────────────────────────────────────────────
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'wid', 'day', '2026-07-01', '2026-07-01', 'onecent', 1, :'m_boss') returning id as pool1 \gset
  select public.calculate_distribution(:'pool1') as dist1 \gset
commit;

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'dist1') = 1,
  'D6  a one-cent pool is fully assigned, to exactly one person');

select tests.ok(
  (select count(*) from public.tip_distribution_entries
   where distribution_id = :'dist1' and amount_cents = 0) = 2,
  'D7  …and the other two get a zero entry rather than vanishing');

-- ── uneven weights ──────────────────────────────────────────────────────────
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.workplace_members set workplace_role_id = :'r_senior' where id = :'m_ann';
  select id as rule2 from public.create_rule_draft(:'wid') as t(id) \gset
  update public.distribution_rules set method = 'hours_points', min_overlap_minutes = 15 where id = :'rule2';
  select public.activate_rule(:'rule2') as v2 \gset

  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'wid', 'day', '2026-07-01', '2026-07-01', 'weighted', 10000, :'m_boss') returning id as pool_w \gset
  select public.calculate_distribution(:'pool_w') as dist_w \gset
commit;

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'dist_w') = 10000,
  'D8  uneven role points still reconcile to the pool exactly');

select tests.ok(
  (select amount_cents from public.tip_distribution_entries
   where distribution_id = :'dist_w' and member_id = :'m_ann')
  > (select amount_cents from public.tip_distribution_entries
     where distribution_id = :'dist_w' and member_id = :'m_ben'),
  'D9  …and the senior server is paid more than the server');

-- ── the overlap boundary ────────────────────────────────────────────────────
-- Ann anchors with a long shift. Ben clears the threshold by a minute, Cara
-- misses it by a minute. Same pool, same rule, one minute apart.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.workplace_members set workplace_role_id = :'r_server' where id = :'m_ann';
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wid', :'m_ann',  '2026-07-02 18:00+02', '2026-07-03 02:00+02', 0, 'approved'),
         (:'wid', :'m_ben',  '2026-07-03 01:45+02', '2026-07-03 05:45+02', 0, 'approved'),
         (:'wid', :'m_cara', '2026-07-03 01:46+02', '2026-07-03 05:46+02', 0, 'approved');

  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'wid', 'day', '2026-07-02', '2026-07-02', 'overlap', 9000, :'m_boss') returning id as pool_o \gset
  select public.calculate_distribution(:'pool_o') as dist_o \gset
commit;

select tests.ok(
  exists (select 1 from public.tip_distribution_entries
          where distribution_id = :'dist_o' and member_id = :'m_ben'),
  'D10 exactly 15 minutes of overlap with the anchor is enough');

select tests.ok(
  not exists (select 1 from public.tip_distribution_entries
              where distribution_id = :'dist_o' and member_id = :'m_cara'),
  'D11 fourteen minutes is not');

select tests.ok(
  (select inputs_snapshot -> 'shifts' @> '[{"eligibility": "below_min_overlap"}]'
   from public.tip_distributions where id = :'dist_o'),
  'D12 the excluded shift is in the snapshot, with the reason');

-- ── an area with a share but nobody in it ───────────────────────────────────
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select id as rule3 from public.create_rule_draft(:'wid') as t(id) \gset
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'rule3' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'rule3' and area_id = :'a_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'rule3' and area_id not in (:'a_service', :'a_bar');
  select public.activate_rule(:'rule3') as v3 \gset

  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'wid', 'day', '2026-07-01', '2026-07-01', 'emptyarea', 5000, :'m_boss') returning id as pool_e \gset

  -- Migration 16: an area with a share and nobody in it stops the whole
  -- distribution rather than having its money quietly absorbed by Service.
  select tests.denied(format($q$select public.calculate_distribution(%L)$q$, :'pool_e'),
    'D13 an area with a share but no eligible people stops the distribution');
commit;

select tests.ok(
  (select count(*) from public.tip_distributions where tip_pool_id = :'pool_e') = 0,
  'D14 …and nothing at all was written');

-- Put Bar back to zero so the rest of the file has a workable rule.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select id as rule3b from public.create_rule_draft(:'wid') as t(id) \gset
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'rule3b' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'rule3b' and area_id <> :'a_service';
  select public.activate_rule(:'rule3b');
commit;

-- ── percentages ─────────────────────────────────────────────────────────────
begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select id as rule_bad from public.create_rule_draft(:'wid') as t(id) \gset
  update public.distribution_rule_areas set percentage = 30 where rule_id = :'rule_bad' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'rule_bad' and area_id <> :'a_service';
  select tests.denied(format($q$select public.activate_rule(%L)$q$, :'rule_bad'),
    'D15 a rule whose areas do not total 100%% cannot be activated');
commit;

begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select tests.denied(
    format($q$update public.distribution_rule_areas set percentage = -10 where rule_id = %L$q$, :'rule_bad'),
    'D16 a negative percentage is refused by the column check');
commit;

-- ── F1 · an overlap model the engine does not implement ─────────────────────
-- Migration 16 implements pairwise, so service_window is now the only
-- unimplemented model. The pairwise case has its own file.
begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.distribution_rules set overlap_basis = 'service_window' where id = :'rule_bad';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'rule_bad' and area_id = :'a_service';
  select tests.denied(format($q$select public.activate_rule(%L)$q$, :'rule_bad'),
    'D17 a rule set to an unimplemented overlap model cannot be activated');
commit;

select tests.ok(
  (select status from public.distribution_rules where id = :'rule_bad') = 'draft',
  'D18 …and it stays a draft');

-- Put the basis back: create_rule_draft() reuses an open draft, so leaving it
-- set to pairwise would poison every later rule in this file.
update public.distribution_rules set overlap_basis = 'longest_shift' where id = :'rule_bad';

-- ── F2 · a stale draft ──────────────────────────────────────────────────────
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'wid', 'day', '2026-07-05', '2026-07-05', 'stale', 6000, :'m_boss') returning id as pool_s \gset
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wid', :'m_ann', '2026-07-05 18:00+02', '2026-07-05 23:00+02', 0, 'approved');
  select public.calculate_distribution(:'pool_s') as dist_s \gset
commit;

select tests.ok(
  (select inputs_fingerprint is not null from public.tip_distributions where id = :'dist_s'),
  'D19 a calculated distribution carries a fingerprint of its inputs');

-- Somebody approves another shift in the same period.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wid', :'m_ben', '2026-07-05 19:00+02', '2026-07-05 23:00+02', 0, 'approved');
  select tests.denied(format($q$select public.send_distribution(%L)$q$, :'dist_s'),
    'D20 sending a draft whose hours changed underneath it is refused');
commit;

select tests.ok(
  (select status from public.tip_distributions where id = :'dist_s') = 'draft',
  'D21 …and it is still a draft, not half-sent');

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  delete from public.tip_distributions where id = :'dist_s';
  update public.tip_pools set status = 'open' where id = :'pool_s';
  select public.calculate_distribution(:'pool_s') as dist_s2 \gset
  select public.send_distribution(:'dist_s2');
commit;

select tests.ok(
  (select status from public.tip_distributions where id = :'dist_s2') = 'sent',
  'D22 recalculating and sending works');

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'dist_s2') = 2,
  'D23 …and the recalculation picked up the shift that had been added');

-- ── duplicate send ──────────────────────────────────────────────────────────
begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select tests.denied(format($q$select public.send_distribution(%L)$q$, :'dist_s2'),
    'D24 sending the same distribution twice is refused');
commit;

-- ── a sent distribution is immutable ────────────────────────────────────────
begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select tests.denied(
    format($q$update public.tip_distributions set pool_cents = 1 where id = %L$q$, :'dist_s2'),
    'D25 a sent distribution cannot be edited, even by the manager who sent it');
  -- changes_nothing, not denied: a manager has no UPDATE policy on entries at
  -- all, so the statement matches no rows rather than raising.
  select id as e_sent from public.tip_distribution_entries
    where distribution_id = :'dist_s2' and member_id = :'m_ann' limit 1 \gset
  select tests.changes_nothing(
    format($q$update public.tip_distribution_entries set amount_cents = 999999 where id = %L$q$, :'e_sent'),
    'D26 a manager cannot rewrite an entry amount either');
commit;

-- ── historical reproducibility ──────────────────────────────────────────────
select amount_cents as hist_amount from public.tip_distribution_entries where id = :'e_sent' \gset
select points as hist_points from public.tip_distribution_entries where id = :'e_sent' \gset

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.workplace_roles set points = 4.50 where id = :'r_server';
  -- Migration 20 requires the default role to belong to the default area, so
  -- the move clears it: "no default role" is legal, and the engine falls back
  -- to the first role of the effective area.
  update public.workplace_members set area_id = :'a_bar', workplace_role_id = null
    where id = :'m_ann';
  select id as rule4 from public.create_rule_draft(:'wid') as t(id) \gset
  update public.distribution_rules set min_overlap_minutes = 240 where id = :'rule4';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'rule4' and area_id = :'a_bar';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'rule4' and area_id <> :'a_bar';
  select public.activate_rule(:'rule4');
commit;

select tests.ok(
  (select amount_cents from public.tip_distribution_entries where id = :'e_sent') = :'hist_amount'::bigint,
  'D27 changing role points, areas and the overlap rule does not move a sent payout');

select tests.ok(
  (select points from public.tip_distribution_entries where id = :'e_sent') = :'hist_points'::numeric,
  'D28 …the entry still records the weighting that was actually used');

select tests.ok(
  (select rules_snapshot -> 'min_overlap_minutes' from public.tip_distributions where id = :'dist_s2')
    = to_jsonb(15),
  'D29 …and the distribution still records the rule it was calculated under');

-- ── F3 · a pool derived from the reports ────────────────────────────────────
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, card_cents, cash_cents)
  values (:'wid', :'m_ann',  '2026-07-08', 4000, 500),
         (:'wid', :'m_ben',  '2026-07-08', 2500, 0),
         (:'wid', :'m_cara', '2026-07-08', 1000, 250);
  select public.create_pool_from_reports(:'wid', '2026-07-08', '2026-07-08', 'from reports') as pool_r \gset
commit;

select tests.ok(
  (select total_cents from public.tip_pools where id = :'pool_r') = 8250,
  'D30 the pool total is summed by the database from the reports, not sent by a client');

select tests.ok(
  (select count(*) from public.tip_pool_sources where pool_id = :'pool_r') = 3,
  'D31 …and the reports it consumed are recorded');

begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select tests.denied(
    format($q$select public.create_pool_from_reports(%L, '2026-07-08', '2026-07-08', 'again')$q$, :'wid'),
    'D32 the same reports cannot fund a second pool');
commit;

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.tip_pools set status = 'void' where id = :'pool_r';
commit;

select tests.ok(
  (select count(*) from public.tip_pool_sources where pool_id = :'pool_r') = 0,
  'D33 voiding a pool releases its reports, so a mistake can be corrected');

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select public.create_pool_from_reports(:'wid', '2026-07-08', '2026-07-08', 'second go') as pool_r2 \gset
commit;

select tests.ok(
  (select total_cents from public.tip_pools where id = :'pool_r2') = 8250,
  'D34 …and they can then be used again, once');

-- ── what an employee may do with any of this ────────────────────────────────
-- Linking an account to a roster row is normally accept_invitation()'s job;
-- done directly here as the owner, since the invitation path has its own tests.
update public.workplace_members set user_id = 'd0000000-0000-0000-0000-000000000002' where id = :'m_ann';

begin; select tests.as_user('d0000000-0000-0000-0000-000000000002');  -- Ann, employee
  select tests.denied(
    format($q$select public.create_pool_from_reports(%L, '2026-07-09', '2026-07-09', 'mine')$q$, :'wid'),
    'D35 an employee cannot open a pool');
  select tests.denied(
    format($q$insert into public.tip_pools (workplace_id, period_start, period_end, cash_cents)
             values (%L, '2026-07-09', '2026-07-09', 100000)$q$, :'wid'),
    'D36 …nor insert one directly');
  select tests.denied(format($q$select public.calculate_distribution(%L)$q$, :'pool_r2'),
    'D37 …nor run a distribution');
  select tests.denied(format($q$select public.send_distribution(%L)$q$, :'dist_s2'),
    'D38 …nor send one');
  select tests.changes_nothing(
    format($q$update public.distribution_rule_areas set percentage = 100 where rule_id = %L$q$, :'rule4'),
    'D39 …nor change the area shares');
  select tests.ok(
    (select count(*) from public.tip_pools where workplace_id = :'wid') = 0,
    'D40 …and cannot even see that pools exist');
commit;

-- What Ann CAN see: her own entry, once it is published.
begin; select tests.as_user('d0000000-0000-0000-0000-000000000002');
  select tests.ok(
    (select count(*) from public.tip_distribution_entries
     where distribution_id = :'dist_s2' and member_id = :'m_ann') = 1,
    'D41 an employee can read their own entry in a sent distribution');
  select tests.ok(
    (select count(*) from public.tip_distribution_entries
     where distribution_id = :'dist_s2' and member_id <> :'m_ann') = 0,
    'D42 …and none of their colleagues'' entries, with peer visibility off');
  select tests.ok(
    (select count(*) from public.tip_distribution_areas where distribution_id = :'dist_s2') = 0,
    'D43 …nor the area subtotals, which would add up to the pool');
  select tests.ok(
    (select count(*) from public.member_distributions where id = :'dist_s2') = 1,
    'D44 …but the distribution itself is visible through the member view');
  select tests.ok(
    (select pool_cents is null from public.member_distributions where id = :'dist_s2'),
    'D45 …with the pool total masked');

  -- Ann's own row IS reachable by the ack policy, so this is the case where
  -- the column guard is what stops her, not RLS.
  select tests.denied(
    format($q$update public.tip_distribution_entries set amount_cents = 999999 where id = %L$q$, :'e_sent'),
    'D46 an employee cannot raise the amount on their own entry');
  select public.acknowledge_entry(:'e_sent', 'acknowledged');
  select tests.ok(
    (select ack_status from public.tip_distribution_entries where id = :'e_sent') = 'acknowledged',
    'D47 …but can confirm it, which is the one thing the entry policy is for');
commit;
