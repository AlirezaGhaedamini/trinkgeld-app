-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3R-A · production hardening (migration 33).
--
-- The lifecycle belongs to the engine: no client UPDATE of a distribution, no
-- client movement of a pool's status, a pool recovered by void_pool(),
-- publication read off sent_at, a draft never cancelled, and the business day
-- handed out by the server. Every guard is proved load-bearing by a negative
-- control that switches it off inside a rolled-back transaction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Rows a statement changed, or -1 when it was refused. The positive twin of
-- tests.denied(): the negative controls need to see a write GO THROUGH.
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

-- The anonymous cases run with role = anon, which the fixture never granted.
grant usage on schema tests to anon;
grant execute on function tests.denied(text, text) to anon;

-- One night of the lab: the boss files the report, the staff member works
-- 18:00–00:00 local, and the reports are pooled. One call per transaction —
-- create_pool_from_reports() keeps a temp table until commit.
create or replace function tests.hard_night(
  p_wp uuid, p_boss uuid, p_staff uuid, p_area uuid, p_role uuid, p_day date
) returns uuid language plpgsql as $$
begin
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (p_wp, p_boss, p_day, 50000);
  insert into public.shifts
    (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values
    (p_wp, p_staff, (p_day::text || ' 16:00Z')::timestamptz, (p_day::text || ' 22:00Z')::timestamptz,
     0, 'approved', p_area, p_role);
  return public.create_pool_from_reports(p_wp, p_day, p_day);
end $$;
grant execute on function tests.hard_night(uuid, uuid, uuid, uuid, uuid, date) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1300000-0000-0000-0000-000000000001', 'h.boss@test.local',  '{"full_name":"H Boss"}'),
  ('a1300000-0000-0000-0000-000000000002', 'h.staff@test.local', '{"full_name":"H Staff"}'),
  ('a1300000-0000-0000-0000-000000000003', 'h.rival@test.local', '{"full_name":"H Rival"}'),
  ('a1300000-0000-0000-0000-000000000004', 'h.gone@test.local',  '{"full_name":"H Gone"}')
on conflict do nothing;

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.create_workplace('Hardening Lab', 'Bonn') as hw \gset
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000003');
  select public.create_workplace('Hardening Rival', 'Bonn') as hx \gset
commit;

select id as h_service from public.workplace_areas where workplace_id = :'hw' and key = 'service' \gset
select id as h_server  from public.workplace_roles where workplace_id = :'hw' and key = 'server' \gset
select id as h_boss    from public.workplace_members where workplace_id = :'hw' and role = 'manager' \gset

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'hw', 'h.staff@test.local', 'H Staff', 'employee', :'h_service', :'h_server') as t \gset tok_h_
  select token from public.create_invitation(
    :'hw', 'h.gone@test.local', 'H Gone', 'employee', :'h_service', :'h_server') as t \gset tok_hg_
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_h_token') as h_staff \gset
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000004');
  select public.accept_invitation(:'tok_hg_token') as h_gone \gset
commit;

-- Service takes the whole pool, so one approved service shift is a full night.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select id as h_rule from public.distribution_rules where workplace_id = :'hw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'h_rule';
  update public.distribution_rule_areas set percentage = 100
    where rule_id = :'h_rule' and area_id = :'h_service';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'h_rule' and area_id <> :'h_service';
  select public.activate_rule(:'h_rule');
commit;

-- Night 1: a draft to attack, and then to send legitimately.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.hard_night(:'hw', :'h_boss', :'h_staff', :'h_service', :'h_server', '2022-03-05') as h_pool1 \gset
  select public.calculate_distribution(:'h_pool1') as h_d1 \gset
commit;
-- An open manual pool, opened the way the app opens one.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  insert into public.tip_pools
    (workplace_id, period, period_start, period_end, label, card_cents, cash_cents, source, status, created_by)
  values (:'hw', 'day', '2022-04-01', '2022-04-01', 'by hand', 1000, 2000, 'manual', 'open', :'h_boss')
  returning id as h_pool_m \gset
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- A · a client cannot write a distribution
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.tip_distributions set status = ''sent'' where id = %L', :'h_d1'),
    'H1  a manager cannot PATCH a draft to sent');
  select tests.denied(format(
    'update public.tip_distributions set sent_at = now() where id = %L', :'h_d1'),
    'H2  …nor forge sent_at');
  select tests.denied(format(
    'update public.tip_distributions set tip_pool_id = %L where id = %L', :'h_pool_m', :'h_d1'),
    'H3  …nor move the draft onto another pool');
  select tests.denied(format(
    'update public.tip_distributions set pool_cents = 1, entries_total_cents = 1, people_count = 99 where id = %L', :'h_d1'),
    'H4  …nor rewrite the calculated totals');
  select tests.denied(format(
    'update public.tip_distributions set correction_reason = ''other'', correction_note = ''forged'' where id = %L', :'h_d1'),
    'H5  …nor forge correction provenance');
  select tests.denied(format(
    'update public.tip_distributions set status = ''cancelled'' where id = %L', :'h_d1'),
    'H6  …nor cancel it by hand');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'update public.tip_distributions set status = ''sent'', sent_at = now() where id = %L', :'h_d1'),
    'H7  an employee cannot do any of that either');
commit;

select tests.ok(
  (select status = 'draft' and sent_at is null and tip_pool_id = :'h_pool1'::uuid and people_count = 1
     from public.tip_distributions where id = :'h_d1'),
  'H8  …and the draft is exactly as the engine left it');

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.send_distribution(:'h_d1');
commit;
select tests.ok(
  (select status = 'sent' and sent_at is not null from public.tip_distributions where id = :'h_d1'),
  'H9  send_distribution() still publishes: status sent, sent_at written');
select tests.ok(
  (select status = 'distributed' from public.tip_pools where id = :'h_pool1'),
  'H10 …and it is the engine that moves the pool to distributed');

-- Night 2: the draft that will be discarded, and the negative controls' subject.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.hard_night(:'hw', :'h_boss', :'h_staff', :'h_service', :'h_server', '2022-03-06') as h_pool2 \gset
  select public.calculate_distribution(:'h_pool2') as h_d2 \gset
commit;

-- Negative controls. Migration 33 refuses the PATCH three times over: the
-- guard trigger, the dropped policy, the revoked privilege. Each control puts
-- the other two layers back and shows which one is biting.
begin;
  alter table public.tip_distributions disable trigger tip_distributions_client_guard;
  grant update on public.tip_distributions to authenticated;
  create policy nc_open on public.tip_distributions for update to authenticated
    using (true) with check (true);
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.rows_changed(format(
    'update public.tip_distributions set people_count = people_count where id = %L', :'h_d2')) as nc1 \gset
rollback;
select tests.ok(:'nc1'::int = 1,
  'NC1 guard off, privilege and a policy back: the PATCH goes through — nothing else was stopping it');

begin;
  grant update on public.tip_distributions to authenticated;
  create policy nc_open on public.tip_distributions for update to authenticated
    using (true) with check (true);
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.rows_changed(format(
    'update public.tip_distributions set people_count = people_count where id = %L', :'h_d2')) as nc2 \gset
rollback;
select tests.ok(:'nc2'::int = -1,
  'NC2 guard on, privilege and policy back: still refused — the trigger bites on its own');

select tests.ok(
  not exists (select 1 from pg_policies where tablename = 'tip_distributions' and cmd = 'UPDATE'),
  'NC3 …and outside the controls no UPDATE policy exists on tip_distributions at all');
select tests.ok(
  not has_table_privilege('authenticated', 'public.tip_distributions', 'UPDATE'),
  'NC4 …and authenticated holds no UPDATE privilege on it');

-- ═════════════════════════════════════════════════════════════════════════════
-- B · a client cannot move a pool
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.tip_pools set status = ''locked'' where id = %L', :'h_pool_m'),
    'H11 a manager cannot PATCH an open pool to locked');
  select tests.denied(format(
    'update public.tip_pools set status = ''open'' where id = %L', :'h_pool2'),
    'H12 …nor reopen a locked one');
  select tests.denied(format(
    'update public.tip_pools set status = ''void'' where id = %L', :'h_pool1'),
    'H13 …nor void a distributed one');
  select tests.denied(format(
    'update public.tip_pools set locked_at = now() where id = %L', :'h_pool_m'),
    'H14 …nor forge locked_at');
  select tests.denied(format(
    'update public.tip_pools set period_start = ''2022-04-02'', period_end = ''2022-04-02'' where id = %L', :'h_pool_m'),
    'H15 …nor move its period');
  select tests.denied(format(
    'update public.tip_pools set card_cents = 1 where id = %L', :'h_pool2'),
    'H16 …nor change a locked pool''s amounts (migration 10, still armed)');
  select tests.denied(format(
    'update public.tip_pools set label = ''history rewritten'' where id = %L', :'h_pool1'),
    'H17 …nor relabel a distributed pool');
  select tests.rows_changed(format(
    'update public.tip_pools set label = ''renamed'', note = ''fine'' where id = %L', :'h_pool_m')) as h_lbl \gset
  select tests.rows_changed(format(
    'update public.tip_pools set card_cents = 1500 where id = %L', :'h_pool_m')) as h_amt \gset
  select tests.denied(format($q$
    insert into public.tip_pools
      (workplace_id, period, period_start, period_end, card_cents, cash_cents, source, status, created_by)
    values (%L, 'day', '2022-04-03', '2022-04-03', 1, 1, 'manual', 'locked', %L)$q$, :'hw', :'h_boss'),
    'H18 a pool cannot be opened already locked');
  select tests.denied(format($q$
    insert into public.tip_pools
      (workplace_id, period, period_start, period_end, card_cents, cash_cents, source, status, created_by)
    values (%L, 'day', '2022-04-04', '2022-04-04', 1, 1, 'staff_reports', 'open', %L)$q$, :'hw', :'h_boss'),
    'H19 …nor claim to be from reports without create_pool_from_reports()');
commit;
select tests.ok(:'h_lbl'::int = 1, 'H20 label and note of an open pool stay editable');
select tests.ok(:'h_amt'::int = 1
  and (select total_cents from public.tip_pools where id = :'h_pool_m') = 3500,
  'H21 …and so do an open pool''s amounts');

begin;
  alter table public.tip_pools disable trigger tip_pools_lifecycle_guard;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.rows_changed(format(
    'update public.tip_pools set status = ''open'' where id = %L', :'h_pool2')) as nc5 \gset
rollback;
select tests.ok(:'nc5'::int = 1,
  'NC5 with the pool guard off, the manager reopens the locked pool — the guard is what stops it');

-- ═════════════════════════════════════════════════════════════════════════════
-- C · void_pool
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool2'),
    'H22 a pool with a draft cannot be voided; the draft is discarded first');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool_m'),
    'H23 an employee cannot void a pool');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool_m'),
    'H24 …nor a manager of another workplace');
commit;
begin;
  select set_config('role', 'anon', true);
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool_m'),
    'H25 …nor an anonymous caller');
rollback;

select count(*) as h_src_before from public.tip_pool_sources where pool_id = :'h_pool2' \gset
select tests.ok(:'h_src_before'::int = 1, 'H26 the report behind night 2 is reserved by its pool');

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  delete from public.tip_distributions where id = :'h_d2';
  select public.void_pool(:'h_pool2', '  Wrong total.  ');
commit;
select tests.ok(
  (select status = 'void' and total_cents = 50000 from public.tip_pools where id = :'h_pool2'),
  'H27 discard the draft, then void: the pool is void and its amounts untouched');
select tests.ok(
  (select count(*) from public.tip_pool_sources where pool_id = :'h_pool2') = 0,
  'H28 …and the report is released');
select tests.ok(
  (select count(*) from public.audit_log
    where table_name = 'tip_pools' and record_id = :'h_pool2'::uuid and action = 'update'
      and (after ->> 'status') = 'void' and reason = 'Wrong total.') = 1,
  'H29 …with the decision and its trimmed reason on the audit trail');

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.create_pool_from_reports(:'hw', '2022-03-06', '2022-03-06') as h_pool2b \gset
  select public.calculate_distribution(:'h_pool2b') as h_d2b \gset
commit;
select tests.ok(
  (select total_cents = 50000 and status = 'locked' from public.tip_pools where id = :'h_pool2b'),
  'H30 the same report funds a fresh pool, which calculates again');

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.void_pool(:'h_pool_m');
  select tests.rows_changed(format('select public.void_pool(%L)', :'h_pool_m')) as h_again \gset
commit;
select tests.ok(
  (select status = 'void' from public.tip_pools where id = :'h_pool_m'),
  'H31 an open manual pool with nothing on it voids');
select tests.ok(:'h_again'::int >= 0, 'H32 …and voiding it again is a quiet no-op, so a retry is safe');

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool1'),
    'H33 a distributed pool cannot be voided');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool2b'),
    'H34 …nor the pool whose fresh draft is waiting');
commit;

-- Night 3: sent and then confirmed by the only person in it.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.hard_night(:'hw', :'h_boss', :'h_staff', :'h_service', :'h_server', '2022-03-07') as h_pool3 \gset
  select public.calculate_distribution(:'h_pool3') as h_d3 \gset
  select public.send_distribution(:'h_d3');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'h_d3', 'acknowledged');
commit;
select tests.ok(
  (select status = 'confirmed' from public.tip_distributions where id = :'h_d3'),
  'H35 night 3 is confirmed');
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool3'),
    'H36 a confirmed pool cannot be voided');
commit;

-- Night 4: sent, then cancelled without a replacement — published history.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.hard_night(:'hw', :'h_boss', :'h_staff', :'h_service', :'h_server', '2022-03-08') as h_pool4 \gset
  select public.calculate_distribution(:'h_pool4') as h_d4 \gset
  select public.send_distribution(:'h_d4');
  select public.cancel_distribution(:'h_d4', 'Redoing it.');
commit;
select tests.ok(
  (select status = 'cancelled' and sent_at is not null from public.tip_distributions where id = :'h_d4')
  and (select status = 'locked' from public.tip_pools where id = :'h_pool4'),
  'H37 cancelling a sent distribution keeps sent_at and locks the pool');
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.void_pool(%L, ''x'')', :'h_pool4'),
    'H38 a pool whose distribution was published, then cancelled, cannot be voided');
commit;
-- Same pool, same status, no draft: the only difference is the cancelled
-- row's sent_at. Clear it (as the owner, which nothing in the product does)
-- and the void goes through — the publication check is what refused it.
begin;
  update public.tip_distributions set sent_at = null where id = :'h_d4';
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.rows_changed(format('select public.void_pool(%L)', :'h_pool4')) as nc6 \gset
rollback;
select tests.ok(:'nc6'::int >= 0,
  'NC6 with the cancelled row''s sent_at cleared, the same void succeeds — publication evidence is the gate');

-- ═════════════════════════════════════════════════════════════════════════════
-- D · publication is sent_at
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select count(*) as h_see1 from public.member_distributions where id = :'h_d1' \gset
  select count(*) as h_see3 from public.member_distributions where id = :'h_d3' \gset
  select count(*) as h_see4 from public.member_distributions where id = :'h_d4' and sent_at is not null \gset
  select count(*) as h_see2b from public.member_distributions where id = :'h_d2b' \gset
commit;
select tests.ok(:'h_see1'::int = 1, 'H39 the employee sees the sent night');
select tests.ok(:'h_see3'::int = 1, 'H40 …and the confirmed one');
select tests.ok(:'h_see4'::int = 1, 'H41 …and the one cancelled after it was sent, sent_at and all');
select tests.ok(:'h_see2b'::int = 0, 'H42 …and never a draft');

-- Night 5: A <- B <- C.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.hard_night(:'hw', :'h_boss', :'h_staff', :'h_service', :'h_server', '2022-03-09') as h_pool5 \gset
  select public.calculate_distribution(:'h_pool5') as h_a \gset
  select public.send_distribution(:'h_a');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'h_a', 'hours', 'A shift was missing.') as h_b \gset
  select public.send_distribution(:'h_b');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'h_b', 'hours', 'And another.') as h_c \gset
  select public.send_distribution(:'h_c');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select count(*) as h_chain from public.member_distributions where id in (:'h_a', :'h_b', :'h_c') \gset
  select superseded_by as h_a_sup from public.member_distributions where id = :'h_a' \gset
  select superseded_by as h_b_sup from public.member_distributions where id = :'h_b' \gset
  select coalesce(superseded_by::text, 'none') as h_c_sup from public.member_distributions where id = :'h_c' \gset
commit;
select tests.ok(:'h_chain'::int = 3, 'H43 all three links of A <- B <- C stay visible');
select tests.ok(:'h_a_sup' = :'h_b' and :'h_b_sup' = :'h_c' and :'h_c_sup' = 'none',
  'H44 …and the chain is walked A -> B -> C, with C current');

-- Night 6: a row that left draft without ever being sent. Nothing in the
-- product can make one any more; the owner makes one here to prove the
-- projection would hide it.
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.hard_night(:'hw', :'h_boss', :'h_staff', :'h_service', :'h_server', '2022-03-10') as h_pool6 \gset
  select public.calculate_distribution(:'h_pool6') as h_d6 \gset
commit;
update public.tip_distributions set status = 'cancelled', cancelled_at = now() where id = :'h_d6';

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select count(*) as h_ghost from public.member_distributions where id = :'h_d6' \gset
  select count(*) as h_ghost_e from public.member_distribution_entries where distribution_id = :'h_d6' \gset
  select app.distribution_is_published(:'h_d6') as h_pub6 \gset
  select app.distribution_is_published(:'h_d1') as h_pub1 \gset
commit;
select tests.ok(:'h_ghost'::int = 0, 'H45 a never-sent cancelled row is invisible to the employee');
select tests.ok(:'h_ghost_e'::int = 0, 'H46 …and so are its entries');
select tests.ok(not :'h_pub6'::boolean and :'h_pub1'::boolean,
  'H47 app.distribution_is_published() says no to it and yes to the sent one');

begin;
  update public.tip_distributions set sent_at = now() where id = :'h_d6';
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select count(*) as nc7 from public.member_distributions where id = :'h_d6' \gset
  select count(*) as nc7e from public.member_distribution_entries where distribution_id = :'h_d6' \gset
rollback;
select tests.ok(:'nc7'::int = 1 and :'nc7e'::int = 1,
  'NC7 give that row a sent_at and it appears — sent_at is the predicate, not the status');

-- ═════════════════════════════════════════════════════════════════════════════
-- E · cancel_distribution
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.cancel_distribution(%L, ''x'')', :'h_d2b'),
    'H48 a draft cannot be cancelled; it is discarded or recalculated');
  select tests.rows_changed(format('select public.cancel_distribution(%L, ''again'')', :'h_d4')) as h_recancel \gset
commit;
select tests.ok(
  (select status = 'draft' and sent_at is null from public.tip_distributions where id = :'h_d2b'),
  'H49 …and the draft is still a draft');
select tests.ok(:'h_recancel'::int >= 0
  and (select status = 'cancelled' and sent_at is not null and cancel_reason = 'Redoing it.'
         from public.tip_distributions where id = :'h_d4'),
  'H50 cancelling a cancelled distribution again is a quiet no-op that changes nothing');

-- ═════════════════════════════════════════════════════════════════════════════
-- F · the server's business day
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  select public.current_business_day(:'hw') as bd_boss \gset
  select (public.current_business_day(:'hw') = app.business_day(now(), :'hw')) as bd_same \gset
  select app.is_trusted_context() as h_trusted_client \gset
  -- The trusted context is WHO the caller is (the table owner), never a
  -- setting. A client may write any app.* setting it likes; none of them
  -- count. (SET ROLE back to the owner is refused under PostgREST, whose
  -- session user is `authenticator`; this harness runs as a superuser, so
  -- that refusal cannot be modelled here and is not asserted.)
  select set_config('app.audit_reason', 'forged', true);
  select set_config('app.trusted', 'true', true);
  select set_config('app.is_trusted_context', 'true', true);
  select app.is_trusted_context() as h_trusted_spoof \gset
commit;
select tests.ok(not :'h_trusted_spoof'::boolean,
  'H51 no setting a client can write makes it the trusted context');
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select public.current_business_day(:'hw') as bd_staff \gset
  select tests.denied(format('select public.current_business_day(%L)', :'hx'),
    'H52 an employee is refused another workplace''s business day');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.current_business_day(%L)', :'hw'),
    'H53 …and so is a manager of another workplace');
commit;
begin;
  select set_config('role', 'anon', true);
  select tests.denied(format('select public.current_business_day(%L)', :'hw'),
    'H54 …and an anonymous caller');
rollback;

select tests.ok(:'bd_boss' is not null and :'bd_boss' = :'bd_staff',
  'H55 the manager and the employee receive the same server date');
select tests.ok(:'bd_same'::boolean,
  'H56 …which is app.business_day(now(), workplace), the definition shifts are filed under');
select tests.ok(not :'h_trusted_client'::boolean and app.is_trusted_context(),
  'H57 the trusted context is the owner and never a client');

begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'h_staff';
  update public.workplace_members set status = 'left', left_at = now() where id = :'h_gone';
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.current_business_day(%L)', :'hw'),
    'H58 a suspended member is refused');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000004');
  select tests.denied(format('select public.current_business_day(%L)', :'hw'),
    'H59 …and so is one who has left');
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'h_staff';
commit;
begin;
  select tests.as_user('a1300000-0000-0000-0000-000000000002');
  select public.current_business_day(:'hw') as bd_back \gset
commit;
select tests.ok(:'bd_back' = :'bd_boss',
  'NC8 reactivated, the same member is answered again — membership status is the gate');
