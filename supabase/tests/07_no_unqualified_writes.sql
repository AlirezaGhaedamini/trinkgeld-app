-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 17: the engine contains no write without a qualifier.
--
-- Supabase preloads pg_safeupdate into every PostgREST connection, so an
-- UPDATE or DELETE with no WHERE clause is refused with SQLSTATE 21000,
-- "UPDATE requires a WHERE clause" — even inside a SECURITY DEFINER function,
-- even against a session-local temp table. A plain PostgreSQL cluster has no
-- such hook, which is why this class of bug passed every local suite and only
-- surfaced against the live project.
--
-- Two assertions therefore:
--   G16–G17  a static lint over the installed function bodies, which is the
--            part a local cluster CAN check, and
--   G18–G22  the behaviour that actually failed: a manager calculating a
--            distribution on a valid pool and rule gets a draft.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the lint ────────────────────────────────────────────────────────────────
create or replace function tests.unqualified_writes()
returns table (fn text, stmt text) language plpgsql as $fn$
declare
  r    record;
  body text;
  frag text;
begin
  for r in
    select n.nspname as ns, p.proname as name, p.prosrc as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language  l on l.oid = p.prolang
    where n.nspname in ('public', 'app')
      and l.lanname in ('plpgsql', 'sql')
  loop
    -- Drop line comments first, so documentation about the old statement is
    -- not mistaken for the statement.
    body := regexp_replace(r.src, '--[^\n]*', '', 'g');
    foreach frag in array string_to_array(body, ';')
    loop
      if frag ~* '^\s*(update|delete\s+from)\s' and frag !~* '\mwhere\M' then
        fn   := r.ns || '.' || r.name;
        stmt := trim(regexp_replace(frag, '\s+', ' ', 'g'));
        return next;
      end if;
    end loop;
  end loop;
end $fn$;

select tests.ok(
  not exists (select 1 from tests.unqualified_writes() where fn = 'public.calculate_distribution'),
  'G16 calculate_distribution() contains no UPDATE or DELETE without a WHERE clause');

select tests.ok(
  not exists (select 1 from tests.unqualified_writes()),
  'G17 …and neither does any other function in public or app');

-- ── the behaviour that failed live ──────────────────────────────────────────
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-000000000001', 'guard.manager@test.local')
on conflict do nothing;

begin;
  select tests.as_user('f0000000-0000-0000-0000-000000000001');
  select public.create_workplace('Guard Lab', 'Marburg') as gw \gset
commit;

select id as g_service from public.workplace_areas   where workplace_id = :'gw' and key = 'service' \gset
select id as g_server  from public.workplace_roles   where workplace_id = :'gw' and key = 'server'  \gset
select id as g_boss    from public.workplace_members where workplace_id = :'gw' and role = 'manager' \gset

begin;
  select tests.as_user('f0000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'g_service', workplace_role_id = :'g_server'
    where id = :'g_boss';
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'gw', 'Ida', 'employee', :'g_service', :'g_server', 'active') returning id as g_ida \gset
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'gw', 'Jan', 'employee', :'g_service', :'g_server', 'active') returning id as g_jan \gset

  select id as gr from public.distribution_rules where workplace_id = :'gw' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours_points', min_overlap_minutes = 15 where id = :'gr';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'gr' and area_id = :'g_service';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'gr' and area_id <> :'g_service';
  select public.activate_rule(:'gr');

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'gw', :'g_ida', '2026-07-01 17:00+02', '2026-07-01 23:00+02', 0, 'approved'),
         (:'gw', :'g_jan', '2026-07-01 18:00+02', '2026-07-02 00:00+02', 0, 'approved');

  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'gw', 'day', '2026-07-01', '2026-07-01', 'guard', 10000, :'g_boss') returning id as g_pool \gset
commit;

-- The exact live call that returned HTTP 400 / 21000.
begin;
  select tests.as_user('f0000000-0000-0000-0000-000000000001');
  select public.calculate_distribution(:'g_pool') as g_dist \gset
commit;

select tests.ok(:'g_dist' is not null,
  'G18 the manager can calculate a distribution on a valid pool and rule — no SQLSTATE 21000');

select tests.ok(
  (select status from public.tip_distributions where id = :'g_dist') = 'draft',
  'G19 …and what comes back is a draft');

select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'g_dist') = 2,
  'G20 …with one entry per eligible member');

select tests.ok(
  (select sum(amount_cents) from public.tip_distribution_entries where distribution_id = :'g_dist') = 10000,
  'G21 …and the entries account for the whole pool, to the cent');

-- `units` is the column the removed UPDATE used to fill: 6 h each at 1 point
-- and multiplier 1, so equal halves. If the CTAS lost the value the split
-- would collapse, so this asserts the replacement computes what it replaced.
select tests.ok(
  (select count(distinct amount_cents) from public.tip_distribution_entries where distribution_id = :'g_dist') = 1
  and (select min(amount_cents) from public.tip_distribution_entries where distribution_id = :'g_dist') = 5000,
  'G22 …split by worked hours exactly as before the fix (5000 / 5000)');
