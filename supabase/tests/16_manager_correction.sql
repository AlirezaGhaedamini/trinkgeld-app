-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3K · manager-initiated corrections.
--
-- The second door into the one replacement engine: a manager who finds the
-- error themselves, without anybody having complained. Same lineage, same pool,
-- same protections — and no fabricated employee question.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('60000000-0000-0000-0000-000000000001', 'n.boss@test.local',  '{"full_name":"N Boss"}'),
  ('60000000-0000-0000-0000-000000000002', 'n.staff@test.local', '{"full_name":"N Staff"}'),
  ('60000000-0000-0000-0000-000000000003', 'n.rival@test.local', '{"full_name":"N Rival"}'),
  ('60000000-0000-0000-0000-000000000004', 'n.second@test.local','{"full_name":"N Second"}')
on conflict do nothing;

begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.create_workplace('Mgr Lab', 'Marburg') as nw \gset
commit;
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000003');
  select public.create_workplace('Mgr Rival', 'Kassel') as nx \gset
commit;

select id as n_service from public.workplace_areas where workplace_id = :'nw' and key = 'service' \gset
select id as n_bar     from public.workplace_areas where workplace_id = :'nw' and key = 'bar' \gset
select id as n_server  from public.workplace_roles where workplace_id = :'nw' and key = 'server' \gset
select id as n_keep    from public.workplace_roles where workplace_id = :'nw' and key = 'bartender' \gset
select id as n_boss    from public.workplace_members where workplace_id = :'nw' and role = 'manager' \gset

begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'n_service', workplace_role_id = :'n_server'
    where id = :'n_boss';
  select token from public.create_invitation(
    :'nw', 'n.staff@test.local', 'Nils Staff', 'employee', :'n_service', :'n_server') as t \gset tok_n_
  -- A second manager, so suspending one leaves the workplace legal.
  select token from public.create_invitation(
    :'nw', 'n.second@test.local', 'Nora Second', 'manager', :'n_service', :'n_server') as t \gset tok_n2_
commit;
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_n_token') as n_staff \gset
commit;
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000004');
  select public.accept_invitation(:'tok_n2_token') as n_second \gset
commit;

begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select id as n_rule from public.distribution_rules where workplace_id = :'nw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'n_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'n_rule' and area_id = :'n_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'n_rule' and area_id = :'n_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'n_rule' and area_id not in (:'n_service', :'n_bar');
  select public.activate_rule(:'n_rule');

  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'nw', :'n_boss', '2020-07-04', 24000) returning id as n_report \gset

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'nw', :'n_staff',  '2020-07-04 16:00Z', '2020-07-04 20:00Z', 0, 'approved', :'n_service', :'n_server'),
         (:'nw', :'n_staff',  '2020-07-04 20:00Z', '2020-07-04 23:00Z', 0, 'approved', :'n_bar',     :'n_keep'),
         (:'nw', :'n_boss',   '2020-07-04 16:00Z', '2020-07-04 23:00Z', 0, 'approved', :'n_service', :'n_server');
  select public.create_pool_from_reports(:'nw', '2020-07-04', '2020-07-04') as n_pool \gset
  select public.calculate_distribution(:'n_pool') as n_orig \gset
  select public.send_distribution(:'n_orig');
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as n_money from public.tip_distribution_entries where distribution_id = :'n_orig' \gset
select sum(amount_cents) as n_staff_before from public.tip_distribution_entries
  where distribution_id = :'n_orig' and member_id = :'n_staff' \gset
select count(*) as n_src_before from public.tip_pool_sources where tip_report_id = :'n_report' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- who may open the second door
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', ''I think it is wrong.'')', :'n_orig'),
    'N1  an employee cannot start a correction');
commit;

begin;
  select tests.as_user('60000000-0000-0000-0000-000000000003');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', ''Mine now.'')', :'n_orig'),
    'N2  nor a manager of another workplace');
commit;

-- A suspended manager is not a manager: app.is_manager() filters on status.
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'n_second';
commit;
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000004');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', ''Let me in.'')', :'n_orig'),
    'N3  nor a suspended manager');
commit;
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'n_second';
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the reason is not optional
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', ''   '')', :'n_orig'),
    'N4  a manager correction with a blank reason is refused');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', %L)', :'n_orig', repeat('x', 501)),
    'N5  …and so is one past the length limit');
  -- Without a reason it falls back to the employee door, which has nothing.
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'n_orig'),
    'N6  …and with no reason at all, when nobody has questioned it either');
commit;

select count(*) as n_drafts from public.tip_distributions
  where tip_pool_id = :'n_pool' and status = 'draft' \gset
select tests.ok(:'n_drafts'::int = 0, 'N7  …and none of those attempts left a draft behind');

select count(*) as n_fake from public.distribution_queries where distribution_id = :'n_orig' \gset
select tests.ok(:'n_fake'::int = 0,
  'N8  …and nothing invented a question in the employee''s name');

-- ═════════════════════════════════════════════════════════════════════════════
-- the manager's own finding
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(
    :'n_orig', 'hours', '  Nils clocked in at 14:00, the roster says so.  ') as n_repl \gset
commit;

select tests.ok(
  (select status = 'draft' and supersedes_id = :'n_orig'::uuid
     from public.tip_distributions where id = :'n_repl'),
  'N9  a manager can correct without anybody having complained');
select tests.ok(
  (select trigger_query_id is null from public.tip_distributions where id = :'n_repl'),
  'N10 …with no query attached, because there is no query');
select tests.ok(
  (select correction_reason = 'hours'
      and correction_note = 'Nils clocked in at 14:00, the roster says so.'
     from public.tip_distributions where id = :'n_repl'),
  'N11 …and the reason recorded in the manager''s own words, trimmed');
select tests.ok(
  (select initiated_by = :'n_boss'::uuid and initiated_at is not null
     from public.tip_distributions where id = :'n_repl'),
  'N12 …with the actor derived by the server, not supplied by the caller');
select tests.ok(
  (select tip_pool_id = :'n_pool'::uuid from public.tip_distributions where id = :'n_repl'),
  'N13 …and the same pool as ever, so this is one money event');

select count(*) as n_fake2 from public.distribution_queries where distribution_id = :'n_orig' \gset
select tests.ok(:'n_fake2'::int = 0,
  'N14 …and still no fabricated question anywhere');

-- ═════════════════════════════════════════════════════════════════════════════
-- the caller supplies nothing it should not
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.tip_distributions set initiated_by = %L where id = %L', :'n_staff', :'n_repl'),
    'N15 a manager cannot rewrite who started a correction');
  select tests.denied(format(
    'update public.tip_distributions set correction_note = ''Something else'' where id = %L', :'n_repl'),
    'N16 …nor the reason afterwards');
  select tests.denied(format(
    'update public.tip_distributions set supersedes_id = %L where id = %L', :'n_repl', :'n_repl'),
    'N17 …nor point it somewhere else');
commit;

begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select tests.attempt(format(
    'update public.tip_distributions set correction_note = ''Mine'' where id = %L', :'n_repl'));
commit;
select tests.ok(
  (select correction_note = 'Nils clocked in at 14:00, the roster says so.'
     from public.tip_distributions where id = :'n_repl'),
  'N18 …and an employee reaches none of it');

-- A stranger to the schema cannot hand-build a replacement either.
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'insert into public.tip_distributions (workplace_id, tip_pool_id, rule_id, rule_version,
       period_start, period_end, pool_cents, method, min_overlap_minutes, overlap_basis,
       rules_snapshot, inputs_snapshot, engine_version, supersedes_id, correction_reason, correction_note)
     values (%L, %L, %L, 1, ''2020-07-04'', ''2020-07-04'', 100, ''hours'', 15, ''longest_shift'',
       ''{}''::jsonb, ''{}''::jsonb, ''x'', %L, ''other'', ''Hand made'')',
    :'nw', :'n_pool', :'n_rule', :'n_orig'),
    'N19 …and a replacement cannot be inserted by hand at all');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- idempotency
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(
    :'n_orig', 'area', 'Actually it is the area that is wrong.') as n_repl2 \gset
commit;

select count(*) as n_children from public.tip_distributions
  where supersedes_id = :'n_orig' and status <> 'cancelled' \gset
select tests.ok(:'n_children'::int = 1,
  'N20 asking twice gives one draft, never two competing corrections');

select tests.ok(
  (select correction_reason = 'area'
      and correction_note = 'Actually it is the area that is wrong.'
     from public.tip_distributions where id = :'n_repl2'),
  'N21 …and the draft carries the reason given on the call that made it');

-- ═════════════════════════════════════════════════════════════════════════════
-- everything Phase 3J promised still holds
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'n_staff' and area_id = :'n_service' and starts_at = '2020-07-04 16:00Z';
  update public.shifts set starts_at = '2020-07-04 14:00Z'
    where member_id = :'n_staff' and area_id = :'n_service' and starts_at = '2020-07-04 16:00Z';
  select tests.denied(format('select public.send_distribution(%L)', :'n_repl2'),
    'N22 a correction whose inputs moved cannot be sent, manager-initiated or not');
  select public.create_replacement_distribution(
    :'n_orig', 'hours', 'Nils clocked in at 14:00.') as n_repl3 \gset
  select public.send_distribution(:'n_repl3');
commit;

select status as n_orig_final from public.tip_distributions where id = :'n_orig' \gset
select status as n_repl_final from public.tip_distributions where id = :'n_repl3' \gset
select tests.ok(:'n_orig_final' = 'cancelled' and :'n_repl_final' = 'sent',
  'N23 sending it retires the original and makes the correction current');

select count(*) as n_live from public.tip_distributions
  where tip_pool_id = :'n_pool' and status in ('sent', 'confirmed') \gset
select count(*) as n_src_after from public.tip_pool_sources where tip_report_id = :'n_report' \gset
select pool_id as n_src_pool from public.tip_pool_sources where tip_report_id = :'n_report' \gset

select tests.ok(:'n_live'::int = 1, 'N24 …with exactly one live payout against the pool');
select tests.ok(:'n_src_after'::int = 1 and :'n_src_after' = :'n_src_before'
                and :'n_src_pool' = :'n_pool',
  'N25 …and the report still funds that one pool and no other');

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as n_money2 from public.tip_distribution_entries where distribution_id = :'n_orig' \gset
select tests.ok(:'n_money' = :'n_money2',
  'N26 …while the original''s amounts never moved');

select sum(amount_cents) as n_staff_after from public.tip_distribution_entries
  where distribution_id = :'n_repl3' and member_id = :'n_staff' \gset
select tests.ok(:'n_staff_after'::bigint <> :'n_staff_before'::bigint,
  'N27 …and the correction is calculated from the fixed hours, not copied');

select count(*) as n_pending from public.tip_distribution_entries
  where distribution_id = :'n_repl3' and ack_status = 'pending' \gset
select count(*) as n_stamped from public.tip_distribution_entries
  where distribution_id = :'n_repl3' and acknowledged_at is not null \gset
select tests.ok(:'n_pending'::int > 0 and :'n_stamped'::int = 0,
  'N28 …and acknowledgement starts fresh on it');

-- ═════════════════════════════════════════════════════════════════════════════
-- what the employee is told, and what they are not
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select count(*) as n_emp_sees from public.member_distributions where workplace_id = :'nw' \gset
  select (correction_reason = 'hours' and correction_note = 'Nils clocked in at 14:00.'
          and supersedes_id = :'n_orig'::uuid) as n_emp_ok
    from public.member_distributions where id = :'n_repl3' \gset
  select (superseded_by = :'n_repl3'::uuid) as n_emp_by_ok
    from public.member_distributions where id = :'n_orig' \gset
commit;

select tests.ok(:'n_emp_ok'::boolean,
  'N29 the employee is told why their payout was corrected');
select tests.ok(:'n_emp_by_ok'::boolean,
  'N30 …and which record replaced which');
select tests.ok(:'n_emp_sees'::int = 2,
  'N31 …with both versions still readable');

-- The view exposes the reason and nothing else about the correction.
select tests.ok(
  (select count(*) = 0 from information_schema.columns
    where table_name = 'member_distributions'
      and column_name in ('initiated_by', 'initiated_at', 'calculated_by', 'sent_by')),
  'N32 …and no internal actor or audit metadata reaches them');

begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'n_repl3', 'acknowledged') as n_ack \gset
commit;
select tests.ok(:'n_ack'::int > 0,
  'N33 …and they confirm the correction the ordinary way');

-- ═════════════════════════════════════════════════════════════════════════════
-- the employee door still works exactly as it did
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'n_repl3', 'My role is wrong on this one.');
commit;
select id as n_query from public.distribution_queries
  where distribution_id = :'n_repl3' and status = 'open' \gset
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.resolve_query(:'n_query', 'correction_required', 'Yes, fixing the role.');
  -- No reason argument: the question is the reason, exactly as in Phase 3J.
  select public.create_replacement_distribution(:'n_repl3') as n_repl4 \gset
  select public.send_distribution(:'n_repl4');
commit;

select tests.ok(
  (select trigger_query_id = :'n_query'::uuid and supersedes_id = :'n_repl3'::uuid
     from public.tip_distributions where id = :'n_repl4'),
  'N34 the employee-reported path still links its triggering question');
select tests.ok(
  (select correction_reason is null and correction_note is null
     from public.tip_distributions where id = :'n_repl4'),
  'N35 …and records no manager reason, because the question is the reason');
select tests.ok(
  (select initiated_by = :'n_boss'::uuid from public.tip_distributions where id = :'n_repl4'),
  'N36 …while still recording who acted on it');

-- Isolated: n_repl4 has no question of its own, so the refusal above could come
-- from the employee door finding nothing. Give a distribution a real resolved
-- question and THEN pass a note with no category, so only the guard that
-- separates the two doors can refuse it.
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'n_repl4', 'And now the area is wrong.');
commit;
select id as n_query2 from public.distribution_queries
  where distribution_id = :'n_repl4' and status = 'open' \gset
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.resolve_query(:'n_query2', 'correction_required', 'Agreed.');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, null, ''A note with no category'')', :'n_repl4'),
    'N37 a note without a category is refused even where the employee door would have opened');
commit;

-- The constraint behind the friendly message: even if the RPC let a blank note
-- through, the table would not.
reset role;
select tests.denied(format(
  'insert into public.tip_distributions (workplace_id, tip_pool_id, rule_id, rule_version,
     period_start, period_end, pool_cents, method, min_overlap_minutes, overlap_basis,
     rules_snapshot, inputs_snapshot, engine_version, supersedes_id, correction_reason, correction_note)
   values (%L, %L, %L, 1, ''2020-07-04'', ''2020-07-04'', 100, ''hours'', 15, ''longest_shift'',
     ''{}''::jsonb, ''{}''::jsonb, ''x'', %L, ''other'', ''   '')',
  :'nw', :'n_pool', :'n_rule', :'n_repl4'),
  'N37b …and the table itself refuses a reason with a blank note, whatever the RPC does');

select tests.denied(format(
  'insert into public.tip_distributions (workplace_id, tip_pool_id, rule_id, rule_version,
     period_start, period_end, pool_cents, method, min_overlap_minutes, overlap_basis,
     rules_snapshot, inputs_snapshot, engine_version, supersedes_id, trigger_query_id,
     correction_reason, correction_note)
   values (%L, %L, %L, 1, ''2020-07-04'', ''2020-07-04'', 100, ''hours'', 15, ''longest_shift'',
     ''{}''::jsonb, ''{}''::jsonb, ''x'', %L, %L, ''other'', ''Both doors at once'')',
  :'nw', :'n_pool', :'n_rule', :'n_repl4', :'n_query2'),
  'N37c …and refuses a replacement that claims both a question and a manager reason');

select count(*) as n_live2 from public.tip_distributions
  where tip_pool_id = :'n_pool' and status in ('sent', 'confirmed') \gset
select tests.ok(:'n_live2'::int = 1,
  'N38 after four versions the pool still has exactly one live payout');

-- ═════════════════════════════════════════════════════════════════════════════
-- lineage still cannot fork or loop
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.create_replacement_distribution(%L, ''other'', ''Again'')', :'n_orig'),
    'N39 a replaced original cannot be corrected a second time');
  -- The current distribution CAN be corrected by the manager door, even though
  -- nobody has questioned it: that is the whole point of this phase.
  select public.create_replacement_distribution(
    :'n_repl4', 'multiplier', 'Nora''s weighting was still the old one.') as n_repl5 \gset
commit;

select tests.ok(
  (select supersedes_id = :'n_repl4'::uuid and correction_reason = 'multiplier'
      and trigger_query_id is null and status = 'draft'
     from public.tip_distributions where id = :'n_repl5'),
  'N40 …while the current one can still be corrected by the manager door, with its own reason');

reset role;
select tests.denied(format(
  'update public.tip_distributions set supersedes_id = %L where id = %L', :'n_repl4', :'n_orig'),
  'N41 the chain cannot be closed into a loop, even by the owner');

-- ═════════════════════════════════════════════════════════════════════════════
-- the trail
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select count(*) as n_audit from public.audit_log
    where workplace_id = :'nw' and table_name = 'tip_distributions' \gset
commit;
select tests.ok(:'n_audit'::int >= 8,
  'N42 every version, and every attempt, is on the audit trail');

-- ═════════════════════════════════════════════════════════════════════════════
-- without a session
-- ═════════════════════════════════════════════════════════════════════════════
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;

begin;
  select set_config('role', 'anon', true);
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''other'', ''Hello'')', :'n_repl4'),
    'N43 an anonymous caller cannot start a correction');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- migration 25 · what "blank" means
--
-- The live Phase 3K run accepted a note of E'    \n\t  '. One-argument btrim()
-- trims a SPACE and nothing else, so that note survived as E'\n\t' — two
-- characters, comfortably "between 1 and 500" — in the RPC and in the check
-- constraint alike, because both spelled the same expression. The request was
-- therefore valid, the engine ran, and the draft it produced was the "1 draft
-- left behind" the next check reported. One cause, two failures.
--
-- A night of its own, so "this pool has no drafts" can be asserted exactly
-- rather than inferred from a total.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'nw', :'n_boss', '2020-07-11', 18000) returning id as n_w_report \gset

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  -- The active rule gives Bar 40%, so the night needs bar hours or the engine
  -- refuses to distribute at all.
  values (:'nw', :'n_staff', '2020-07-11 16:00Z', '2020-07-11 20:00Z', 0, 'approved', :'n_service', :'n_server'),
         (:'nw', :'n_staff', '2020-07-11 20:00Z', '2020-07-11 23:00Z', 0, 'approved', :'n_bar',     :'n_keep'),
         (:'nw', :'n_boss',  '2020-07-11 16:00Z', '2020-07-11 23:00Z', 0, 'approved', :'n_service', :'n_server');
  select public.create_pool_from_reports(:'nw', '2020-07-11', '2020-07-11') as n_w_pool \gset
  select public.calculate_distribution(:'n_w_pool') as n_w_orig \gset
  select public.send_distribution(:'n_w_orig');
commit;

-- ── every shape of blank, refused ──────────────────────────────────────────
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', '''')', :'n_w_orig'),
    'N44 a manager reason with an empty note is refused');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', %L)', :'n_w_orig', '     '),
    'N45 …and a note of spaces only');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''hours'', %L)', :'n_w_orig', E'    \n\t  '),
    'N46 …and the tabs-and-newlines note the live run accepted');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''area'', %L)', :'n_w_orig', E'\r\f\v'),
    'N47 …and a carriage return, form feed and vertical tab');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''role'', %L)', :'n_w_orig', E'  ​　'),
    'N48 …and the invisible characters a paste from a word processor leaves behind');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, ''other'', %L)',
    :'n_w_orig', '  ' || repeat('z', 501) || E'\n'),
    'N49 …and 501 characters once the whitespace around them is gone');
commit;

-- ── and none of them wrote anything ────────────────────────────────────────
select count(*) as n_w_drafts from public.tip_distributions
  where tip_pool_id = :'n_w_pool' and status <> 'sent' \gset
select tests.ok(:'n_w_drafts'::int = 0,
  'N50 every refused request left no draft, no lineage row and no correction metadata');

select count(*) as n_w_fake from public.distribution_queries
  where distribution_id = :'n_w_orig' \gset
select tests.ok(:'n_w_fake'::int = 0,
  'N51 …and fabricated no question on the way');

-- ── one visible character is a reason ──────────────────────────────────────
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(
    :'n_w_orig', 'hours', E' \n\t x \r ') as n_w_one \gset
commit;
select tests.ok(
  (select correction_note = 'x' and length(correction_note) = 1
     from public.tip_distributions where id = :'n_w_one'),
  'N52 one visible character is a reason, and is stored trimmed of everything around it');

-- ── the boundary at 500, from both sides ───────────────────────────────────
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(
    :'n_w_orig', 'rule', E'  \t' || repeat('y', 500) || E' \n ') as n_w_500 \gset
commit;
select tests.ok(
  (select length(correction_note) = 500 and correction_note = repeat('y', 500)
     from public.tip_distributions where id = :'n_w_500'),
  'N53 500 characters inside whitespace are accepted, and stored as exactly 500');

-- ── inner whitespace is content, outer whitespace is not ───────────────────
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(
    :'n_w_orig', 'tip_amount', E'\n  Lena began at 14:00,\n  not 16:00.  \t') as n_w_real \gset
commit;
select tests.ok(
  (select correction_note = E'Lena began at 14:00,\n  not 16:00.'
     from public.tip_distributions where id = :'n_w_real'),
  'N54 a real sentence keeps the whitespace inside it and loses only the whitespace around it');

-- ── the table says the same thing the function does ────────────────────────
reset role;
select tests.denied(format(
  'update public.tip_distributions set correction_note = %L where id = %L', E' \n\t ', :'n_w_real'),
  'N55 the table itself refuses a whitespace-only note, whatever the RPC does');
select tests.denied(format(
  'insert into public.tip_distributions
     (workplace_id, tip_pool_id, rule_id, rule_version, period_start, period_end,
      pool_cents, people_count, status, method, min_overlap_minutes, overlap_basis,
      entries_total_cents, engine_version, rules_snapshot, inputs_snapshot,
      supersedes_id, correction_reason, correction_note)
   values (%L, %L, %L, 1, ''2020-07-11'', ''2020-07-11'', 18000, 2, ''draft'', ''hours_points'',
           15, ''longest_shift'', 18000, ''1.0'', ''{}''::jsonb, ''{}''::jsonb, %L, ''other'', %L)',
  :'nw', :'n_w_pool', :'n_rule', :'n_w_orig', E'\t\n'),
  'N56 …and refuses one written straight into the table, bypassing the RPC entirely');

-- ── the employee door is exactly as it was ─────────────────────────────────
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'n_w_orig', 'My hours look short on this one.');
commit;
begin;
  select tests.as_user('60000000-0000-0000-0000-000000000001');
  select id as n_w_query from public.distribution_queries
    where distribution_id = :'n_w_orig' and status = 'open' \gset
  select public.resolve_query(:'n_w_query', 'correction_required', 'You are right.');
  select tests.denied(format(
    'select public.create_replacement_distribution(%L, null, %L)', :'n_w_orig', 'And my own reason too.'),
    'N57 the employee door still refuses a second reason of the manager''s own');
  select public.create_replacement_distribution(:'n_w_orig') as n_w_emp \gset
commit;
select tests.ok(
  (select trigger_query_id = :'n_w_query'::uuid and correction_reason is null
      and correction_note is null and status = 'draft'
     from public.tip_distributions where id = :'n_w_emp'),
  'N58 …and still works by its own door, with the question as its reason');
