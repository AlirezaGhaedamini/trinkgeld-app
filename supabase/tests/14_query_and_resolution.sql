-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3I · the query loop.
--
-- What a question is allowed to do, who may answer it, what it stops, and what
-- it must never touch: the money, and the words the employee used.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('40000000-0000-0000-0000-000000000001', 'q.boss@test.local',  '{"full_name":"Q Boss"}'),
  ('40000000-0000-0000-0000-000000000002', 'q.staff@test.local', '{"full_name":"Q Staff"}'),
  ('40000000-0000-0000-0000-000000000003', 'q.rival@test.local', '{"full_name":"Q Rival"}')
on conflict do nothing;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select public.create_workplace('Query Lab', 'Marburg') as qw \gset
commit;
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000003');
  select public.create_workplace('Query Rival', 'Kassel') as qx \gset
commit;

select id as q_service from public.workplace_areas where workplace_id = :'qw' and key = 'service' \gset
select id as q_bar     from public.workplace_areas where workplace_id = :'qw' and key = 'bar' \gset
select id as q_server  from public.workplace_roles where workplace_id = :'qw' and key = 'server' \gset
select id as q_keep    from public.workplace_roles where workplace_id = :'qw' and key = 'bartender' \gset
select id as q_boss    from public.workplace_members where workplace_id = :'qw' and role = 'manager' \gset

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'q_service', workplace_role_id = :'q_server'
    where id = :'q_boss';
  select token from public.create_invitation(
    :'qw', 'q.staff@test.local', 'Quinn Staff', 'employee', :'q_service', :'q_server') as t \gset tok_q_
commit;
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_q_token') as q_staff \gset
commit;

-- Two areas for the employee, so a question has to cover both entries at once.
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select id as q_rule from public.distribution_rules where workplace_id = :'qw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'q_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'q_rule' and area_id = :'q_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'q_rule' and area_id = :'q_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'q_rule' and area_id not in (:'q_service', :'q_bar');
  select public.activate_rule(:'q_rule');

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'qw', :'q_staff', '2020-04-01 16:00Z', '2020-04-01 20:00Z', 0, 'approved', :'q_service', :'q_server'),
         (:'qw', :'q_staff', '2020-04-01 20:00Z', '2020-04-01 23:00Z', 0, 'approved', :'q_bar',     :'q_keep'),
         (:'qw', :'q_boss',  '2020-04-01 16:00Z', '2020-04-01 23:00Z', 0, 'approved', :'q_service', :'q_server');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'qw', 'day', '2020-04-01', '2020-04-01', 'q1', 30000, :'q_boss') returning id as q_pool \gset
  select public.calculate_distribution(:'q_pool') as q_dist \gset
commit;

-- The financial fingerprint: every field that decides money, and nothing else.
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as q_money from public.tip_distribution_entries where distribution_id = :'q_dist' \gset

-- The same rows the live script compared before Phase 3I's diagnosis: the
-- financial fields PLUS the three that exist to change. Kept here so the suite
-- proves why that comparison had to fail on a correct backend.
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text
                      || '|' || ack_status::text
                      || '|' || coalesce(acknowledged_at::text, '-')
                      || '|' || coalesce(queried_at::text, '-'), ';' order by id::text))
  as q_naive from public.tip_distribution_entries where distribution_id = :'q_dist' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- a draft answers nothing
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.query_distribution(%L, ''My hours look wrong.'')', :'q_dist'),
    'Q1  a draft cannot be queried');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select public.send_distribution(:'q_dist');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the question
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.query_distribution(%L, ''   '')', :'q_dist'),
    'Q2  a question without a sentence is refused');
  select tests.denied(format('select public.query_distribution(%L, %L)', :'q_dist', repeat('x', 501)),
    'Q3  …and so is one past the length limit');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'q_dist', '  I worked in Bar, not Service.  ') as q_touched \gset
commit;

select tests.ok(:'q_touched'::int = 2,
  'Q4  one question covers every entry the person holds, not just one area');

select count(*) as q_open from public.tip_distribution_entries
  where distribution_id = :'q_dist' and member_id = :'q_staff' and ack_status = 'queried' \gset
select tests.ok(:'q_open'::int = 2, 'Q5  …and both of them say so');

select id as q_query, note as q_note, status as q_status, raised_at as q_raised,
       member_name as q_name
  from public.distribution_queries where distribution_id = :'q_dist' \gset

select tests.ok(:'q_note' = 'I worked in Bar, not Service.' and :'q_status' = 'open',
  'Q6  the words are stored once, trimmed, against the distribution');
select tests.ok(:'q_name' = 'Quinn Staff',
  'Q7  …with the name as it was, so a later rename cannot rewrite the question');

select count(*) as q_rows from public.distribution_queries where distribution_id = :'q_dist' \gset
select tests.ok(:'q_rows'::int = 1,
  'Q8  …and one row for the person, not one per entry');

-- ═════════════════════════════════════════════════════════════════════════════
-- queried is not confirmed
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select public.acknowledge_distribution(:'q_dist', 'acknowledged');
commit;

select status as q_dstatus from public.tip_distributions where id = :'q_dist' \gset
select tests.ok(:'q_dstatus' = 'sent',
  'Q9  everybody else confirming does not close a distribution somebody has questioned');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'q_dist'),
    'Q10 the person who asked cannot answer their own question');
  select tests.denied(format('select public.acknowledge_entry(%L, ''acknowledged'')',
    (select id from public.tip_distribution_entries
      where distribution_id = :'q_dist' and member_id = :'q_staff' limit 1)),
    'Q11 …not one entry at a time either');
commit;

select count(*) as q_still from public.tip_distribution_entries
  where distribution_id = :'q_dist' and member_id = :'q_staff' and ack_status = 'queried' \gset
select tests.ok(:'q_still'::int = 2, 'Q12 …and nothing moved while they tried');

-- Asking again while it is open is accepted, and rewrites nothing.
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'q_dist', 'I worked in Bar, not Service.');
commit;

select count(*) as q_rows2 from public.distribution_queries where distribution_id = :'q_dist' \gset
select note as q_note2, raised_at as q_raised2 from public.distribution_queries where id = :'q_query' \gset
select tests.ok(:'q_rows2'::int = 1 and :'q_note2' = 'I worked in Bar, not Service.'
                and :'q_raised2' = :'q_raised',
  'Q13 asking again while it is open is safe, and the first words stand');

-- ═════════════════════════════════════════════════════════════════════════════
-- whose question is it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.query_distribution(%L, ''Mine now.'')', :'q_dist'),
    'Q14 somebody from another workplace cannot raise a question here');
  select tests.denied(format('select * from public.distribution_query_list(%L)', :'q_dist'),
    'Q15 …nor read the ones that exist');
  select tests.denied(format('select public.resolve_query(%L, ''no_correction'')', :'q_query'),
    'Q16 …nor answer one');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.resolve_query(%L, ''no_correction'', ''Fine by me'')', :'q_query'),
    'Q17 the employee cannot answer their own question');
  select tests.denied(format(
    'update public.distribution_queries set status = ''resolved'', outcome = ''no_correction'',
       resolved_at = now() where id = %L', :'q_query'),
    'Q18 …nor write the resolution by hand');
commit;

select status as q_status2 from public.distribution_queries where id = :'q_query' \gset
select tests.ok(:'q_status2' = 'open', 'Q19 …and it is still open');

-- ═════════════════════════════════════════════════════════════════════════════
-- the manager answers it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select count(*) as q_seen from public.distribution_query_list(:'q_dist') \gset
  select note as q_seen_note, amount_cents as q_seen_amount
    from public.distribution_query_list(:'q_dist') limit 1 \gset
commit;

select tests.ok(:'q_seen'::int = 1 and :'q_seen_note' = 'I worked in Bar, not Service.',
  'Q20 the manager reads the question, in the employee''s own words');
select tests.ok(:'q_seen_amount'::bigint > 0,
  'Q21 …with what the person was actually paid, summed across their areas');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select public.resolve_query(:'q_query', 'no_correction', '  Checked the roster — the hours are right.  ');
commit;

select status as q_status3, outcome as q_outcome, manager_response as q_response,
       resolved_at as q_resolved, note as q_note3
  from public.distribution_queries where id = :'q_query' \gset

select tests.ok(:'q_status3' = 'resolved' and :'q_outcome' = 'no_correction'
                and :'q_response' = 'Checked the roster — the hours are right.'
                and :'q_resolved' is not null,
  'Q22 the manager answers it, and the answer is recorded');
select tests.ok(:'q_note3' = 'I worked in Bar, not Service.',
  'Q23 …without touching a word of what was asked');

select count(*) as q_back from public.tip_distribution_entries
  where distribution_id = :'q_dist' and member_id = :'q_staff' and ack_status = 'pending' \gset
select tests.ok(:'q_back'::int = 2,
  'Q24 resolving puts every one of their entries back to pending, not to confirmed');

select status as q_dstatus2 from public.tip_distributions where id = :'q_dist' \gset
select tests.ok(:'q_dstatus2' = 'sent',
  'Q25 the manager''s answer is not the employee''s confirmation');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.resolve_query(%L, ''no_correction'')', :'q_query'),
    'Q26 …and a question is only answered once');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- and now they can confirm
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'q_dist', 'acknowledged') as q_ack \gset
commit;

select tests.ok(:'q_ack'::int = 2, 'Q27 after the answer, they confirm — both entries');

select status as q_dstatus3 from public.tip_distributions where id = :'q_dist' \gset
select tests.ok(:'q_dstatus3' = 'confirmed',
  'Q28 …and that is what finally closes the distribution');

select note as q_note4, manager_response as q_response2
  from public.distribution_queries where id = :'q_query' \gset
select tests.ok(:'q_note4' = 'I worked in Bar, not Service.'
                and :'q_response2' = 'Checked the roster — the hours are right.',
  'Q29 the whole exchange survives the confirmation');

-- ═════════════════════════════════════════════════════════════════════════════
-- the money never moved
-- ═════════════════════════════════════════════════════════════════════════════
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as q_money2 from public.tip_distribution_entries where distribution_id = :'q_dist' \gset
select tests.ok(:'q_money' = :'q_money2',
  'Q30 through question, answer and confirmation the amounts are word for word what they were');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.attempt(format(
    'update public.tip_distribution_entries set amount_cents = 1 where distribution_id = %L', :'q_dist'));
commit;
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as q_money3 from public.tip_distribution_entries where distribution_id = :'q_dist' \gset
select tests.ok(:'q_money' = :'q_money3',
  'Q31 …and a question was never a way to reach them');

-- ═════════════════════════════════════════════════════════════════════════════
-- a correction the manager agrees with
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'qw', :'q_staff', '2020-04-08 16:00Z', '2020-04-08 22:00Z', 0, 'approved', :'q_service', :'q_server'),
         (:'qw', :'q_boss',  '2020-04-08 16:00Z', '2020-04-08 19:00Z', 0, 'approved', :'q_service', :'q_server'),
         (:'qw', :'q_boss',  '2020-04-08 19:00Z', '2020-04-08 22:00Z', 0, 'approved', :'q_bar',     :'q_keep');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'qw', 'day', '2020-04-08', '2020-04-08', 'q2', 20000, :'q_boss') returning id as q_pool2 \gset
  select public.calculate_distribution(:'q_pool2') as q_dist2 \gset
  select public.send_distribution(:'q_dist2');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'q_dist2', 'This is missing my Bar shift entirely.');
commit;

select id as q_query2 from public.distribution_queries
  where distribution_id = :'q_dist2' and status = 'open' \gset

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select public.resolve_query(:'q_query2', 'correction_required', 'You are right, I will redo this one.');
commit;

select count(*) as q_still2 from public.tip_distribution_entries
  where distribution_id = :'q_dist2' and member_id = :'q_staff' and ack_status = 'queried' \gset
select tests.ok(:'q_still2'::int = 1,
  'Q32 when the manager agrees something is wrong, the entry stays queried');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'q_dist2'),
    'Q33 …and nobody is asked to confirm a share the manager believes is wrong');
commit;

select status as q_dstatus4 from public.tip_distributions where id = :'q_dist2' \gset
select tests.ok(:'q_dstatus4' = 'sent',
  'Q34 …so the distribution stays open, which is the honest state for it');

-- ═════════════════════════════════════════════════════════════════════════════
-- cancelled is readable, not answerable
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select public.cancel_distribution(:'q_dist2', 'Redoing it with the missing shift.');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.query_distribution(%L, ''Still wrong.'')', :'q_dist2'),
    'Q35 a cancelled distribution accepts no new question');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'q_dist2'),
    'Q36 …and no confirmation');
  select tests.attempt(format(
    'update public.tip_distribution_entries set ack_status = ''acknowledged''
      where distribution_id = %L', :'q_dist2'));
  select count(*) as q_cancelled_seen from public.member_distributions where id = :'q_dist2' \gset
commit;

select count(*) as q_cancelled_acked from public.tip_distribution_entries
  where distribution_id = :'q_dist2' and ack_status = 'acknowledged' \gset
select tests.ok(:'q_cancelled_acked'::int = 0,
  'Q37 …not even by writing the column');
select tests.ok(:'q_cancelled_seen'::int = 1,
  'Q38 …while it stays visible, because what happened still happened');

select count(*) as q_hist from public.distribution_queries where distribution_id = :'q_dist2' \gset
select tests.ok(:'q_hist'::int = 1,
  'Q39 …and the question asked about it is still on the record');

-- ═════════════════════════════════════════════════════════════════════════════
-- suspension, and what stays
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'qw', :'q_staff', '2020-04-15 16:00Z', '2020-04-15 22:00Z', 0, 'approved', :'q_service', :'q_server'),
         (:'qw', :'q_boss',  '2020-04-15 16:00Z', '2020-04-15 22:00Z', 0, 'approved', :'q_bar',     :'q_keep');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'qw', 'day', '2020-04-15', '2020-04-15', 'q3', 10000, :'q_boss') returning id as q_pool3 \gset
  select public.calculate_distribution(:'q_pool3') as q_dist3 \gset
  select public.send_distribution(:'q_dist3');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'q_dist3', 'Why is my amount lower than expected?');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'q_staff';
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.query_distribution(%L, ''And again.'')', :'q_dist3'),
    'Q40 a suspended member cannot raise a question');
  select count(*) as q_sees from public.distribution_queries where workplace_id = :'qw' \gset
commit;

select tests.ok(:'q_sees'::int = 0,
  'Q41 …and cannot read their own while their access is paused');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select count(*) as q_mgr_sees from public.distribution_query_list(:'q_dist3') \gset
commit;
select tests.ok(:'q_mgr_sees'::int = 1,
  'Q42 …while the manager still sees the question they asked');

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'q_staff';
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000002');
  select count(*) as q_sees2 from public.distribution_queries
    where distribution_id = :'q_dist3' and status = 'open' \gset
commit;
select tests.ok(:'q_sees2'::int = 1,
  'Q43 reactivated, their unresolved question is exactly where they left it');

-- ═════════════════════════════════════════════════════════════════════════════
-- the words, and the history, are immutable
-- ═════════════════════════════════════════════════════════════════════════════
select id as q_query3 from public.distribution_queries
  where distribution_id = :'q_dist3' and status = 'open' \gset

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.distribution_queries set note = ''Nothing to see'' where id = %L', :'q_query3'),
    'Q44 not even the manager can edit the question as it was asked');
commit;

begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  update public.workplace_members
    set display_name = 'Quinn Renamed', area_id = :'q_bar', workplace_role_id = :'q_keep', multiplier = 1.9
    where id = :'q_staff';
commit;

select member_name as q_name2, note as q_note5 from public.distribution_queries where id = :'q_query' \gset
select tests.ok(:'q_name2' = 'Quinn Staff' and :'q_note5' = 'I worked in Bar, not Service.',
  'Q45 renaming the member leaves every old question under the name it was asked with');

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as q_money4 from public.tip_distribution_entries where distribution_id = :'q_dist' \gset
select tests.ok(:'q_money' = :'q_money4',
  'Q46 …and the distribution it was about is still word for word what it was');

-- ═════════════════════════════════════════════════════════════════════════════
-- it is all on the audit trail
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('40000000-0000-0000-0000-000000000001');
  select count(*) as q_audit from public.audit_log
    where workplace_id = :'qw' and table_name = 'distribution_queries' \gset
  select count(*) as q_audit_ack from public.audit_log
    where workplace_id = :'qw' and table_name = 'tip_distribution_entries' \gset
commit;

select tests.ok(:'q_audit'::int >= 3,
  'Q47 asking, re-asking and answering are all on the audit trail');
select tests.ok(:'q_audit_ack'::int > 0,
  'Q48 …and so is every answer given on an entry');

-- ═════════════════════════════════════════════════════════════════════════════
-- without a session
-- ═════════════════════════════════════════════════════════════════════════════
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;

begin;
  select set_config('role', 'anon', true);
  select tests.denied(format('select public.query_distribution(%L, ''Hello.'')', :'q_dist3'),
    'Q49 an anonymous caller cannot raise a question');
  select tests.denied(format('select public.resolve_query(%L, ''no_correction'')', :'q_query3'),
    'Q50 …nor answer one');
  select tests.denied(format('select * from public.distribution_query_list(%L)', :'q_dist3'),
    'Q51 …nor read them');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the words are immutable even to the owner
-- ═════════════════════════════════════════════════════════════════════════════
-- Q44 above is enforced by the absent UPDATE grant, which is a fine first line
-- but says nothing about the definer functions: they run as the table's owner
-- and could rewrite the note without RLS ever being consulted. This is the
-- assertion that pins the trigger itself, with no trusted-context escape.
reset role;
select tests.denied(format(
  'update public.distribution_queries set note = ''Owner rewrote this'' where id = %L', :'q_query'),
  'Q52 the owner cannot rewrite the question either — the guard has no exception');

select tests.ok(
  (select note = 'I worked in Bar, not Service.' from public.distribution_queries where id = :'q_query'),
  'Q53 …and the words are exactly the ones that were typed');

select tests.denied(format(
  'update public.distribution_queries set status = ''open'', outcome = null, resolved_at = null
     where id = %L', :'q_query'),
  'Q54 …and a question that has been answered is not reopened behind the answer');

-- ═════════════════════════════════════════════════════════════════════════════
-- why the live comparison failed, pinned
-- ═════════════════════════════════════════════════════════════════════════════
-- The live Phase 3I run reported "identical: false" for money immutability on a
-- backend that had not moved a cent. It compared entry rows that included
-- ack_status, acknowledged_at and queried_at — three fields whose entire job is
-- to change as somebody asks, is answered and confirms.
--
-- These two assertions are the diagnosis: the money is byte-identical, and the
-- naive fingerprint is necessarily not. Anything comparing the second set will
-- report a false alarm no matter how correct the engine is.
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as q_money_final from public.tip_distribution_entries where distribution_id = :'q_dist' \gset

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text
                      || '|' || ack_status::text
                      || '|' || coalesce(acknowledged_at::text, '-')
                      || '|' || coalesce(queried_at::text, '-'), ';' order by id::text))
  as q_naive_final from public.tip_distribution_entries where distribution_id = :'q_dist' \gset

select tests.ok(:'q_money' = :'q_money_final',
  'Q55 after the whole lifecycle the financial fields are byte-identical');

select tests.ok(:'q_naive' <> :'q_naive_final',
  'Q56 …while the acknowledgement fields did change, which is why comparing them was a false alarm');

select tests.ok(
  (select count(*) = 3 from public.tip_distribution_entries
    where distribution_id = :'q_dist' and ack_status = 'acknowledged'),
  'Q57 …specifically: every entry moved from pending to acknowledged, and got a timestamp');
