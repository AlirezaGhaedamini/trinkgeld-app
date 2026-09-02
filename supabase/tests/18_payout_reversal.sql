-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3M · payout reversal events.
--
-- A payout recorded by mistake is never edited and never deleted. A second
-- immutable event says it should no longer count, and the money question —
-- what does this lineage still owe? — is answered from the payments that still
-- count, not from the payments that were ever made.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-000000000001', 'v.boss@test.local',  '{"full_name":"V Boss"}'),
  ('80000000-0000-0000-0000-000000000002', 'v.staff@test.local', '{"full_name":"V Staff"}'),
  ('80000000-0000-0000-0000-000000000003', 'v.rival@test.local', '{"full_name":"V Rival"}'),
  ('80000000-0000-0000-0000-000000000004', 'v.second@test.local','{"full_name":"V Second"}')
on conflict do nothing;

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.create_workplace('Rev Lab', 'Marburg') as vw \gset
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000003');
  select public.create_workplace('Rev Rival', 'Kassel') as vx \gset
commit;

select id as v_service from public.workplace_areas where workplace_id = :'vw' and key = 'service' \gset
select id as v_bar     from public.workplace_areas where workplace_id = :'vw' and key = 'bar' \gset
select id as v_server  from public.workplace_roles where workplace_id = :'vw' and key = 'server' \gset
select id as v_keep    from public.workplace_roles where workplace_id = :'vw' and key = 'bartender' \gset
select id as v_boss    from public.workplace_members where workplace_id = :'vw' and role = 'manager' \gset

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'v_service', workplace_role_id = :'v_server'
    where id = :'v_boss';
  select token from public.create_invitation(
    :'vw', 'v.staff@test.local', 'Vera Staff', 'employee', :'v_service', :'v_server') as t \gset tok_v_
  select token from public.create_invitation(
    :'vw', 'v.second@test.local', 'Vito Second', 'manager', :'v_service', :'v_server') as t \gset tok_v2_
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_v_token') as v_staff \gset
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000004');
  select public.accept_invitation(:'tok_v2_token') as v_second \gset
commit;

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select id as v_rule from public.distribution_rules where workplace_id = :'vw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'v_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'v_rule' and area_id = :'v_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'v_rule' and area_id = :'v_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'v_rule' and area_id not in (:'v_service', :'v_bar');
  select public.activate_rule(:'v_rule');
commit;

-- One night, sent and paid. The manager's shift is the longest, which is the
-- longest_shift anchor overlap is measured against; a longer service shift would
-- leave Bar touching it only at 20:00 and the engine would refuse to distribute.
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'vw', :'v_boss', '2022-04-09', 80000);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'vw', :'v_staff', '2022-04-09 16:00Z', '2022-04-09 20:00Z', 0, 'approved', :'v_service', :'v_server'),
         (:'vw', :'v_staff', '2022-04-09 20:00Z', '2022-04-09 23:00Z', 0, 'approved', :'v_bar',     :'v_keep'),
         (:'vw', :'v_boss',  '2022-04-09 16:00Z', '2022-04-09 23:00Z', 0, 'approved', :'v_service', :'v_server');
  select public.create_pool_from_reports(:'vw', '2022-04-09', '2022-04-09') as v_pool \gset
  select public.calculate_distribution(:'v_pool') as v_a \gset
  select public.send_distribution(:'v_a');
  select public.record_distribution_payout(:'v_a', 'cash', 'Paid on the night.') as v_p1 \gset
commit;

select entries_total_cents as v_total from public.tip_distributions where id = :'v_a' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- who may reverse one
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''recorded_by_mistake'', ''Nope.'')', :'v_p1'),
    'V1  an employee cannot reverse a payout');
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000003');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''recorded_by_mistake'', ''Nope.'')', :'v_p1'),
    'V2  …nor a manager of another workplace');
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'v_second';
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000004');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''recorded_by_mistake'', ''Nope.'')', :'v_p1'),
    'V3  …nor a suspended manager');
commit;
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;
begin;
  select set_config('role', 'anon', true);
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''recorded_by_mistake'', ''Nope.'')', :'v_p1'),
    'V4  …and without a session, nobody at all');
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'v_second';
commit;

select count(*) as v_none from public.distribution_payout_reversals where payout_id = :'v_p1' \gset
select tests.ok(:'v_none'::int = 0, 'V5  …and none of those refusals recorded anything');

-- ═════════════════════════════════════════════════════════════════════════════
-- a reversal needs a reason, and blank is not one
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, null, ''Some explanation.'')', :'v_p1'),
    'V6  a reversal without a category is refused');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'')', :'v_p1'),
    'V7  …and one with no explanation at all');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'', %L)', :'v_p1', '     '),
    'V8  …and spaces are not an explanation');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'', %L)', :'v_p1', E'  \n\t '),
    'V9  …nor tabs and newlines, which migration 25 taught this codebase to catch');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'', %L)', :'v_p1', E'    ​　'),
    'V10 …nor the invisible characters a paste from a word processor leaves');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'', %L)',
    :'v_p1', '  ' || repeat('x', 501) || E'\n'),
    'V11 …and 501 characters once the whitespace around them is gone');
commit;

select count(*) as v_still_none from public.distribution_payout_reversals where payout_id = :'v_p1' \gset
select tests.ok(:'v_still_none'::int = 0, 'V12 …and still nothing was written');

-- ═════════════════════════════════════════════════════════════════════════════
-- the reversal itself
-- ═════════════════════════════════════════════════════════════════════════════
select to_jsonb(p.*) as v_p1_before from public.distribution_payouts p where p.id = :'v_p1' \gset

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(
    :'v_p1', 'recorded_by_mistake', '  We logged the wrong night.  ') as v_r1 \gset
commit;

select tests.ok(
  (select payout_id = :'v_p1'::uuid and distribution_id = :'v_a'::uuid
      and workplace_id = :'vw'::uuid
     from public.distribution_payout_reversals where id = :'v_r1'),
  'V13 the reversal names the payout, and the distribution and workplace the server derived');
select tests.ok(
  (select reversed_by = :'v_boss'::uuid and reversed_at is not null
     from public.distribution_payout_reversals where id = :'v_r1'),
  'V14 …with the actor from the session and a timestamp from the server');
select tests.ok(
  (select reason = 'recorded_by_mistake' and note = 'We logged the wrong night.'
     from public.distribution_payout_reversals where id = :'v_r1'),
  'V15 …the category chosen, and the note stored trimmed');
select tests.ok(
  (select to_jsonb(p.*) = :'v_p1_before'::jsonb from public.distribution_payouts p where p.id = :'v_p1'),
  'V16 …and the payout row itself is byte-for-byte what it was');

-- ═════════════════════════════════════════════════════════════════════════════
-- once, and only once
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'', ''Again.'')', :'v_p1'),
    'V17 a payout cannot be reversed twice');
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000004');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''other'', ''Me too.'')', :'v_p1'),
    'V18 …not by a second manager either');
commit;
select count(*) as v_one from public.distribution_payout_reversals where payout_id = :'v_p1' \gset
select tests.ok(:'v_one'::int = 1, 'V19 …so one reversal stayed one reversal');

reset role;
select tests.denied(format(
  'insert into public.distribution_payout_reversals
     (workplace_id, payout_id, distribution_id, reason, note)
   values (%L, %L, %L, ''other'', ''By hand.'')', :'vw', :'v_p1', :'v_a'),
  'V20 …and the unique index refuses a second one written straight into the table');

-- ═════════════════════════════════════════════════════════════════════════════
-- the reversal is a record too
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.distribution_payout_reversals set note = ''different'' where id = %L', :'v_r1'),
    'V21 a manager cannot reword a reversal');
  select tests.denied(format(
    'delete from public.distribution_payout_reversals where id = %L', :'v_r1'),
    'V22 …nor delete it');
commit;
reset role;
select tests.denied(format(
  'update public.distribution_payout_reversals set reason = ''other'' where id = %L', :'v_r1'),
  'V23 …and neither can the owner: the guard has no trusted-context escape');
select tests.denied(format(
  'update public.distribution_payout_reversals set reversed_at = now() - interval ''1 year'' where id = %L', :'v_r1'),
  'V24 …a reversal cannot be back-dated');
select tests.denied(format(
  'update public.distribution_payout_reversals set payout_id = %L where id = %L', :'v_p1', :'v_r1'),
  'V25 …nor repointed at another payout');
select tests.denied(format(
  'delete from public.distribution_payout_reversals where id = %L', :'v_r1'),
  'V26 …nor deleted by the owner');
select tests.denied(format(
  'insert into public.distribution_payout_reversals
     (workplace_id, payout_id, distribution_id, reason, note)
   values (%L, %L, %L, ''other'', ''Wrong distribution.'')',
  :'vw', :'v_p1', :'v_a'),
  'V27 …and a row that disagrees with the payout it names cannot be written');

-- ═════════════════════════════════════════════════════════════════════════════
-- what the reversal does to the money question
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select payout_status::text as v_state1, settlement_due_cents as v_due1,
         settled_entitlement_cents as v_basis1, reversal_count as v_rc1
    from public.distribution_settlement where distribution_id = :'v_a' \gset
commit;
select tests.ok(:'v_state1' = 'reversed',
  'V28 the distribution now reads as reversed, not as though it had never been paid');
select tests.ok(:'v_due1'::bigint = :'v_total'::bigint,
  'V29 …and the whole entitlement is owed again');
select tests.ok(:'v_basis1'::bigint = 0,
  'V30 …because a payment that no longer counts settles nothing');
select tests.ok(:'v_rc1'::int = 1,
  'V31 …while the reversal itself is still on the record');
select tests.ok(
  (select app.effective_payout(:'v_a'::uuid) is null),
  'V32 …and the distribution has no payout that still counts');
select tests.ok(
  (select count(*) = 1 from public.distribution_payouts where distribution_id = :'v_a'),
  'V33 …though the payout row it had is exactly where it was');

-- ═════════════════════════════════════════════════════════════════════════════
-- paying it again
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'v_a', 'payroll', 'On the next payslip.') as v_p2 \gset
commit;
select tests.ok(
  (select amount_cents = :'v_total'::bigint and previous_entitlement_cents = 0
     from public.distribution_payouts where id = :'v_p2'),
  'V34 the distribution can be paid again, for the full amount');
select tests.ok(
  (select count(*) = 2 from public.distribution_payouts where distribution_id = :'v_a'),
  'V35 …so two payout rows exist, which is the history');
select tests.ok(
  (select app.effective_payout(:'v_a'::uuid) = :'v_p2'::uuid),
  'V36 …and exactly one of them still counts');

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select payout_status::text as v_state2, settlement_due_cents as v_due2
    from public.distribution_settlement where distribution_id = :'v_a' \gset
  select tests.denied(format(
    'select public.record_distribution_payout(%L, ''cash'')', :'v_a'),
    'V37 …and a third payout is refused while the second one stands');
commit;
select tests.ok(:'v_state2' = 'paid',
  'V38 a distribution paid, reversed and paid again reads as PAID, not as reversed');
select tests.ok(:'v_due2'::bigint = 0, 'V39 …with nothing further owed');

reset role;
select tests.denied(format(
  'insert into public.distribution_payouts
     (workplace_id, distribution_id, entitlement_cents, previous_entitlement_cents, amount_cents, method)
   values (%L, %L, %L, 0, %L, ''cash'')', :'vw', :'v_a', :'v_total', :'v_total'),
  'V40 …and the two-effective-payouts case is refused at the table, not only by the RPC');

-- ═════════════════════════════════════════════════════════════════════════════
-- a correction after a reversal settles the FULL amount
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'v_p2', 'payment_not_completed',
    'The transfer never went out.') as v_r2 \gset
  update public.shifts set locked = false
    where member_id = :'v_staff' and area_id = :'v_service' and work_date = '2022-04-09';
  update public.shifts set starts_at = '2022-04-09 15:00Z'
    where member_id = :'v_staff' and area_id = :'v_service' and work_date = '2022-04-09';
  select public.create_replacement_distribution(:'v_a', 'hours', 'Vera started at 15:00.') as v_b \gset
  select public.send_distribution(:'v_b');
  select settled_entitlement_cents as v_b_basis, settlement_due_cents as v_b_due,
         payout_status::text as v_b_state
    from public.distribution_settlement where distribution_id = :'v_b' \gset
commit;
select entries_total_cents as v_b_total from public.tip_distributions where id = :'v_b' \gset

select tests.ok(:'v_b_basis'::bigint = 0,
  'V41 a correction whose lineage was paid and then reversed has settled nothing');
select tests.ok(:'v_b_due'::bigint = :'v_b_total'::bigint,
  'V42 …so it owes the full corrected amount, not a difference against money nobody has');
select tests.ok(:'v_b_state' = 'unpaid',
  'V43 …and reads as never paid, because ITS own record has no payout at all');

-- The basis IDENTITY, not just the amount. An employee works out their own
-- correction difference by reading their entries on settled_basis_id, so a
-- reversed ancestor must not be named there — otherwise they would be shown a
-- difference against money nobody has.
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select app.settled_basis(:'v_b'::uuid) is null as v_b_nobasis \gset
commit;
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000002');
  select settled_basis_id is null as v_b_emp_nobasis
    from public.member_distributions where id = :'v_b' \gset
commit;
select tests.ok(:'v_b_nobasis'::boolean,
  'V43b …and the lineage names no settled basis at all, because the payment behind it was reversed');
select tests.ok(:'v_b_emp_nobasis'::boolean,
  'V43c …so an employee is not pointed at an earlier version to compare against');

-- ═════════════════════════════════════════════════════════════════════════════
-- the same shape, but the ancestor's payment still counts
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'v_b', 'cash', 'Full amount, at last.') as v_p3 \gset
  update public.shifts set locked = false
    where member_id = :'v_staff' and area_id = :'v_service' and work_date = '2022-04-09';
  update public.shifts set starts_at = '2022-04-09 16:00Z'
    where member_id = :'v_staff' and area_id = :'v_service' and work_date = '2022-04-09';
  select public.create_replacement_distribution(:'v_b', 'hours', 'Back to 16:00.') as v_c \gset
  select public.send_distribution(:'v_c');
  select settled_entitlement_cents as v_c_basis, settlement_due_cents as v_c_due
    from public.distribution_settlement where distribution_id = :'v_c' \gset
commit;

select tests.ok(:'v_c_basis'::bigint = :'v_b_total'::bigint and :'v_c_due'::bigint = 0,
  'V44 a correction whose ancestor IS still settled owes the difference, exactly as before');

-- ═════════════════════════════════════════════════════════════════════════════
-- the safety rule: no reversing the ground a later settlement stands on
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'v_c') as v_p4 \gset
commit;
select tests.ok(
  (select amount_cents = 0 from public.distribution_payouts where id = :'v_p4'),
  'V45 the current version is settled at zero, its ancestor having covered it');

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.reverse_distribution_payout(%L, ''recorded_by_mistake'', ''Undo the earlier one.'')',
    :'v_p3'),
    'V46 the ancestor''s payment cannot be reversed while a later settlement stands on it');
commit;
select tests.ok(
  (select app.effective_payout(:'v_b'::uuid) = :'v_p3'::uuid),
  'V47 …and the attempt changed nothing');
select tests.ok(
  (select app.has_settled_descendant(:'v_b'::uuid)),
  'V48 …because a later version of it has been settled');

-- Unwind in the right order: the downstream one first, then the upstream one.
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'v_p4', 'recorded_by_mistake',
    'That correction was never settled separately.') as v_r4 \gset
commit;
select tests.ok(
  (select not app.has_settled_descendant(:'v_b'::uuid)),
  'V49 once the downstream settlement is reversed, nothing stands on the earlier one');
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'v_p3', 'recorded_by_mistake',
    'And that one was wrong too.') as v_r3 \gset
commit;
select tests.ok(
  (select count(*) = 1 from public.distribution_payout_reversals where payout_id = :'v_p3'),
  'V50 …and it may then be reversed, in the order that keeps the arithmetic true');
select tests.ok(
  (select app.settled_entitlement(:'v_c'::uuid) = 0),
  'V51 …after which the lineage has settled nothing at all again');

-- ═════════════════════════════════════════════════════════════════════════════
-- the event history
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select count(*) as v_events from public.distribution_payout_events
    where distribution_id = :'v_a' \gset
  select sum(amount_cents) as v_net from public.distribution_payout_events
    where distribution_id = :'v_a' \gset
  select count(*) as v_still from public.distribution_payout_events
    where distribution_id = :'v_a' and kind = 'payout' and still_counts \gset
commit;
select tests.ok(:'v_events'::int = 4,
  'V52 the first distribution has four events: paid, reversed, paid again, reversed again');
select tests.ok(:'v_net'::bigint = 0,
  'V53 …whose amounts sum to nothing, because nothing on it still counts');
select tests.ok(:'v_still'::int = 0,
  'V54 …and no payout on it is marked as still counting');

-- ═════════════════════════════════════════════════════════════════════════════
-- what each side may read
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000002');
  select count(*) as v_emp_rev from public.distribution_payout_reversals \gset
  select count(*) as v_emp_ev from public.distribution_payout_events \gset
  select payout_status::text as v_emp_state from public.member_distributions where id = :'v_a' \gset
commit;
select tests.ok(:'v_emp_rev'::int = 0,
  'V55 an employee cannot read the reversal ledger: it names the actor and the reason category');
select tests.ok(:'v_emp_ev'::int = 0, 'V56 …nor the manager event list');
select tests.ok(:'v_emp_state' = 'reversed',
  'V57 …but is told the current state of their own share, in one word');

begin;
  select tests.as_user('80000000-0000-0000-0000-000000000003');
  select count(*) as v_rival_rev from public.distribution_payout_reversals \gset
commit;
select tests.ok(:'v_rival_rev'::int = 0, 'V58 a manager of another workplace reads none of it');
begin;
  select set_config('role', 'anon', true);
  select tests.denied('select count(*) from public.distribution_payout_reversals',
    'V59 and without a session there is nothing to read');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the trail
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('80000000-0000-0000-0000-000000000001');
  select count(*) as v_audit from public.audit_log
    where workplace_id = :'vw' and table_name = 'distribution_payout_reversals' \gset
  select count(*) as v_reversals from public.distribution_payout_reversals
    where workplace_id = :'vw' \gset
  select (after ->> 'reason') as v_audit_reason from public.audit_log
    where table_name = 'distribution_payout_reversals' and record_id = :'v_r1'::uuid \gset
  select actor_member_id as v_audit_actor from public.audit_log
    where table_name = 'distribution_payout_reversals' and record_id = :'v_r1'::uuid \gset
  select (after ->> 'distribution_id') as v_audit_dist from public.audit_log
    where table_name = 'distribution_payout_reversals' and record_id = :'v_r1'::uuid \gset
commit;
select tests.ok(:'v_audit'::int = :'v_reversals'::int and :'v_reversals'::int >= 4,
  'V60 every reversal is on the audit trail, one row each');
select tests.ok(:'v_audit_reason' = 'recorded_by_mistake',
  'V61 …with the reason it was given');
select tests.ok(:'v_audit_actor' = :'v_boss',
  'V62 …the manager who recorded it');
select tests.ok(:'v_audit_dist' = :'v_a',
  'V63 …and the distribution it belongs to');
select tests.ok(
  (select count(*) >= 4 from public.audit_log
    where workplace_id = :'vw' and table_name = 'distribution_payouts'),
  'V64 …while the payouts keep the audit rows they always had');
