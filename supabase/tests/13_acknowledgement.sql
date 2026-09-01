-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3H · acknowledgement.
--
-- The employee's half of the loop. Who may confirm, what a confirmation is
-- allowed to touch, what happens to somebody who works two areas in one night,
-- and what the requirement means once the rule behind it has moved on.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('ac000000-0000-0000-0000-000000000001', 'ack.boss@test.local',  '{"full_name":"Ada Boss"}'),
  ('ac000000-0000-0000-0000-000000000002', 'ack.staff@test.local', '{"full_name":"Ash Staff"}'),
  ('ac000000-0000-0000-0000-000000000003', 'ack.rival@test.local', '{"full_name":"Ray Rival"}')
on conflict do nothing;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select public.create_workplace('Ack Lab', 'Marburg') as aw \gset
commit;
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000003');
  select public.create_workplace('Ack Rival', 'Kassel') as ax \gset
commit;

select id as a_service from public.workplace_areas where workplace_id = :'aw' and key = 'service' \gset
select id as a_bar     from public.workplace_areas where workplace_id = :'aw' and key = 'bar' \gset
select id as a_server  from public.workplace_roles where workplace_id = :'aw' and key = 'server' \gset
select id as a_keep    from public.workplace_roles where workplace_id = :'aw' and key = 'bartender' \gset
select id as a_boss    from public.workplace_members where workplace_id = :'aw' and role = 'manager' \gset

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'a_service', workplace_role_id = :'a_server'
    where id = :'a_boss';
  select token from public.create_invitation(
    :'aw', 'ack.staff@test.local', 'Ash Staff', 'employee', :'a_service', :'a_server') as t \gset tok_ash_
commit;
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_ash_token') as a_ash \gset
commit;

-- A placeholder with no account: they can never answer, and the counts must
-- not wait for them.
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'aw', 'Ghost Placeholder', 'employee', :'a_service', :'a_server', 'active')
  returning id as a_ghost \gset
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- a distribution that requires confirmation, with Ash working two areas
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select id as a_rule from public.distribution_rules where workplace_id = :'aw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'a_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'a_rule' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'a_rule' and area_id = :'a_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'a_rule' and area_id not in (:'a_service', :'a_bar');
  select public.activate_rule(:'a_rule');

  -- Ash works Service and then Bar on the same night: two entries, one person.
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'aw', :'a_ash',   '2020-02-01 16:00Z', '2020-02-01 20:00Z', 0, 'approved', :'a_service', :'a_server'),
         (:'aw', :'a_ash',   '2020-02-01 20:00Z', '2020-02-01 23:00Z', 0, 'approved', :'a_bar',     :'a_keep'),
         (:'aw', :'a_boss',  '2020-02-01 16:00Z', '2020-02-01 23:00Z', 0, 'approved', :'a_service', :'a_server'),
         (:'aw', :'a_ghost', '2020-02-01 16:00Z', '2020-02-01 23:00Z', 0, 'approved', :'a_bar',     :'a_keep');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'aw', 'day', '2020-02-01', '2020-02-01', 'ack', 30000, :'a_boss') returning id as a_pool \gset
  select public.calculate_distribution(:'a_pool') as a_dist \gset
commit;

select count(*) as a_ash_entries from public.tip_distribution_entries
  where distribution_id = :'a_dist' and member_id = :'a_ash' \gset

select tests.ok(:'a_ash_entries'::int = 2,
  'K1  a member who worked two areas has two entries in one distribution');

-- ── a draft may not be acknowledged, by either door ─────────────────────────
select id as a_ash_entry from public.tip_distribution_entries
  where distribution_id = :'a_dist' and member_id = :'a_ash' order by area_name limit 1 \gset

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select tests.denied(
    format('select public.acknowledge_entry(%L, ''acknowledged'')', :'a_ash_entry'),
    'K2  a draft cannot be acknowledged through acknowledge_entry()');
  select tests.denied(
    format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'a_dist'),
    'K3  …nor through acknowledge_distribution()');
  select tests.attempt(
    format('update public.tip_distribution_entries set ack_status = ''acknowledged'' where id = %L', :'a_ash_entry'));
commit;

select tests.ok(
  (select ack_status = 'pending' from public.tip_distribution_entries where id = :'a_ash_entry'),
  'K4  …nor by writing the column directly');

-- ── the employee cannot even see a draft ───────────────────────────────────
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select count(*) as a_draft_seen from public.member_distributions where id = :'a_dist' \gset
commit;
select tests.ok(:'a_draft_seen'::int = 0, 'K5  a draft is not on the employee''s list at all');

-- ═════════════════════════════════════════════════════════════════════════════
-- sent: now it may be answered
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select public.send_distribution(:'a_dist');
commit;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select acknowledgement_required as a_required from public.member_distributions where id = :'a_dist' \gset
  select count(*) as a_pending_seen from public.member_distribution_entries
    where distribution_id = :'a_dist' and ack_status = 'pending' and is_own \gset
commit;

select tests.ok(:'a_required'::boolean, 'K6  the employee is told confirmation is required');
select tests.ok(:'a_pending_seen'::int = 2, 'K7  …and sees both of their own entries waiting');

-- ── one action, both entries ───────────────────────────────────────────────
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'a_dist', 'acknowledged') as a_touched \gset
commit;

select tests.ok(:'a_touched'::int = 2,
  'K8  one action acknowledges every entry the caller owns, and says how many');

select count(*) as a_left from public.tip_distribution_entries
  where distribution_id = :'a_dist' and member_id = :'a_ash' and ack_status <> 'acknowledged' \gset
select tests.ok(:'a_left'::int = 0, 'K9  …so neither of their areas is left half-confirmed');

select acknowledged_at as a_stamp1 from public.tip_distribution_entries where id = :'a_ash_entry' \gset
select tests.ok(:'a_stamp1' is not null, 'K10 …and the moment is recorded');

-- ── repeating it is safe and does not move the moment ──────────────────────
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'a_dist', 'acknowledged');
  select public.acknowledge_entry(:'a_ash_entry', 'acknowledged');
commit;

select acknowledged_at as a_stamp2 from public.tip_distribution_entries where id = :'a_ash_entry' \gset
select tests.ok(:'a_stamp1' = :'a_stamp2',
  'K11 acknowledging again is accepted and leaves the first moment where it was');

-- ── the placeholder never answers, and never blocks ────────────────────────
select status as a_dstatus from public.tip_distributions where id = :'a_dist' \gset
select ack_status as a_ghost_ack from public.tip_distribution_entries
  where distribution_id = :'a_dist' and member_id = :'a_ghost' \gset

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select public.acknowledge_distribution(:'a_dist', 'acknowledged');
commit;

select status as a_dstatus2 from public.tip_distributions where id = :'a_dist' \gset
select tests.ok(:'a_ghost_ack' = 'pending' and :'a_dstatus2' = 'confirmed',
  'K12 a roster placeholder never confirms, and never holds the distribution open');

-- ═════════════════════════════════════════════════════════════════════════════
-- whose entry is it
-- ═════════════════════════════════════════════════════════════════════════════
select id as a_boss_entry from public.tip_distribution_entries
  where distribution_id = :'a_dist' and member_id = :'a_boss' limit 1 \gset
select id as a_ghost_entry from public.tip_distribution_entries
  where distribution_id = :'a_dist' and member_id = :'a_ghost' limit 1 \gset

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_entry(%L, ''acknowledged'')', :'a_boss_entry'),
    'K13 an employee cannot acknowledge a colleague''s entry');
  select tests.denied(format('select public.acknowledge_entry(%L, ''acknowledged'')', :'a_ghost_entry'),
    'K14 …nor a placeholder''s, which is nobody''s to answer');
commit;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.acknowledge_entry(%L, ''acknowledged'')', :'a_ash_entry'),
    'K15 somebody from another workplace cannot acknowledge an entry here');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'a_dist'),
    'K16 …nor the distribution');
  select tests.denied(format('select * from public.distribution_ack_state(%L)', :'a_dist'),
    'K17 …nor read who has confirmed');
commit;

-- The manager is not allowed to answer on somebody's behalf either: they can
-- only ever reach their own entry, because app.member_id() resolves to it.
select tests.ok(
  (select ack_status = 'pending' from public.tip_distribution_entries where id = :'a_ghost_entry'),
  'K18 the manager''s own confirmation did not answer for the placeholder');

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select tests.attempt(format(
    'update public.tip_distribution_entries set ack_status = ''acknowledged'' where id = %L', :'a_ghost_entry'));
commit;

select tests.ok(
  (select ack_status = 'pending' from public.tip_distribution_entries where id = :'a_ghost_entry'),
  'K19 …and cannot write the column for them either');

-- ── an invalid transition ──────────────────────────────────────────────────
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_entry(%L, ''pending'')', :'a_ash_entry'),
    'K20 nobody can put an entry back to pending through the RPC');
  select tests.attempt(format(
    'update public.tip_distribution_entries set ack_status = ''pending'' where id = %L', :'a_ash_entry'));
commit;

select tests.ok(
  (select ack_status = 'acknowledged' from public.tip_distribution_entries where id = :'a_ash_entry'),
  'K21 …and writing the column back to pending does not stick either');

-- ── the money is still untouchable ─────────────────────────────────────────
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as a_money from public.tip_distribution_entries where distribution_id = :'a_dist' \gset

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select tests.attempt(format(
    'update public.tip_distribution_entries set amount_cents = 999999 where id = %L', :'a_ash_entry'));
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as a_money2 from public.tip_distribution_entries where distribution_id = :'a_dist' \gset
select tests.ok(:'a_money' = :'a_money2',
  'K22 acknowledging is the only thing an entry lets anybody change');

-- ═════════════════════════════════════════════════════════════════════════════
-- the manager's view of it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select count(*) as a_rows,
         count(*) filter (where can_acknowledge) as a_answerable,
         count(*) filter (where ack_status = 'acknowledged') as a_done,
         count(*) filter (where can_acknowledge and ack_status = 'pending') as a_waiting
    from public.distribution_ack_state(:'a_dist') \gset
commit;

select tests.ok(:'a_rows'::int = 4 and :'a_answerable'::int = 3,
  'K23 the manager sees every entry, and which of them anybody can answer');
select tests.ok(:'a_done'::int = 3 and :'a_waiting'::int = 0,
  'K24 …with the counts the engine itself used to close the distribution');

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select count(*) as a_leaks from public.distribution_ack_state(:'a_dist')
    where member_name like '%@%' \gset
commit;
select tests.ok(:'a_leaks'::int = 0, 'K25 …and it carries snapshot names, never an email address');

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select tests.denied(format('select * from public.distribution_ack_state(%L)', :'a_dist'),
    'K26 an employee cannot read the whole workplace''s confirmations');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- suspension, and coming back
-- ═════════════════════════════════════════════════════════════════════════════
-- A second distribution, still open, so there is something left to confirm.
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'aw', :'a_ash',   '2020-02-08 16:00Z', '2020-02-08 22:00Z', 0, 'approved', :'a_service', :'a_server'),
         (:'aw', :'a_boss',  '2020-02-08 16:00Z', '2020-02-08 22:00Z', 0, 'approved', :'a_service', :'a_server'),
         (:'aw', :'a_ghost', '2020-02-08 16:00Z', '2020-02-08 22:00Z', 0, 'approved', :'a_bar',     :'a_keep');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'aw', 'day', '2020-02-08', '2020-02-08', 'ack2', 20000, :'a_boss') returning id as a_pool2 \gset
  select public.calculate_distribution(:'a_pool2') as a_dist2 \gset
  select public.send_distribution(:'a_dist2');
  update public.workplace_members set status = 'suspended' where id = :'a_ash';
commit;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'a_dist2'),
    'K27 a suspended member cannot acknowledge');
  select count(*) as a_sees_suspended from public.member_distributions where workplace_id = :'aw' \gset
commit;

select tests.ok(:'a_sees_suspended'::int = 0,
  'K28 …and cannot see the distribution to acknowledge in the first place');

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'a_ash';
commit;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'a_dist2', 'acknowledged') as a_touched2 \gset
commit;

select tests.ok(:'a_touched2'::int = 1,
  'K29 reactivated, the confirmation that was waiting is still theirs to give');

-- The first distribution's answers did not move while they were away.
select tests.ok(
  (select acknowledged_at = :'a_stamp1' from public.tip_distribution_entries where id = :'a_ash_entry'),
  'K30 …and the confirmation they gave before suspension is exactly where it was');

-- ═════════════════════════════════════════════════════════════════════════════
-- a query, and what it does not do
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.acknowledge_entry(:'a_ash_entry', 'queried', '  I worked later than this  ');
commit;

select ack_status as a_q_status, query_note as a_q_note, queried_at as a_q_at,
       acknowledged_at as a_q_ack
  from public.tip_distribution_entries where id = :'a_ash_entry' \gset

select tests.ok(:'a_q_status' = 'queried' and :'a_q_note' = 'I worked later than this'
                and :'a_q_at' is not null,
  'K31 an entry can be queried, with the note trimmed');
select tests.ok(:'a_q_ack' = :'a_stamp1',
  'K32 …and querying does not erase the moment they had confirmed');

-- Phase 3I: the person who asked cannot answer themselves. The manager
-- resolves, which puts the entry back to pending, and only then may they
-- confirm. Asserted properly in 14_query_and_resolution.sql; here it is just
-- the path back to a clean state for the rest of this file.
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select public.resolve_query(
    (select id from public.distribution_queries
      where distribution_id = :'a_dist' and status = 'open' limit 1),
    'no_correction', 'Checked the roster; the hours are right.');
commit;
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.acknowledge_entry(:'a_ash_entry', 'acknowledged');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the requirement is frozen, not looked up
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  select id as a_draft2 from public.create_rule_draft(:'aw') as id \gset
  update public.distribution_rules set acknowledgement_required = false where id = :'a_draft2';
  select public.activate_rule(:'a_draft2');
commit;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select acknowledgement_required as a_required_after from public.member_distributions where id = :'a_dist' \gset
commit;

select tests.ok(:'a_required_after'::boolean,
  'K33 a distribution sent under a rule that required confirmation still requires it');

-- A new distribution under the new rule does not.
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'aw', :'a_ash',   '2020-03-01 16:00Z', '2020-03-01 22:00Z', 0, 'approved', :'a_service', :'a_server'),
         (:'aw', :'a_boss',  '2020-03-01 16:00Z', '2020-03-01 22:00Z', 0, 'approved', :'a_service', :'a_server'),
         (:'aw', :'a_ghost', '2020-03-01 16:00Z', '2020-03-01 22:00Z', 0, 'approved', :'a_bar',     :'a_keep');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'aw', 'day', '2020-03-01', '2020-03-01', 'ack3', 15000, :'a_boss') returning id as a_pool3 \gset
  select public.calculate_distribution(:'a_pool3') as a_dist3 \gset
  select public.send_distribution(:'a_dist3');
commit;

begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select acknowledgement_required as a_required3 from public.member_distributions where id = :'a_dist3' \gset
commit;

select tests.ok(not :'a_required3'::boolean,
  'K34 …while one sent afterwards carries the new answer');

-- Not required does not mean not allowed: it changes what the app asks for,
-- never what the database permits.
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'a_dist3', 'acknowledged') as a_touched3 \gset
commit;
select tests.ok(:'a_touched3'::int = 1,
  'K35 …and confirming anyway is still accepted');

-- ═════════════════════════════════════════════════════════════════════════════
-- history does not move under it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('ac000000-0000-0000-0000-000000000001');
  update public.workplace_members
    set display_name = 'Ash Renamed', area_id = :'a_bar', workplace_role_id = :'a_keep', multiplier = 1.75
    where id = :'a_ash';
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text || '|' || ack_status::text,
                      ';' order by id::text)) as a_final
  from public.tip_distribution_entries where distribution_id = :'a_dist' \gset

select tests.ok(:'a_final' = md5((select string_agg(member_name || '|' || area_name || '|'
                                    || amount_cents::text || '|' || ack_status::text, ';' order by id::text)
                                  from public.tip_distribution_entries where distribution_id = :'a_dist')),
  'K36 renaming and moving the member leaves the entries, and their answers, alone');

select tests.ok(
  (select member_name = 'Ash Staff' and ack_status = 'acknowledged'
     and acknowledged_at = :'a_stamp1'
   from public.tip_distribution_entries where id = :'a_ash_entry'),
  'K37 …down to the name it recorded and the moment it was answered');

-- ═════════════════════════════════════════════════════════════════════════════
-- without a session
-- ═════════════════════════════════════════════════════════════════════════════
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;

begin;
  select set_config('role', 'anon', true);
  select tests.denied(format('select public.acknowledge_entry(%L, ''acknowledged'')', :'a_ash_entry'),
    'K38 an anonymous caller cannot acknowledge an entry');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'a_dist'),
    'K39 …nor a distribution');
  select tests.denied(format('select * from public.distribution_ack_state(%L)', :'a_dist'),
    'K40 …nor read who has');
commit;
