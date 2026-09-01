-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3E · the rules editor: versioning, permissions and tenancy.
--
-- Thirteen security questions from the phase brief, plus the draft lifecycle
-- the editor depends on and the three tenancy holes migration 18 closes.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'rules.boss@test.local'),
  ('b1000000-0000-0000-0000-000000000002', 'rules.staff@test.local'),
  ('b1000000-0000-0000-0000-000000000003', 'rules.rival@test.local')
on conflict do nothing;

begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select public.create_workplace('Rules Lab', 'Marburg') as rw \gset
commit;
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000003');
  select public.create_workplace('Rival Bar', 'Kassel') as xw \gset
commit;

select id as r_service from public.workplace_areas where workplace_id = :'rw' and key = 'service' \gset
select id as r_bar     from public.workplace_areas where workplace_id = :'rw' and key = 'bar' \gset
select id as r_server  from public.workplace_roles where workplace_id = :'rw' and key = 'server' \gset
select id as r_senior  from public.workplace_roles where workplace_id = :'rw' and key = 'senior_server' \gset
select id as r_mgr     from public.workplace_members where workplace_id = :'rw' and role = 'manager' \gset
select id as x_service from public.workplace_areas where workplace_id = :'xw' and key = 'service' \gset
select id as x_server  from public.workplace_roles where workplace_id = :'xw' and key = 'server' \gset

begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'r_service', workplace_role_id = :'r_server'
    where id = :'r_mgr';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'rw', 'Sam', 'employee', :'r_service', :'r_server', 'active') returning id as r_emp \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'rw', 'Tao', 'employee', :'r_service', :'r_server', 'active') returning id as r_emp2 \gset
commit;
update public.workplace_members set user_id = 'b1000000-0000-0000-0000-000000000002' where id = :'r_emp';

-- ── the draft lifecycle the editor relies on ────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'rw') as rd1 \gset
  select public.create_rule_draft(:'rw') as rd2 \gset
commit;

select tests.ok(:'rd1' = :'rd2',
  'E1  create_rule_draft() is idempotent — a second call returns the same draft, never a duplicate');

select tests.ok(
  (select count(*) from public.distribution_rules where workplace_id = :'rw' and status = 'draft') = 1,
  'E2  …and the workplace still has exactly one draft');

select tests.ok(
  (select count(*) from public.distribution_rule_areas where rule_id = :'rd1')
    = (select count(*) from public.workplace_areas
       where workplace_id = :'rw' and archived_at is null and is_pool_eligible),
  'E3  …seeded with a share row for every pool-eligible area of this workplace');

-- ── 1 · an employee cannot create a draft ───────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.create_rule_draft(%L)', :'rw'),
    'E4  an employee cannot create a rule draft');
commit;

-- ── 3 · an employee cannot edit area shares ─────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(
    format('update public.distribution_rule_areas set percentage = 100 where rule_id = %L', :'rd1'),
    'E5  an employee cannot change an area share');
  select tests.denied(
    format('insert into public.distribution_rule_areas (rule_id, workplace_id, area_id, area_key, percentage)
            values (%L, %L, %L, ''service'', 100)', :'rd1', :'rw', :'r_service'),
    'E6  …nor add one');
commit;

-- ── 4 · an employee cannot edit role points ─────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(
    format('update public.workplace_roles set points = 5 where id = %L', :'r_server'),
    'E7  an employee cannot change a role''s points');
commit;
select tests.ok((select points from public.workplace_roles where id = :'r_server') = 1.00,
  'E8  …and the points are untouched');

-- ── 5 · an employee cannot edit workplace settings ──────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(
    format('update public.workplaces set peer_entry_visibility = ''workplace'',
            pool_amount_visible_to_members = true, business_day_start_hour = 0,
            timezone = ''UTC'' where id = %L', :'rw'),
    'E9  an employee cannot change the workplace settings');
commit;
select tests.ok(
  (select peer_entry_visibility = 'none' and not pool_amount_visible_to_members
          and business_day_start_hour = 5 and timezone = 'Europe/Berlin'
   from public.workplaces where id = :'rw'),
  'E10 …and every one of them still holds its default');

-- ── 6 · the manager can edit their own workplace ────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  update public.workplaces
    set peer_entry_visibility = 'area', pool_amount_visible_to_members = true,
        business_day_start_hour = 4, timezone = 'Europe/Vienna'
    where id = :'rw';
commit;
select tests.ok(
  (select peer_entry_visibility = 'area' and pool_amount_visible_to_members
          and business_day_start_hour = 4 and timezone = 'Europe/Vienna'
   from public.workplaces where id = :'rw'),
  'E11 the manager can change timezone, business-day start and both visibility settings');

-- Back to the defaults the rest of this file assumes.
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  update public.workplaces
    set peer_entry_visibility = 'none', pool_amount_visible_to_members = false,
        business_day_start_hour = 5, timezone = 'Europe/Berlin'
    where id = :'rw';
commit;

-- ── 7 · …and not somebody else's ────────────────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select tests.changes_nothing(
    format('update public.workplaces set timezone = ''UTC'' where id = %L', :'xw'),
    'E12 a manager cannot change another workplace''s settings');
  select tests.denied(format('select public.create_rule_draft(%L)', :'xw'),
    'E13 …nor open a draft there');
commit;

-- ── 9 · the shares must total 100 ───────────────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'rd1' and area_id = :'r_service';
  update public.distribution_rule_areas set percentage = 0  where rule_id = :'rd1' and area_id <> :'r_service';
  select tests.denied(format('select public.activate_rule(%L)', :'rd1'),
    'E14 a draft whose shares do not total 100%% cannot be activated');
commit;

select tests.ok((select status from public.distribution_rules where id = :'rd1') = 'draft',
  'E15 …and the draft is still a draft afterwards, so the manager can fix it');

-- ── 8 · an overlap model the engine does not implement ──────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'rd1' and area_id = :'r_service';
  update public.distribution_rules set overlap_basis = 'service_window' where id = :'rd1';
  select tests.denied(format('select public.activate_rule(%L)', :'rd1'),
    'E16 a draft on service_window cannot be activated');
  update public.distribution_rules set overlap_basis = 'pairwise', method = 'hours',
         min_overlap_minutes = 15 where id = :'rd1';
  select public.activate_rule(:'rd1') as rv1 \gset
commit;

select tests.ok(:'rv1'::int = 1, 'E17 …while pairwise activates, and becomes version 1');
select tests.ok((select status from public.distribution_rules where id = :'rd1') = 'active',
  'E18 …and the draft is now the active rule');

-- ── 10, 11 · cross-workplace ids (migration 18) ─────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'rw') as rd2b \gset
  select tests.denied(
    format('insert into public.distribution_rule_areas (rule_id, workplace_id, area_id, area_key, percentage)
            values (%L, %L, %L, ''service'', 10)', :'rd2b', :'rw', :'x_service'),
    'E19 a share cannot name an area of another workplace');
  select tests.denied(
    format('insert into public.distribution_rule_roles (rule_id, workplace_id, workplace_role_id, role_key, points)
            values (%L, %L, %L, ''server'', 2)', :'rd2b', :'rw', :'x_server'),
    'E20 a rule role cannot name a role of another workplace');
  select tests.denied(
    format('update public.distribution_rules set rounding_area_id = %L where id = %L', :'x_service', :'rd2b'),
    'E21 the rounding area cannot be another workplace''s area');
  update public.distribution_rules set rounding_area_id = :'r_bar' where id = :'rd2b';
commit;
select tests.ok((select rounding_area_id from public.distribution_rules where id = :'rd2b') = :'r_bar'::uuid,
  'E22 …while its own area is accepted');

-- The injection shape: a manager of one workplace writing into another's draft.
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000003');
  select public.create_rule_draft(:'xw') as xd \gset
commit;
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('insert into public.distribution_rule_areas (rule_id, workplace_id, area_id, area_key, percentage)
            values (%L, %L, %L, ''service'', 100)', :'xd', :'rw', :'r_service'),
    'E24 a manager cannot inject a share row into another workplace''s draft');
commit;

-- ── 12 · the active rule cannot be edited in place ──────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select tests.changes_nothing(
    format('update public.distribution_rules set min_overlap_minutes = 240 where id = %L', :'rd1'),
    'E25 the active rule cannot be edited in place');
  select tests.denied(
    format('update public.distribution_rule_areas set percentage = 50 where rule_id = %L', :'rd1'),
    'E26 …nor can its area shares');
commit;
select tests.ok((select min_overlap_minutes from public.distribution_rules where id = :'rd1') = 15,
  'E27 …and it still reads exactly as it was activated');

-- ── 2 · an employee cannot activate ─────────────────────────────────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.activate_rule(%L)', :'rd2b'),
    'E28 an employee cannot activate a rule');
commit;

-- ── role points are frozen by activation ────────────────────────────────────
select tests.ok(
  (select points from public.distribution_rule_roles
   where rule_id = :'rd1' and workplace_role_id = :'r_server') = 1.00,
  'E29 activation froze the role points onto the rule version');

begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  update public.workplace_roles set points = 3.00 where id = :'r_server';
commit;

select tests.ok(
  (select points from public.distribution_rule_roles
   where rule_id = :'rd1' and workplace_role_id = :'r_server') = 1.00,
  'E30 …and editing the role definition afterwards does not move the active version''s copy');

-- ── 13 · a sent distribution is untouched by a new rule version ─────────────
begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'rw', :'r_emp',  '2019-07-01 18:00Z', '2019-07-01 22:00Z', 0, 'approved'),
         (:'rw', :'r_emp2', '2019-07-01 18:00Z', '2019-07-01 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'rw', 'day', '2019-07-01', '2019-07-01', 'rules', 10000, :'r_mgr') returning id as r_pool \gset
  select public.calculate_distribution(:'r_pool') as r_dist \gset
  select public.send_distribution(:'r_dist');
commit;

select md5(string_agg(amount_cents::text || ':' || points::text, '|' order by id::text)) as before_hash
  from public.tip_distribution_entries where distribution_id = :'r_dist' \gset
select rule_version as before_version from public.tip_distributions where id = :'r_dist' \gset

begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select id as rd3 from public.distribution_rules where workplace_id = :'rw' and status = 'draft' \gset
  update public.distribution_rules set method = 'equal', min_overlap_minutes = 90,
         overlap_basis = 'longest_shift' where id = :'rd3';
  update public.distribution_rule_areas set percentage = 50 where rule_id = :'rd3' and area_id = :'r_service';
  update public.distribution_rule_areas set percentage = 50 where rule_id = :'rd3' and area_id = :'r_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'rd3' and area_id not in (:'r_service', :'r_bar');
  select public.activate_rule(:'rd3') as rv2 \gset
commit;

select tests.ok(:'rv2'::int = 2, 'E31 activating again produces version 2');
select tests.ok((select status from public.distribution_rules where id = :'rd1') = 'superseded',
  'E32 …and version 1 becomes superseded, not deleted');
select tests.ok(
  (select count(*) from public.distribution_rules where workplace_id = :'rw' and status = 'active') = 1,
  'E33 …with exactly one active rule at any moment');

select md5(string_agg(amount_cents::text || ':' || points::text, '|' order by id::text)) as after_hash
  from public.tip_distribution_entries where distribution_id = :'r_dist' \gset
select rule_version as after_version from public.tip_distributions where id = :'r_dist' \gset

select tests.ok(:'before_hash' = :'after_hash',
  'E34 the sent distribution''s entries are byte-identical after the new version');
select tests.ok(:'before_version' = :'after_version',
  'E35 …and it still records the version it was calculated under');

-- ── the 0%-share warning premise, from real data ────────────────────────────
-- Version 2 gives Bar 50%, and nobody works in Bar; version 2 also leaves no
-- area at 0%. Move someone to a zero-share area and the premise becomes true.
select tests.ok(
  (select count(*) from public.distribution_rules where workplace_id = :'rw' and status = 'draft') = 0,
  'E36 activating leaves no stray draft behind');

select tests.ok(
  (select count(*) from public.workplace_members m
   join public.distribution_rule_areas ra
     on ra.area_id = m.area_id and ra.rule_id = :'rd3'
   where m.workplace_id = :'rw' and m.status = 'active' and ra.percentage = 0) = 0,
  'E37 with Service and Bar both funded, nobody sits in a 0%% area');

begin;
  select tests.as_user('b1000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'rw') as rd5 \gset
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'rd5' and area_id = :'r_bar';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'rd5' and area_id <> :'r_bar';
commit;

select tests.ok(
  (select count(*) from public.workplace_members m
   join public.distribution_rule_areas ra
     on ra.area_id = m.area_id and ra.rule_id = :'rd5'
   where m.workplace_id = :'rw' and m.status = 'active' and ra.percentage = 0) = 3,
  'E38 …and a draft that funds only Bar strands all three Service people — the warning''s premise');

-- clean up the draft so later files see a settled workplace
delete from public.distribution_rule_areas where rule_id = :'rd5';
delete from public.distribution_rules where id = :'rd5';
