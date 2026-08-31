-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 16: pairwise overlap, exhaustively.
--
-- Its own workplace and its own people, with intervals chosen so every case in
-- the specification is a separate, hand-checkable fact.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'pair.manager@test.local'),
  ('e0000000-0000-0000-0000-000000000002', 'pair.ann@test.local')
on conflict do nothing;

begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  select public.create_workplace('Pairwise Lab', 'Marburg') as pw \gset
commit;

select id as p_service from public.workplace_areas where workplace_id = :'pw' and key = 'service' \gset
select id as p_bar     from public.workplace_areas where workplace_id = :'pw' and key = 'bar' \gset
select id as p_server  from public.workplace_roles where workplace_id = :'pw' and key = 'server' \gset
select id as p_barkeep from public.workplace_roles where workplace_id = :'pw' and key = 'bartender' \gset
select id as p_boss    from public.workplace_members where workplace_id = :'pw' and role = 'manager' \gset

begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'p_service', workplace_role_id = :'p_server'
    where id = :'p_boss';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'pw', 'Ann',  'employee', :'p_service', :'p_server', 'active') returning id as p_ann \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'pw', 'Ben',  'employee', :'p_service', :'p_server', 'active') returning id as p_ben \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'pw', 'Cara', 'employee', :'p_service', :'p_server', 'active') returning id as p_cara \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'pw', 'Dov',  'employee', :'p_service', :'p_server', 'active') returning id as p_dov \gset

  -- All the weight in Service, so only eligibility is under test.
  select id as pr1 from public.distribution_rules where workplace_id = :'pw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours', min_overlap_minutes = 15, overlap_basis = 'pairwise' where id = :'pr1';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'pr1' and area_id = :'p_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'pr1' and area_id <> :'p_service';
  select public.activate_rule(:'pr1') as pv1 \gset
commit;

select tests.ok(:'pv1'::integer = 1, 'P0  a pairwise rule can be activated');
select tests.ok(
  (select overlap_basis from public.distribution_rules where id = :'pr1') = 'pairwise',
  'P0b …and the workplace is on the pairwise model');

-- ── the chain: A—B and B—C, with A and C never meeting ──────────────────────
-- Ann   18:00–22:00
-- Ben   21:00–01:00   (1 h with Ann, 1 h with Cara — the link in the middle)
-- Cara  00:00–04:00   (never meets Ann at all)
-- Dov   09:00–13:00   (meets nobody)
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann',  '2026-06-01 18:00+02', '2026-06-01 22:00+02', 0, 'approved'),
         (:'pw', :'p_ben',  '2026-06-01 21:00+02', '2026-06-02 01:00+02', 0, 'approved'),
         (:'pw', :'p_cara', '2026-06-02 00:00+02', '2026-06-02 04:00+02', 0, 'approved'),
         (:'pw', :'p_dov',  '2026-06-01 09:00+02', '2026-06-01 13:00+02', 0, 'approved');

  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-01', '2026-06-01', 'chain', 12000, :'p_boss') returning id as pool_c \gset
commit;

-- Dov is isolated, so the eligible people form ONE group and he is excluded.
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  select public.calculate_distribution(:'pool_c') as dist_c \gset
commit;

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'dist_c') = 3,
  'P1  the chain A—B—C is one group: all three are paid');

select tests.ok(
  exists (select 1 from public.tip_distribution_entries
          where distribution_id = :'dist_c' and member_id = :'p_ann')
  and exists (select 1 from public.tip_distribution_entries
              where distribution_id = :'dist_c' and member_id = :'p_cara'),
  'P2  …including Ann and Cara, who never met each other');

select tests.ok(
  not exists (select 1 from public.tip_distribution_entries
              where distribution_id = :'dist_c' and member_id = :'p_dov'),
  'P3  the day-shift runner who met nobody is out');

select tests.ok(
  (select inputs_snapshot -> 'shifts' @> '[{"eligibility": "no_pairwise_overlap"}]'
   from public.tip_distributions where id = :'dist_c'),
  'P4  …and the record says why');

select tests.ok(
  (select inputs_snapshot -> 'anchor_shift_id' from public.tip_distributions where id = :'dist_c')
    = 'null'::jsonb,
  'P5  a pairwise distribution records no anchor, because it used none');

select tests.ok(
  (select jsonb_array_length(inputs_snapshot -> 'pairs') from public.tip_distributions where id = :'dist_c') = 6,
  'P6  the whole overlap graph is in the snapshot (4 people = 6 pairs)');

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'dist_c') = 12000,
  'P7  and the money still reconciles exactly');

select tests.ok(
  (select overlap_minutes from public.tip_distribution_entries
   where distribution_id = :'dist_c' and member_id = :'p_ben') = 60,
  'P8  each entry records that person''s strongest link (Ben: 60 min)');

-- ── exactly at the threshold, and one minute below ──────────────────────────
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann',  '2026-06-03 18:00+02', '2026-06-03 23:00+02', 0, 'approved'),
         (:'pw', :'p_ben',  '2026-06-03 22:45+02', '2026-06-04 02:45+02', 0, 'approved'),
         (:'pw', :'p_cara', '2026-06-03 22:46+02', '2026-06-04 02:46+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-03', '2026-06-03', 'threshold', 9000, :'p_boss') returning id as pool_t \gset
commit;

begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  select public.calculate_distribution(:'pool_t') as dist_t \gset
commit;

select tests.ok(
  exists (select 1 from public.tip_distribution_entries
          where distribution_id = :'dist_t' and member_id = :'p_ben'),
  'P9  exactly 15 minutes of overlap is enough');

-- Cara overlaps Ann by 14 minutes, but Ben by 3h59 — so the chain still holds
-- her in. This is the point of pairwise: she worked the night with Ben.
select tests.ok(
  exists (select 1 from public.tip_distribution_entries
          where distribution_id = :'dist_t' and member_id = :'p_cara'),
  'P10 14 minutes with Ann is not enough on its own, but Cara''s 3h59 with Ben is');

select tests.ok(
  (select (p ->> 'linked')::boolean = false
   from public.tip_distributions d,
        lateral jsonb_array_elements(d.inputs_snapshot -> 'pairs') p
   where d.id = :'dist_t'
     and ((p ->> 'member_a') = :'p_ann' and (p ->> 'member_b') = :'p_cara'
          or (p ->> 'member_a') = :'p_cara' and (p ->> 'member_b') = :'p_ann')),
  'P11 …and the graph records the Ann–Cara pair as not linked');

-- ── two crews who never met ─────────────────────────────────────────────────
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann',  '2026-06-05 08:00+02', '2026-06-05 13:00+02', 0, 'approved'),
         (:'pw', :'p_ben',  '2026-06-05 09:00+02', '2026-06-05 13:00+02', 0, 'approved'),
         (:'pw', :'p_cara', '2026-06-05 18:00+02', '2026-06-05 23:00+02', 0, 'approved'),
         (:'pw', :'p_dov',  '2026-06-05 19:00+02', '2026-06-05 23:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-05', '2026-06-05', 'twocrews', 8000, :'p_boss') returning id as pool_2 \gset

  select tests.denied(format($q$select public.calculate_distribution(%L)$q$, :'pool_2'),
    'P12 a period holding two crews who never met is refused, not silently split');
commit;

select tests.ok(
  (select count(*) from public.tip_distributions where tip_pool_id = :'pool_2') = 0,
  'P13 …and nothing was written');

-- ── one person, working alone ───────────────────────────────────────────────
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann', '2026-06-07 18:00+02', '2026-06-07 23:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-07', '2026-06-07', 'solo', 4321, :'p_boss') returning id as pool_s1 \gset
  select public.calculate_distribution(:'pool_s1') as dist_s1 \gset
commit;

select tests.ok(
  (select amount_cents from public.tip_distribution_entries where distribution_id = :'dist_s1') = 4321,
  'P14 somebody who worked alone takes the pool: there was nobody to overlap with');

select tests.ok(
  (select inputs_snapshot -> 'shifts' @> '[{"eligibility": "sole_worker"}]'
   from public.tip_distributions where id = :'dist_s1'),
  'P15 …and the record says that is why');

-- ── several shifts each, several partial overlaps ───────────────────────────
-- Ann 18:00–20:00 and 21:00–23:00; Ben 19:50–21:10.
-- Ben meets Ann for 10 min, then 10 min again — 20 minutes in total, which
-- clears 15 only because the pairs are SUMMED rather than taken separately.
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann', '2026-06-09 18:00+02', '2026-06-09 20:00+02', 0, 'approved'),
         (:'pw', :'p_ann', '2026-06-09 21:00+02', '2026-06-09 23:00+02', 0, 'approved'),
         (:'pw', :'p_ben', '2026-06-09 19:50+02', '2026-06-09 21:10+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-09', '2026-06-09', 'partials', 6000, :'p_boss') returning id as pool_p \gset
  select public.calculate_distribution(:'pool_p') as dist_p \gset
commit;

select tests.ok(
  (select count(distinct member_id) from public.tip_distribution_entries
   where distribution_id = :'dist_p') = 2,
  'P16 two partial overlaps of 10 minutes each add up to 20 and count as one link');

select tests.ok(
  (select overlap_minutes from public.tip_distribution_entries
   where distribution_id = :'dist_p' and member_id = :'p_ben') = 20,
  'P17 …and 20 is the number recorded');

select tests.ok(
  (select worked_minutes from public.tip_distribution_entries
   where distribution_id = :'dist_p' and member_id = :'p_ann') = 240,
  'P18 a person''s two shifts are one entry, with the hours added up');

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'dist_p') = 6000,
  'P19 …and it still reconciles');

-- ── overnight, across a real DST-free midnight ──────────────────────────────
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann', '2026-06-11 22:00+02', '2026-06-12 04:00+02', 0, 'approved'),
         (:'pw', :'p_ben', '2026-06-12 01:00+02', '2026-06-12 06:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-11', '2026-06-11', 'overnight', 7000, :'p_boss') returning id as pool_n \gset
  select public.calculate_distribution(:'pool_n') as dist_n \gset
commit;

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'dist_n') = 2,
  'P20 two overnight shifts that meet after midnight are linked');

select tests.ok(
  (select overlap_minutes from public.tip_distribution_entries
   where distribution_id = :'dist_n' and member_id = :'p_ben') = 180,
  'P21 …by the three hours they actually shared, midnight being nothing special');

-- ── two areas ───────────────────────────────────────────────────────────────
-- Overlap is measured across areas: Bar and Service worked the same night.
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'p_bar', workplace_role_id = :'p_barkeep'
    where id = :'p_ben';
  select id as pr2 from public.create_rule_draft(:'pw') as t(id) \gset
  update public.distribution_rules
    set method = 'hours', min_overlap_minutes = 15, overlap_basis = 'pairwise' where id = :'pr2';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'pr2' and area_id = :'p_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'pr2' and area_id = :'p_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'pr2' and area_id not in (:'p_service', :'p_bar');
  select public.activate_rule(:'pr2');

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann', '2026-06-13 18:00+02', '2026-06-13 23:00+02', 0, 'approved'),
         (:'pw', :'p_ben', '2026-06-13 18:00+02', '2026-06-13 23:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-13', '2026-06-13', 'twoareas', 10000, :'p_boss') returning id as pool_a \gset
  select public.calculate_distribution(:'pool_a') as dist_a \gset
commit;

select tests.ok(
  (select count(*) from public.tip_distribution_areas where distribution_id = :'dist_a') = 2,
  'P22 people in different areas still link, and both areas get their share');

select tests.ok(
  (select total_cents from public.tip_distribution_areas
   where distribution_id = :'dist_a' and area_key = 'service') = 6000
  and (select total_cents from public.tip_distribution_areas
       where distribution_id = :'dist_a' and area_key = 'bar') = 4000,
  'P23 …60 / 40, to the cent');

-- ── an area with a share and nobody in it ───────────────────────────────────
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann',  '2026-06-15 18:00+02', '2026-06-15 23:00+02', 0, 'approved'),
         (:'pw', :'p_cara', '2026-06-15 18:00+02', '2026-06-15 23:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-15', '2026-06-15', 'nobar', 10000, :'p_boss') returning id as pool_nb \gset

  select tests.denied(format($q$select public.calculate_distribution(%L)$q$, :'pool_nb'),
    'P24 Bar has 40%% of the pool and nobody in it: the distribution stops');
commit;

select tests.ok(
  (select count(*) from public.tip_distributions where tip_pool_id = :'pool_nb') = 0,
  'P25 …and no money moved into Service instead');

-- ── the shift-level area override, end to end ───────────────────────────────
-- Linking an account to a roster row is accept_invitation()'s job and the
-- guard refuses it from any client; done here as the owner, since the
-- invitation path has its own tests.
update public.workplace_members set user_id = 'e0000000-0000-0000-0000-000000000002'
where id = :'p_ann';

begin; select tests.as_user('e0000000-0000-0000-0000-000000000002');  -- Ann, employee
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id)
  values (:'pw', :'p_ann', '2026-06-17 18:00+02', '2026-06-17 23:00+02', 0, 'submitted', :'p_bar')
  returning id as s_override \gset
commit;

select tests.ok(
  (select area_id from public.shifts where id = :'s_override') = :'p_bar',
  'P26 an employee may still say which area they actually worked');

begin; select tests.as_user('e0000000-0000-0000-0000-000000000001');
  -- Ben back to Service, so the override moves Ann from Service to Bar and
  -- both areas have exactly one person.
  update public.workplace_members set area_id = :'p_service', workplace_role_id = :'p_server'
    where id = :'p_ben';
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ben', '2026-06-17 18:00+02', '2026-06-17 23:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-17', '2026-06-17', 'override', 10000, :'p_boss') returning id as pool_o2 \gset

  -- Ann's shift is only SUBMITTED, so Service has nobody: the run stops.
  select tests.denied(format($q$select public.calculate_distribution(%L)$q$, :'pool_o2'),
    'P27 a shift that has not been approved cannot take part in a distribution');
commit;

begin; select tests.as_user('e0000000-0000-0000-0000-000000000001');
  update public.shifts set status = 'approved', reviewed_by = :'p_boss', reviewed_at = now()
    where id = :'s_override';
  select public.calculate_distribution(:'pool_o2') as dist_o2 \gset
commit;

select tests.ok(
  (select area_key from public.tip_distribution_entries
   where distribution_id = :'dist_o2' and member_id = :'p_ann') = 'bar',
  'P28 once approved, the shift takes part under the OVERRIDDEN area');

select tests.ok(
  (select area_source from public.tip_distribution_entries
   where distribution_id = :'dist_o2' and member_id = :'p_ann') = 'shift',
  'P29 …and the entry records that the area came from the shift, not the member');

select tests.ok(
  (select role_key from public.tip_distribution_entries
   where distribution_id = :'dist_o2' and member_id = :'p_ann') = 'bartender',
  'P30 …weighted by the role of the area she actually worked');

begin; select tests.as_user('e0000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(
    format($q$update public.shifts set area_id = %L where id = %L$q$, :'p_service', :'s_override'),
    'P31 an employee cannot change the area of a shift once it is approved');
commit;

select tests.ok(
  (select locked from public.shifts where id = :'s_override'),
  'P32 …and the distribution locked it, so nobody edits the basis of a payout');

-- ── longest_shift is untouched ──────────────────────────────────────────────
begin;
  select tests.as_user('e0000000-0000-0000-0000-000000000001');
  select id as pr3 from public.create_rule_draft(:'pw') as t(id) \gset
  update public.distribution_rules
    set method = 'hours', min_overlap_minutes = 15, overlap_basis = 'longest_shift' where id = :'pr3';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'pr3' and area_id = :'p_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'pr3' and area_id <> :'p_service';
  select public.activate_rule(:'pr3');

  update public.workplace_members set area_id = :'p_service', workplace_role_id = :'p_server'
    where id = :'p_ben';
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'pw', :'p_ann', '2026-06-19 18:00+02', '2026-06-19 23:00+02', 0, 'approved'),
         (:'pw', :'p_ben', '2026-06-19 22:00+02', '2026-06-20 02:00+02', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'pw', 'day', '2026-06-19', '2026-06-19', 'anchored', 5000, :'p_boss') returning id as pool_l \gset
  select public.calculate_distribution(:'pool_l') as dist_l \gset
commit;

select tests.ok(
  (select overlap_basis from public.tip_distributions where id = :'dist_l') = 'longest_shift',
  'P33 a workplace can still run the anchored model');

select tests.ok(
  (select inputs_snapshot -> 'anchor_shift_id' from public.tip_distributions where id = :'dist_l')
    <> 'null'::jsonb,
  'P34 …and that distribution records its anchor, as it always did');

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'dist_l') = 2,
  'P35 …with the same two people and the same reconciliation');
