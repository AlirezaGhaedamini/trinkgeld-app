-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3S-C · a manager can see their team's email addresses (migration 40)
--
-- Managers asked to see members' emails in the Team area. public.profiles is
-- readable only by its owner, so team_member_emails() hands a manager ONE field
-- of the profile — the address — for the members of ONE workplace they actively
-- manage, and refuses everyone else.
--
-- The assertions that matter most here are the refusals: an employee, a peer, a
-- manager of a DIFFERENT workplace, a suspended manager, and nobody at all. A
-- negative control at the end removes the manager check inside a rolled-back
-- transaction and watches an employee get the list, so the refusals cannot be
-- passing for some other reason.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function tests.tm_said(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.tm_said(text) to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2100000-0000-0000-0000-000000000001', 'tm.boss@test.local',  '{"full_name":"TM Boss"}'),
  ('a2100000-0000-0000-0000-000000000002', 'tm.staff@test.local', '{"full_name":"TM Staff"}'),
  ('a2100000-0000-0000-0000-000000000003', 'tm.co@test.local',    '{"full_name":"TM Co"}'),
  ('a2100000-0000-0000-0000-000000000004', 'tm.rival@test.local', '{"full_name":"TM Rival"}')
on conflict do nothing;

-- Workplace W, managed by boss.
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  select public.create_workplace('Team Lab', 'Kiel') as tw \gset
commit;
select id as t_boss from public.workplace_members where workplace_id = :'tw' and role = 'manager' \gset

-- Workplace X, managed by rival — who is ALSO an employee of W, the case where a
-- person could otherwise be mistaken for a manager of the wrong workplace.
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000004');
  select public.create_workplace('Rival Lab', 'Kiel') as tx \gset
commit;

begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  select token from public.create_invitation(:'tw', 'tm.staff@test.local', 'TM Staff', 'employee') as t \gset s_
  select token from public.create_invitation(:'tw', 'tm.co@test.local',    'TM Co',    'manager')  as t \gset c_
  select token from public.create_invitation(:'tw', 'tm.rival@test.local', 'TM Rival', 'employee') as t \gset r_
  -- Never accepted: a roster placeholder with no account behind it.
  select token from public.create_invitation(:'tw', 'tm.pending@test.local', 'TM Pending', 'employee') as t \gset p_
commit;
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'s_token') as t_staff \gset
commit;
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000003');
  select public.accept_invitation(:'c_token') as t_co \gset
commit;
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000004');
  select public.accept_invitation(:'r_token') as t_rival_in_w \gset
commit;
select id as t_pending from public.workplace_members
where workplace_id = :'tw' and display_name = 'TM Pending' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- M · the manager of this workplace sees it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  select count(*) as m_rows from public.team_member_emails(:'tw') \gset
  select email as m_staff from public.team_member_emails(:'tw') where member_id = :'t_staff' \gset
  select email as m_boss  from public.team_member_emails(:'tw') where member_id = :'t_boss' \gset
commit;
select tests.ok(:'m_staff' = 'tm.staff@test.local',
  'M1  a manager sees the email address of an employee in their workplace');
select tests.ok(:'m_boss' = 'tm.boss@test.local',
  'M2  …and their own');
select tests.ok(:'m_rows'::int = 4,
  'M3  …one row per member with an account: boss, staff, co and rival — not the placeholder');

select tests.ok(
  (select pg_catalog.pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'team_member_emails')
  = 'TABLE(member_id uuid, email text)',
  'M4  it returns the member id and the email and nothing else from the profile');

begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  select count(*) as m_pending from public.team_member_emails(:'tw') where member_id = :'t_pending' \gset
commit;
select tests.ok(:'m_pending'::int = 0,
  'M5  a member with no account has no address to show, and none is invented');

-- ═════════════════════════════════════════════════════════════════════════════
-- R · and nobody else does
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000002');
  select tests.tm_said(format('select * from public.team_member_emails(%L)', :'tw')) as r_staff \gset
commit;
select tests.ok(:'r_staff' like '%only a manager%',
  'R1  an employee of the workplace is refused');

-- rival manages X and is an employee of W.
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000004');
  select tests.tm_said(format('select * from public.team_member_emails(%L)', :'tw')) as r_cross \gset
commit;
select tests.ok(:'r_cross' like '%only a manager%',
  'R2  a manager of ANOTHER workplace is refused, even while an employee of this one');

begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000004');
  select count(*) as r_own from public.team_member_emails(:'tx') \gset
  select count(*) as r_leak from public.team_member_emails(:'tx')
   where email in ('tm.boss@test.local', 'tm.staff@test.local', 'tm.co@test.local') \gset
commit;
select tests.ok(:'r_own'::int = 1 and :'r_leak'::int = 0,
  'R3  asked about their OWN workplace, that manager gets only its members — none of W''s');

-- Suspend the co-manager; boss remains the active manager of W.
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'t_co';
commit;
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000003');
  select tests.tm_said(format('select * from public.team_member_emails(%L)', :'tw')) as r_susp \gset
commit;
select tests.ok(:'r_susp' like '%only a manager%',
  'R4  a suspended manager is refused — only an ACTIVE manager may look');

begin;
  set local role anon;
  select tests.tm_said(format('select * from public.team_member_emails(%L)', :'tw')) as r_anon \gset
commit;
select tests.ok(:'r_anon' <> '',
  'R5  and so is somebody who is not signed in at all');

-- ═════════════════════════════════════════════════════════════════════════════
-- P · reading is all it does
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  select tests.changes_nothing(
    format('update public.profiles set email = %L where id = %L',
           'hijacked@test.local', 'a2100000-0000-0000-0000-000000000002'),
    'P1  a manager still cannot change a member''s email address');
commit;
select tests.ok(
  (select email::text = 'tm.staff@test.local' from public.profiles
    where id = 'a2100000-0000-0000-0000-000000000002'),
  'P2  …the member''s address is exactly as it was');
begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  select count(*) as p_seen from public.profiles
   where id = 'a2100000-0000-0000-0000-000000000002' \gset
commit;
select tests.ok(:'p_seen'::int = 0,
  'P3  …and the profile itself is still unreadable to the manager — only the one field is shared');

-- ═════════════════════════════════════════════════════════════════════════════
-- NC · the manager check is load-bearing
-- Replace the function with one that skips app.is_manager() — as the owner,
-- which nothing in the product can do — and the employee R1 refused gets the
-- list. Rolled back, so nothing survives.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  create or replace function public.team_member_emails(p_workplace_id uuid)
  returns table (member_id uuid, email text)
  language plpgsql stable security definer set search_path = '' as $$
  begin
    return query
    select m.id, pr.email::text
    from public.workplace_members m
    join public.profiles pr on pr.id = m.user_id
    where m.workplace_id = p_workplace_id and pr.email is not null;
  end;
  $$;
  select tests.as_user('a2100000-0000-0000-0000-000000000002');
  select count(*) as nc_rows from public.team_member_emails(:'tw') \gset
rollback;
select tests.ok(:'nc_rows'::int > 0,
  'NC1 without the manager check the employee gets the list — that check is what refused them');

begin;
  select tests.as_user('a2100000-0000-0000-0000-000000000002');
  select tests.tm_said(format('select * from public.team_member_emails(%L)', :'tw')) as nc_after \gset
commit;
select tests.ok(:'nc_after' like '%only a manager%',
  'NC2 …and with the control rolled back the employee is refused again');

-- ═════════════════════════════════════════════════════════════════════════════
-- S · privileges, as the HOSTED project grants them
--
-- The local shim has no default privileges; Supabase does. There, every new
-- function in `public` is granted EXECUTE to anon, authenticated and
-- service_role by name, and `revoke … from public` does not remove the anon
-- grant — proven live against pending_join_requests(). These blocks reproduce
-- that platform default, recreate the function from the SHIPPED migration file,
-- and check what anon is left with.
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  not has_function_privilege('anon', 'public.team_member_emails(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.team_member_emails(uuid)', 'execute')
  and (select proacl::text from pg_proc where proname = 'team_member_emails') !~ '(^|[{,])=X'
  and (select proacl::text from pg_proc where proname = 'team_member_emails') !~ 'anon=',
  'S1  as deployed: anon cannot execute, authenticated can, and PUBLIC holds no grant');

select tests.ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'team_member_emails'),
  'S2  it is SECURITY DEFINER with a fixed, empty search_path');

begin;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  drop function public.team_member_emails(uuid);
  \ir ../migrations/20260901004000_team_member_emails.sql
  select has_function_privilege('anon', 'public.team_member_emails(uuid)', 'execute') as s_anon_hosted \gset
  select has_function_privilege('authenticated', 'public.team_member_emails(uuid)', 'execute') as s_auth_hosted \gset
rollback;
select tests.ok(:'s_anon_hosted' = 'f' and :'s_auth_hosted' = 't',
  'S3  under Supabase''s own default privileges the shipped migration still leaves anon without EXECUTE');

-- Negative control: the same platform default, the migration's grant block
-- WITHOUT the explicit anon revoke — and anon can execute. So the revoke is
-- what defeats the platform default, not something else.
begin;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  drop function public.team_member_emails(uuid);
  create function public.team_member_emails(p_workplace_id uuid)
  returns table (member_id uuid, email text)
  language plpgsql stable security definer set search_path = '' as $$
  begin
    if not app.is_manager(p_workplace_id) then
      raise exception 'only a manager of this workplace may read its team''s email addresses' using errcode = '42501';
    end if;
    return query select m.id, pr.email::pg_catalog.text from public.workplace_members m
      join public.profiles pr on pr.id = m.user_id
      where m.workplace_id = p_workplace_id and pr.email is not null;
  end; $$;
  revoke all on function public.team_member_emails(uuid) from public;
  grant execute on function public.team_member_emails(uuid) to authenticated;
  select has_function_privilege('anon', 'public.team_member_emails(uuid)', 'execute') as s_anon_nc \gset
rollback;
select tests.ok(:'s_anon_nc' = 't',
  'NC3 without the explicit revoke, the platform default hands anon EXECUTE — the revoke is load-bearing');

-- ═════════════════════════════════════════════════════════════════════════════
-- H · no search_path hijack through the temp schema
--
-- With search_path = '', PostgreSQL still looks in the session's pg_temp FIRST
-- for type names, and authenticated holds TEMPORARY. So an unqualified `::text`
-- inside this SECURITY DEFINER function could be captured by a type the caller
-- planted. The shipped function casts to pg_catalog.text.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  -- A fresh copy of the shipped function, so no plan cached earlier in this
  -- session can make the test pass on a stale resolution.
  drop function public.team_member_emails(uuid);
  \ir ../migrations/20260901004000_team_member_emails.sql
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  create type pg_temp.text as (hijacked int);
  select email as h_staff from public.team_member_emails(:'tw') where member_id = :'t_staff' \gset
rollback;
select tests.ok(:'h_staff' = 'tm.staff@test.local',
  'H1  a manager who has planted a pg_temp.text type still gets the real address — the cast cannot be captured');

-- Negative control: the same planted type against an UNQUALIFIED ::text, and the
-- call breaks. So qualifying the cast is what holds.
begin;
  drop function public.team_member_emails(uuid);
  create function public.team_member_emails(p_workplace_id uuid)
  returns table (member_id uuid, email text)
  language plpgsql stable security definer set search_path = '' as $$
  begin
    if not app.is_manager(p_workplace_id) then
      raise exception 'only a manager of this workplace may read its team''s email addresses' using errcode = '42501';
    end if;
    return query select m.id, pr.email::text from public.workplace_members m
      join public.profiles pr on pr.id = m.user_id
      where m.workplace_id = p_workplace_id and pr.email is not null;
  end; $$;
  grant execute on function public.team_member_emails(uuid) to authenticated;
  select tests.as_user('a2100000-0000-0000-0000-000000000001');
  create type pg_temp.text as (hijacked int);
  select tests.tm_said(format('select * from public.team_member_emails(%L)', :'tw')) as h_nc \gset
rollback;
select tests.ok(:'h_nc' <> '',
  'NC4 with an UNQUALIFIED ::text the planted type captures the cast and the call breaks — the qualification is load-bearing');

select tests.ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'team_member_emails')
  and not has_function_privilege('anon', 'public.team_member_emails(uuid)', 'execute')
  and pg_catalog.pg_get_functiondef('public.team_member_emails(uuid)'::regprocedure) like '%pg_catalog.text%',
  'NC5 …and every control rolled back: the deployed function is the hardened one again');
