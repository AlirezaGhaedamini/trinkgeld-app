-- ─────────────────────────────────────────────────────────────────────────────
-- Security scenarios that need no distribution: submission, escalation,
-- tenant isolation, invitations, direct table access.
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
select v as wp_a from tests.ids where k = 'wp_a' \gset
select v as wp_b from tests.ids where k = 'wp_b' \gset
select v as m_lena from tests.ids where k = 'm_lena' \gset
select v as m_nina from tests.ids where k = 'm_nina' \gset
select v as m_daan from tests.ids where k = 'm_daan' \gset

grant select on all tables in schema tests to authenticated;

-- ── 1 · an employee can submit their own shift ──────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');  -- Lena
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, submitted_at)
  values (:'wp_a', :'m_lena', '2026-08-22 17:00+02', '2026-08-23 01:30+02', 30, 'submitted', now());
  select tests.ok((select count(*) from public.shifts where member_id = :'m_lena') = 1,
                  '01  employee can submit their own shift');
commit;

-- ── 2 · but not one for somebody else ───────────────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'insert into public.shifts (workplace_id, member_id, starts_at, ends_at, status)
     values (%L, %L, ''2026-08-22 16:00+02'', ''2026-08-22 23:00+02'', ''submitted'')',
    :'wp_a', :'m_nina'),
    '02  employee cannot submit a shift for another member');
commit;

-- ── 3 · an employee cannot promote themselves ───────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'update public.workplace_members set role = ''manager'' where id = %L', :'m_lena'),
    '03  employee cannot promote themselves to manager');
  select tests.changes_nothing(format(
    'update public.workplace_members set multiplier = 2.00 where id = %L', :'m_lena'),
    '03b employee cannot raise their own multiplier');
  select tests.changes_nothing(format(
    'update public.workplace_members set role = ''manager'' where id = %L', :'m_nina'),
    '03c employee cannot promote a colleague');
commit;
select tests.ok((select role from public.workplace_members where id = :'m_lena') = 'employee',
                '03d Lena is still an employee');

-- ── 4 · an employee cannot edit the workplace rules ─────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(format(
    'update public.distribution_rules set min_overlap_minutes = 60 where workplace_id = %L', :'wp_a'),
    '04  employee cannot change the minimum overlap');
  select tests.changes_nothing(format(
    'update public.distribution_rule_areas set percentage = 99 where workplace_id = %L', :'wp_a'),
    '04b employee cannot change area percentages');
  select tests.denied(format(
    'insert into public.distribution_rules (workplace_id, status) values (%L, ''draft'')', :'wp_a'),
    '04c employee cannot create a rule version');
  select tests.changes_nothing(format(
    'update public.workplaces set peer_entry_visibility = ''workplace'' where id = %L', :'wp_a'),
    '04d employee cannot change workplace settings');
commit;

-- ── 5 · an employee cannot touch a tip pool ─────────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');  -- Daan, manager
  insert into public.tip_pools (workplace_id, period_start, period_end, card_cents, cash_cents, created_by)
  values (:'wp_a', '2026-08-22', '2026-08-22', 178500, 69500, :'m_daan');
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'insert into public.tip_pools (workplace_id, period_start, period_end, card_cents)
     values (%L, ''2026-08-23'', ''2026-08-23'', 100000)', :'wp_a'),
    '05  employee cannot create a tip pool');
  select tests.changes_nothing(
    'update public.tip_pools set card_cents = 1 where card_cents = 178500',
    '05b employee cannot change a pool amount');
  select tests.ok((select count(*) from public.tip_pools) = 0,
    '05c employee sees no pools at all');
commit;

-- ── 11 · a manager in one workplace has no authority in another ─────────────
begin;
  select tests.as_user('c0000000-0000-0000-0000-000000000001');  -- Marco: manager in B, employee in A
  select tests.ok(app.is_manager(:'wp_b'), '11  Marco manages workplace B');
  select tests.ok(not app.is_manager(:'wp_a'), '11b Marco does not manage workplace A');
  select tests.changes_nothing(format(
    'update public.workplaces set name = ''Hijacked'' where id = %L', :'wp_a'),
    '11c a manager of B cannot rename workplace A');
  select tests.changes_nothing(format(
    'update public.distribution_rules set min_overlap_minutes = 60 where workplace_id = %L', :'wp_a'),
    '11d a manager of B cannot edit the rules of A');
  select tests.ok((select count(*) from public.tip_pools) = 0,
    '11e a manager of B sees no pool belonging to A');
commit;

-- ── 12 · belonging to two workplaces is safe ────────────────────────────────
begin;
  select tests.as_user('c0000000-0000-0000-0000-000000000001');
  select tests.ok((select count(*) from public.workplaces) = 2,
    '12  Marco sees exactly his two workplaces');
  select tests.ok((select count(*) from public.workplace_members) = 6,
    '12b he sees the rosters of both, and nothing else');
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');  -- Lena, workplace A only
  select tests.ok((select count(*) from public.workplaces) = 1,
    '12c Lena sees only her own workplace');
  select tests.ok((select count(*) from public.workplace_members where workplace_id = :'wp_b') = 0,
    '12d Lena sees nothing from workplace B');
commit;

-- ── 17 · an invitation cannot be reused or replayed ─────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'wp_a', 'once@alto.test', 'Single Use', 'employee', null, null) \gset once_
commit;
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'once@alto.test'),
  ('d0000000-0000-0000-0000-000000000002', 'thief@alto.test');

begin; select tests.as_user('d0000000-0000-0000-0000-000000000001');
       select public.accept_invitation(:'once_token'); commit;
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.accept_invitation(%L)', :'once_token'),
    '17  an accepted invitation cannot be used a second time');
  select tests.denied('select public.accept_invitation(''not-a-real-token'')',
    '17b a made-up token is refused');
commit;

-- expiry
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'wp_a', 'late@alto.test', 'Too Late', 'employee', null, null) \gset late_
commit;
update public.invitations set expires_at = now() - interval '1 day'
where email = 'late@alto.test';
insert into auth.users (id, email) values ('d0000000-0000-0000-0000-000000000003', 'late@alto.test');
begin;
  select tests.as_user('d0000000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.accept_invitation(%L)', :'late_token'),
    '17c an expired invitation is refused');
commit;

-- an employee cannot mint an invitation, and a join request can never be manager
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'select public.create_invitation(%L, ''x@alto.test'', ''X'', ''manager'', null, null)', :'wp_a'),
    '17d an employee cannot create an invitation');
  select tests.denied(format(
    'insert into public.invitations (workplace_id, kind, email, proposed_role)
     values (%L, ''invite'', ''y@alto.test'', ''manager'')', :'wp_a'),
    '17e nobody can INSERT an invitation directly');
commit;

-- ── 18 · direct writes to calculated or manager-only tables are refused ─────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'insert into public.tip_distributions
       (workplace_id, tip_pool_id, rule_id, rule_version, period_start, period_end,
        pool_cents, method, min_overlap_minutes, overlap_basis, rules_snapshot,
        inputs_snapshot, engine_version)
     select %L, p.id, r.id, 1, ''2026-08-22'', ''2026-08-22'', 1, ''hours'', 15,
            ''longest_shift'', ''{}''::jsonb, ''{}''::jsonb, ''x''
     from public.tip_pools p, public.distribution_rules r limit 1', :'wp_a'),
    '18  employee cannot insert a distribution');
  select tests.denied(
    'insert into public.tip_distribution_entries
       (distribution_id, workplace_id, member_id, member_name, area_id, area_key, area_name)
     values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ''x'',
             gen_random_uuid(), ''x'', ''x'')',
    '18b employee cannot insert a distribution entry');
  select tests.denied(
    'insert into public.audit_log (workplace_id, table_name, record_id, action)
     values (gen_random_uuid(), ''shifts'', gen_random_uuid(), ''update'')',
    '18c nobody can write the audit log directly');
  select tests.changes_nothing(
    'delete from public.audit_log where true', '18d nobody can delete the audit log');
  select tests.ok((select count(*) from public.profiles where id <> auth.uid()) = 0,
    '18e another user''s profile is invisible');
  select tests.ok((select count(*) from public.profiles) = 1,
    '18f only your own profile is readable');
commit;

-- ── a workplace must keep at least one manager ──────────────────────────────
-- The guard is a DEFERRED constraint trigger, so that a manager handover can
-- promote and demote inside one transaction. Forcing it immediate is how the
-- test observes it without ending the session's transaction.
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');  -- Daan, the only manager of A
  select tests.denied(format(
    'update public.workplace_members set role = ''employee'' where id = %L;
     set constraints public.workplace_members_last_manager immediate;', :'m_daan'),
    '19  the last manager cannot demote themselves');
  select tests.denied(format(
    'update public.workplace_members set status = ''left'' where id = %L;
     set constraints public.workplace_members_last_manager immediate;', :'m_daan'),
    '19b nor step down and leave the workplace unmanaged');
commit;
select tests.ok(
  (select count(*) from public.workplace_members
    where workplace_id = :'wp_a' and role = 'manager' and status = 'active') = 1,
  '19c workplace A still has its manager');

-- ── a locked shift is frozen for the employee ───────────────────────────────
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.shifts set locked = true where member_id = :'m_lena';
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000002');
  select tests.changes_nothing(format(
    'update public.shifts set break_minutes = 0 where member_id = %L', :'m_lena'),
    '20  an employee cannot edit a locked shift');
  select tests.changes_nothing(format(
    'update public.shifts set locked = false where member_id = %L', :'m_lena'),
    '20b nor unlock it themselves');
commit;
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false where member_id = :'m_lena';
  select tests.ok((select not locked from public.shifts where member_id = :'m_lena'),
    '20c a manager can unlock it');
commit;
