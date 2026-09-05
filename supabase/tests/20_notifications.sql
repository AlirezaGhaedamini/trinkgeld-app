-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3O · notifications, and migration 31's lineage fix.
--
-- Six events, one personal inbox each, and a table no client may write. What is
-- proved here: who is told, who is NOT told, that a repeated event is idempotent
-- while two genuine events stay two rows, that nothing but read_at ever moves —
-- not even for the table owner — and that a corrected night stays traversable
-- down a chain.
--
-- The fixture is built so every amount can be checked by hand: a pool of
-- €1,000, service at 60% shared by two people and bar at 40% held by one, so a
-- correction to service hours moves service and leaves bar EXACTLY where it was.
-- That zero-delta member is the whole point of the payout recipient rule.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1100000-0000-0000-0000-000000000001', 'n.boss@test.local',  '{"full_name":"N Boss"}'),
  ('a1100000-0000-0000-0000-000000000002', 'n.staff@test.local', '{"full_name":"N Staff"}'),
  ('a1100000-0000-0000-0000-000000000003', 'n.bar@test.local',   '{"full_name":"N Bar"}'),
  ('a1100000-0000-0000-0000-000000000004', 'n.rival@test.local', '{"full_name":"N Rival"}'),
  ('a1100000-0000-0000-0000-000000000005', 'n.ghost@test.local', '{"full_name":"N Ghost"}')
on conflict do nothing;

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.create_workplace('Notify Lab', 'Marburg') as nw \gset
commit;
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000004');
  select public.create_workplace('Notify Rival', 'Kassel') as nx \gset
commit;

select id as n_service from public.workplace_areas where workplace_id = :'nw' and key = 'service' \gset
select id as n_bar     from public.workplace_areas where workplace_id = :'nw' and key = 'bar' \gset
select id as n_server  from public.workplace_roles where workplace_id = :'nw' and key = 'server' \gset
select id as n_keep    from public.workplace_roles where workplace_id = :'nw' and key = 'bartender' \gset
select id as n_boss    from public.workplace_members where workplace_id = :'nw' and role = 'manager' \gset

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'n_service', workplace_role_id = :'n_server'
    where id = :'n_boss';
  select token from public.create_invitation(
    :'nw', 'n.staff@test.local', 'Nia Staff', 'employee', :'n_service', :'n_server') as t \gset tok_n1_
  select token from public.create_invitation(
    :'nw', 'n.bar@test.local', 'Bo Bar', 'employee', :'n_bar', :'n_keep') as t \gset tok_n2_
  -- The negative control: a real, active, account-backed member of this
  -- workplace who never works a shift, so nothing here is ever about them.
  select token from public.create_invitation(
    :'nw', 'n.ghost@test.local', 'Gil Ghost', 'employee', :'n_service', :'n_server') as t \gset tok_n3_
commit;
begin; select tests.as_user('a1100000-0000-0000-0000-000000000002');
       select public.accept_invitation(:'tok_n1_token') as n_staff \gset commit;
begin; select tests.as_user('a1100000-0000-0000-0000-000000000003');
       select public.accept_invitation(:'tok_n2_token') as n_bar_m \gset commit;
begin; select tests.as_user('a1100000-0000-0000-0000-000000000005');
       select public.accept_invitation(:'tok_n3_token') as n_ghost \gset commit;

-- The same person in a SECOND workplace, so multi-workplace isolation is a fact
-- about the fixture rather than an assumption.
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000004');
  select token from public.create_invitation(
    :'nx', 'n.staff@test.local', 'Nia Elsewhere', 'employee', null, null) as t \gset tok_nx_
commit;
begin; select tests.as_user('a1100000-0000-0000-0000-000000000002');
       select public.accept_invitation(:'tok_nx_token') as n_staff_x \gset commit;

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select id as n_rule from public.distribution_rules where workplace_id = :'nw' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours_points', min_overlap_minutes = 15,
         acknowledgement_required = true where id = :'n_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'n_rule' and area_id = :'n_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'n_rule' and area_id = :'n_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'n_rule' and area_id not in (:'n_service', :'n_bar');
  select public.activate_rule(:'n_rule');
commit;

create or replace function tests.notify_night(
  p_wp uuid, p_boss uuid, p_staff uuid, p_bar_m uuid, p_svc uuid, p_bar uuid,
  p_srv uuid, p_keep uuid, p_day date, p_cash bigint)
returns uuid language plpgsql as $$
declare v_pool uuid; v_dist uuid;
begin
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (p_wp, p_boss, p_day, p_cash);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (p_wp, p_boss,   (p_day + time '16:00') at time zone 'UTC', (p_day + time '23:00') at time zone 'UTC', 0, 'approved', p_svc, p_srv),
         (p_wp, p_staff,  (p_day + time '16:00') at time zone 'UTC', (p_day + time '20:00') at time zone 'UTC', 0, 'approved', p_svc, p_srv),
         (p_wp, p_bar_m,  (p_day + time '18:00') at time zone 'UTC', (p_day + time '22:00') at time zone 'UTC', 0, 'approved', p_bar, p_keep);
  v_pool := public.create_pool_from_reports(p_wp, p_day, p_day);
  v_dist := public.calculate_distribution(v_pool);
  return v_dist;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- a draft tells nobody
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select tests.notify_night(:'nw', :'n_boss', :'n_staff', :'n_bar_m', :'n_service', :'n_bar',
    :'n_server', :'n_keep', '2024-02-01', 100000) as n_a1 \gset
commit;

select count(*) as n_draft_rows from public.member_notifications where workplace_id = :'nw' \gset
select tests.ok(:'n_draft_rows'::int = 0,
  'N1  a distribution that has only been calculated notifies nobody');

-- ═════════════════════════════════════════════════════════════════════════════
-- sending it tells the people in it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.send_distribution(:'n_a1');
commit;

select count(*) as n_sent_rows from public.member_notifications
  where distribution_id = :'n_a1' and type = 'distribution_sent' \gset
select count(*) as n_entry_people from (
  select distinct member_id from public.tip_distribution_entries where distribution_id = :'n_a1') t \gset
select tests.ok(:'n_sent_rows'::int = :'n_entry_people'::int and :'n_sent_rows'::int = 3,
  'N2  sending it notifies exactly the people who have an entry');
select tests.ok(
  (select bool_and(type = 'distribution_sent') from public.member_notifications
    where distribution_id = :'n_a1'),
  'N3  …as a first version, not as a correction');
select tests.ok(
  (select count(*) = 0 from public.member_notifications n
    where n.distribution_id = :'n_a1' and n.read_at is not null),
  'N4  …and every one of them starts unread');
select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'n_ghost'),
  'N4b a member with an account but no entry in it is told nothing');

-- Everyone confirms, so the distribution moves sent -> confirmed. That is a
-- status change on the same row, and it must not read as a second sending.
begin; select tests.as_user('a1100000-0000-0000-0000-000000000001');
       select public.acknowledge_distribution(:'n_a1', 'acknowledged'); commit;
begin; select tests.as_user('a1100000-0000-0000-0000-000000000002');
       select public.acknowledge_distribution(:'n_a1', 'acknowledged'); commit;
begin; select tests.as_user('a1100000-0000-0000-0000-000000000003');
       select public.acknowledge_distribution(:'n_a1', 'acknowledged'); commit;
select tests.ok(
  (select status = 'confirmed' from public.tip_distributions where id = :'n_a1'),
  'N4c the fixture really did confirm it');
select tests.ok(
  (select count(*) from public.member_notifications
    where distribution_id = :'n_a1' and type = 'distribution_sent') = :'n_sent_rows'::int,
  'N4d …and confirming did not send a second round of notifications');

-- ═════════════════════════════════════════════════════════════════════════════
-- the payload carries no money, no auth id, no private note
-- ═════════════════════════════════════════════════════════════════════════════
select coalesce(string_agg(payload::text, ' '), '') as n_payloads
  from public.member_notifications where workplace_id = :'nw' \gset
select tests.ok(
  position('cents' in :'n_payloads') = 0 and position('amount' in :'n_payloads') = 0
  and position('pool' in :'n_payloads') = 0,
  'N5  no payload mentions an amount or a pool');
select tests.ok(position('a1100000-0000-0000-0000' in :'n_payloads') = 0,
  'N6  …nor an auth user id');
select tests.ok(position('@' in :'n_payloads') = 0,
  'N7  …nor an email address');
select tests.ok(
  (select bool_and(not (payload ? 'correction_note')) from public.member_notifications
    where workplace_id = :'nw'),
  'N8  …nor a manager-only correction note');

-- ═════════════════════════════════════════════════════════════════════════════
-- the same source event twice is one row
-- ═════════════════════════════════════════════════════════════════════════════
select app.notify_members(:'nw', array[:'n_staff']::uuid[], 'distribution_sent',
  :'n_a1', null, null, null, '{}'::jsonb) as n_again \gset
select count(*) as n_after_repeat from public.member_notifications
  where member_id = :'n_staff' and type = 'distribution_sent' and distribution_id = :'n_a1' \gset
select tests.ok(:'n_again'::int = 0 and :'n_after_repeat'::int = 1,
  'N9  replaying the same source event inserts nothing and leaves one row');

-- ═════════════════════════════════════════════════════════════════════════════
-- a first payout reaches everyone whose settlement moves
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'n_a1', 'cash', 'Paid on the night.') as n_pay1 \gset
commit;

select count(*) as n_pay1_rows from public.member_notifications
  where payout_id = :'n_pay1' and type = 'payout_recorded' \gset
select tests.ok(:'n_pay1_rows'::int = :'n_entry_people'::int and :'n_pay1_rows'::int > 0,
  'N10 a first payout reaches everyone with an entry, because nothing was settled before it');

-- ═════════════════════════════════════════════════════════════════════════════
-- the correction, and the member whose own share did not move
-- ═════════════════════════════════════════════════════════════════════════════
select amount_cents as n_bar_before from public.tip_distribution_entries
  where distribution_id = :'n_a1' and member_id = :'n_bar_m' \gset

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'n_staff' and work_date = '2024-02-01';
  update public.shifts set starts_at = '2024-02-01 15:00Z'
    where member_id = :'n_staff' and work_date = '2024-02-01';
  select public.create_replacement_distribution(:'n_a1', 'hours',
    'Nia started an hour earlier.') as n_a2 \gset
  select public.send_distribution(:'n_a2');
commit;

select amount_cents as n_bar_after from public.tip_distribution_entries
  where distribution_id = :'n_a2' and member_id = :'n_bar_m' \gset

select tests.ok(:'n_bar_before'::bigint = :'n_bar_after'::bigint,
  'N11 the bar share is identical across the correction, by construction');
-- Recipients of a correction are the union of both versions' people. Here the
-- same three are in both, so the union is three — derived, not assumed.
select count(*) as n_a2_people from (
  select distinct member_id from public.tip_distribution_entries
   where distribution_id in (:'n_a1', :'n_a2')) t \gset
select tests.ok(
  (select count(*) from public.member_notifications
    where distribution_id = :'n_a2' and type = 'distribution_corrected') = :'n_a2_people'::int,
  'N12 the corrected version is announced to everyone in either version');
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where distribution_id = :'n_a2' and type = 'distribution_sent'),
  'N13 …as a correction, never as a first send');

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'n_a2', 'payroll', 'Difference with the run.') as n_pay2 \gset
commit;

select amount_cents as n_pay2_amount from public.distribution_payouts where id = :'n_pay2' \gset
select tests.ok(:'n_pay2_amount'::bigint = 0,
  'N14 paying the corrected version settles a zero delta at workplace level');
select tests.ok(
  (select count(*) = 2 from public.member_notifications
    where payout_id = :'n_pay2' and type = 'payout_recorded'),
  'N15 …but only the two people whose OWN share moved are told');
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where payout_id = :'n_pay2' and member_id = :'n_bar_m'),
  'N16 …and the member whose share did not move is not told they were paid');

-- ═════════════════════════════════════════════════════════════════════════════
-- reversal reaches exactly whoever was told about that payment
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'n_pay2', 'payment_not_completed',
    'The run did not go out.') as n_rev2 \gset
commit;

select tests.ok(
  (select array_agg(member_id order by member_id) from public.member_notifications
     where reversal_id = :'n_rev2' and type = 'payout_reversed')
  = (select array_agg(member_id order by member_id) from public.member_notifications
     where payout_id = :'n_pay2' and type = 'payout_recorded'),
  'N17 the reversal reaches exactly the set that was told about that payment');
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where reversal_id = :'n_rev2' and member_id = :'n_bar_m'),
  'N18 …so nobody is told a payment was taken back that they never heard of');

-- ═════════════════════════════════════════════════════════════════════════════
-- payout → reversal → repayout stays two distinct events
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'n_a2', 'cash', 'Paid in cash instead.') as n_pay3 \gset
commit;

select count(*) as n_recorded_on_a2 from public.member_notifications
  where distribution_id = :'n_a2' and type = 'payout_recorded' and member_id = :'n_staff' \gset
select tests.ok(:'n_recorded_on_a2'::int = 2,
  'N19 a repayment after a reversal is a SECOND notification, not a collapsed one');
select tests.ok(
  (select count(distinct payout_id) = 2 from public.member_notifications
    where distribution_id = :'n_a2' and type = 'payout_recorded' and member_id = :'n_staff'),
  'N20 …distinguished by the payout each one came from');

-- ═════════════════════════════════════════════════════════════════════════════
-- a chain of three, and migration 31
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'n_staff' and work_date = '2024-02-01';
  update public.shifts set starts_at = '2024-02-01 14:00Z'
    where member_id = :'n_staff' and work_date = '2024-02-01';
  select public.create_replacement_distribution(:'n_a2', 'hours',
    'Earlier still.') as n_a3 \gset
  select public.send_distribution(:'n_a3');
commit;

select tests.ok(
  (select status = 'cancelled' and sent_at is not null
     from public.tip_distributions where id = :'n_a2'),
  'N21 the middle version is retired but still records that it was published');

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select superseded_by as n_head1 from public.member_distributions where id = :'n_a1' \gset
  select superseded_by as n_head2 from public.member_distributions where id = :'n_a2' \gset
  -- The head has no successor, and psql UNSETS a variable on a NULL, which
  -- would leave :'n_head3' as literal text and abort the suite. Coalesce it.
  select coalesce(superseded_by::text, '') as n_head3
    from public.member_distributions where id = :'n_a3' \gset
commit;
select tests.ok(:'n_head1' = :'n_a2',
  'N22 migration 31: the original still points at the version that replaced it');
select tests.ok(:'n_head2' = :'n_a3',
  'N23 …and that one points at the current head, so A <- B <- C is traversable');
select tests.ok(nullif(:'n_head3', '') is null,
  'N24 …while the head itself points nowhere, which is how the walk terminates');

-- ═════════════════════════════════════════════════════════════════════════════
-- questions: raised to managers, answered to the asker, repeatable
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select tests.notify_night(:'nw', :'n_boss', :'n_staff', :'n_bar_m', :'n_service', :'n_bar',
    :'n_server', :'n_keep', '2024-02-02', 50000) as n_b1 \gset
  select public.send_distribution(:'n_b1');
commit;

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select public.query_distribution(:'n_b1', 'My hours look short.');
commit;

select tests.ok(
  (select count(*) = 1 from public.member_notifications
    where type = 'query_raised' and member_id = :'n_boss'),
  'N25 a question reaches the manager');
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where type = 'query_raised' and member_id in (:'n_staff', :'n_bar_m')),
  'N26 …and reaches no employee, not even the one who asked');

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select id as n_q1 from public.distribution_queries
    where distribution_id = :'n_b1' and status = 'open' \gset
  select public.resolve_query(:'n_q1', 'no_correction', 'The roster is right.');
commit;
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select public.query_distribution(:'n_b1', 'Still looks short to me.');
commit;
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select id as n_q2 from public.distribution_queries
    where distribution_id = :'n_b1' and status = 'open' \gset
  select public.resolve_query(:'n_q2', 'no_correction', 'Checked again, it is right.');
commit;

select count(*) as n_resolved_rows from public.member_notifications
  where type = 'query_resolved' and member_id = :'n_staff' \gset
select tests.ok(:'n_resolved_rows'::int = 2,
  'N27 two questions answered are two notifications, not one collapsed');
select tests.ok(
  (select count(distinct query_id) = 2 from public.member_notifications
    where type = 'query_resolved' and member_id = :'n_staff'),
  'N28 …distinguished by the question each one answers');
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where type = 'query_resolved' and member_id <> :'n_staff'),
  'N29 …and an answer goes only to the person who asked');

-- ═════════════════════════════════════════════════════════════════════════════
-- whose inbox is it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select count(*) as n_staff_sees from public.member_notifications \gset
  select count(*) as n_staff_foreign from public.member_notifications
    where member_id <> :'n_staff' and member_id <> :'n_staff_x' \gset
commit;
select tests.ok(:'n_staff_foreign'::int = 0,
  'N30 an employee reads no row addressed to anybody else');
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select count(*) as n_boss_foreign from public.member_notifications
    where member_id <> :'n_boss' \gset
commit;
select tests.ok(:'n_boss_foreign'::int = 0,
  'N31 a manager has no privileged view of anybody else''s inbox either');
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000004');
  select count(*) as n_rival_sees from public.member_notifications \gset
commit;
select tests.ok(:'n_rival_sees'::int = 0,
  'N32 a manager of another workplace reads none of them');

-- Multi-workplace: the same person, two memberships, two inboxes.
select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'n_staff_x'),
  'N33 the second workplace''s inbox is independent and empty');

-- ═════════════════════════════════════════════════════════════════════════════
-- suspended, then restored
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'n_staff';
commit;
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select count(*) as n_susp from public.member_notifications where workplace_id = :'nw' \gset
commit;
select tests.ok(:'n_susp'::int = 0,
  'N34 a suspended member loses the inbox while the rows stay on the record');
select tests.ok(
  (select count(*) > 0 from public.member_notifications where member_id = :'n_staff'),
  'N35 …the rows really are still there, just unreadable');
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'n_staff';
commit;
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select count(*) as n_restored from public.member_notifications where workplace_id = :'nw' \gset
commit;
select tests.ok(:'n_restored'::int > 0, 'N36 …and gets them back on reinstatement');

-- ═════════════════════════════════════════════════════════════════════════════
-- the table is not writable by anybody
-- ═════════════════════════════════════════════════════════════════════════════
select id as n_row from public.member_notifications where member_id = :'n_staff' limit 1 \gset

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'insert into public.member_notifications (workplace_id, member_id, type, distribution_id)
     values (%L, %L, ''distribution_sent'', %L)', :'nw', :'n_staff', :'n_b1'),
    'N37 an employee cannot write themselves a notification');
  select tests.changes_nothing(format(
    'update public.member_notifications set read_at = now() where id = %L', :'n_row'),
    'N38 …nor set read_at directly');
  select tests.changes_nothing(format(
    'update public.member_notifications set type = ''payout_recorded'' where id = %L', :'n_row'),
    'N39 …nor change the type');
  select tests.changes_nothing(format(
    'update public.member_notifications set member_id = %L where id = %L', :'n_boss', :'n_row'),
    'N40 …nor readdress it to somebody else');
  select tests.changes_nothing(format(
    'update public.member_notifications set payload = ''{"amount_cents":9999}''::jsonb where id = %L', :'n_row'),
    'N41 …nor put an amount into the payload');
  select tests.changes_nothing(format(
    'delete from public.member_notifications where id = %L', :'n_row'),
    'N42 …nor delete it');
commit;

-- The guard has no trusted-context escape, so the owner is refused too.
reset role;
select tests.denied(format(
  'update public.member_notifications set type = ''payout_recorded'' where id = %L', :'n_row'),
  'N43 the table owner cannot change an immutable column either');
select tests.denied(format(
  'update public.member_notifications set payload = ''{"x":1}''::jsonb where id = %L', :'n_row'),
  'N44 …nor rewrite the payload');
select tests.denied(format(
  'update public.member_notifications set member_id = %L where id = %L', :'n_boss', :'n_row'),
  'N45 …nor readdress it');
select tests.denied(format(
  'delete from public.member_notifications where id = %L', :'n_row'),
  'N46 …nor delete it');
select tests.ok(
  (select count(*) = 1 from public.member_notifications where id = :'n_row'),
  'N47 …so the row is exactly as it was written');

-- ═════════════════════════════════════════════════════════════════════════════
-- read state
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select public.mark_notification_read(:'n_row');
  select read_at as n_first_read from public.member_notifications where id = :'n_row' \gset
commit;
select tests.ok(:'n_first_read' is not null, 'N48 mark_notification_read marks it read');

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select public.mark_notification_read(:'n_row');
  select read_at as n_second_read from public.member_notifications where id = :'n_row' \gset
commit;
select tests.ok(:'n_second_read' = :'n_first_read',
  'N49 …and reading it again does not move the moment it was first read');

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.mark_notification_read(%L)', :'n_row'),
    'N50 somebody else''s notification cannot be marked read, not even by a manager');
commit;

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select public.mark_all_notifications_read(:'nw') as n_all \gset
  select count(*) as n_unread_left from public.member_notifications
    where member_id = :'n_staff' and read_at is null \gset
commit;
select tests.ok(:'n_unread_left'::int = 0,
  'N51 mark_all_notifications_read clears this workplace''s inbox');
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where member_id <> :'n_staff' and read_at is not null),
  'N52 …and touches nobody else''s rows');

begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000003');
  select count(*) as n_bar_unread from public.member_notifications where read_at is null \gset
commit;
select tests.ok(:'n_bar_unread'::int > 0,
  'N53 …so a colleague''s inbox is still unread, which is what "only mine" means');

-- ═════════════════════════════════════════════════════════════════════════════
-- a member who vanishes from a correction is still told about it
--
-- The pre-push review found the case: X holds an entry on A, the manager
-- rejects X's hours and corrects, and B has no entry for X at all. Reading only
-- B's entries would leave X — the one person whose share fell to nothing — as
-- the one person never told. The recipient set is the union of both versions,
-- and X's notification names B, which X cannot open, so the screen falls back
-- to A, which X can. Nothing here widens what X may read.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select tests.notify_night(:'nw', :'n_boss', :'n_staff', :'n_bar_m', :'n_service', :'n_bar',
    :'n_server', :'n_keep', '2024-02-03', 80000) as n_c1 \gset
  select public.send_distribution(:'n_c1');
  select public.record_distribution_payout(:'n_c1', 'cash', 'Paid on the night.') as n_payc1 \gset
commit;

select count(*) as n_ghost_before from public.member_notifications where member_id = :'n_ghost' \gset

-- The manager rejects Nia's hours for that night and recalculates.
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'n_staff' and work_date = '2024-02-03';
  update public.shifts set status = 'rejected'
    where member_id = :'n_staff' and work_date = '2024-02-03';
  select public.create_replacement_distribution(:'n_c1', 'hours',
    'Those hours were not worked.') as n_c2 \gset
  select public.send_distribution(:'n_c2');
commit;

select tests.ok(
  (select count(*) = 0 from public.tip_distribution_entries
    where distribution_id = :'n_c2' and member_id = :'n_staff'),
  'N54 the fixture really dropped her: no entry on the replacement');
select tests.ok(
  (select count(*) = 1 from public.member_notifications
    where member_id = :'n_staff' and type = 'distribution_corrected' and distribution_id = :'n_c2'),
  'N55 …and she is still told, exactly once, that the night was corrected');

-- Everyone in EITHER version, derived from the entries rather than assumed.
select count(*) as n_c_people from (
  select distinct member_id from public.tip_distribution_entries
   where distribution_id in (:'n_c1', :'n_c2')) t \gset
select tests.ok(
  (select count(*) from public.member_notifications
    where type = 'distribution_corrected' and distribution_id = :'n_c2') = :'n_c_people'::int,
  'N56 …as is everyone who was in either version, and nobody else');
select tests.ok(
  (select count(*) from public.member_notifications where member_id = :'n_ghost')
    = :'n_ghost_before'::int,
  'N57 …while the member who was in neither hears nothing');

-- Paying the replacement must not tell her she was paid: she has no share on it.
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'n_c2', 'payroll', 'Difference with the run.') as n_payc2 \gset
commit;
select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where member_id = :'n_staff' and payout_id = :'n_payc2'),
  'N58 paying the replacement does not tell the dropped member she was paid');
select tests.ok(
  (select count(*) > 0 from public.member_notifications
    where payout_id = :'n_payc2' and type = 'payout_recorded'),
  'N59 …while those whose share actually moved are told');

-- What she can and cannot read, which is what the deep-link fallback rests on.
begin;
  select tests.as_user('a1100000-0000-0000-0000-000000000002');
  select count(*) as n_x_sees_c2 from public.member_distributions where id = :'n_c2' \gset
  select coalesce(superseded_by::text, '') as n_x_c1_next
    from public.member_distributions where id = :'n_c1' \gset
  select count(*) as n_x_c2_entries from public.tip_distribution_entries
    where distribution_id = :'n_c2' \gset
commit;
select tests.ok(:'n_x_sees_c2'::int = 0,
  'N60 the replacement she is not in stays invisible to her');
select tests.ok(:'n_x_c1_next' = :'n_c2',
  'N61 …but the version she was in still points at it, so the screen can land her there');
select tests.ok(:'n_x_c2_entries'::int = 0,
  'N62 …and she reads none of the replacement''s entries, so nothing was widened');
