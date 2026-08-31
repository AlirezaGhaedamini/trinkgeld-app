-- ─────────────────────────────────────────────────────────────────────────────
-- Test helpers and a deterministic fixture.
--
-- Runs as the database owner, so it may write directly where a real client
-- would not. Everything that models a user action goes through the same RPCs
-- and policies the application uses.
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists tests;

create or replace function tests.ok(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

-- Asserts that a statement is refused. Any error counts: a policy violation, a
-- missing privilege or a trigger raise are all "refused".
create or replace function tests.denied(p_sql text, p_label text)
returns void language plpgsql as $$
declare v_refused boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL  % — the statement was allowed', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end $$;

-- "Cannot" covers both shapes RLS takes: a hard refusal, or a policy that
-- silently matches no rows. Either outcome passes; a row actually changing fails.
create or replace function tests.changes_nothing(p_sql text, p_label text)
returns void language plpgsql as $$
declare v_count integer := 0;
begin
  begin
    execute p_sql;
    get diagnostics v_count = row_count;
  exception when others then
    v_count := 0;
  end;
  if v_count > 0 then
    raise exception 'FAIL  % — % row(s) changed', p_label, v_count;
  end if;
  raise notice 'PASS  %', p_label;
end $$;

create or replace function tests.as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

grant usage on schema tests to authenticated;
grant select on all tables in schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ── fixture ─────────────────────────────────────────────────────────────────
-- Two workplaces so cross-tenant isolation can be tested, and one person who
-- belongs to both with different roles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'daan@alto.test',  '{"full_name":"Daan Visser"}'),
  ('a0000000-0000-0000-0000-000000000002', 'lena@alto.test',  '{"full_name":"Lena Mertens"}'),
  ('a0000000-0000-0000-0000-000000000003', 'nina@alto.test',  '{"full_name":"Nina Kovac"}'),
  ('b0000000-0000-0000-0000-000000000001', 'bea@beta.test',   '{"full_name":"Bea Ruiz"}'),
  ('c0000000-0000-0000-0000-000000000001', 'multi@both.test', '{"full_name":"Marco Riva"}');

-- Workplace A, created by Daan.
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select public.create_workplace('Café Alto', 'Rotterdam') as wid \gset
commit;

-- Workplace B, created by Bea.
begin;
  select tests.as_user('b0000000-0000-0000-0000-000000000001');
  select public.create_workplace('Bar Beta', 'Utrecht', 'Europe/Amsterdam') as wid_b \gset
commit;

create table if not exists tests.ids (k text primary key, v uuid);
insert into tests.ids (k, v) values ('wp_a', :'wid'), ('wp_b', :'wid_b')
  on conflict (k) do update set v = excluded.v;

-- Invite Lena and Nina into A, and Marco into A as an employee.
begin;
  select tests.as_user('a0000000-0000-0000-0000-000000000001');
  select
    (select id from public.workplace_areas where workplace_id = :'wid' and key = 'service') as a_service,
    (select id from public.workplace_areas where workplace_id = :'wid' and key = 'bar')     as a_bar,
    (select id from public.workplace_roles where workplace_id = :'wid' and key = 'server')    as r_server,
    (select id from public.workplace_roles where workplace_id = :'wid' and key = 'bartender') as r_bartender
  \gset
  select token from public.create_invitation(
    :'wid', 'lena@alto.test', 'Lena Mertens', 'employee', :'a_service', :'r_server') as t1 \gset tok_lena_
  select token from public.create_invitation(
    :'wid', 'nina@alto.test', 'Nina Kovac', 'employee', :'a_bar', :'r_bartender') as t2 \gset tok_nina_
  select token from public.create_invitation(
    :'wid', 'multi@both.test', 'Marco Riva', 'employee', :'a_service', :'r_server') as t3 \gset tok_marco_
commit;

begin; select tests.as_user('a0000000-0000-0000-0000-000000000002');
       select public.accept_invitation(:'tok_lena_token'); commit;
begin; select tests.as_user('a0000000-0000-0000-0000-000000000003');
       select public.accept_invitation(:'tok_nina_token'); commit;
begin; select tests.as_user('c0000000-0000-0000-0000-000000000001');
       select public.accept_invitation(:'tok_marco_token'); commit;

-- Marco is also a manager in workplace B.
begin;
  select tests.as_user('b0000000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'wid_b', 'multi@both.test', 'Marco Riva', 'manager', null, null) as t4 \gset tokb_
commit;
begin; select tests.as_user('c0000000-0000-0000-0000-000000000001');
       select public.accept_invitation(:'tokb_token'); commit;

insert into tests.ids (k, v)
select 'm_daan',  id from public.workplace_members where workplace_id = :'wid' and display_name = 'Daan Visser'
on conflict (k) do update set v = excluded.v;
insert into tests.ids (k, v)
select 'm_lena',  id from public.workplace_members where workplace_id = :'wid' and display_name = 'Lena Mertens'
on conflict (k) do update set v = excluded.v;
insert into tests.ids (k, v)
select 'm_nina',  id from public.workplace_members where workplace_id = :'wid' and display_name = 'Nina Kovac'
on conflict (k) do update set v = excluded.v;
insert into tests.ids (k, v)
select 'm_marco', id from public.workplace_members where workplace_id = :'wid' and display_name = 'Marco Riva'
on conflict (k) do update set v = excluded.v;

select tests.ok(
  (select count(*) from public.workplace_members where workplace_id = :'wid') = 4,
  'fixture: workplace A has four members');
select tests.ok(
  (select count(*) from public.workplace_members where user_id = 'c0000000-0000-0000-0000-000000000001') = 2,
  'fixture: Marco belongs to two workplaces');
select tests.ok(
  (select role from public.workplace_members
   where user_id = 'c0000000-0000-0000-0000-000000000001' and workplace_id = :'wid_b') = 'manager',
  'fixture: Marco is a manager in B and an employee in A');
