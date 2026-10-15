-- ─────────────────────────────────────────────────────────────────────────────
-- Invitation-aware onboarding · the preview and the two name rules (migration 41)
--
-- Three things are proven here. P: a visitor with no account can read, from
-- the token alone, exactly what the invitation email said — and nothing from
-- an unknown token. F: a used, expired or withdrawn invitation says so and
-- still cannot be joined. A/B/H: a brand-new account takes its first name from
-- the sign-up metadata the invitation filled in, while an existing account
-- keeps its own name through acceptance, and no manager of any workplace can
-- write it. C: only the account that owns the invited address can accept,
-- and a refused account changes nothing. Negative controls show the token
-- lookup, the address check and the cast qualification are load-bearing.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function tests.ip_said(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.ip_said(text) to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2700000-0000-0000-0000-000000000001', 'ip.boss@test.local',     '{"full_name":"IP Boss"}'),
  ('a2700000-0000-0000-0000-000000000002', 'ip.existing@test.local', '{"full_name":"Mohammad Masoud Ahmadi"}'),
  ('a2700000-0000-0000-0000-000000000003', 'ip.other@test.local',    '{"full_name":"IP Other"}'),
  ('a2700000-0000-0000-0000-000000000004', 'ip.rival@test.local',    '{"full_name":"IP Rival"}')
on conflict do nothing;

-- Workplace "Cafe Test", managed by boss; a second workplace managed by rival.
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  select public.create_workplace('Cafe Test', 'Kiel') as ipw \gset
commit;
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000004');
  select public.create_workplace('Rival Cafe', 'Kiel') as ipx \gset
commit;
select id as ip_service from public.workplace_areas where workplace_id = :'ipw' and key = 'service' \gset
select id as ip_server  from public.workplace_roles where workplace_id = :'ipw' and key = 'server'  \gset

begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  -- The invitation the whole feature is about: a named newcomer with area and role.
  select token from public.create_invitation(
    :'ipw', 'masoud@test.local', 'Masoud', 'employee', :'ip_service', :'ip_server') as t \gset new_
  -- The same manager-entered name, sent to somebody who already has a profile.
  select token from public.create_invitation(
    :'ipw', 'ip.existing@test.local', 'Masoud', 'employee', :'ip_service', :'ip_server') as t \gset ex_
  select token from public.create_invitation(:'ipw', 'ip.expired@test.local', 'Expired Person', 'employee') as t \gset exp_
  select token from public.create_invitation(:'ipw', 'ip.revoked@test.local', 'Revoked Person', 'employee') as t \gset rev_
  select token from public.create_invitation(:'ipw', 'ip.other@test.local',   'Other Person',   'manager')  as t \gset oth_
commit;

-- Age one as the owner (time cannot be made to pass), withdraw one as the manager.
update public.invitations set expires_at = now() - interval '1 minute'
 where token_hash = encode(extensions.digest(:'exp_token', 'sha256'), 'hex');
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  update public.invitations set status = 'revoked', revoked_at = now()
   where token_hash = encode(extensions.digest(:'rev_token', 'sha256'), 'hex');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- P · what a visitor with no account sees
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  set local role anon;
  select count(*) as p_rows from public.invitation_preview(:'new_token') \gset
  select workplace_name as p_wp, invited_name as p_name, email as p_email,
         area_name as p_area, role_name as p_role, proposed_role::text as p_prole,
         status as p_status
    from public.invitation_preview(:'new_token') \gset
commit;
select tests.ok(:'p_rows'::int = 1 and :'p_wp' = 'Cafe Test',
  'P1  the token alone, with no session, names the workplace');
select tests.ok(:'p_name' = 'Masoud' and :'p_email' = 'masoud@test.local',
  'P2  …and the invited name and address the manager entered');
select tests.ok(:'p_area' = 'Service' and :'p_role' = 'Server' and :'p_prole' = 'employee',
  'P3  …and the area, the workplace role and the proposed membership role');
select tests.ok(:'p_status' = 'pending',
  'P4  …as a pending invitation');

begin;
  set local role anon;
  select count(*) as p_unknown from public.invitation_preview(repeat('0', 64)) \gset
  select count(*) as p_empty   from public.invitation_preview('') \gset
  select count(*) as p_null    from public.invitation_preview(null) \gset
commit;
select tests.ok(:'p_unknown'::int = 0 and :'p_empty'::int = 0 and :'p_null'::int = 0,
  'P5  an unknown, empty or null token returns no row and no error — nothing is confirmed');

select tests.ok(
  (select pg_catalog.pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invitation_preview')
  like 'TABLE(workplace_name text, invited_name text, email text, area_name text, role_name text, proposed_role %, status text, expires_at timestamp with time zone)',
  'P6  it returns the shown fields and nothing else: no id, no token hash, no inviter, no join code');

select tests.ok(
  (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invitation_preview'),
  'P7  it is STABLE (reads only), SECURITY DEFINER, with a fixed empty search_path');

-- ═════════════════════════════════════════════════════════════════════════════
-- F · a link that no longer works says so, and still cannot be joined
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  set local role anon;
  select status as f_expired from public.invitation_preview(:'exp_token') \gset
  select status as f_revoked from public.invitation_preview(:'rev_token') \gset
commit;
select tests.ok(:'f_expired' = 'expired',
  'F1  an invitation past its expiry previews as expired');
select tests.ok(
  (select status::text from public.invitations
    where token_hash = encode(extensions.digest(:'exp_token', 'sha256'), 'hex')) = 'pending',
  'F2  …computed, not written: the preview changed nothing on the row');
select tests.ok(:'f_revoked' = 'revoked',
  'F3  a withdrawn invitation previews as revoked');

-- A stale link names nobody: status only, every other column NULL.
begin;
  set local role anon;
  select (workplace_name, invited_name, email, area_name, role_name, proposed_role, expires_at)
         is not distinct from (null::text, null::text, null::text, null::text, null::text,
                               null::public.member_role, null::timestamptz) as l_exp_blank,
         count(*) over () as l_exp_rows
    from public.invitation_preview(:'exp_token') \gset
  select (workplace_name, invited_name, email, area_name, role_name, proposed_role, expires_at)
         is not distinct from (null::text, null::text, null::text, null::text, null::text,
                               null::public.member_role, null::timestamptz) as l_rev_blank
    from public.invitation_preview(:'rev_token') \gset
commit;
select tests.ok(:'l_exp_rows'::int = 1 and :'l_exp_blank'::boolean,
  'L1  an expired invitation previews as one row: status ''expired'' and NULL name, address, workplace, area, role, expiry');
select tests.ok(:'l_rev_blank'::boolean,
  'L2  …and so does a withdrawn one');

begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000003');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'exp_token')) as f_join_exp \gset
  select tests.ip_said(format('select public.accept_invitation(%L)', :'rev_token')) as f_join_rev \gset
commit;
select tests.ok(:'f_join_exp' like '%expired%',
  'F4  joining on the expired link is still refused by accept_invitation()');
select tests.ok(:'f_join_rev' like '%already been used or withdrawn%',
  'F5  …and so is the withdrawn one');

-- ═════════════════════════════════════════════════════════════════════════════
-- A · a brand-new account: the invitation name becomes the initial profile name
-- ═════════════════════════════════════════════════════════════════════════════
-- The sign-up screen hands the previewed name to Supabase as user metadata;
-- app.handle_new_user() reads it. This is the whole backend of "initialize".
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2700000-0000-0000-0000-000000000005', 'masoud@test.local', '{"full_name":"Masoud"}')
on conflict do nothing;
select tests.ok(
  (select full_name from public.profiles where id = 'a2700000-0000-0000-0000-000000000005') = 'Masoud',
  'A1  a brand-new account takes its first name from the sign-up metadata the invitation filled in');

begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000005');
  select public.accept_invitation(:'new_token') as a_member \gset
commit;
select tests.ok(
  (select m.user_id = 'a2700000-0000-0000-0000-000000000005' and m.status = 'active'
      and m.role = 'employee' and m.display_name = 'Masoud'
     from public.workplace_members m where m.id = :'a_member'),
  'A2  accepting binds the roster row the manager made to the new account, active, employee');
select tests.ok(
  (select m.area_id = :'ip_service' and m.workplace_role_id = :'ip_server'
     from public.workplace_members m where m.id = :'a_member'),
  'G1  …with the area and the workplace role exactly as invited');
select tests.ok(
  (select full_name from public.profiles where id = 'a2700000-0000-0000-0000-000000000005') = 'Masoud',
  'A3  …and the profile name is unchanged by the acceptance itself');
begin;
  set local role anon;
  select status as a_status,
         (workplace_name, invited_name, email, area_name, role_name, proposed_role, expires_at)
         is not distinct from (null::text, null::text, null::text, null::text, null::text,
                               null::public.member_role, null::timestamptz) as a_blank
    from public.invitation_preview(:'new_token') \gset
commit;
select tests.ok(:'a_status' = 'accepted',
  'F6  a used invitation previews as accepted — a second visitor is told, not misled');
select tests.ok(:'a_blank'::boolean,
  'L3  …and a used link found in someone''s history no longer names the person, address or workplace');

-- ═════════════════════════════════════════════════════════════════════════════
-- B/H · an existing account keeps its name; no manager can write it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'ex_token') as b_member \gset
commit;
select tests.ok(
  (select full_name from public.profiles where id = 'a2700000-0000-0000-0000-000000000002')
    = 'Mohammad Masoud Ahmadi',
  'B1  an existing account accepting an invitation named "Masoud" keeps "Mohammad Masoud Ahmadi"');
select tests.ok(
  (select display_name from public.workplace_members where id = :'b_member') = 'Masoud',
  'B2  …the manager''s "Masoud" stays on the ROSTER row, which is that workplace''s label, not the person''s identity');
select tests.ok(
  (select last_workplace_id from public.profiles where id = 'a2700000-0000-0000-0000-000000000002') = :'ipw',
  'B3  …last_workplace_id is the only profile field acceptance writes');

begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  select tests.changes_nothing(
    format('update public.profiles set full_name = %L where id = %L',
           'Masoud', 'a2700000-0000-0000-0000-000000000002'),
    'H1  the manager who invited them cannot rename their profile');
commit;
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000004');
  select tests.changes_nothing(
    format('update public.profiles set full_name = %L where id = %L',
           'Someone Else', 'a2700000-0000-0000-0000-000000000002'),
    'H2  nor can a manager of another workplace');
commit;
select tests.ok(
  (select full_name from public.profiles where id = 'a2700000-0000-0000-0000-000000000002')
    = 'Mohammad Masoud Ahmadi',
  'H3  …the name is exactly as it was');
select tests.ok(
  (select count(*) from public.profiles where id = 'a2700000-0000-0000-0000-000000000002') = 1,
  'H4  …and accepting created no second profile');

-- ═════════════════════════════════════════════════════════════════════════════
-- C · the seat is bound to the token; a guessed token opens nothing
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000003');
  select tests.ip_said(format('select public.accept_invitation(%L)', repeat('0', 64))) as c_guess \gset
  select tests.ip_said(format('select public.accept_invitation(%L)', :'new_token')) as c_used \gset
commit;
select tests.ok(:'c_guess' like '%invitation not found%',
  'C1  a token nobody was given opens nothing');
select tests.ok(:'c_used' like '%already been used or withdrawn%',
  'C2  an invitation somebody else already accepted cannot be consumed again by another account');

-- The seat belongs to the invited address, not to whoever holds the link.
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'ipw', 'ip.target@test.local', 'Target', 'manager', :'ip_service', :'ip_server') as t \gset tgt_
  select token from public.create_invitation(
    :'ipw', 'ip.noemail@test.local', 'No Email', 'employee') as t \gset nom_
commit;
select member_id as c_roster from public.invitations
 where token_hash = encode(extensions.digest(:'tgt_token', 'sha256'), 'hex') \gset

begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000003');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'tgt_token')) as c_wrong \gset
commit;
select tests.ok(:'c_wrong' like '%sent to a different address%',
  'C3  a signed-in account with another address holding the link is refused');
select tests.ok(
  (select i.status = 'pending' and i.accepted_by is null from public.invitations i
    where token_hash = encode(extensions.digest(:'tgt_token', 'sha256'), 'hex'))
  and (select m.user_id is null and m.status = 'invited' from public.workplace_members m where m.id = :'c_roster')
  and (select count(*) = 0 from public.workplace_members m
        where m.workplace_id = :'ipw' and m.user_id = 'a2700000-0000-0000-0000-000000000003')
  and (select last_workplace_id is null from public.profiles where id = 'a2700000-0000-0000-0000-000000000003'),
  'C4  …and the refusal wrote nothing: invitation pending, roster row unclaimed, no membership, profile untouched');

-- The invited person signs up with different capitalisation; the address is the same.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2700000-0000-0000-0000-000000000006', 'IP.Target@Test.Local', '{"full_name":"Target"}')
on conflict do nothing;
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000006');
  select public.accept_invitation(:'tgt_token') as c_target \gset
commit;
select tests.ok(
  (select m.user_id = 'a2700000-0000-0000-0000-000000000006' and m.role = 'manager'
      and m.area_id = :'ip_service' and m.workplace_role_id = :'ip_server'
     from public.workplace_members m where m.id = :'c_target'),
  'C5  the invited address accepts regardless of case, with the invited role, area and workplace role (G2)');

-- Migration 39's fallback: a profile with no email still accepts by its account address.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2700000-0000-0000-0000-000000000007', 'ip.noemail@test.local', '{"full_name":"No Email"}')
on conflict do nothing;
update public.profiles set email = null where id = 'a2700000-0000-0000-0000-000000000007';
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000007');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'nom_token')) as c_noemail \gset
commit;
select tests.ok(:'c_noemail' = ''
  and (select user_id = 'a2700000-0000-0000-0000-000000000007' from public.workplace_members m
        join public.invitations i on i.member_id = m.id
       where i.token_hash = encode(extensions.digest(:'nom_token', 'sha256'), 'hex')),
  'C6  a profile left without an email (migration 39) still accepts — the address is read from the account');

-- Negative control: migration 07's accept_invitation, without the address
-- check, hands the seat to the wrong account. Rolled back.
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  select token from public.create_invitation(:'ipw', 'ip.nc@test.local', 'NC Person', 'employee') as t \gset ncw_
  reset role;
  create or replace function public.accept_invitation(p_token text)
  returns uuid language plpgsql security definer set search_path = '' as $$
  declare v_user uuid := auth.uid(); v_inv public.invitations%rowtype;
  begin
    select * into v_inv from public.invitations
     where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
    if v_inv.id is null then raise exception 'invitation not found' using errcode = '42501'; end if;
    if v_inv.status <> 'pending' then raise exception 'used' using errcode = '42501'; end if;
    update public.workplace_members set user_id = v_user, role = v_inv.proposed_role, status = 'active',
           joined_at = coalesce(joined_at, now()) where id = v_inv.member_id;
    update public.invitations set status = 'accepted', accepted_by = v_user, accepted_at = now()
     where id = v_inv.id;
    return v_inv.member_id;
  end; $$;
  select tests.as_user('a2700000-0000-0000-0000-000000000003');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'ncw_token')) as nc_took \gset
rollback;
select tests.ok(:'nc_took' = '',
  'NC3 without the address check the wrong account takes the seat — that check is what refuses C3');

-- ═════════════════════════════════════════════════════════════════════════════
-- E · missing and blank addresses, and aliases
-- Two absent addresses must never compare equal. Every refusal is checked for
-- zero writes across every table an acceptance can touch.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function tests.ip_snap() returns text language sql as $$
  select md5(concat_ws('|',
    (select md5(coalesce(string_agg(row_to_json(i)::text, ',' order by i.id), '')) from public.invitations i),
    (select md5(coalesce(string_agg(row_to_json(m)::text, ',' order by m.id), '')) from public.workplace_members m),
    (select md5(coalesce(string_agg(row_to_json(p)::text, ',' order by p.id), '')) from public.profiles p),
    (select count(*)::text from public.audit_log),
    (select count(*)::text from public.member_notifications)))
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2700000-0000-0000-0000-000000000008', null,                 '{"full_name":"No Address"}'),
  ('a2700000-0000-0000-0000-000000000009', '',                   '{"full_name":"Empty Address"}'),
  ('a2700000-0000-0000-0000-00000000000a', E' \t ',              '{"full_name":"Blank Address"}'),
  ('a2700000-0000-0000-0000-00000000000b', 'ip.person+work@test.local', '{"full_name":"Plus Tag"}')
on conflict do nothing;

begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  select token from public.create_invitation(:'ipw', 'ip.nobody@test.local', 'Nobody', 'employee') as t \gset nb_
  select token from public.create_invitation(:'ipw', 'ip.person@test.local', 'Person', 'employee') as t \gset pp_
  select token from public.create_invitation(:'ipw', 'ip.blankme@test.local', 'Blank Me', 'employee') as t \gset bl_
commit;

-- D/E · an account with a NULL, empty or whitespace-only address
select tests.ip_snap() as e_before \gset
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000008');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'nb_token')) as e_null \gset
  select tests.as_user('a2700000-0000-0000-0000-000000000009');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'nb_token')) as e_empty \gset
  select tests.as_user('a2700000-0000-0000-0000-00000000000a');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'nb_token')) as e_blank \gset
commit;
select tests.ok(:'e_null' like '%sent to a different address%' and :'e_before' = tests.ip_snap(),
  'E1  an account with NO address is refused, with zero writes');
select tests.ok(:'e_empty' like '%sent to a different address%' and :'e_blank' like '%sent to a different address%'
  and :'e_before' = tests.ip_snap(),
  'E2  an account whose address is empty or whitespace (tab included) is refused, with zero writes');

-- G · a manager blanks the invitation's address (invitations_update_manager allows it)
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000001');
  update public.invitations set email = E'  '
   where token_hash = encode(extensions.digest(:'bl_token', 'sha256'), 'hex');
commit;
select tests.ip_snap() as g_before \gset
begin;
  select tests.as_user('a2700000-0000-0000-0000-000000000008');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'bl_token')) as g_null \gset
  select tests.as_user('a2700000-0000-0000-0000-000000000009');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'bl_token')) as g_empty \gset
  select tests.as_user('a2700000-0000-0000-0000-00000000000a');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'bl_token')) as g_blank \gset
commit;
select tests.ok(:'g_null' like '%sent to a different address%' and :'g_empty' like '%sent to a different address%'
  and :'g_blank' like '%sent to a different address%' and :'g_before' = tests.ip_snap(),
  'E3  an invitation blanked to whitespace/NBSP by its manager cannot be taken by any address-less account, zero writes');

-- F · a NULL invitation address. The table forbids it for invites, so the
-- constraint is lifted inside a rolled-back transaction to reach the function.
begin;
  alter table public.invitations drop constraint invitations_invite_needs_email;
  update public.invitations set email = null
   where token_hash = encode(extensions.digest(:'bl_token', 'sha256'), 'hex');
  select tests.ip_snap() as f_before \gset
  select tests.as_user('a2700000-0000-0000-0000-000000000008');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'bl_token')) as f_null \gset
  reset role;
  select tests.ip_snap() = :'f_before' as f_nowrite \gset
rollback;
select tests.ok(:'f_null' like '%sent to a different address%' and :'f_nowrite'::boolean,
  'E4  an invitation with NO address is refused even to an account with none, zero writes');
select tests.ok(
  (select count(*) from pg_constraint where conname = 'invitations_invite_needs_email') = 1,
  'E5  …and the table constraint that normally forbids it is back');

-- H · aliases are not folded
select tests.ip_snap() as h_before \gset
begin;
  select tests.as_user('a2700000-0000-0000-0000-00000000000b');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'pp_token')) as h_plus \gset
commit;
select tests.ok(:'h_plus' like '%sent to a different address%' and :'h_before' = tests.ip_snap(),
  'E6  ip.person+work@ is not ip.person@ — refused, zero writes; only case is ignored');

-- Negative control: the first draft compared coalesce(account, '') with the
-- trimmed invitation address, so a blank invitation matched an account with
-- no address. Shown inside a rolled-back transaction.
begin;
  update public.invitations set email = ''
   where token_hash = encode(extensions.digest(:'bl_token', 'sha256'), 'hex');
  create or replace function public.accept_invitation(p_token text)
  returns uuid language plpgsql security definer set search_path = '' as $$
  declare v_user uuid := auth.uid(); v_inv public.invitations%rowtype; v_email pg_catalog.text;
  begin
    select * into v_inv from public.invitations
     where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
    if v_inv.id is null then raise exception 'invitation not found' using errcode = '42501'; end if;
    if v_inv.status <> 'pending' then raise exception 'used' using errcode = '42501'; end if;
    select u.email::pg_catalog.text into v_email from auth.users u where u.id = v_user;
    if pg_catalog.lower(pg_catalog.btrim(coalesce(v_email, '')))
       <> pg_catalog.lower(pg_catalog.btrim(v_inv.email::pg_catalog.text)) then
      raise exception 'this invitation was sent to a different address' using errcode = '42501';
    end if;
    update public.workplace_members set user_id = v_user, status = 'active' where id = v_inv.member_id;
    update public.invitations set status = 'accepted', accepted_by = v_user where id = v_inv.id;
    return v_inv.member_id;
  end; $$;
  select tests.as_user('a2700000-0000-0000-0000-000000000008');
  select tests.ip_said(format('select public.accept_invitation(%L)', :'bl_token')) as nc_blank \gset
rollback;
select tests.ok(:'nc_blank' = '',
  'NC4 with the coalesce-to-empty comparison an address-less account takes a blanked invitation — the blank refusal is load-bearing');

-- ═════════════════════════════════════════════════════════════════════════════
-- NC · the token lookup is load-bearing
-- A preview that forgot the hash filter would hand ANY visitor the first
-- invitation. Shown inside a rolled-back transaction.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  create or replace function public.invitation_preview(p_token text)
  returns table (workplace_name text, invited_name text, email text, area_name text, role_name text,
                 proposed_role public.member_role, status text, expires_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
  begin
    return query
    select w.name::pg_catalog.text, m.display_name::pg_catalog.text, i.email::pg_catalog.text,
           null::pg_catalog.text, null::pg_catalog.text, i.proposed_role, i.status::pg_catalog.text, i.expires_at
    from public.invitations i join public.workplaces w on w.id = i.workplace_id
    left join public.workplace_members m on m.id = i.member_id
    where i.kind = 'invite' limit 1;
  end; $$;
  set local role anon;
  select count(*) as nc_leak from public.invitation_preview(repeat('0', 64)) \gset
rollback;
select tests.ok(:'nc_leak'::int > 0,
  'NC1 without the hash filter a guessed token shows somebody''s invitation — that filter is what refuses it');
begin;
  set local role anon;
  select count(*) as nc_after from public.invitation_preview(repeat('0', 64)) \gset
commit;
select tests.ok(:'nc_after'::int = 0,
  'NC2 …and with the control rolled back a guessed token shows nothing again');

-- ═════════════════════════════════════════════════════════════════════════════
-- S · privileges and the temp-schema cast, as in migration 40
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  has_function_privilege('anon', 'public.invitation_preview(text)', 'execute')
  and has_function_privilege('authenticated', 'public.invitation_preview(text)', 'execute')
  and not has_function_privilege('service_role', 'public.invitation_preview(text)', 'execute')
  and (select proacl::text from pg_proc where proname = 'invitation_preview') !~ '(^|[{,])=X',
  'S1  invitation_preview: anon and authenticated may call it — on purpose — service_role and PUBLIC may not');
select tests.ok(
  not has_function_privilege('anon', 'public.accept_invitation(text)', 'execute')
  and has_function_privilege('authenticated', 'public.accept_invitation(text)', 'execute')
  and not has_function_privilege('service_role', 'public.accept_invitation(text)', 'execute')
  and (select proacl::text from pg_proc where proname = 'accept_invitation') !~ '(^|[{,])=X',
  'S3  accept_invitation: authenticated only — anon, service_role and PUBLIC may not');

grant usage on schema tests to anon;   -- test helpers only, for the anon call below

-- As the HOSTED project grants them. The shim has no default privileges;
-- Supabase does, and grants EXECUTE on every new public function to anon,
-- authenticated and service_role BY NAME (migration 40 found this live).
-- Reproduce that, recreate both functions from the SHIPPED file, and check.
begin;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  drop function public.accept_invitation(text);
  drop function public.invitation_preview(text);
  \ir ../migrations/20260901004100_invitation_preview.sql
  select has_function_privilege('anon', 'public.accept_invitation(text)', 'execute')               as hs_acc_anon,
         has_function_privilege('authenticated', 'public.accept_invitation(text)', 'execute')      as hs_acc_auth,
         has_function_privilege('service_role', 'public.accept_invitation(text)', 'execute')       as hs_acc_svc,
         has_function_privilege('anon', 'public.invitation_preview(text)', 'execute')              as hs_pre_anon,
         has_function_privilege('authenticated', 'public.invitation_preview(text)', 'execute')     as hs_pre_auth,
         has_function_privilege('service_role', 'public.invitation_preview(text)', 'execute')      as hs_pre_svc \gset
  -- and through PostgREST's eyes: an anon call is refused by the privilege, not by the body
  set local role anon;
  select tests.ip_said('select public.accept_invitation(''x'')') as hs_anon_call \gset
  select count(*) as hs_anon_preview from public.invitation_preview(:'oth_token') \gset
rollback;
select tests.ok(:'hs_acc_anon' = 'f' and :'hs_acc_auth' = 't' and :'hs_acc_svc' = 'f',
  'S4  under Supabase''s default privileges the shipped file leaves accept_invitation to authenticated alone');
select tests.ok(:'hs_pre_anon' = 't' and :'hs_pre_auth' = 't' and :'hs_pre_svc' = 'f',
  'S5  …and invitation_preview to anon and authenticated, without service_role');
select tests.ok(:'hs_anon_call' like '%permission denied for function accept_invitation%' and :'hs_anon_preview'::int = 1,
  'S6  an anon caller is refused EXECUTE on accept_invitation and can still read a pending preview');

-- The same platform default applied to the EXISTING functions (create or
-- replace keeps an ACL): a project where anon and service_role already hold a
-- grant still ends with the right ACL once the file runs.
begin;
  grant execute on function public.accept_invitation(text) to anon, service_role;
  grant execute on function public.invitation_preview(text) to service_role;
  \ir ../migrations/20260901004100_invitation_preview.sql
  select has_function_privilege('anon', 'public.accept_invitation(text)', 'execute')
      or has_function_privilege('service_role', 'public.accept_invitation(text)', 'execute')
      or has_function_privilege('service_role', 'public.invitation_preview(text)', 'execute') as hs_stale \gset
rollback;
select tests.ok(:'hs_stale' = 'f',
  'S7  grants anon or service_role already held are removed by name when the file is applied');

-- Negative control: the platform default with only `revoke … from public` —
-- anon keeps EXECUTE on accept_invitation. The by-name revoke is load-bearing.
begin;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  drop function public.accept_invitation(text);
  create function public.accept_invitation(p_token text)
  returns uuid language plpgsql security definer set search_path = '' as $$
  begin return null; end; $$;
  revoke all on function public.accept_invitation(text) from public;
  grant execute on function public.accept_invitation(text) to authenticated;
  select has_function_privilege('anon', 'public.accept_invitation(text)', 'execute') as hs_nc \gset
rollback;
select tests.ok(:'hs_nc' = 't',
  'NC5 with only the PUBLIC revoke the platform default hands anon EXECUTE — the revoke by name is what removes it');

begin;
  drop function public.invitation_preview(text);
  \ir ../migrations/20260901004100_invitation_preview.sql
  select tests.as_user('a2700000-0000-0000-0000-000000000003');
  create type pg_temp.text as (hijacked int);
  select email as h_email from public.invitation_preview(:'oth_token') \gset
rollback;
select tests.ok(:'h_email' = 'ip.other@test.local',
  'S2  a caller who planted a pg_temp.text type still gets the real address — every cast is qualified');
