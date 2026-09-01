-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3G · member management.
--
-- Who may move a membership, what a membership may point at, what suspension
-- and removal actually do, how a join request becomes a member — and the one
-- thing none of it may touch: a distribution already paid.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'crew.boss@test.local',    '{"full_name":"Bo Crew"}'),
  ('e1000000-0000-0000-0000-000000000002', 'crew.staff@test.local',   '{"full_name":"Sam Staff"}'),
  ('e1000000-0000-0000-0000-000000000003', 'crew.rival@test.local',   '{"full_name":"Rae Rival"}'),
  ('e1000000-0000-0000-0000-000000000004', 'crew.knocker@test.local', '{"full_name":"Kit Knocker"}'),
  ('e1000000-0000-0000-0000-000000000005', 'crew.later@test.local',    '{"full_name":"Lee Later"}')
on conflict do nothing;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select public.create_workplace('Crew Lab', 'Marburg') as cw \gset
commit;
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000003');
  select public.create_workplace('Crew Rival', 'Kassel') as cx \gset
commit;

select id as c_service from public.workplace_areas where workplace_id = :'cw' and key = 'service' \gset
select id as c_bar     from public.workplace_areas where workplace_id = :'cw' and key = 'bar' \gset
select id as c_runner  from public.workplace_areas where workplace_id = :'cw' and key = 'runner' \gset
select id as c_server  from public.workplace_roles where workplace_id = :'cw' and key = 'server' \gset
select id as c_senior  from public.workplace_roles where workplace_id = :'cw' and key = 'senior_server' \gset
select id as c_keep    from public.workplace_roles where workplace_id = :'cw' and key = 'bartender' \gset
select id as c_runrole from public.workplace_roles where workplace_id = :'cw' and key = 'runner' \gset
select id as c_boss    from public.workplace_members where workplace_id = :'cw' and role = 'manager' \gset
select id as x_service from public.workplace_areas where workplace_id = :'cx' and key = 'service' \gset
select id as x_server  from public.workplace_roles where workplace_id = :'cx' and key = 'server' \gset
select join_code as c_code from public.workplaces where id = :'cw' \gset

-- Sam joins by invitation, so user_id is linked the only way the schema allows.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'c_service', workplace_role_id = :'c_server'
    where id = :'c_boss';
  select token from public.create_invitation(
    :'cw', 'crew.staff@test.local', 'Sam Staff', 'employee', :'c_service', :'c_server') as t \gset tok_sam_
commit;
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_sam_token') as c_sam \gset
commit;

select tests.ok(
  (select role = 'employee' and status = 'active' and user_id = 'e1000000-0000-0000-0000-000000000002'
   from public.workplace_members where id = :'c_sam'),
  'M1  accepting an invitation links the account and takes the role the invitation carried');

-- A second, account-less roster placeholder.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  insert into public.workplace_members (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values (:'cw', 'Robin', 'employee', :'c_service', :'c_server', 'active') returning id as c_robin \gset
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- what an employee may not do
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select tests.denied(
    format('update public.workplace_members set role = ''manager'' where id = %L', :'c_sam'),
    'M2  an employee cannot promote themselves');
  select tests.denied(
    format('update public.workplace_members set multiplier = 2.00 where id = %L', :'c_sam'),
    'M3  …nor change their own weighting');
  select tests.denied(
    format('update public.workplace_members set area_id = %L where id = %L', :'c_bar', :'c_sam'),
    'M4  …nor their own default area');
  select tests.denied(
    format('update public.workplace_members set workplace_role_id = %L where id = %L', :'c_senior', :'c_sam'),
    'M5  …nor their own default role');
  select tests.denied(
    format('update public.workplace_members set status = ''suspended'' where id = %L', :'c_sam'),
    'M6  …nor their own status');
  select tests.denied(
    format('update public.workplace_members set joined_at = now() where id = %L', :'c_sam'),
    'M7  …nor the date they joined');
  select tests.changes_nothing(
    format('update public.workplace_members set multiplier = 2.00 where id = %L', :'c_robin'),
    'M8  …and cannot reach another member at all');
  -- The one thing a member may change about themselves.
  update public.workplace_members set display_name = 'Sam S.' where id = :'c_sam';
commit;

select tests.ok(
  (select role = 'employee' and multiplier = 1.00 and status = 'active'
          and area_id = :'c_service'::uuid and workplace_role_id = :'c_server'::uuid
          and display_name = 'Sam S.'
   from public.workplace_members where id = :'c_sam'),
  'M9  …while their own display name is theirs to set, and nothing else moved');

-- ═════════════════════════════════════════════════════════════════════════════
-- what a manager may do, and where it stops
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members
    set area_id = :'c_bar', workplace_role_id = :'c_keep', multiplier = 1.25
    where id = :'c_sam';
commit;

select tests.ok(
  (select area_id = :'c_bar'::uuid and workplace_role_id = :'c_keep'::uuid and multiplier = 1.25
   from public.workplace_members where id = :'c_sam'),
  'M10 a manager can move a member''s area, role and weighting in one save');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('update public.workplace_members set area_id = %L where id = %L', :'x_service', :'c_sam'),
    'M11 …but not to an area of another workplace');
  select tests.denied(
    format('update public.workplace_members set workplace_role_id = %L where id = %L', :'x_server', :'c_sam'),
    'M12 …nor to a role of another workplace');
  select tests.denied(
    format('update public.workplace_members set workplace_role_id = %L where id = %L', :'c_server', :'c_sam'),
    'M13 …nor to a role that belongs to a different area than the member does');
  select tests.denied(
    format('update public.workplace_members set multiplier = 5 where id = %L', :'c_sam'),
    'M14 …nor outside the weighting range the column allows');
commit;

select tests.ok(
  (select area_id = :'c_bar'::uuid and workplace_role_id = :'c_keep'::uuid and multiplier = 1.25
   from public.workplace_members where id = :'c_sam'),
  'M15 …and none of those attempts moved anything');

-- Clearing the role is the legal way to change area without picking one.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'c_service', workplace_role_id = null
    where id = :'c_sam';
  update public.workplace_members set workplace_role_id = :'c_server' where id = :'c_sam';
commit;

select tests.ok(
  (select area_id = :'c_service'::uuid and workplace_role_id = :'c_server'::uuid
   from public.workplace_members where id = :'c_sam'),
  'M16 clearing the role is how a member moves area, and a role from the new area can then be set');

-- Archived area and role (migration 19), on a membership.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select public.archive_workplace_role(:'c_runrole');
  select public.archive_workplace_area(:'c_runner');
  select tests.denied(
    format('update public.workplace_members set area_id = %L, workplace_role_id = null where id = %L',
           :'c_runner', :'c_sam'),
    'M17 an archived area cannot become a member''s default');
  select tests.denied(
    format('update public.workplace_members set workplace_role_id = %L where id = %L',
           :'c_runrole', :'c_sam'),
    'M18 …nor an archived role');
commit;

-- Another workplace's manager.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000003');
  select tests.changes_nothing(
    format('update public.workplace_members set multiplier = 2.00 where id = %L', :'c_sam'),
    'M19 a manager of another workplace cannot touch this roster');
  select tests.denied(
    format('select public.pending_join_requests(%L)', :'cw'),
    'M20 …and cannot read its pending join requests');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- the last manager
-- ═════════════════════════════════════════════════════════════════════════════
-- app.guard_last_manager() is a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger, so it fires at COMMIT rather than at the statement. Forcing the
-- deferred checks to run inside the subtransaction is what makes the refusal
-- observable here; in the app it arrives when the transaction commits, which is
-- the same moment PostgREST turns it into an error response.
create or replace function tests.denied_at_commit(p_sql text, p_label text)
returns void language plpgsql as $fn$
declare v_refused boolean := false;
begin
  begin
    execute p_sql;
    set constraints all immediate;
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL  % — the statement was allowed', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end $fn$;
grant execute on function tests.denied_at_commit(text, text) to authenticated;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied_at_commit(
    format('update public.workplace_members set role = ''employee'' where id = %L', :'c_boss'),
    'M21 the last manager cannot demote themselves');
  select tests.denied_at_commit(
    format('update public.workplace_members set status = ''suspended'' where id = %L', :'c_boss'),
    'M22 …nor suspend themselves');
  select tests.denied_at_commit(
    format('update public.workplace_members set status = ''left'' where id = %L', :'c_boss'),
    'M23 …nor leave');
commit;

select tests.ok(
  (select role = 'manager' and status = 'active' from public.workplace_members where id = :'c_boss'),
  'M24 …and the workplace still has its manager');

-- With a second manager in place the rule stops applying. Note the actor stays
-- a manager throughout: demoting yourself makes every later statement in the
-- same transaction the work of a non-manager, which the column guard refuses
-- long before the deferred check would.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set role = 'manager' where id = :'c_robin';
  update public.workplace_members set status = 'suspended' where id = :'c_robin';
  update public.workplace_members set status = 'active' where id = :'c_robin';
  update public.workplace_members set role = 'employee' where id = :'c_robin';
commit;

select tests.ok(
  (select role = 'manager' and status = 'active' from public.workplace_members where id = :'c_boss')
  and (select role = 'employee' from public.workplace_members where id = :'c_robin'),
  'M25 …while a second manager can be suspended and demoted freely, because one remains');

-- ═════════════════════════════════════════════════════════════════════════════
-- suspend, reactivate, remove
-- ═════════════════════════════════════════════════════════════════════════════
-- A distribution first, so there is history to protect.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select id as c_rule from public.distribution_rules where workplace_id = :'cw' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours_points', min_overlap_minutes = 15 where id = :'c_rule';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'c_rule' and area_id = :'c_service';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'c_rule' and area_id <> :'c_service';
  select public.activate_rule(:'c_rule');

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'cw', :'c_sam',   '2020-01-10 18:00Z', '2020-01-10 22:00Z', 0, 'approved'),
         (:'cw', :'c_robin', '2020-01-10 18:00Z', '2020-01-10 22:00Z', 0, 'approved');
  insert into public.tip_pools (workplace_id, period, period_start, period_end, label, cash_cents, created_by)
  values (:'cw', 'day', '2020-01-10', '2020-01-10', 'crew', 10000, :'c_boss') returning id as c_pool \gset
  select public.calculate_distribution(:'c_pool') as c_dist \gset
  select public.send_distribution(:'c_dist');
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || coalesce(role_name, '-')
                      || '|' || points::text || '|' || multiplier::text || '|' || amount_cents::text,
                      ';' order by id::text)) as c_before
  from public.tip_distribution_entries where distribution_id = :'c_dist' \gset

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select count(*) as c_sees_before from public.member_distribution_entries where workplace_id = :'cw' \gset
commit;
select tests.ok(:'c_sees_before'::int = 1, 'M26 the employee can read their own share while active');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'c_sam';
commit;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select count(*) as c_sees_after from public.member_distribution_entries where workplace_id = :'cw' \gset
  select count(*) as c_dists_after from public.member_distributions where workplace_id = :'cw' \gset
  select tests.denied(
    format('insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
            values (%L, %L, ''2020-02-01 18:00Z'', ''2020-02-01 22:00Z'', 0, ''submitted'')',
           :'cw', :'c_sam'),
    'M28 …and cannot submit a shift');
  select tests.denied(
    format('insert into public.tip_reports (workplace_id, member_id, work_date, card_cents, cash_cents)
            values (%L, %L, ''2020-02-01'', 100, 100)', :'cw', :'c_sam'),
    'M29 …nor report tips');
commit;

select tests.ok(:'c_sees_after'::int = 0 and :'c_dists_after'::int = 0,
  'M27 a suspended member reads no entry and no distribution from that workplace');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'c_sam';
commit;
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select count(*) as c_sees_back from public.member_distribution_entries where workplace_id = :'cw' \gset
commit;
select tests.ok(:'c_sees_back'::int = 1, 'M30 reactivating gives exactly that access back');

-- Removal is a status, not a deletion.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'left', left_at = now() where id = :'c_sam';
commit;
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select count(*) as c_sees_left from public.member_distribution_entries where workplace_id = :'cw' \gset
commit;

select tests.ok(:'c_sees_left'::int = 0, 'M31 a removed member loses access on the same terms as a suspended one');
select tests.ok(
  (select count(*) from public.workplace_members where id = :'c_sam') = 1,
  'M32 …while the membership row, and everything that points at it, is still there');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied(format('delete from public.workplace_members where id = %L', :'c_sam'),
    'M33 …and it cannot be deleted, because shifts and entries restrict');
  update public.workplace_members set status = 'active', left_at = null where id = :'c_sam';
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || coalesce(role_name, '-')
                      || '|' || points::text || '|' || multiplier::text || '|' || amount_cents::text,
                      ';' order by id::text)) as c_after
  from public.tip_distribution_entries where distribution_id = :'c_dist' \gset

select tests.ok(:'c_before' = :'c_after',
  'M34 through all of that, the sent distribution is word for word what it was');

-- And after the manager moves everything a member has.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members
    set area_id = :'c_bar', workplace_role_id = :'c_keep', multiplier = 0.75
    where id = :'c_sam';
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || coalesce(role_name, '-')
                      || '|' || points::text || '|' || multiplier::text || '|' || amount_cents::text,
                      ';' order by id::text)) as c_after2
  from public.tip_distribution_entries where distribution_id = :'c_dist' \gset

select tests.ok(:'c_before' = :'c_after2',
  'M35 …and moving their area, role and weighting does not move it either');

-- ═════════════════════════════════════════════════════════════════════════════
-- join requests
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000004');
  select public.request_join(:'c_code') as c_req \gset
commit;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select count(*) as c_pending from public.pending_join_requests(:'cw') \gset
  select requester_name as c_who from public.pending_join_requests(:'cw') limit 1 \gset
commit;

select tests.ok(:'c_pending'::int = 1 and :'c_who' = 'Kit Knocker',
  'M36 the manager can see a pending request, and who it is from');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.ok(
    not exists (
      select 1 from pg_catalog.jsonb_each_text(
        pg_catalog.to_jsonb((select r from public.pending_join_requests(:'cw') r limit 1)))
      where value like '%@%'),
    'M37 …and the list carries a name, never an email address');
commit;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000004');
  select tests.denied(format('select public.approve_join_request(%L)', :'c_req'),
    'M38 the person asking cannot approve their own request');
commit;
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.approve_join_request(%L)', :'c_req'),
    'M39 …and neither can a manager of another workplace');
commit;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select public.approve_join_request(:'c_req', null, :'c_service', :'c_server') as c_kit \gset
commit;

select tests.ok(
  (select role = 'employee' and status = 'active'
          and user_id = 'e1000000-0000-0000-0000-000000000004'
          and area_id = :'c_service'::uuid and workplace_role_id = :'c_server'::uuid
   from public.workplace_members where id = :'c_kit'),
  'M40 approving creates an active employee, with the area and role the manager chose');

select tests.ok(
  (select status = 'accepted' and member_id = :'c_kit'::uuid
   from public.invitations where id = :'c_req'),
  'M41 …and the request is marked accepted, pointing at the membership it made');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.approve_join_request(%L)', :'c_req'),
    'M42 …and cannot be approved a second time');
  select count(*) as c_pending2 from public.pending_join_requests(:'cw') \gset
commit;

select tests.ok(:'c_pending2'::int = 0, 'M43 …so it is gone from the pending list');
select tests.ok(
  (select count(*) from public.workplace_members
   where workplace_id = :'cw' and user_id = 'e1000000-0000-0000-0000-000000000004') = 1,
  'M44 …and it produced exactly one membership');

-- A request can never yield a manager, whatever is on the invitation row.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('update public.invitations set proposed_role = ''manager'' where id = %L', :'c_req'),
    'M45 a join request cannot be turned into a manager invitation — the check constraint refuses it');
commit;

-- Declining is an ordinary manager update on the invitation.
-- A different person, because someone already in the workplace cannot ask again.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000005');
  select public.request_join(:'c_code') as c_req2 \gset
commit;
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.invitations set status = 'declined' where id = :'c_req2';
  select count(*) as c_pending3 from public.pending_join_requests(:'cw') \gset
commit;

select tests.ok(:'c_pending3'::int = 0, 'M46 a declined request leaves the pending list');
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.approve_join_request(%L)', :'c_req2'),
    'M47 …and cannot be approved afterwards');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- invitations
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select tests.denied(
    format('select token from public.create_invitation(%L, ''x@test.local'', ''X'', ''manager'')', :'cw'),
    'M48 an employee cannot invite anyone, least of all a manager');
commit;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'cw', 'later@test.local', 'Later Person', 'employee', :'c_bar', :'c_keep') as t \gset tok_later_
commit;

select tests.ok(
  (select status = 'invited' and role = 'employee' and area_id = :'c_bar'::uuid
          and workplace_role_id = :'c_keep'::uuid and user_id is null
   from public.workplace_members
   where workplace_id = :'cw' and display_name = 'Later Person'),
  'M49 an invitation puts a roster placeholder in place, with no account attached');

select tests.ok(
  (select token_hash is not null and pg_catalog.length(token_hash) = 64
   from public.invitations where workplace_id = :'cw' and email = 'later@test.local'),
  'M50 …and only the hash of the token is stored');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('update public.workplace_members set user_id = %L where display_name = ''Later Person''',
           'e1000000-0000-0000-0000-000000000003'),
    'M51 a manager cannot attach somebody''s account to a placeholder by hand');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- a suspended manager is not a manager
-- ═════════════════════════════════════════════════════════════════════════════
-- app.is_manager() filters on status = 'active', so suspension takes the
-- authority with it. Nothing above proves that, and it is the corollary of the
-- rule the whole phase rests on: current membership status controls access.
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set role = 'manager' where id = :'c_sam';
  update public.workplace_members set status = 'suspended' where id = :'c_sam';
commit;

-- A refusal has two legal shapes here, and the distinction matters. The RLS
-- policy is `using (app.is_manager(...) or user_id = auth.uid())`, so a
-- suspended manager's UPDATE of somebody else's row matches nothing and is
-- silently filtered — it never reaches the guard trigger and so never raises.
-- Zero rows changed IS the refusal. tests.denied() would call that a failure,
-- so assert the outcome instead: nothing moved.
-- The attempt itself must not abort the transaction, because a filtered write
-- does not raise. Swallow whichever refusal arrives; the verdict comes from
-- reading the row afterwards, as somebody who is still allowed to read it.
create or replace function tests.attempt(p_sql text)
returns void language plpgsql as $fn$
begin
  begin
    execute p_sql;
  exception when others then null;
  end;
end $fn$;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  select tests.attempt(
    format('update public.workplace_members set multiplier = 2.00 where id = %L', :'c_robin'));
  select tests.denied(format('select * from public.pending_join_requests(%L)', :'cw'),
    'M53 a suspended manager cannot read the join queue');
  select tests.denied(
    format('select token from public.create_invitation(%L, ''nope@test.local'', ''Nope'', ''manager'')', :'cw'),
    'M54 …nor invite anybody');
commit;

select tests.ok(
  (select multiplier = 1.00 from public.workplace_members where id = :'c_robin'),
  'M52 …and reaches no other member''s row at all');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'c_sam';
commit;

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000002');
  update public.workplace_members set multiplier = 1.10 where id = :'c_robin';
commit;

select tests.ok(
  (select multiplier = 1.10 from public.workplace_members where id = :'c_robin'),
  'M55 …and reinstating them hands the authority straight back');

begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set role = 'employee', multiplier = 1.00 where id = :'c_sam';
  update public.workplace_members set multiplier = 1.00 where id = :'c_robin';
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- renaming a person does not rename them in history
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('e1000000-0000-0000-0000-000000000001');
  update public.workplace_members set display_name = 'Samira Renamed' where id = :'c_sam';
commit;

select md5(string_agg(member_name || '|' || area_name || '|' || coalesce(role_name, '-')
                      || '|' || points::text || '|' || multiplier::text || '|' || amount_cents::text,
                      ';' order by id::text)) as c_after3
  from public.tip_distribution_entries where distribution_id = :'c_dist' \gset

select tests.ok(:'c_after3' = :'c_before',
  'M56 the name a sent distribution recorded is the name it keeps');
