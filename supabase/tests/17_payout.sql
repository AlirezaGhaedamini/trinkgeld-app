-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3L · payout / paid status.
--
-- Recording that a distribution was actually handed over, and — the part this
-- phase turns on — making a correction after a payment settle the DIFFERENCE
-- rather than a second full amount.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0000-0000-0000-000000000001', 'p.boss@test.local',  '{"full_name":"P Boss"}'),
  ('70000000-0000-0000-0000-000000000002', 'p.staff@test.local', '{"full_name":"P Staff"}'),
  ('70000000-0000-0000-0000-000000000003', 'p.rival@test.local', '{"full_name":"P Rival"}'),
  ('70000000-0000-0000-0000-000000000004', 'p.second@test.local','{"full_name":"P Second"}')
on conflict do nothing;

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select public.create_workplace('Pay Lab', 'Marburg') as pw \gset
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000003');
  select public.create_workplace('Pay Rival', 'Kassel') as px \gset
commit;

select id as p_service from public.workplace_areas where workplace_id = :'pw' and key = 'service' \gset
select id as p_bar     from public.workplace_areas where workplace_id = :'pw' and key = 'bar' \gset
select id as p_server  from public.workplace_roles where workplace_id = :'pw' and key = 'server' \gset
select id as p_keep    from public.workplace_roles where workplace_id = :'pw' and key = 'bartender' \gset
select id as p_boss    from public.workplace_members where workplace_id = :'pw' and role = 'manager' \gset

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'p_service', workplace_role_id = :'p_server'
    where id = :'p_boss';
  select token from public.create_invitation(
    :'pw', 'p.staff@test.local', 'Pia Staff', 'employee', :'p_service', :'p_server') as t \gset tok_p_
  select token from public.create_invitation(
    :'pw', 'p.second@test.local', 'Piet Second', 'manager', :'p_service', :'p_server') as t \gset tok_p2_
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_p_token') as p_staff \gset
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000004');
  select public.accept_invitation(:'tok_p2_token') as p_second \gset
commit;

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select id as p_rule from public.distribution_rules where workplace_id = :'pw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'p_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'p_rule' and area_id = :'p_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'p_rule' and area_id = :'p_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'p_rule' and area_id not in (:'p_service', :'p_bar');
  select public.activate_rule(:'p_rule');

  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'pw', :'p_boss', '2021-05-08', 100000) returning id as p_report \gset

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'pw', :'p_staff', '2021-05-08 16:00Z', '2021-05-08 20:00Z', 0, 'approved', :'p_service', :'p_server'),
         (:'pw', :'p_staff', '2021-05-08 20:00Z', '2021-05-08 23:00Z', 0, 'approved', :'p_bar',     :'p_keep'),
         (:'pw', :'p_boss',  '2021-05-08 16:00Z', '2021-05-08 23:00Z', 0, 'approved', :'p_service', :'p_server');
  select public.create_pool_from_reports(:'pw', '2021-05-08', '2021-05-08') as p_pool \gset
  select public.calculate_distribution(:'p_pool') as p_a \gset
  select public.send_distribution(:'p_a');
commit;

select entries_total_cents as p_a_total from public.tip_distributions where id = :'p_a' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- nothing is paid until somebody says so
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select payout_status::text as p_state0, settlement_due_cents as p_due0
    from public.distribution_settlement where distribution_id = :'p_a' \gset
commit;
select tests.ok(:'p_state0' = 'unpaid', 'P1  a sent distribution starts unpaid');
select tests.ok(:'p_due0'::bigint = :'p_a_total'::bigint,
  'P2  …and the whole entitlement is what is due, because nothing was settled before it');

-- ═════════════════════════════════════════════════════════════════════════════
-- who may record one
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_a'),
    'P3  an employee cannot mark a distribution paid');
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000003');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_a'),
    'P4  …nor a manager of another workplace');
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'p_second';
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000004');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_a'),
    'P5  …nor a suspended manager, because app.is_manager() filters on status');
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'p_second';
commit;

select count(*) as p_none from public.distribution_payouts where distribution_id = :'p_a' \gset
select tests.ok(:'p_none'::int = 0, 'P6  …and none of those refusals recorded anything');

-- ═════════════════════════════════════════════════════════════════════════════
-- the manager records it, and the server decides the number
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'p_a', 'cash', '  Handed out after service.  ') as p_pay_a \gset
commit;

select tests.ok(
  (select amount_cents = :'p_a_total'::bigint
      and entitlement_cents = :'p_a_total'::bigint
      and previous_entitlement_cents = 0
     from public.distribution_payouts where id = :'p_pay_a'),
  'P7  the first payout settles the whole entitlement, derived from the distribution');
select tests.ok(
  (select paid_by = :'p_boss'::uuid and paid_at is not null and method = 'cash'
     from public.distribution_payouts where id = :'p_pay_a'),
  'P8  …with the actor derived from the session, a timestamp, and the method given');
select tests.ok(
  (select note = 'Handed out after service.' from public.distribution_payouts where id = :'p_pay_a'),
  'P9  …and the note stored trimmed');

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select payout_status::text as p_state1 from public.distribution_settlement
    where distribution_id = :'p_a' \gset
  select settlement_due_cents as p_due1 from public.distribution_settlement
    where distribution_id = :'p_a' \gset
commit;
select tests.ok(:'p_state1' = 'paid', 'P10 the distribution now reads as paid');

-- ═════════════════════════════════════════════════════════════════════════════
-- exactly once
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''payroll'')', :'p_a'),
    'P11 the same distribution cannot be paid a second time');
commit;
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000004');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_a'),
    'P12 …not by a second manager either');
commit;
select count(*) as p_one from public.distribution_payouts where distribution_id = :'p_a' \gset
select tests.ok(:'p_one'::int = 1, 'P13 …so one payout stayed one payout');

-- ═════════════════════════════════════════════════════════════════════════════
-- the record cannot be rewritten
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.distribution_payouts set amount_cents = 1 where id = %L', :'p_pay_a'),
    'P14 a manager cannot rewrite what was paid');
  select tests.denied(format(
    'update public.distribution_payouts set paid_by = %L where id = %L', :'p_staff', :'p_pay_a'),
    'P15 …nor who paid it');
  select tests.denied(format(
    'update public.distribution_payouts set method = ''payroll'' where id = %L', :'p_pay_a'),
    'P16 …nor how');
  select tests.denied(format(
    'update public.distribution_payouts set paid_at = now() - interval ''3 days'' where id = %L', :'p_pay_a'),
    'P17 …nor when');
  select tests.denied(format(
    'delete from public.distribution_payouts where id = %L', :'p_pay_a'),
    'P18 …and it cannot be deleted');
  select tests.denied(format(
    'insert into public.distribution_payouts
       (workplace_id, distribution_id, entitlement_cents, previous_entitlement_cents,
        amount_cents, method, paid_by)
     values (%L, %L, 999999, 0, 999999, ''cash'', %L)', :'pw', :'p_a', :'p_boss'),
    'P19 …and no client may write one by hand, at an amount of its own choosing');
commit;
-- As the OWNER, which is past every privilege and every policy. The payload
-- matters: an amount is already refused by payouts_amount_is_the_difference, so
-- changing one would prove the arithmetic constraint rather than the guard.
-- These change fields no constraint polices, which leaves the guard as the only
-- thing that can say no.
reset role;
select tests.denied(format(
  'update public.distribution_payouts set method = ''bank_transfer'' where id = %L', :'p_pay_a'),
  'P20 …not even the owner: the immutability guard has no trusted-context escape');
select tests.denied(format(
  'update public.distribution_payouts set paid_at = now() - interval ''1 year'' where id = %L', :'p_pay_a'),
  'P20b …and a payment cannot be back-dated by anybody');
select tests.denied(format(
  'update public.distribution_payouts set note = ''something else'' where id = %L', :'p_pay_a'),
  'P20c …nor its note quietly reworded');
select tests.denied(format(
  'delete from public.distribution_payouts where id = %L', :'p_pay_a'),
  'P20d …and the owner cannot delete it either');
-- Arithmetically valid, correctly shaped, and still refused: a distribution is
-- settled once. This reaches the unique index, which is what survives two
-- managers pressing the button at the same instant — the RPC's own check would
-- have refused it long before here.
select tests.denied(format(
  'insert into public.distribution_payouts
     (workplace_id, distribution_id, entitlement_cents, previous_entitlement_cents, amount_cents, method)
   values (%L, %L, 500, 0, 500, ''cash'')', :'pw', :'p_a'),
  'P20e a second payout for one distribution is refused by the database, not by the RPC');

select tests.ok(
  (select amount_cents = :'p_a_total'::bigint and method = 'cash' and paid_by = :'p_boss'::uuid
     from public.distribution_payouts where id = :'p_pay_a'),
  'P21 …so the record still says exactly what it said');

-- ═════════════════════════════════════════════════════════════════════════════
-- a paid distribution is replaced: the correction settles the DIFFERENCE
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-08';
  update public.shifts set starts_at = '2021-05-08 14:00Z'
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-08';
  -- More hours for the same pool does not change the pool, so force a bigger one
  -- by raising the report the pool was built from is not possible: the pool is
  -- reused by design. The entitlement therefore stays equal, which is exactly
  -- the zero-delta case — tested first, then a real difference below.
  select public.create_replacement_distribution(:'p_a', 'hours', 'Pia started at 14:00.') as p_b \gset
  select public.send_distribution(:'p_b');
commit;

select entries_total_cents as p_b_total from public.tip_distributions where id = :'p_b' \gset
select tests.ok(:'p_b_total'::bigint = :'p_a_total'::bigint,
  'P22 a replacement funded by the same pool has the same total; only the split moved');

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select settled_entitlement_cents as p_b_basis, settlement_due_cents as p_b_due,
         payout_status::text as p_b_state
    from public.distribution_settlement where distribution_id = :'p_b' \gset
commit;
select tests.ok(:'p_b_basis'::bigint = :'p_a_total'::bigint,
  'P23 …and it knows the lineage already settled the original''s entitlement');
select tests.ok(:'p_b_due'::bigint = 0,
  'P24 …so the difference still to settle is zero, not a second full payout');
select tests.ok(:'p_b_state' = 'unpaid',
  'P25 …while the correction itself is not yet marked settled');

select tests.ok(
  (select status = 'cancelled' from public.tip_distributions where id = :'p_a'),
  'P26 the original was retired by the correction');
select tests.ok(
  (select count(*) = 1 from public.distribution_payouts where distribution_id = :'p_a'),
  'P27 …and its payment stayed exactly where it was, on the distribution that was paid');
select tests.ok(
  (select count(*) = 0 from public.distribution_payouts where distribution_id = :'p_b'),
  'P28 …and was not moved onto the correction');

-- Zero difference, settled without naming a method: nothing changed hands.
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'p_b') as p_pay_b \gset
commit;
select tests.ok(
  (select amount_cents = 0 and method is null and entitlement_cents = :'p_a_total'::bigint
     from public.distribution_payouts where id = :'p_pay_b'),
  'P29 a correction worth nothing is settled at zero, with no method invented for it');

select tests.ok(
  (select sum(amount_cents) = :'p_a_total'::bigint from public.distribution_payouts
     where distribution_id in (:'p_a', :'p_b')),
  'P30 …and the lineage has still handed over exactly one entitlement in total');

-- ═════════════════════════════════════════════════════════════════════════════
-- the difference that actually moves: per person, not per workplace
--
-- The audit finding this phase turns on. A replacement reuses the original's
-- pool, and a distributed pool's amounts are frozen, so the workplace total
-- CANNOT change across a lineage. What changes is who gets what — and that is
-- the money a manager has to hand over or take back.
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  (select count(distinct entries_total_cents) = 1 from public.tip_distributions
     where tip_pool_id = :'p_pool'),
  'P31 every version funded by one pool has the identical total — the pool is frozen');

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select difference_cents as p_staff_diff from public.distribution_member_settlement
    where distribution_id = :'p_b' and member_id = :'p_staff' \gset
  select difference_cents as p_boss_diff from public.distribution_member_settlement
    where distribution_id = :'p_b' and member_id = :'p_boss' \gset
  select sum(difference_cents) as p_sum_diff from public.distribution_member_settlement
    where distribution_id = :'p_b' \gset
  select entitlement_cents as p_staff_now, previously_settled_cents as p_staff_was
    from public.distribution_member_settlement
    where distribution_id = :'p_b' and member_id = :'p_staff' \gset
commit;

select tests.ok(:'p_staff_diff'::bigint > 0,
  'P32 the corrected version owes one person more than the version that was paid');
select tests.ok(:'p_boss_diff'::bigint < 0,
  'P33 …and another person less');
select tests.ok(:'p_staff_diff'::bigint = -(:'p_boss_diff'::bigint),
  'P34 …by exactly the same amount, because the pool did not change');
select tests.ok(:'p_sum_diff'::bigint = 0,
  'P35 …so the differences across the team sum to zero, which is why the workplace owes nothing more');
select tests.ok(:'p_staff_now'::bigint - :'p_staff_was'::bigint = :'p_staff_diff'::bigint,
  'P36 …and each difference is that person''s new share minus the share that was settled for them');

-- ═════════════════════════════════════════════════════════════════════════════
-- the per-person basis follows the LINEAGE, not the immediate predecessor
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  -- Move hours in SERVICE, the area two people share. Bar is Pia's alone, so her
  -- hours there set nobody's ratio and changing them moves no money. And it has
  -- to be her shift, not the manager's: his 16:00-23:00 is the longest_shift
  -- anchor overlap is measured against, and shortening it would hand the anchor
  -- to a service shift that merely touches the bar shift at 20:00, leaving Bar
  -- with no eligible hours and no distribution at all.
  update public.shifts set locked = false
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-08';
  update public.shifts set starts_at = '2021-05-08 15:00Z'
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-08';
  select public.create_replacement_distribution(:'p_b', 'hours', 'Pia started at 15:00, not 14:00.') as p_b2 \gset
  select public.send_distribution(:'p_b2');
  select settled_entitlement_cents as p_b2_basis, settlement_due_cents as p_b2_due
    from public.distribution_settlement where distribution_id = :'p_b2' \gset
  select previously_settled_cents as p_b2_staff_was
    from public.distribution_member_settlement
    where distribution_id = :'p_b2' and member_id = :'p_staff' \gset
  select entitlement_cents as p_b_staff from public.distribution_member_settlement
    where distribution_id = :'p_b' and member_id = :'p_staff' \gset
commit;

select tests.ok(:'p_b2_basis'::bigint = :'p_a_total'::bigint and :'p_b2_due'::bigint = 0,
  'P37 a third version still owes the workplace nothing more, because the pool is the same one');
select tests.ok(:'p_b2_staff_was'::bigint = :'p_b_staff'::bigint,
  'P38 …and each person is measured against the version most recently settled for them, not the first');

-- A negative per-person difference is recorded and shown, and creates no debt.
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select count(*) as p_neg from public.distribution_member_settlement
    where distribution_id = :'p_b2' and difference_cents < 0 \gset
  select count(*) as p_pos from public.distribution_member_settlement
    where distribution_id = :'p_b2' and difference_cents > 0 \gset
commit;
select tests.ok(:'p_neg'::int >= 1 and :'p_pos'::int >= 1,
  'P39 a correction is somebody up and somebody down, and both are stated plainly');

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'p_b2') as p_pay_b2 \gset
commit;
select tests.ok(
  (select sum(amount_cents) = :'p_a_total'::bigint from public.distribution_payouts p
     join public.tip_distributions d on d.id = p.distribution_id
    where d.tip_pool_id = :'p_pool'),
  'P40 three settlements against one pool still add up to exactly one entitlement');

-- ═════════════════════════════════════════════════════════════════════════════
-- never paid, then replaced: the correction settles the FULL amount
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'pw', :'p_boss', '2021-05-22', 60000) returning id as p_report3 \gset
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'pw', :'p_staff', '2021-05-22 16:00Z', '2021-05-22 20:00Z', 0, 'approved', :'p_service', :'p_server'),
         (:'pw', :'p_staff', '2021-05-22 20:00Z', '2021-05-22 23:00Z', 0, 'approved', :'p_bar',     :'p_keep'),
         (:'pw', :'p_boss',  '2021-05-22 16:00Z', '2021-05-22 23:00Z', 0, 'approved', :'p_service', :'p_server');
  select public.create_pool_from_reports(:'pw', '2021-05-22', '2021-05-22') as p_pool3 \gset
  select public.calculate_distribution(:'p_pool3') as p_f \gset
  select public.send_distribution(:'p_f');

  update public.shifts set locked = false where member_id = :'p_staff' and work_date = '2021-05-22'
    and area_id = :'p_service';
  update public.shifts set starts_at = '2021-05-22 14:00Z'
    where member_id = :'p_staff' and work_date = '2021-05-22' and area_id = :'p_service';
  select public.create_replacement_distribution(:'p_f', 'hours', 'Pia started at 14:00.') as p_g \gset
  select public.send_distribution(:'p_g');

  update public.shifts set locked = false
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-22';
  update public.shifts set starts_at = '2021-05-22 15:00Z'
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-22';
  select public.create_replacement_distribution(:'p_g', 'hours', 'Pia started at 15:00, not 14:00.') as p_h \gset
  select public.send_distribution(:'p_h');
  select settled_entitlement_cents as p_h_basis, settlement_due_cents as p_h_due
    from public.distribution_settlement where distribution_id = :'p_h' \gset
  select previously_settled_cents as p_h_staff_was, difference_cents as p_h_staff_diff
    from public.distribution_member_settlement
    where distribution_id = :'p_h' and member_id = :'p_staff' \gset
commit;
select entries_total_cents as p_h_total from public.tip_distributions where id = :'p_h' \gset

select tests.ok(:'p_h_basis'::bigint = 0,
  'P41 a lineage nobody ever paid has settled nothing, however long it is');
select tests.ok(:'p_h_due'::bigint = :'p_h_total'::bigint,
  'P42 …so the current version settles its full amount, not a difference');
select tests.ok(:'p_h_staff_was'::bigint = 0,
  'P43 …and per person nothing was settled either');
select tests.ok(:'p_h_staff_diff'::bigint > 0,
  'P44 …so each person is owed their whole share, not the movement since the last version');

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'p_h', 'bank_transfer') as p_pay_h \gset
commit;
select tests.ok(
  (select amount_cents = :'p_h_total'::bigint and previous_entitlement_cents = 0
     from public.distribution_payouts where id = :'p_pay_h'),
  'P45 …and that is what gets recorded');
select tests.ok(
  (select count(*) = 0 from public.distribution_payouts
     where distribution_id in (:'p_f', :'p_g')),
  'P46 …while the two versions nobody paid still have no payout of their own');

-- ═════════════════════════════════════════════════════════════════════════════
-- what may be paid at all
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-22';
  update public.shifts set starts_at = '2021-05-22 16:00Z'
    where member_id = :'p_staff' and area_id = :'p_service' and work_date = '2021-05-22';
  select public.create_replacement_distribution(:'p_h', 'hours', 'Back to 16:00 after all.') as p_draft \gset
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_draft'),
    'P47 a draft has been shown to nobody and cannot be paid');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_a'),
    'P48 a replaced historical version cannot be newly paid');
commit;

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select public.send_distribution(:'p_draft');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_h'),
    'P49 …and neither can the version it just replaced, even though that one was paid');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the shape of the ledger itself
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
select tests.denied(format(
  'insert into public.distribution_payouts
     (workplace_id, distribution_id, entitlement_cents, previous_entitlement_cents, amount_cents, method)
   values (%L, %L, 1000, 0, 500, ''cash'')', :'pw', :'p_draft'),
  'P50 a payout row whose amount is not the difference is not a payout row');
select tests.denied(format(
  'insert into public.distribution_payouts
     (workplace_id, distribution_id, entitlement_cents, previous_entitlement_cents, amount_cents)
   values (%L, %L, 1000, 0, 1000)', :'pw', :'p_draft'),
  'P51 …and money that changed hands has to say how');

-- A method is only meaningful when something changed hands. A fourth night,
-- never paid, is where the whole entitlement moves and the method is therefore
-- required — the correction above needed none, because at workplace level a
-- correction to a settled pool moves nothing.
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'pw', :'p_boss', '2021-05-29', 40000);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'pw', :'p_staff', '2021-05-29 16:00Z', '2021-05-29 20:00Z', 0, 'approved', :'p_service', :'p_server'),
         (:'pw', :'p_staff', '2021-05-29 20:00Z', '2021-05-29 23:00Z', 0, 'approved', :'p_bar',     :'p_keep'),
         (:'pw', :'p_boss',  '2021-05-29 16:00Z', '2021-05-29 23:00Z', 0, 'approved', :'p_service', :'p_server');
  select public.create_pool_from_reports(:'pw', '2021-05-29', '2021-05-29') as p_pool4 \gset
  select public.calculate_distribution(:'p_pool4') as p_j \gset
  select public.send_distribution(:'p_j');

  select tests.denied(format(
    'select public.record_distribution_payout(%L, null)', :'p_j'),
    'P52 …which the RPC refuses too, when something really does change hands');
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'', %L)', :'p_j', repeat('n', 501)),
    'P53 …and a note longer than the column allows is refused');
  select settlement_due_cents as p_j_due from public.distribution_settlement
    where distribution_id = :'p_j' \gset
commit;
select tests.ok(:'p_j_due'::bigint > 0,
  'P54 …the difference on that night being the whole of it, since its pool never paid out');

-- ═════════════════════════════════════════════════════════════════════════════
-- what each side may read
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000002');
  select count(*) as p_emp_ledger from public.distribution_payouts \gset
  select count(*) as p_emp_settle from public.distribution_settlement \gset
  select payout_status::text as p_emp_state, payout_method::text as p_emp_method
    from public.member_distributions where id = :'p_a' \gset
  select settled_basis_id as p_emp_basis from public.member_distributions where id = :'p_b2' \gset
  -- The per-member settlement view reads tip_distributions, which an employee
  -- cannot read at all, so it is manager-only by inheritance. An employee works
  -- out their own difference the way they already can: their own entries on this
  -- version, and their own entries on the version it was settled against.
  select sum(amount_cents) as p_emp_now from public.member_distribution_entries
    where distribution_id = :'p_b2' and is_own \gset
  select sum(amount_cents) as p_emp_was from public.member_distribution_entries
    where distribution_id = :'p_b' and is_own \gset
  select count(*) as p_emp_peers from public.member_distribution_entries
    where distribution_id = :'p_b2' and not is_own \gset
commit;
select tests.ok(:'p_emp_ledger'::int = 0,
  'P55 an employee cannot read the ledger: its amounts are workplace totals');
select tests.ok(:'p_emp_settle'::int = 0,
  'P56 …nor the manager settlement view');
select tests.ok(:'p_emp_state' = 'paid',
  'P57 …but is told whether their own distribution was settled');
select tests.ok(:'p_emp_method' = 'cash',
  'P58 …and how it was paid');
select tests.ok(:'p_emp_basis' = :'p_b',
  'P59 …and which earlier version it was settled against, so they can work out their own difference');
select tests.ok(:'p_emp_now'::bigint > 0 and :'p_emp_was'::bigint > 0,
  'P59b …and can read their own share on both, which is their correction difference');
select tests.ok(:'p_emp_peers'::int = 0,
  'P59c …while a colleague''s share stays behind peer_entry_visibility, exactly as before this phase');

begin;
  select tests.as_user('70000000-0000-0000-0000-000000000003');
  select count(*) as p_rival from public.distribution_payouts \gset
commit;
select tests.ok(:'p_rival'::int = 0, 'P60 a manager of another workplace reads none of it');

grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;
begin;
  select set_config('role', 'anon', true);
  select tests.denied('select count(*) from public.distribution_payouts',
    'P61 and without a session there is nothing to read');
commit;
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;
begin;
  select set_config('role', 'anon', true);
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'p_draft'),
    'P62 …and nothing to write');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the payment outlives everything around it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  update public.workplace_members set display_name = 'Pia Renamed' where id = :'p_staff';
  update public.workplace_members set area_id = :'p_bar', workplace_role_id = :'p_keep'
    where id = :'p_staff';
  select id as p_rule2 from public.create_rule_draft(:'pw') as id \gset
  update public.distribution_rule_areas set percentage = 50 where rule_id = :'p_rule2' and area_id = :'p_service';
  update public.distribution_rule_areas set percentage = 50 where rule_id = :'p_rule2' and area_id = :'p_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'p_rule2' and area_id not in (:'p_service', :'p_bar');
  select public.activate_rule(:'p_rule2');
commit;

select tests.ok(
  (select amount_cents = :'p_a_total'::bigint and method = 'cash'
     from public.distribution_payouts where id = :'p_pay_a'),
  'P63 a payout is unchanged by a rename, a reassignment or a new rule version');
select tests.ok(
  (select distribution_id = :'p_a' from public.distribution_payouts where id = :'p_pay_a'),
  'P64 …and stays attached to the distribution it settled, not to whatever replaced it');

-- ═════════════════════════════════════════════════════════════════════════════
-- the trail
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('70000000-0000-0000-0000-000000000001');
  select count(*) as p_audit from public.audit_log
    where workplace_id = :'pw' and table_name = 'distribution_payouts' \gset
  select (after ->> 'amount_cents') as p_audit_amount from public.audit_log
    where workplace_id = :'pw' and table_name = 'distribution_payouts'
      and record_id = :'p_pay_a'::uuid \gset
  select actor_member_id as p_audit_actor from public.audit_log
    where workplace_id = :'pw' and table_name = 'distribution_payouts'
      and record_id = :'p_pay_a'::uuid \gset
commit;
select count(*) as p_payouts from public.distribution_payouts where workplace_id = :'pw' \gset
select tests.ok(:'p_audit'::int = :'p_payouts'::int and :'p_payouts'::int >= 4,
  'P65 every payout is on the audit trail — one row each, no more and no fewer');
select tests.ok(:'p_audit_amount'::bigint = :'p_a_total'::bigint,
  'P66 …with the amount that was actually recorded');
select tests.ok(:'p_audit_actor' = :'p_boss',
  'P67 …and the manager who recorded it');
