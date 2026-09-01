-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3F · area and role management.
--
-- Renaming, reordering, archiving and restoring, the four things that must
-- refuse an archive, and the one thing none of it is ever allowed to touch: a
-- distribution that has already been paid.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'ops.boss@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'ops.staff@test.local'),
  ('a1000000-0000-0000-0000-000000000003', 'ops.rival@test.local')
on conflict do nothing;

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.create_workplace('Ops Lab', 'Marburg') as ow \gset
commit;
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000003');
  select public.create_workplace('Ops Rival', 'Kassel') as ox \gset
commit;

select id as o_service from public.workplace_areas where workplace_id = :'ow' and key = 'service' \gset
select id as o_bar     from public.workplace_areas where workplace_id = :'ow' and key = 'bar' \gset
select id as o_runner  from public.workplace_areas where workplace_id = :'ow' and key = 'runner' \gset
select id as o_server  from public.workplace_roles where workplace_id = :'ow' and key = 'server' \gset
select id as o_runrole from public.workplace_roles where workplace_id = :'ow' and key = 'runner' \gset
select id as o_mgr     from public.workplace_members where workplace_id = :'ow' and role = 'manager' \gset
select id as x_service from public.workplace_areas where workplace_id = :'ox' and key = 'service' \gset

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'o_service', workplace_role_id = :'o_server'
    where id = :'o_mgr';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'ow', 'Pia', 'employee', :'o_service', :'o_server', 'active') returning id as o_emp \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'ow', 'Quinn', 'employee', :'o_service', :'o_server', 'active') returning id as o_emp2 \gset
commit;
update public.workplace_members set user_id = 'a1000000-0000-0000-0000-000000000002' where id = :'o_emp';

-- ═════════════════════════════════════════════════════════════════════════════
-- slugs and names
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(app.slugify('Späti Küche') = 'spaeti_kueche',
  'F1  a German name becomes a legal key');
select tests.ok(app.slugify('2nd Floor') = 'x_2nd_floor',
  'F2  …a name starting with a digit is still legal');
select tests.ok(app.slugify('!!!') is null,
  'F3  …and a name with nothing usable in it produces no key at all');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.create_workplace_area(:'ow', 'Späti Küche') as o_new \gset
commit;

select tests.ok(
  (select key from public.workplace_areas where id = :'o_new') = 'spaeti_kueche',
  'F4  creating an area derives the key from the name');
select tests.ok(
  (select sort_order from public.workplace_areas where id = :'o_new')
    > (select max(sort_order) from public.workplace_areas
       where workplace_id = :'ow' and id <> :'o_new'),
  'F5  …and it lands at the end of the order');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.create_workplace_area(%L, %L)', :'ow', '  '),
    'F6  a blank name is refused');
  select tests.denied(format('select public.create_workplace_area(%L, %L)', :'ow', 'Bar'),
    'F7  …and so is a second live area called the same thing');
  select tests.denied(
    format('update public.workplace_areas set name = ''Bar'' where id = %L', :'o_new'),
    'F8  …including by rename');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- permissions
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.create_workplace_area(%L, %L)', :'ow', 'Terrace'),
    'F9  an employee cannot create an area');
  select tests.changes_nothing(
    format('update public.workplace_areas set name = ''Hacked'' where id = %L', :'o_bar'),
    'F10 …nor rename one');
  select tests.denied(format('select public.archive_workplace_area(%L)', :'o_bar'),
    'F11 …nor archive one');
  select tests.denied(format('select public.create_workplace_role(%L, %L, %L)', :'ow', :'o_bar', 'Ghost'),
    'F12 …nor create a role');
  select tests.changes_nothing(
    format('update public.workplace_roles set name = ''Hacked'', points = 5 where id = %L', :'o_server'),
    'F13 …nor rename a role or move its points');
  select tests.denied(format('select public.area_usage(%L)', :'o_bar'),
    'F14 …nor read what an area is being used for');
commit;

select tests.ok(
  (select name from public.workplace_areas where id = :'o_bar') = 'Bar'
  and (select name = 'Server' and points = 1.00 from public.workplace_roles where id = :'o_server'),
  'F15 …and nothing they tried moved');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.create_workplace_area(%L, %L)', :'ox', 'Sneaky'),
    'F16 a manager cannot add an area to another workplace');
  select tests.denied(
    format('select public.create_workplace_role(%L, %L, %L)', :'ow', :'x_service', 'Sneaky'),
    'F17 …nor put one of their roles into another workplace''s area');
  select tests.denied(
    format('select public.reorder_workplace_areas(%L, array[%L]::uuid[])', :'ow', :'x_service'),
    'F18 …nor reorder using an id from another workplace');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- ordering
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.reorder_workplace_areas(:'ow', array[:'o_bar', :'o_service', :'o_runner']::uuid[]);
commit;

select tests.ok(
  (select sort_order from public.workplace_areas where id = :'o_bar')
    < (select sort_order from public.workplace_areas where id = :'o_service'),
  'F19 reordering puts the areas in the order it was given');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.reorder_workplace_areas(:'ow', array[:'o_service', :'o_bar', :'o_runner']::uuid[]);
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- what stops an archive
-- ═════════════════════════════════════════════════════════════════════════════
-- Service has both employees, three roles and a rule share: every reason at once.
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select id as o_rule from public.distribution_rules where workplace_id = :'ow' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours', min_overlap_minutes = 15 where id = :'o_rule';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'o_rule' and area_id = :'o_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'o_rule' and area_id <> :'o_service';
  select public.activate_rule(:'o_rule');
  select tests.denied(format('select public.archive_workplace_area(%L)', :'o_service'),
    'F20 an area that is somebody''s default area cannot be archived');
commit;

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.ok(
    ((select public.area_usage(:'o_service')) ->> 'members')::int = 3,
    'F21 …and the manager is told how many people that is');
commit;

-- Runner: nobody works there, but it has a role, so it is still blocked.
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.archive_workplace_area(%L)', :'o_runner'),
    'F22 an area that still holds a live role cannot be archived either');
  select public.archive_workplace_role(:'o_runrole');
commit;

select tests.ok(
  (select archived_at is not null from public.workplace_roles where id = :'o_runrole'),
  'F23 …the role archives once nobody uses it');

-- An unfinished shift in Runner blocks it again.
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id)
  values (:'ow', :'o_emp', '2019-10-01 18:00Z', '2019-10-01 22:00Z', 0, 'submitted', :'o_runner')
  returning id as o_open \gset
  select tests.denied(format('select public.archive_workplace_area(%L)', :'o_runner'),
    'F24 an area on a shift that is not finished cannot be archived');
commit;

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  update public.shifts set status = 'rejected' where id = :'o_open';
  select public.archive_workplace_area(:'o_runner') as o_arch \gset
commit;

select tests.ok((:'o_arch')::jsonb ->> 'archived' = 'true',
  'F25 …and archives once that shift is out of the way');
select tests.ok(
  (select archived_at is not null from public.workplace_areas where id = :'o_runner'),
  'F26 …with archived_at stamped, not a deleted row');

-- A funded share blocks it too.
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.create_rule_draft(:'ow') as o_d2 \gset
  update public.distribution_rule_areas set percentage = 50 where rule_id = :'o_d2' and area_id = :'o_service';
  update public.distribution_rule_areas set percentage = 50 where rule_id = :'o_d2' and area_id = :'o_bar';
  select tests.denied(format('select public.archive_workplace_area(%L)', :'o_bar'),
    'F27 an area with a share of the pool in an open draft cannot be archived');
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'o_d2' and area_id = :'o_service';
  update public.distribution_rule_areas set percentage = 0 where rule_id = :'o_d2' and area_id = :'o_bar';
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- an archived area cannot be chosen again
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('update public.workplace_members set area_id = %L where id = %L', :'o_runner', :'o_emp2'),
    'F28 an archived area cannot be given to a team member');
  select tests.denied(
    format('insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id)
            values (%L, %L, ''2019-10-05 18:00Z'', ''2019-10-05 22:00Z'', 0, ''submitted'', %L)',
           :'ow', :'o_emp2', :'o_runner'),
    'F29 …nor put on a new shift');
  select tests.denied(
    format('update public.distribution_rule_areas set percentage = 10
            where rule_id = %L and area_id = %L', :'o_d2', :'o_runner'),
    'F30 …nor given a share of the pool');
  select tests.denied(
    format('update public.distribution_rules set rounding_area_id = %L where id = %L',
           :'o_runner', :'o_d2'),
    'F31 …nor made the area that takes the rounding remainder');
  select tests.denied(
    format('select public.create_workplace_role(%L, %L, %L)', :'ow', :'o_runner', 'Late runner'),
    'F32 …and no new role can be put in it');
commit;

select tests.ok(
  (select area_id from public.shifts where id = :'o_open') = :'o_runner'::uuid,
  'F33 …while the shift that already pointed at it is untouched');

-- The zero-percent copy the draft carries forward is allowed, which is what
-- keeps create_rule_draft() working after an area is archived.
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.activate_rule(:'o_d2');
  select public.create_rule_draft(:'ow') as o_d3 \gset
commit;

select tests.ok(
  (select count(*) from public.distribution_rule_areas
   where rule_id = :'o_d3' and area_id = :'o_runner' and percentage = 0) = 1,
  'F34 a new draft still carries the archived area forward at 0%%');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.restore_workplace_area(:'o_runner');
commit;
select tests.ok(
  (select archived_at is null from public.workplace_areas where id = :'o_runner'),
  'F35 an archived area can be brought back');

-- ═════════════════════════════════════════════════════════════════════════════
-- roles
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.create_workplace_role(:'ow', :'o_bar', 'Bar Lead', 1.30) as o_lead \gset
commit;

select tests.ok(
  (select key = 'bar_lead' and points = 1.30 and area_id = :'o_bar'::uuid
   from public.workplace_roles where id = :'o_lead'),
  'F36 a role is created under its area, with its key derived and its points set');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('select public.create_workplace_role(%L, %L, %L)', :'ow', :'o_bar', 'Bar Lead'),
    'F37 …and a second live role of the same name in the same area is refused');
  select public.create_workplace_role(:'ow', :'o_service', 'Bar Lead') as o_dup \gset
commit;

select tests.ok(
  (select key from public.workplace_roles where id = :'o_dup') = 'bar_lead_2',
  'F38 …while the same name in another area is fine, and takes the next free key');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  update public.workplace_roles set name = 'Bar lead (evening)', points = 1.40 where id = :'o_lead';
  select public.reorder_workplace_roles(:'o_bar', array[:'o_lead']::uuid[]);
commit;

select tests.ok(
  (select name = 'Bar lead (evening)' and points = 1.40 from public.workplace_roles where id = :'o_lead'),
  'F39 a manager can rename a role and change its points');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('select public.reorder_workplace_roles(%L, array[%L]::uuid[])', :'o_bar', :'o_server'),
    'F40 …but cannot reorder a role into an area it does not belong to');
  select tests.denied(
    format('select public.archive_workplace_role(%L)', :'o_server'),
    'F41 …and cannot archive a role three people still hold');
commit;

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  -- The role is a Bar role, so the shift has to name Bar as its area: the
  -- Phase 2 guard already refuses a role that does not belong to the shift's
  -- effective area.
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes,
                             status, area_id, workplace_role_id)
  values (:'ow', :'o_emp2', '2019-10-02 18:00Z', '2019-10-02 22:00Z', 0, 'submitted',
          :'o_bar', :'o_lead')
  returning id as o_open2 \gset
  select tests.denied(format('select public.archive_workplace_role(%L)', :'o_lead'),
    'F42 a role on an unfinished shift cannot be archived');
  update public.shifts set status = 'rejected' where id = :'o_open2';
  select public.archive_workplace_role(:'o_lead');
commit;

select tests.ok(
  (select archived_at is not null from public.workplace_roles where id = :'o_lead'),
  'F43 …and archives once it is free');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('update public.workplace_members set workplace_role_id = %L where id = %L',
           :'o_lead', :'o_emp2'),
    'F44 an archived role cannot be given to a team member');
  select tests.denied(
    format('insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
            values (%L, %L, ''2019-10-06 18:00Z'', ''2019-10-06 22:00Z'', 0, ''submitted'', %L, %L)',
           :'ow', :'o_emp2', :'o_bar', :'o_lead'),
    'F45 …nor put on a new shift');
commit;

-- A role cannot come back under an area that is still archived. Runner is the
-- area with nothing else in it, so it is the one that can actually be archived.
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.create_workplace_role(:'ow', :'o_runner', 'Late runner') as o_late \gset
commit;
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.archive_workplace_role(:'o_late');
  select public.archive_workplace_area(:'o_runner');
  select tests.denied(format('select public.restore_workplace_role(%L)', :'o_late'),
    'F46 a role cannot be restored while its area is still archived');
  select public.restore_workplace_area(:'o_runner');
  select public.restore_workplace_role(:'o_late');
commit;

select tests.ok(
  (select archived_at is null from public.workplace_roles where id = :'o_late'),
  'F47 …and comes back once the area does');

-- ═════════════════════════════════════════════════════════════════════════════
-- deleting, and what the database refuses to let go
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select public.create_workplace_area(:'ow', 'Typo Aera') as o_typo \gset
commit;
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  delete from public.workplace_areas where id = :'o_typo';
commit;
select tests.ok(
  not exists (select 1 from public.workplace_areas where id = :'o_typo'),
  'F48 an area nothing references can simply be deleted');

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.denied(format('delete from public.workplace_areas where id = %L', :'o_service'),
    'F49 …while one that is referenced cannot be, because every key into it restricts');
  select tests.denied(format('delete from public.workplace_roles where id = %L', :'o_server'),
    'F50 …and neither can a role that is');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- history does not move
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'ow', :'o_emp',  '2019-11-01 18:00Z', '2019-11-01 22:00Z', 0, 'approved'),
         (:'ow', :'o_emp2', '2019-11-01 18:00Z', '2019-11-01 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'ow', 'day', '2019-11-01', '2019-11-01', 'ops', 10000, :'o_mgr') returning id as o_pool \gset
  select public.calculate_distribution(:'o_pool') as o_dist \gset
  select public.send_distribution(:'o_dist');
commit;

select md5(string_agg(area_name || '|' || coalesce(role_name, '-') || '|' || points::text
                      || '|' || amount_cents::text, ';' order by id::text)) as o_before
  from public.tip_distribution_entries where distribution_id = :'o_dist' \gset

begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  update public.workplace_areas set name = 'Front of house' where id = :'o_service';
  update public.workplace_roles set name = 'Waiter', points = 2.20 where id = :'o_server';
commit;

select md5(string_agg(area_name || '|' || coalesce(role_name, '-') || '|' || points::text
                      || '|' || amount_cents::text, ';' order by id::text)) as o_after
  from public.tip_distribution_entries where distribution_id = :'o_dist' \gset

select tests.ok(:'o_before' = :'o_after',
  'F51 renaming an area and a role, and moving its points, leaves a paid distribution word for word as it was');

select tests.ok(
  (select count(*) from public.tip_distribution_entries
   where distribution_id = :'o_dist' and area_name = 'Service') = 2,
  'F52 …it still reads "Service", the name it was paid under');

select tests.ok(
  (select points from public.distribution_rule_roles
   where rule_id = (select rule_id from public.tip_distributions where id = :'o_dist')
     and workplace_role_id = :'o_server') = 1.00,
  'F53 …and the rule version it used still holds the points it froze');

-- ═════════════════════════════════════════════════════════════════════════════
-- the usage report
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1000000-0000-0000-0000-000000000001');
  select tests.ok(
    ((select public.area_usage(:'o_service')) ->> 'distributions')::int = 1,
    'F54 area_usage counts the distributions an area appears in');
  select tests.ok(
    ((select public.area_usage(:'o_service')) ->> 'open_shifts')::int = 0,
    'F55 …and does not count shifts already locked into one');
  select tests.ok(
    not ((select public.area_usage(:'o_service'))::text ~* 'cents|amount|total'),
    'F56 …and reports no money of any kind');

  -- `references` is the delete test, and it is stricter than the archive test:
  -- a rule row holding an area at 0% restricts the delete just as firmly as an
  -- active member does, so the UI must not offer Delete on the strength of the
  -- other counters alone.
  select tests.ok(
    ((select public.area_usage(:'o_runner')) ->> 'funded_rules')::int = 0
    and ((select public.area_usage(:'o_runner')) ->> 'references')::int > 0,
    'F57 an area with only a 0%% rule row has nothing funded, but is still referenced');
  select tests.ok(
    ((select public.role_usage(:'o_late')) ->> 'references')::int = 0,
    'F58 …while a role nothing points at reports no references at all');
commit;
