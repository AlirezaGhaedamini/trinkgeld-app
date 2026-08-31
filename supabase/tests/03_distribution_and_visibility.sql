-- ─────────────────────────────────────────────────────────────────────────────
-- The calculation itself, and everything that depends on a distribution
-- existing: overnight shifts, area overrides, multi-area entries, visibility
-- settings, and historical immutability.
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
select v as wp_a from tests.ids where k = 'wp_a' \gset
select v as m_lena from tests.ids where k = 'm_lena' \gset
select v as m_nina from tests.ids where k = 'm_nina' \gset
select v as m_marco from tests.ids where k = 'm_marco' \gset

select id as a_service from public.workplace_areas where workplace_id = :'wp_a' and key = 'service' \gset
select id as a_bar     from public.workplace_areas where workplace_id = :'wp_a' and key = 'bar' \gset

-- ── the manager sets the split and activates it ─────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select id as draft_id from public.distribution_rules
   where workplace_id = :'wp_a' and status = 'draft' \gset
  update public.distribution_rule_areas set percentage = 60
   where rule_id = :'draft_id' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 40
   where rule_id = :'draft_id' and area_id = :'a_bar';
  select tests.denied(format('select public.activate_rule(%L)', :'draft_id') ,
    'rule activation is refused while the shares do not total 100')
    where (select sum(percentage) from public.distribution_rule_areas where rule_id = :'draft_id') <> 100;
  select public.activate_rule(:'draft_id') as v1 \gset
  select tests.ok(:'v1'::int = 1, 'R1  the first activated rule is version 1');
commit;

-- ── shifts, including an overnight one and a two-area day ───────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000003');  -- Nina, bar
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wp_a', :'m_nina', '2026-08-22 16:00+02', '2026-08-23 01:30+02', 30, 'submitted');
commit;

begin;
  select tests.as_user('c0000000-0000-0000-0000-000000000001');  -- Marco: Bar then Service, one night
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id)
  values (:'wp_a', :'m_marco', '2026-08-22 13:00+02', '2026-08-22 17:30+02', 0, 'submitted', :'a_bar');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wp_a', :'m_marco', '2026-08-22 18:00+02', '2026-08-22 23:00+02', 0, 'submitted');
commit;

-- A day-shift runner who shares no time with the evening: the overlap rule
-- must keep him out of the evening pool. He is also a roster placeholder with
-- no account, which is the case a manager sets up before someone signs up.
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'wp_a', 'Luis Ferro', 'employee', :'a_service',
          (select id from public.workplace_roles where workplace_id = :'wp_a' and key = 'server'),
          'active')
  returning id as m_luis \gset
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, source)
  values (:'wp_a', :'m_luis', '2026-08-22 09:00+02', '2026-08-22 13:00+02', 0, 'submitted', 'manager');
commit;

-- ── 13 · the overnight shift lands on the right business day ────────────────
select tests.ok(
  (select work_date from public.shifts where member_id = :'m_lena') = date '2026-08-22',
  '13  a 17:00→01:30 shift belongs to the 22nd, not the 23rd');
select tests.ok(
  (select worked_minutes from public.shifts where member_id = :'m_lena') = 480,
  '13b it is counted as 8 hours after the 30 minute break');
select tests.ok(
  (select count(*) from public.shifts
    where member_id = :'m_marco' and work_date = date '2026-08-22') = 2,
  '13c a lunch and a dinner shift share one business day');

-- ── the manager approves everything ─────────────────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.shifts set status = 'approved', reviewed_at = now()
  where workplace_id = :'wp_a' and status = 'submitted';
commit;

-- ── run it ──────────────────────────────────────────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select id as pool_id from public.tip_pools where workplace_id = :'wp_a' limit 1 \gset
  select public.calculate_distribution(:'pool_id') as dist_id \gset
  select public.send_distribution(:'dist_id');
commit;

insert into tests.ids (k, v) values ('dist', :'dist_id') on conflict (k) do update set v = excluded.v;

-- ── the arithmetic adds up ──────────────────────────────────────────────────
select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'dist_id')
  = (select pool_cents from public.tip_distributions where id = :'dist_id'),
  'C1  the entries sum to the pool exactly');
select tests.ok(
  (select sum(total_cents) from public.tip_distribution_areas where distribution_id = :'dist_id') = 248000,
  'C2  the area pots sum to the pool');

-- ── 14 · the shift-level area override decides the weighting context ────────
select tests.ok(
  (select area_source from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_marco' and area_id = :'a_bar') = 'shift',
  '14  Marco''s bar entry records that the area came from the shift');
select tests.ok(
  (select role_key from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_marco' and area_id = :'a_bar') = 'bartender',
  '14b moving him to Bar also moves the weighting to a Bar role');
select tests.ok(
  (select area_source from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_marco' and area_id = :'a_service') = 'member',
  '14c his service entry falls back to his default area');
select tests.ok(
  (select role_key from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_marco' and area_id = :'a_service') = 'server',
  '14d ... with his own role');

-- ── the overlap rule keeps a non-overlapping day shift out ──────────────────
select tests.ok(
  (select count(*) from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_luis') = 0,
  'O1  a 09:00–13:00 day shift shares nothing with the evening and is excluded');
select tests.ok(
  (select s2 ->> 'eligibility' from public.tip_distributions d,
     lateral jsonb_array_elements(d.inputs_snapshot -> 'shifts') s2
   where d.id = :'dist_id' and (s2 ->> 'member_id')::uuid = :'m_luis') = 'below_min_overlap',
  'O2  and the snapshot records why');

-- ── 15 · one member, two areas, two entries ─────────────────────────────────
select tests.ok(
  (select count(*) from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_marco') = 2,
  '15  a member who worked two areas gets two entries, not one blended row');
select tests.ok(
  (select count(distinct area_id) from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_marco') = 2,
  '15b they are for different areas');
select tests.denied(format(
  'insert into public.tip_distribution_entries
     (distribution_id, workplace_id, member_id, member_name, area_id, area_key, area_name)
   values (%L, %L, %L, ''dupe'', %L, ''bar'', ''Bar'')',
   :'dist_id', :'wp_a', :'m_marco', :'a_bar'),
  '15c but not two entries for the same member and area');

-- ── 10 · the manager sees the whole distribution ────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select tests.ok((select count(*) from public.tip_distribution_entries
                    where distribution_id = :'dist_id') = 4,
    '10  the manager sees every entry (Lena, Nina, and Marco twice)');
  select tests.ok((select pool_cents from public.tip_distributions where id = :'dist_id') = 248000,
    '10b the manager sees the pool total');
  select tests.ok((select count(*) from public.tip_distribution_areas
                    where distribution_id = :'dist_id') = 2,
    '10c the manager sees both area blocks');
commit;

-- ── 6, 7, 9 · the employee sees their own money and nothing else ────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');  -- Lena
  select tests.ok((select count(*) from public.tip_distributions) = 0,
    '06  an employee cannot read the distributions table at all');
  select tests.ok((select count(*) from public.tip_pools) = 0,
    '06b nor the pools table');
  select tests.ok((select count(*) from public.tip_distribution_areas) = 0,
    '06c nor the area subtotals, which would reveal the pool');
  select tests.ok((select pool_cents from public.member_distributions where id = :'dist_id') is null,
    '09  the member view hides the pool total while the setting is off');
  select tests.ok((select count(*) from public.member_distributions where id = :'dist_id') = 1,
    '09b but the distribution itself is listed');
  select tests.ok((select count(*) from public.tip_distribution_entries) = 1,
    '07  with peer visibility "none" an employee sees only their own entry');
  select tests.ok((select member_id from public.tip_distribution_entries) = :'m_lena',
    '07b and it is theirs');
  select tests.ok((select count(*) from public.member_distribution_entries where not is_own) = 0,
    '07c the member entries view exposes no peer rows');
commit;

-- ── 9 · releasing the pool total ────────────────────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.workplaces set pool_amount_visible_to_members = true where id = :'wp_a';
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.ok((select pool_cents from public.member_distributions where id = :'dist_id') = 248000,
    '09c once the manager releases it, the employee sees the total');
  select tests.ok((select count(*) from public.tip_distribution_areas) = 2,
    '09d and the area subtotals that explain it');
  select tests.ok((select count(*) from public.tip_distribution_entries) = 1,
    '09e releasing the pool does not reveal peer amounts');
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.workplaces set pool_amount_visible_to_members = false where id = :'wp_a';
commit;

-- ── 8 · peer visibility, when a workplace turns it on ───────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.workplaces set peer_entry_visibility = 'area' where id = :'wp_a';
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');  -- Lena, service
  select tests.ok((select count(*) from public.tip_distribution_entries) = 2,
    '08  with "area" Lena sees the two service entries');
  select tests.ok((select count(*) from public.tip_distribution_entries where area_id = :'a_bar') = 0,
    '08b and none from the bar');
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.workplaces set peer_entry_visibility = 'workplace' where id = :'wp_a';
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.ok((select count(*) from public.tip_distribution_entries) = 4,
    '08c with "workplace" she sees the whole distribution');
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.workplaces set peer_entry_visibility = 'none' where id = :'wp_a';
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.ok((select count(*) from public.tip_distribution_entries) = 1,
    '08d and back to one when it is switched off again');
commit;

-- ── 16 · editing the rules never touches a finished distribution ────────────
select amount_cents as lena_before from public.tip_distribution_entries
 where distribution_id = :'dist_id' and member_id = :'m_lena' \gset
select rules_snapshot ->> 'version' as snap_version_before from public.tip_distributions
 where id = :'dist_id' \gset

begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'wp_a') as draft2 \gset
  update public.distribution_rule_areas set percentage = 10
   where rule_id = :'draft2' and area_id = :'a_service';
  update public.distribution_rule_areas set percentage = 90
   where rule_id = :'draft2' and area_id = :'a_bar';
  select public.activate_rule(:'draft2') as v2 \gset
  select tests.ok(:'v2'::int = 2, '16  editing the rules produces version 2');
commit;

select tests.ok(
  (select amount_cents from public.tip_distribution_entries
    where distribution_id = :'dist_id' and member_id = :'m_lena') = :'lena_before'::bigint,
  '16b the sent distribution''s amounts are unchanged');
select tests.ok(
  (select rules_snapshot ->> 'version' from public.tip_distributions where id = :'dist_id')
  = :'snap_version_before',
  '16c its snapshot still names version 1');
select tests.ok(
  (select rule_version from public.tip_distributions where id = :'dist_id') = 1,
  '16d and it still points at the version it used');
select tests.ok(
  (select status from public.distribution_rules where id = :'draft_id') = 'superseded',
  '16e version 1 is superseded, not deleted');

-- a superseded version cannot be edited, even by a manager
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select tests.changes_nothing(format(
    'update public.distribution_rules set min_overlap_minutes = 45 where id = %L', :'draft_id'),
    '16f a superseded rule version is frozen');
  select tests.changes_nothing(format(
    'update public.distribution_rule_areas set percentage = 1 where rule_id = %L', :'draft_id'),
    '16g so are its area shares');
commit;

-- a sent distribution is frozen too
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select tests.changes_nothing(format(
    'update public.tip_distributions set pool_cents = 1 where id = %L', :'dist_id'),
    '16h a sent distribution cannot be edited');
  select tests.changes_nothing(format(
    'update public.tip_distribution_entries set amount_cents = 999999 where distribution_id = %L', :'dist_id'),
    '16i nor can its entries');
commit;

-- ── the employee may still acknowledge their own line ───────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select id as lena_entry from public.tip_distribution_entries limit 1 \gset
  select public.acknowledge_entry(:'lena_entry', 'acknowledged');
  select tests.ok((select ack_status from public.tip_distribution_entries where id = :'lena_entry')
                  = 'acknowledged',
    'A1  an employee can confirm their own share');
commit;
