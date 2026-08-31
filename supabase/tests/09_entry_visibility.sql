-- ─────────────────────────────────────────────────────────────────────────────
-- Distribution-entry visibility, end to end.
--
-- The live run reported two failures here: one "foreign entry" readable by an
-- employee, and one entry still readable after that employee was suspended.
-- Both are asserted below, in the two shapes that matter:
--
--   * within one workplace, which is what the policy governs, and
--   * across two workplaces the same person belongs to, which is what an
--     unfiltered `select * from member_distribution_entries` actually returns.
--
-- The rule this file pins down: current membership status controls financial
-- access, per workplace. Suspended in a workplace → nothing from that
-- workplace. Active in another → that workplace's own rows, and only those.
-- ─────────────────────────────────────────────────────────────────────────────

grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'vis.boss@test.local'),
  ('c1000000-0000-0000-0000-000000000002', 'vis.staff@test.local'),
  ('c1000000-0000-0000-0000-000000000003', 'vis.otherboss@test.local')
on conflict do nothing;

-- ── workplace V ─────────────────────────────────────────────────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  select public.create_workplace('Visibility Lab', 'Marburg') as vw \gset
commit;

select id as v_service from public.workplace_areas where workplace_id = :'vw' and key = 'service' \gset
select id as v_bar     from public.workplace_areas where workplace_id = :'vw' and key = 'bar' \gset
select id as v_server  from public.workplace_roles where workplace_id = :'vw' and key = 'server' \gset
select id as v_keep    from public.workplace_roles where workplace_id = :'vw' and key = 'bartender' \gset
select id as v_mgr     from public.workplace_members where workplace_id = :'vw' and role = 'manager' \gset

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'v_service', workplace_role_id = :'v_server'
    where id = :'v_mgr';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'vw', 'Eva',  'employee', :'v_service', :'v_server', 'active') returning id as v_e1 \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'vw', 'Finn', 'employee', :'v_service', :'v_server', 'active') returning id as v_e2 \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'vw', 'Gita', 'employee', :'v_bar',     :'v_keep',   'active') returning id as v_e3 \gset
commit;

update public.workplace_members set user_id = 'c1000000-0000-0000-0000-000000000002' where id = :'v_e1';

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  select id as v_rule from public.distribution_rules where workplace_id = :'vw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours', min_overlap_minutes = 15, overlap_basis = 'longest_shift' where id = :'v_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'v_rule' and area_id = :'v_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'v_rule' and area_id = :'v_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'v_rule' and area_id not in (:'v_service', :'v_bar');
  select public.activate_rule(:'v_rule');

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'vw', :'v_e1', '2019-06-01 18:00Z', '2019-06-01 22:00Z', 0, 'approved'),
         (:'vw', :'v_e2', '2019-06-01 18:00Z', '2019-06-01 22:00Z', 0, 'approved'),
         (:'vw', :'v_e3', '2019-06-01 18:00Z', '2019-06-01 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'vw', 'day', '2019-06-01', '2019-06-01', 'visibility', 10000, :'v_mgr') returning id as v_pool \gset
  select public.calculate_distribution(:'v_pool') as v_dist \gset
  select public.send_distribution(:'v_dist');
commit;

select id as v_entry1 from public.tip_distribution_entries
  where distribution_id = :'v_dist' and member_id = :'v_e1' \gset

-- ── 1 · an active employee sees their own entry ─────────────────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select count(*) as t1_own from public.member_distribution_entries
    where workplace_id = :'vw' and member_id = :'v_e1' \gset
  select count(*) as t1_all from public.member_distribution_entries where workplace_id = :'vw' \gset
commit;

select tests.ok(:'t1_own'::int = 1, 'V1  an active employee reads their own entry');

-- ── 2 · …and no peer entry while peer visibility is off ─────────────────────
select tests.ok(:'t1_all'::int = 1,
  'V2  …and nothing else in that workplace — peer_entry_visibility is none by default');

-- ── 3 · peer visibility = area ──────────────────────────────────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  update public.workplaces set peer_entry_visibility = 'area' where id = :'vw';
commit;
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select count(*) filter (where member_id = :'v_e2') as t3_same,
         count(*) filter (where member_id = :'v_e3') as t3_other
    from public.member_distribution_entries where workplace_id = :'vw' \gset
commit;

select tests.ok(:'t3_same'::int = 1 and :'t3_other'::int = 0,
  'V3  peer_entry_visibility = area shows the colleague in the same area and not the one in Bar');

-- ── 4 · peer visibility = workplace ─────────────────────────────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  update public.workplaces set peer_entry_visibility = 'workplace' where id = :'vw';
commit;
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select count(*) as t4 from public.member_distribution_entries where workplace_id = :'vw' \gset
commit;

select tests.ok(:'t4'::int = 3, 'V4  peer_entry_visibility = workplace shows all three');

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  update public.workplaces set peer_entry_visibility = 'none' where id = :'vw';
commit;

-- ── 8 · the manager sees every entry in the workplace they manage ───────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  select count(*) as t8 from public.tip_distribution_entries where workplace_id = :'vw' \gset
commit;
select tests.ok(:'t8'::int = 3, 'V5  the manager reads every entry in their own workplace');

-- ── 9 · a manager of a different workplace sees none of them ────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000003');
  select public.create_workplace('Second Job', 'Kassel') as ww \gset
commit;
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000003');
  select count(*) as t9 from public.tip_distribution_entries where workplace_id = :'vw' \gset
commit;
select tests.ok(:'t9'::int = 0, 'V6  a manager of another workplace reads none of them');

-- ── 10 · no session at all ──────────────────────────────────────────────────
begin;
  select set_config('role', 'anon', true);
  do $do$
  declare v_ok boolean := false; v_n integer;
  begin
    begin
      select count(*) into v_n from public.member_distribution_entries;
      v_ok := (v_n = 0);
    exception when others then
      v_ok := true;   -- no privilege at all is the stronger outcome
    end;
    perform tests.ok(v_ok, 'V7  without a session the entries are unreachable');
  end
  $do$;
commit;

-- ── the same person, a second workplace ─────────────────────────────────────
select id as w_mgr from public.workplace_members where workplace_id = :'ww' and role = 'manager' \gset
select id as w_service from public.workplace_areas where workplace_id = :'ww' and key = 'service' \gset
select id as w_server  from public.workplace_roles where workplace_id = :'ww' and key = 'server' \gset

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000003');
  update public.workplace_members set area_id = :'w_service', workplace_role_id = :'w_server'
    where id = :'w_mgr';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'ww', 'Eva', 'employee', :'w_service', :'w_server', 'active') returning id as w_e1 \gset
commit;

update public.workplace_members set user_id = 'c1000000-0000-0000-0000-000000000002' where id = :'w_e1';

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000003');
  select id as w_rule from public.distribution_rules where workplace_id = :'ww' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours', min_overlap_minutes = 15 where id = :'w_rule';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'w_rule' and area_id = :'w_service';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'w_rule' and area_id <> :'w_service';
  select public.activate_rule(:'w_rule');

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'ww', :'w_e1', '2019-06-02 18:00Z', '2019-06-02 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'ww', 'day', '2019-06-02', '2019-06-02', 'second job', 4000, :'w_mgr') returning id as w_pool \gset
  select public.calculate_distribution(:'w_pool') as w_dist \gset
  select public.send_distribution(:'w_dist');
commit;

-- ── 5, 6, 7 · suspended in workplace V ──────────────────────────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'v_e1';
commit;

select tests.ok(
  (select status from public.workplace_members where id = :'v_e1') = 'suspended',
  'V8  the suspension really took');

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select count(*) as t5 from public.member_distribution_entries where workplace_id = :'vw' \gset
  select count(*) as t6 from public.member_distributions where workplace_id = :'vw' \gset
  select count(*) as t6b from public.tip_distribution_areas where workplace_id = :'vw' \gset
commit;

select tests.ok(:'t5'::int = 0, 'V9  a suspended member reads no entry from that workplace');
select tests.ok(:'t6'::int = 0, 'V10 …no distribution summary either');
select tests.ok(:'t6b'::int = 0, 'V11 …and no area subtotals');

begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_entry(%L, ''acknowledged'')', :'v_entry1'),
    'V12 …and cannot acknowledge the entry');
commit;

-- ── the live symptom, reproduced exactly ────────────────────────────────────
-- Suspended in V, still active in W. An unfiltered read returns W's row — and
-- its member_id is W's membership, not V's. A test that compares every row's
-- member_id against ONE workplace's membership id counts that as foreign.
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select count(*) as tx_all from public.member_distribution_entries \gset
  select count(*) filter (where member_id <> :'v_e1') as tx_foreign,
         count(*) filter (where is_own) as tx_own
    from public.member_distribution_entries \gset
commit;

select tests.ok(:'tx_all'::int = 1,
  'V13 an unfiltered read still returns the other workplace''s row — one entry, exactly as the live run reported');
select tests.ok(:'tx_foreign'::int = 1,
  'V14 …whose member_id is that workplace''s membership, so a single-workplace comparison calls it foreign');
select tests.ok(:'tx_own'::int = 1,
  'V15 …while is_own is true for it, which is the test the policy actually supports');

-- ── restored ────────────────────────────────────────────────────────────────
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'v_e1';
commit;
begin;
  select tests.as_user('c1000000-0000-0000-0000-000000000002');
  select count(*) as t14 from public.member_distribution_entries where workplace_id = :'vw' \gset
commit;
select tests.ok(:'t14'::int = 1, 'V16 reinstating the membership restores exactly the own entry');
