-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3R-D · a shift sent back tells its owner (migrations 34 and 35), and
-- the correction round trip the employee policy has allowed since migration 8.
--
-- What is proved: exactly one person is told, with the date and NOT the note;
-- the employee can correct and resubmit an unlocked rejected shift and cannot
-- touch a locked or approved one; a second rejection of the same shift re-arms
-- the one row instead of adding another, inside the immutability rule rather
-- than around it; the shape constraint refuses every wrong combination; the
-- table stays unwritable by clients; and the trigger and the dedupe index are
-- each proved load-bearing by a negative control that switches them off inside
-- a rolled-back transaction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Rows a statement changed, or -1 when it was refused. Also defined by suite
-- 22; repeated here so this file runs on its own.
create or replace function tests.rows_changed(p_sql text)
returns integer language plpgsql as $$
declare v_count integer := 0;
begin
  begin
    execute p_sql;
    get diagnostics v_count = row_count;
  exception when others then
    v_count := -1;
  end;
  return v_count;
end $$;
grant execute on function tests.rows_changed(text) to authenticated;

-- The SQLSTATE a statement fails with, or '00000' when it succeeds. The shape
-- tests need to know WHICH rule refused a row: a CHECK violation is 23514, a
-- foreign key is 23503, and only the first proves the constraint.
create or replace function tests.sqlstate_of(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return '00000';
exception when others then
  return sqlstate;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1400000-0000-0000-0000-000000000001', 'rj.boss@test.local',  '{"full_name":"R Boss"}'),
  ('a1400000-0000-0000-0000-000000000002', 'rj.staff@test.local', '{"full_name":"R Staff"}'),
  ('a1400000-0000-0000-0000-000000000003', 'rj.peer@test.local',  '{"full_name":"R Peer"}'),
  ('a1400000-0000-0000-0000-000000000004', 'rj.rival@test.local', '{"full_name":"R Rival"}'),
  ('a1400000-0000-0000-0000-000000000005', 'rj.gone@test.local',  '{"full_name":"R Gone"}')
on conflict do nothing;

begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  select public.create_workplace('Rejection Lab', 'Trier') as rw \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000004');
  select public.create_workplace('Rejection Rival', 'Trier') as rx \gset
commit;

select id as r_service from public.workplace_areas where workplace_id = :'rw' and key = 'service' \gset
select id as r_server  from public.workplace_roles where workplace_id = :'rw' and key = 'server' \gset
select id as r_boss    from public.workplace_members where workplace_id = :'rw' and role = 'manager' \gset

begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'rw', 'rj.staff@test.local', 'R Staff', 'employee', :'r_service', :'r_server') as t \gset tok_rs_
  select token from public.create_invitation(
    :'rw', 'rj.peer@test.local', 'R Peer', 'employee', :'r_service', :'r_server') as t \gset tok_rp_
  select token from public.create_invitation(
    :'rw', 'rj.gone@test.local', 'R Gone', 'employee', :'r_service', :'r_server') as t \gset tok_rg_
  -- A roster placeholder: on the books, no account, nobody to tell.
  insert into public.workplace_members (workplace_id, display_name, role, status, area_id, workplace_role_id)
  values (:'rw', 'R Ghost', 'employee', 'active', :'r_service', :'r_server')
  returning id as r_ghost \gset
commit;
begin; select tests.as_user('a1400000-0000-0000-0000-000000000002');
       select public.accept_invitation(:'tok_rs_token') as r_staff \gset
commit;
begin; select tests.as_user('a1400000-0000-0000-0000-000000000003');
       select public.accept_invitation(:'tok_rp_token') as r_peer \gset
commit;
begin; select tests.as_user('a1400000-0000-0000-0000-000000000005');
       select public.accept_invitation(:'tok_rg_token') as r_gone \gset
commit;

-- The same person in a second workplace, so isolation is a fact about the
-- fixture rather than an assumption.
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000004');
  select token from public.create_invitation(
    :'rx', 'rj.staff@test.local', 'R Elsewhere', 'employee', null, null) as t \gset tok_rx_
commit;
begin; select tests.as_user('a1400000-0000-0000-0000-000000000002');
       select public.accept_invitation(:'tok_rx_token') as r_staff_x \gset
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the shift under test: submitted by the employee, exactly as the app does it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, submitted_at)
  values (:'rw', :'r_staff', '2024-05-06 18:00+02', '2024-05-06 23:00+02', 30, 'submitted', now())
  returning id as r_s1 \gset
commit;

select tests.ok(
  (select count(*) = 0 from public.member_notifications
    where type = 'shift_rejected' and workplace_id = :'rw'),
  'R1  a submitted shift has told nobody anything');

-- ═════════════════════════════════════════════════════════════════════════════
-- sending it back tells the person whose shift it is
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.shifts
     set status = 'rejected', reviewed_by = :'r_boss', reviewed_at = now(),
         review_note = 'Finish time is wrong'
   where id = :'r_s1';
commit;

select tests.ok(
  (select count(*) = 1 from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R2  the rejection produces exactly one shift_rejected row for that shift');
select tests.ok(
  (select member_id = :'r_staff' and workplace_id = :'rw' from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R3  …addressed to the shift''s own member, in the shift''s own workplace');
select tests.ok(
  (select payload = jsonb_build_object('work_date', '2024-05-06') from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R4  …carrying the business date and nothing else');
select tests.ok(
  (select not (payload ? 'review_note') and payload::text not ilike '%wrong%'
     from public.member_notifications where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R5  …so the manager''s note is NOT in the notification');
select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'r_peer'),
  'R6  a colleague is told nothing');
select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'r_boss'),
  'R7  the manager who sent it back is told nothing');
select tests.ok(
  (select read_at is null from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R8  …and the row starts unread');
select tests.ok(
  (select count(*) = 1 from public.member_notifications where workplace_id = :'rw'),
  'R9  no other notification of any type came out of the rejection');

-- Remembered for the re-arm proof below: the row must be THIS row afterwards.
select id as r_n1, created_at as r_n1_created, payload::text as r_n1_payload
  from public.member_notifications where type = 'shift_rejected' and shift_id = :'r_s1' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- who cannot be told
-- ═════════════════════════════════════════════════════════════════════════════
-- A member who has left, a suspended one, and a placeholder with no account.
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000005');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, submitted_at)
  values (:'rw', :'r_gone', '2024-05-06 17:00+02', '2024-05-06 22:00+02', 0, 'submitted', now())
  returning id as r_s_gone \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000003');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, submitted_at)
  values (:'rw', :'r_peer', '2024-05-06 17:00+02', '2024-05-06 22:00+02', 0, 'submitted', now())
  returning id as r_s_peer \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'left', left_at = now() where id = :'r_gone';
  update public.workplace_members set status = 'suspended' where id = :'r_peer';
  update public.shifts set status = 'rejected', reviewed_by = :'r_boss', reviewed_at = now()
   where id in (:'r_s_gone', :'r_s_peer');
  -- The placeholder's shift is the manager's to enter and to send back.
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, source)
  values (:'rw', :'r_ghost', '2024-05-06 17:00+02', '2024-05-06 22:00+02', 0, 'submitted', 'manager')
  returning id as r_s_ghost \gset
  update public.shifts set status = 'rejected', reviewed_by = :'r_boss', reviewed_at = now()
   where id = :'r_s_ghost';
commit;

select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'r_gone'),
  'R10 a member who has left is told nothing');
select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'r_peer'),
  'R11 a suspended member is told nothing');
select tests.ok(
  (select count(*) = 0 from public.member_notifications where member_id = :'r_ghost'),
  'R12 a roster placeholder with no account is told nothing');

begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'r_peer';
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the employee corrects it and sends it again — migration 8's policy, no RPC
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select tests.rows_changed(format(
    $q$update public.shifts
          set starts_at = '2024-05-06 18:00+02', ends_at = '2024-05-06 23:30+02',
              break_minutes = 30, status = 'submitted', submitted_at = now()
        where id = %L$q$, :'r_s1')) as r_resubmit \gset
  select status::text as r_s1_status, (reviewed_at is not null) as r_s1_kept_at,
         reviewed_by = :'r_boss' as r_s1_kept_by, coalesce(review_note, '') as r_s1_note,
         worked_minutes as r_s1_worked
    from public.shifts where id = :'r_s1' \gset
commit;

select tests.ok(:'r_resubmit'::int = 1,
  'R13 the employee can correct and resubmit their unlocked rejected shift');
select tests.ok(:'r_s1_status' = 'submitted' and :'r_s1_worked'::int = 300,
  'R14 …it is submitted again, with the corrected hours the database computed');
select tests.ok(:'r_s1_kept_at' and :'r_s1_kept_by' and :'r_s1_note' = 'Finish time is wrong',
  'R15 …and the earlier review stays on the row as history, since the employee cannot clear it');
select tests.ok(
  (select count(*) = 1 from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R16 resubmitting changes nothing in the inbox');

-- The person reads it, as the app does through the RPC.
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select public.mark_notification_read(:'r_n1');
commit;
select tests.ok(
  (select read_at is not null from public.member_notifications where id = :'r_n1'),
  'R17 …and marks it read');

-- ═════════════════════════════════════════════════════════════════════════════
-- approving tells nobody
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.shifts
     set status = 'approved', reviewed_by = :'r_boss', reviewed_at = now(), review_note = null
   where id = :'r_s1';
commit;

select tests.ok(
  (select count(*) = 1 from public.member_notifications where member_id = :'r_staff'),
  'R18 approving the corrected shift adds no notification of any type');
select tests.ok(
  (select review_note is null from public.shifts where id = :'r_s1'),
  'R19 …and the manager''s decision replaced the old note, so nothing stale remains');

-- ═════════════════════════════════════════════════════════════════════════════
-- rejected again: one row, re-armed
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.shifts
     set status = 'rejected', reviewed_by = :'r_boss', reviewed_at = now(),
         review_note = 'Still not right'
   where id = :'r_s1';
commit;

select tests.ok(
  (select count(*) = 1 from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R20 a second rejection of the same shift adds no second row');
select tests.ok(
  (select id = :'r_n1' and read_at is null from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1'),
  'R21 …it re-arms the SAME row: unread again');
select tests.ok(
  (select created_at = :'r_n1_created'::timestamptz and payload::text = :'r_n1_payload'
     from public.member_notifications where id = :'r_n1'),
  'R22 …with its created_at and payload exactly as first written');
select tests.ok(
  (select payload::text not ilike '%still not right%' from public.member_notifications where id = :'r_n1'),
  'R23 …and the new note is not in it either');

-- The re-arm is inside the immutability rule, not an exception to it: the
-- guard still refuses every other column, for the owner too, and the one
-- thing it permits is precisely a read_at-only change.
reset role;
select tests.denied(format(
  'update public.member_notifications set payload = ''{"x":1}''::jsonb where id = %L', :'r_n1'),
  'R24 the guard is live: even the owner cannot rewrite the payload');
select tests.denied(format(
  'update public.member_notifications set shift_id = null where id = %L', :'r_n1'),
  'R25 …nor detach the row from its shift — shift_id is immutable too');
select tests.denied(format(
  'update public.member_notifications set member_id = %L where id = %L', :'r_boss', :'r_n1'),
  'R26 …nor readdress it');
select tests.denied(format(
  'delete from public.member_notifications where id = %L', :'r_n1'),
  'R27 …nor delete it');
select tests.ok(
  tests.rows_changed(format(
    'update public.member_notifications set read_at = now() where id = %L', :'r_n1')) = 1
  and tests.rows_changed(format(
    'update public.member_notifications set read_at = null where id = %L', :'r_n1')) = 1,
  'R28 …while a read_at-only change — what the re-arm is — is exactly what it allows');

-- ═════════════════════════════════════════════════════════════════════════════
-- what the employee still cannot do
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.shifts set locked = true where id = :'r_s1';
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select tests.changes_nothing(format(
    $q$update public.shifts set ends_at = '2024-05-06 23:45+02', status = 'submitted' where id = %L$q$, :'r_s1'),
    'R29 a locked rejected shift cannot be resubmitted by the employee');
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.shifts set locked = false where id = :'r_s1';
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select tests.rows_changed(format(
    $q$update public.shifts set ends_at = '2024-05-06 23:45+02', status = 'submitted', submitted_at = now()
        where id = %L$q$, :'r_s1')) as r_resubmit2 \gset
commit;
select tests.ok(:'r_resubmit2'::int = 1,
  'R30 …and can be once the manager unlocks it');

begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, submitted_at)
  values (:'rw', :'r_staff', '2024-05-07 18:00+02', '2024-05-07 23:00+02', 0, 'submitted', now())
  returning id as r_s2 \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  update public.shifts set status = 'approved', reviewed_by = :'r_boss', reviewed_at = now() where id = :'r_s2';
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select tests.changes_nothing(format(
    $q$update public.shifts set ends_at = '2024-05-07 23:30+02', status = 'submitted' where id = %L$q$, :'r_s2'),
    'R31 an approved shift cannot be edited by the employee');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the shape rule
-- ═════════════════════════════════════════════════════════════════════════════
-- Each refusal must be the CHECK constraint (23514), not a foreign key that
-- happened to fire first — so the sources that are wrong are real rows.
reset role;
select tests.ok(
  tests.sqlstate_of(format(
    'insert into public.member_notifications (workplace_id, member_id, type) values (%L, %L, ''shift_rejected'')',
    :'rw', :'r_staff')) = '23514',
  'R32 shift_rejected without a shift has no valid shape');
select tests.ok(
  tests.sqlstate_of(format(
    'insert into public.member_notifications (workplace_id, member_id, type, shift_id, distribution_id)
       values (%L, %L, ''shift_rejected'', %L, %L)',
    :'rw', :'r_staff', :'r_s2', gen_random_uuid())) = '23514',
  'R33 …and shift_rejected with any money source is refused by the shape rule, not by a key');
select tests.ok(
  tests.sqlstate_of(format(
    'insert into public.member_notifications (workplace_id, member_id, type, shift_id, distribution_id)
       values (%L, %L, ''distribution_sent'', %L, %L)',
    :'rw', :'r_staff', :'r_s2', gen_random_uuid())) = '23514',
  'R34 a money event pointing at a shift is refused by the shape rule');

-- ═════════════════════════════════════════════════════════════════════════════
-- nobody writes the table from outside
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'insert into public.member_notifications (workplace_id, member_id, type, shift_id)
     values (%L, %L, ''shift_rejected'', %L)', :'rw', :'r_staff', :'r_s2'),
    'R35 an employee cannot write themselves a shift_rejected row');
  select tests.changes_nothing(format(
    'update public.member_notifications set read_at = null where id = %L', :'r_n1'),
    'R36 …nor re-arm one directly');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- who may read it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000002');
  select count(*) as r_staff_sees from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1' \gset
  select count(*) as r_staff_sees_x from public.member_notifications where workplace_id = :'rx' \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000003');
  select count(*) as r_peer_sees from public.member_notifications where shift_id = :'r_s1' \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000001');
  select count(*) as r_boss_sees from public.member_notifications where shift_id = :'r_s1' \gset
commit;
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000004');
  select count(*) as r_rival_sees from public.member_notifications where shift_id = :'r_s1' \gset
commit;
select tests.ok(:'r_staff_sees'::int = 1, 'R37 the employee reads their own shift_rejected row');
select tests.ok(:'r_peer_sees'::int = 0,  'R38 a colleague cannot read it');
select tests.ok(:'r_boss_sees'::int = 0,  'R39 the manager cannot read it — it is not theirs');
select tests.ok(:'r_rival_sees'::int = 0, 'R40 another workplace''s manager cannot read it');
select tests.ok(:'r_staff_sees_x'::int = 0,
  'R41 the same person''s inbox in their OTHER workplace is untouched');

-- ═════════════════════════════════════════════════════════════════════════════
-- another workplace cannot reach in
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1400000-0000-0000-0000-000000000004');
  select tests.changes_nothing(format(
    $q$update public.shifts set status = 'rejected' where id = %L$q$, :'r_s1'),
    'R42 a manager of another workplace cannot send this shift back');
commit;
select tests.ok(
  (select status = 'submitted' from public.shifts where id = :'r_s1'),
  'R43 …so it is still submitted, and the inbox saw nothing');

-- ═════════════════════════════════════════════════════════════════════════════
-- negative controls: switch each guard off and watch the assertion break
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
begin;
  drop trigger shifts_notify_rejected on public.shifts;
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'rw', :'r_staff', '2024-05-08 18:00+02', '2024-05-08 23:00+02', 0, 'submitted')
  returning id as r_s3 \gset
  update public.shifts set status = 'rejected' where id = :'r_s3';
  select tests.ok(
    (select count(*) = 0 from public.member_notifications where shift_id = :'r_s3'),
    'R44 NEGATIVE CONTROL: without the trigger, a rejection tells nobody — it is what fires R2');
rollback;

begin;
  drop index public.member_notifications_dedupe;
  update public.shifts set status = 'rejected' where id = :'r_s1';
  select tests.ok(
    (select count(*) = 2 from public.member_notifications
      where type = 'shift_rejected' and shift_id = :'r_s1'),
    'R45 NEGATIVE CONTROL: without the dedupe index, a repeat rejection adds a second row — it is what holds R20');
rollback;

select tests.ok(
  (select count(*) = 1 from public.member_notifications
    where type = 'shift_rejected' and shift_id = :'r_s1')
  and (select tgenabled from pg_trigger where tgname = 'shifts_notify_rejected') <> 'D',
  'R46 …and both controls rolled back: one row, trigger in place');
