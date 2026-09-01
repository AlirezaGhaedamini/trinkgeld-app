-- ─────────────────────────────────────────────────────────────────────────────
-- The six live failures from the Phase 3D run, reproduced locally.
--
-- Every scenario below is the live script's own fixture, replayed against the
-- same migrations. The point is to decide, per failure, whether the engine
-- misbehaved or the test did — so each one is asserted twice: once in the shape
-- the live script actually built (reproducing the reported result) and once in
-- the shape the live script *meant* to build (showing the expected result).
--
-- Timestamps are UTC, like the live script. Workplace timezone Europe/Berlin
-- (+02:00 in May) and business_day_start_hour 5 are the seeded defaults, so a
-- shift starting at 07:00Z is 09:00 local and belongs to that same day.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'live.manager@test.local'),
  ('d0000000-0000-0000-0000-000000000002', 'live.bea@test.local')
on conflict do nothing;

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select public.create_workplace('Live Lab', 'Marburg') as lw \gset
commit;

select id as l_service from public.workplace_areas where workplace_id = :'lw' and key = 'service' \gset
select id as l_bar     from public.workplace_areas where workplace_id = :'lw' and key = 'bar' \gset
select id as l_server  from public.workplace_roles where workplace_id = :'lw' and key = 'server' \gset
select id as l_senior  from public.workplace_roles where workplace_id = :'lw' and key = 'senior_server' \gset
select id as l_a       from public.workplace_members where workplace_id = :'lw' and role = 'manager' \gset

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'l_service', workplace_role_id = :'l_server'
    where id = :'l_a';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'lw', 'Bea',  'employee', :'l_service', :'l_server', 'active') returning id as l_b \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'lw', 'Cem',  'employee', :'l_service', :'l_server', 'active') returning id as l_c \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'lw', 'Dora', 'employee', :'l_service', :'l_server', 'active') returning id as l_d \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'lw', 'Emil', 'employee', :'l_service', :'l_server', 'active') returning id as l_e \gset
commit;

-- Bea is a real account, so she can act for herself.
update public.workplace_members set user_id = 'd0000000-0000-0000-0000-000000000002' where id = :'l_b';

-- 100% to Service, hours, 15 minutes, longest_shift — the live script's rule 1.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select id as lr1 from public.distribution_rules where workplace_id = :'lw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours', min_overlap_minutes = 15, overlap_basis = 'longest_shift' where id = :'lr1';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'lr1' and area_id = :'l_service';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'lr1' and area_id <> :'l_service';
  select public.activate_rule(:'lr1');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- FAILURE 8 — "employee cannot boost role points on own shift", PATCH HTTP 200
-- ═════════════════════════════════════════════════════════════════════════════
-- The live script picks the employee's FIRST shift with no ordering. By the
-- time check 8 runs, the only shift Bea has is the one the calculation already
-- locked, and shifts_update's USING clause excludes locked/approved rows for a
-- non-manager. So PostgREST matches nothing, updates nothing, and answers 200.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_a', '2019-05-06 18:00Z', '2019-05-06 22:00Z', 0, 'approved'),
         (:'lw', :'l_b', '2019-05-06 18:00Z', '2019-05-06 22:00Z', 0, 'approved'),
         (:'lw', :'l_c', '2019-05-06 18:00Z', '2019-05-06 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-06', '2019-05-06', 'base', 9000, :'l_a') returning id as lp1 \gset
  select public.calculate_distribution(:'lp1') as ld1 \gset
commit;

select id as l_b_locked from public.shifts
  where member_id = :'l_b' and work_date = '2019-05-06' \gset

select tests.ok(
  (select locked and status = 'approved' from public.shifts where id = :'l_b_locked'),
  'L1  the shift the live script picks for check 8 is approved and locked by then');

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(
    format('update public.shifts set workplace_role_id = %L where id = %L', :'l_senior', :'l_b_locked'),
    'L2  …so the employee''s update matches no row at all — HTTP 200, zero rows changed');
commit;

select tests.ok(
  (select workplace_role_id is null from public.shifts where id = :'l_b_locked'),
  'L3  …and the role on that shift is still unset afterwards — no escalation happened');

-- The guard itself, on a shift the employee CAN reach. This is what check 8
-- was trying to test, and it is refused outright.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_b', '2019-05-04 10:00Z', '2019-05-04 12:00Z', 0, 'submitted')
  returning id as l_b_open \gset
commit;

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000002');
  select tests.denied(
    format('update public.shifts set workplace_role_id = %L where id = %L', :'l_senior', :'l_b_open'),
    'L4  on a shift she can actually reach, the column guard refuses the role outright');
  -- Control: the row really is reachable, so L4 was the guard and not RLS.
  update public.shifts set break_minutes = 5 where id = :'l_b_open';
commit;

select tests.ok(
  (select break_minutes = 5 and workplace_role_id is null from public.shifts where id = :'l_b_open'),
  'L5  …while an ordinary edit to the same row succeeds — the row was reachable');

-- ═════════════════════════════════════════════════════════════════════════════
-- FAILURE 34 — "unsupported overlap model is refused", HTTP 200
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'lw') as lr_pw \gset
  update public.distribution_rules set overlap_basis = 'pairwise', method = 'hours',
         min_overlap_minutes = 15 where id = :'lr_pw';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'lr_pw' and area_id = :'l_service';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'lr_pw' and area_id <> :'l_service';
  select public.activate_rule(:'lr_pw') as lv_pw \gset
commit;

select tests.ok(:'lv_pw'::integer > 0,
  'L6  pairwise activates — migration 16 implements it, so check 34''s old expectation is stale');

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'lw') as lr_sw \gset
  update public.distribution_rules set overlap_basis = 'service_window' where id = :'lr_sw';
  select tests.denied(format('select public.activate_rule(%L)', :'lr_sw'),
    'L7  service_window is still refused — that is the model check 34 should name');
commit;

-- Leave no stray draft behind.
delete from public.distribution_rules where id = :'lr_sw';

-- ═════════════════════════════════════════════════════════════════════════════
-- FAILURE 36 — "pairwise chain B—C is paid", only 1 included
-- ═════════════════════════════════════════════════════════════════════════════
-- The live script's check 28/29/30 moves the employee into Bar to prove that a
-- sent distribution does not move, and never moves her back. Every later
-- scenario runs with her in Bar. Bar's share in the pairwise rule is 0%, and
-- tmp_eligible classifies a zero-share area as 'area_not_in_pool' BEFORE the
-- pairwise branch — so she is dropped, and only her partner is left.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  -- Migration 20 requires the role to belong to the area, so the move clears
  -- it; the engine falls back to the first role of the effective area.
  update public.workplace_members set area_id = :'l_bar', workplace_role_id = null
    where id = :'l_b';   -- the contamination
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_b', '2019-05-08 16:00Z', '2019-05-08 20:00Z', 0, 'approved'),
         (:'lw', :'l_c', '2019-05-08 19:00Z', '2019-05-08 23:00Z', 0, 'approved'),
         (:'lw', :'l_a', '2019-05-08 07:00Z', '2019-05-08 11:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-08', '2019-05-08', 'chain dirty', 9000, :'l_a') returning id as lp2 \gset
  select public.calculate_distribution(:'lp2') as ld2 \gset
commit;

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'ld2') = 1,
  'L8  with the employee left in a 0% area, exactly one person is paid — the live "1 included"');

select tests.ok(
  (select member_id from public.tip_distribution_entries where distribution_id = :'ld2') = :'l_c'::uuid,
  'L9  …and it is her partner, not her');

select tests.ok(
  (select count(*) from public.tip_distributions d,
     lateral jsonb_array_elements(d.inputs_snapshot -> 'shifts') s
   where d.id = :'ld2' and s ->> 'member_id' = :'l_b'
     and s ->> 'eligibility' = 'area_not_in_pool') = 1,
  'L10 …recorded as area_not_in_pool, which is the engine behaving as designed');

select tests.ok(
  (select jsonb_array_length(inputs_snapshot -> 'pairs') from public.tip_distributions where id = :'ld2') = 3,
  'L11 …with all three pairs still in the record, which is why check 37 passed');

-- The same day, with nobody stranded in a zero-share area: a real chain.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'l_service', workplace_role_id = :'l_server'
    where id = :'l_b';  -- the fix
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_b', '2019-05-12 16:00Z', '2019-05-12 20:00Z', 0, 'approved'),
         (:'lw', :'l_c', '2019-05-12 19:00Z', '2019-05-12 23:00Z', 0, 'approved'),
         (:'lw', :'l_d', '2019-05-12 22:00Z', '2019-05-13 02:00Z', 0, 'approved'),
         (:'lw', :'l_a', '2019-05-12 07:00Z', '2019-05-12 11:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-12', '2019-05-12', 'chain clean', 9000, :'l_a') returning id as lp3 \gset
  select public.calculate_distribution(:'lp3') as ld3 \gset
commit;

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'ld3') = 3
  and (select bool_and(member_id in (:'l_b'::uuid, :'l_c'::uuid, :'l_d'::uuid))
       from public.tip_distribution_entries where distribution_id = :'ld3'),
  'L12 a true chain B—C—D pays all three, each linked to at least one other');

select tests.ok(
  not exists (select 1 from public.tip_distribution_entries
              where distribution_id = :'ld3' and member_id = :'l_a'),
  'L13 …and the isolated morning shift is not paid');

select tests.ok(
  (select count(*) from public.tip_distributions d,
     lateral jsonb_array_elements(d.inputs_snapshot -> 'pairs') p
   where d.id = :'ld3'
     and (p ->> 'member_a') in (:'l_b', :'l_d') and (p ->> 'member_b') in (:'l_b', :'l_d')
     and (p ->> 'linked')::boolean = false) = 1,
  'L14 …with B and D recorded as a real pair that never linked');

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'ld3') = 9000,
  'L15 …and the money still reconciles exactly');

-- ═════════════════════════════════════════════════════════════════════════════
-- FAILURE 40 — "two disconnected crews are refused", HTTP 200, one written
-- ═════════════════════════════════════════════════════════════════════════════
-- The live fixture is a crew of two plus ONE lone worker. A lone worker has no
-- link, so he is excluded — he is not a second component. One component means
-- the calculation is correct to proceed.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_a', '2019-05-09 06:00Z', '2019-05-09 11:00Z', 0, 'approved'),
         (:'lw', :'l_b', '2019-05-09 07:00Z', '2019-05-09 11:00Z', 0, 'approved'),
         (:'lw', :'l_c', '2019-05-09 16:00Z', '2019-05-09 21:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-09', '2019-05-09', 'one crew', 5000, :'l_a') returning id as lp4 \gset
  select public.calculate_distribution(:'lp4') as ld4 \gset
commit;

select tests.ok(:'ld4' is not null,
  'L16 one crew plus one lone worker is NOT two crews — the calculation proceeds, as the live run showed');

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'ld4') = 2,
  'L17 …paying the crew of two');

select tests.ok(
  (select count(*) from public.tip_distributions d,
     lateral jsonb_array_elements(d.inputs_snapshot -> 'shifts') s
   where d.id = :'ld4' and s ->> 'member_id' = :'l_c'
     and s ->> 'eligibility' = 'no_pairwise_overlap') = 1,
  'L18 …and excluding the lone worker with a reason');

-- Two crews really means two of them.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_a', '2019-05-13 06:00Z', '2019-05-13 11:00Z', 0, 'approved'),
         (:'lw', :'l_b', '2019-05-13 07:00Z', '2019-05-13 11:00Z', 0, 'approved'),
         (:'lw', :'l_c', '2019-05-13 16:00Z', '2019-05-13 21:00Z', 0, 'approved'),
         (:'lw', :'l_d', '2019-05-13 17:00Z', '2019-05-13 21:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-13', '2019-05-13', 'two crews', 5000, :'l_a') returning id as lp5 \gset
  select tests.denied(format('select public.calculate_distribution(%L)', :'lp5'),
    'L19 two crews of two who never met is refused');
commit;

select tests.ok(
  (select count(*) from public.tip_distributions where tip_pool_id = :'lp5') = 0,
  'L20 …and nothing was written for that pool');

-- ═════════════════════════════════════════════════════════════════════════════
-- FAILURES 41 / 41b — "area with a share and zero eligible workers", 200
-- ═════════════════════════════════════════════════════════════════════════════
-- Same contamination as 36: the employee is in Bar, so Bar is not empty and
-- there is nothing for the validation to refuse.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'lw') as lr_60 \gset
  update public.distribution_rules set overlap_basis = 'longest_shift', method = 'hours' where id = :'lr_60';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'lr_60' and area_id = :'l_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'lr_60' and area_id = :'l_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'lr_60' and area_id not in (:'l_service', :'l_bar');
  select public.activate_rule(:'lr_60');

  -- Migration 20 requires the role to belong to the area, so the move clears
  -- it; the engine falls back to the first role of the effective area.
  update public.workplace_members set area_id = :'l_bar', workplace_role_id = null
    where id = :'l_b';   -- the contamination
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_a', '2019-05-10 18:00Z', '2019-05-10 22:00Z', 0, 'approved'),
         (:'lw', :'l_b', '2019-05-10 18:00Z', '2019-05-10 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-10', '2019-05-10', 'bar occupied', 10000, :'l_a') returning id as lp6 \gset
  select public.calculate_distribution(:'lp6') as ld6 \gset
commit;

select tests.ok(:'ld6' is not null,
  'L21 with someone actually in Bar the calculation proceeds — the live "distribution written"');

select tests.ok(
  (select total_cents from public.tip_distribution_areas
   where distribution_id = :'ld6' and area_key = 'bar') = 4000,
  'L22 …and Bar receives its 40%, so nothing was redistributed either');

-- Bar genuinely empty.
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'l_service', workplace_role_id = :'l_server'
    where id = :'l_b';  -- the fix
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'lw', :'l_a', '2019-05-14 18:00Z', '2019-05-14 22:00Z', 0, 'approved'),
         (:'lw', :'l_b', '2019-05-14 18:00Z', '2019-05-14 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'lw', 'day', '2019-05-14', '2019-05-14', 'bar empty', 10000, :'l_a') returning id as lp7 \gset
  select tests.denied(format('select public.calculate_distribution(%L)', :'lp7'),
    'L23 with Bar truly empty the calculation is refused');
commit;

select tests.ok(
  (select count(*) from public.tip_distributions where tip_pool_id = :'lp7') = 0,
  'L24 …nothing written');

select tests.ok(
  (select count(*) from public.tip_distribution_areas da
   join public.tip_distributions d on d.id = da.distribution_id
   where d.tip_pool_id = :'lp7') = 0,
  'L25 …and no money moved into Service instead');

begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000001');
  do $do$
  declare v_msg text; v_pool uuid;
  begin
    select id into v_pool from public.tip_pools where label = 'bar empty';
    begin
      perform public.calculate_distribution(v_pool);
      v_msg := 'no error';
    exception when others then
      v_msg := sqlerrm;
    end;
    perform tests.ok(v_msg like '%Bar%',
      'L26 …and the message names the unresolved area: ' || v_msg);
  end
  $do$;
commit;
