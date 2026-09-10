-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3S-B · the two release blockers (migrations 38 and 39)
--
-- L · A standalone cancellation abandons a LINEAGE, not a row. Migration 37
--     asked "has this version been paid" and a correction moves the money's
--     anchor without moving the money, so the live head of a settled chain
--     answered no. Section L pins the question being asked of the whole chain:
--     this version, every ancestor it replaced, every descendant that replaced
--     it — while leaving the correction path, which retires a predecessor
--     through send_distribution(), completely alone.
--
-- P · A profile does not get to say who it is. profiles.email was writable by
--     its owner, which let any signed-in user claim an unregistered address,
--     lock its real owner out of ever creating an account, and read who had
--     been invited where. Section P pins the guard and the now-unblockable
--     signup.
--
-- Negative controls at the end switch each guard off inside a rolled-back
-- transaction and watch the same call go through.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function tests.said(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.said(text) to authenticated;

create or replace function tests.rel_night(
  p_wp uuid, p_boss uuid, p_staff uuid, p_area uuid, p_role uuid, p_day date, p_cash integer
) returns uuid language plpgsql as $$
begin
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (p_wp, p_boss, p_day, p_cash);
  insert into public.shifts
    (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values
    (p_wp, p_staff, (p_day::text || ' 16:00Z')::timestamptz, (p_day::text || ' 22:00Z')::timestamptz,
     0, 'approved', p_area, p_role);
  return public.create_pool_from_reports(p_wp, p_day, p_day);
end $$;
grant execute on function tests.rel_night(uuid, uuid, uuid, uuid, uuid, date, integer) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-000000000001', 'lc.boss@test.local',  '{"full_name":"LC Boss"}'),
  ('a2000000-0000-0000-0000-000000000002', 'lc.staff@test.local', '{"full_name":"LC Staff"}'),
  ('a2000000-0000-0000-0000-000000000003', 'lc.other@test.local', '{"full_name":"LC Other"}')
on conflict do nothing;

begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.create_workplace('Lineage Lab', 'Kiel') as lw \gset
commit;
select id as l_service from public.workplace_areas   where workplace_id = :'lw' and key = 'service' \gset
select id as l_server  from public.workplace_roles   where workplace_id = :'lw' and key = 'server'  \gset
select id as l_boss    from public.workplace_members where workplace_id = :'lw' and role = 'manager' \gset
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'lw', 'lc.staff@test.local', 'LC Staff', 'employee', :'l_service', :'l_server') as t \gset tok_l_
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_l_token') as l_staff \gset
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select id as l_rule from public.distribution_rules where workplace_id = :'lw' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours_points', min_overlap_minutes = 15 where id = :'l_rule';
  update public.distribution_rule_areas set percentage = 100 where rule_id = :'l_rule' and area_id = :'l_service';
  update public.distribution_rule_areas set percentage = 0   where rule_id = :'l_rule' and area_id <> :'l_service';
  select public.activate_rule(:'l_rule');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- L · a paid chain is not abandoned
-- Night one: A is sent and paid in full, then corrected by B. The payout stays
-- on A, because that is where it was made.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.rel_night(:'lw', :'l_boss', :'l_staff', :'l_service', :'l_server', '2025-06-03', 60000) as l_p1 \gset
  select public.calculate_distribution(:'l_p1') as l_a \gset
  select public.send_distribution(:'l_a');
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'l_a', 'cash', 'paid in full') as l_pay \gset
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'l_a', 'hours', 'They stayed until closing.') as l_b \gset
  select public.send_distribution(:'l_b');
commit;

select tests.ok(
  (select status = 'cancelled' from public.tip_distributions where id = :'l_a')
  and (select status = 'sent' from public.tip_distributions where id = :'l_b'),
  'L1  a paid distribution can still be corrected: A is retired, B is current');
select tests.ok(app.payout_is_effective(:'l_pay') and app.effective_payout(:'l_b') is null,
  'L2  …the money stays on A, so B on its own reads as never paid');
select tests.ok(app.settled_basis(:'l_b') = :'l_a' and app.lineage_has_effective_payout(:'l_b'),
  'L3  …but the chain knows: settled_basis points at A, and the lineage reads as paid');

begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'lw', '2025-06-02', '2025-06-08') as l_ex0 \gset
commit;
select (:'l_ex0'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint as l_owed0 \gset
select (:'l_ex0'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint  as l_set0 \gset
select (:'l_ex0'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint        as l_out0 \gset
select tests.ok(:'l_owed0'::bigint = 60000 and :'l_set0'::bigint = 60000 and :'l_out0'::bigint = 0,
  'L4  the week reads 60000 owed, 60000 settled, nothing outstanding');

begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.cancel_distribution(%L, ''abandon the chain'')', :'l_b'),
    'L5  the live head of a settled chain cannot be abandoned');
  select tests.said(format('select public.cancel_distribution(%L, ''x'')', :'l_b')) as l_msg \gset
commit;
select tests.ok(:'l_msg' like '%correction chain%' and :'l_msg' like '%reverse%',
  'L6  …and the refusal says the money is on the chain, not on this version');
select tests.ok(
  (select status = 'sent' and cancelled_at is null from public.tip_distributions where id = :'l_b'),
  'L7  …B is still sent and still current');
select tests.ok((select status = 'distributed' from public.tip_pools where id = :'l_p1'),
  'L8  …the pool is still distributed');
select tests.ok(app.payout_is_effective(:'l_pay'),
  'L9  …and the payment still stands');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'lw', '2025-06-02', '2025-06-08') as l_ex1 \gset
commit;
select tests.ok(
  (:'l_ex1'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = :'l_owed0'::bigint
  and (:'l_ex1'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint = :'l_set0'::bigint
  and (:'l_ex1'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint = :'l_out0'::bigint
  and (:'l_ex1'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint >= 0,
  'L10 …so owed, settled and outstanding are untouched, and outstanding never goes negative');

-- A ← B ← C: three deep, the money still on the oldest.
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'l_b', 'hours', 'Once more, with the bar shift.') as l_c \gset
  select public.send_distribution(:'l_c');
commit;
select tests.ok(
  (select status = 'cancelled' from public.tip_distributions where id = :'l_b')
  and (select status = 'sent' from public.tip_distributions where id = :'l_c')
  and app.settled_basis(:'l_c') = :'l_a',
  'L11 a chain three deep still finds the payment two steps back');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.cancel_distribution(%L, ''abandon it'')', :'l_c'),
    'L12 …and the head of A←B←C cannot be abandoned either');
commit;

-- Reverse the payment, and the chain may be abandoned.
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'l_pay', 'recorded_by_mistake', 'never actually paid') as l_rev \gset
commit;
select tests.ok(:'l_rev' is not null and not app.lineage_has_effective_payout(:'l_c'),
  'L13 reversing the payment clears the whole chain, not just the version it was on');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.said(format('select public.cancel_distribution(%L, ''abandon it'')', :'l_c')) as l_after \gset
commit;
select tests.ok(:'l_after' = ''
  and (select status = 'cancelled' from public.tip_distributions where id = :'l_c'),
  'L14 …and only then may the head be abandoned');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'lw', '2025-06-02', '2025-06-08') as l_ex2 \gset
commit;
select tests.ok(
  (:'l_ex2'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = 0
  and (:'l_ex2'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint = 0
  and (:'l_ex2'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint = 0,
  'L15 …leaving the week owing nothing, settling nothing, and outstanding at zero');

-- A night nothing was ever paid on abandons exactly as it always could.
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.rel_night(:'lw', :'l_boss', :'l_staff', :'l_service', :'l_server', '2025-06-04', 20000) as l_p2 \gset
  select public.calculate_distribution(:'l_p2') as l_d2 \gset
  select public.send_distribution(:'l_d2');
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.said(format('select public.cancel_distribution(%L, ''never happened'')', :'l_d2')) as l_unpaid \gset
commit;
select tests.ok(:'l_unpaid' = ''
  and (select status = 'cancelled' from public.tip_distributions where id = :'l_d2'),
  'L16 a chain with nothing paid on it anywhere still cancels');

-- ═════════════════════════════════════════════════════════════════════════════
-- P · a profile does not get to say who it is
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000003');
  select tests.said($$update public.profiles set locale = 'en' where id = auth.uid()$$) as p_locale \gset
commit;
select tests.ok(:'p_locale' = ''
  and (select locale = 'en' from public.profiles where id = 'a2000000-0000-0000-0000-000000000003'),
  'P1  a person may still set their own language');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000003');
  select tests.said($$update public.profiles set full_name = 'LC Renamed' where id = auth.uid()$$) as p_name \gset
commit;
select tests.ok(:'p_name' = '',
  'P2  …and their own display name');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000003');
  select tests.said($$update public.profiles set email = 'someone.else@test.local' where id = auth.uid()$$) as p_email \gset
commit;
select tests.ok(:'p_email' like '%comes from your account%',
  'P3  but not their own email address, which is the account''s');
select tests.ok(
  (select email::text = 'lc.other@test.local' from public.profiles where id = 'a2000000-0000-0000-0000-000000000003'),
  'P4  …and the address on the row did not move');
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000003');
  select tests.changes_nothing(
    $$update public.profiles set full_name = 'stolen' where id = 'a2000000-0000-0000-0000-000000000001'$$,
    'P5  somebody else''s profile is not theirs to touch at all');
commit;

-- The registration denial, end to end: a legacy row squatting an address —
-- written as the owner, which is the only way one can exist after this
-- migration — must not stop the real person creating an account.
-- A profile row must belong to an account (profiles_id_fkey), so the squatter
-- is a real user whose profile email is then moved AS THE OWNER — the only way
-- such a row can come about once migration 39 is in.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-00000000000f', 'lc.squatter@test.local', '{"full_name":"LC Squatter"}')
on conflict do nothing;
update public.profiles set email = 'lc.newcomer@test.local'
where id = 'a2000000-0000-0000-0000-00000000000f';
select tests.said($$insert into auth.users (id, email, raw_user_meta_data)
  values ('a2000000-0000-0000-0000-000000000004', 'lc.newcomer@test.local', '{"full_name":"LC Newcomer"}')$$)
  as p_signup \gset
select tests.ok(:'p_signup' = ''
  and (select count(*) = 1 from auth.users where id = 'a2000000-0000-0000-0000-000000000004'),
  'P6  an address already spoken for no longer stops the account being created');
select tests.ok(
  (select email is null from public.profiles where id = 'a2000000-0000-0000-0000-000000000004'),
  'P7  …the profile exists with no email rather than not existing');

-- Invitation metadata cannot be reached by claiming an address.
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'lw', 'lc.target@test.local', 'LC Target', 'employee', :'l_service', :'l_server') as t \gset tok_t_
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000003');
  select tests.said($$update public.profiles set email = 'lc.target@test.local' where id = auth.uid()$$) as p_claim \gset
  select count(*) as p_seen from public.invitations where email = 'lc.target@test.local' \gset
commit;
select tests.ok(:'p_claim' like '%comes from your account%' and :'p_seen'::int = 0,
  'P8  claiming an invited address is refused, so its invitation stays unreadable');

-- ═════════════════════════════════════════════════════════════════════════════
-- NC · each guard is load-bearing
-- ═════════════════════════════════════════════════════════════════════════════

-- NC1 · the lineage helper. A fresh paid chain, then a helper that always says
-- "nothing paid here" — as the owner, which nothing in the product can do.
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select tests.rel_night(:'lw', :'l_boss', :'l_staff', :'l_service', :'l_server', '2025-06-05', 35000) as l_p3 \gset
  select public.calculate_distribution(:'l_p3') as l_e \gset
  select public.send_distribution(:'l_e');
commit;
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'l_e', 'cash', 'paid') as l_pay3 \gset
  select public.create_replacement_distribution(:'l_e', 'hours', 'corrected') as l_f \gset
  select public.send_distribution(:'l_f');
commit;
select tests.ok(app.lineage_has_effective_payout(:'l_f') and app.effective_payout(:'l_f') is null,
  'NC1 the control subject is set: F reads unpaid on its own, paid across its chain');
begin;
  create or replace function app.lineage_has_effective_payout(p_distribution_id uuid)
  returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.cancel_distribution(:'l_f', 'negative control');
  select status::text as l_nc1 from public.tip_distributions where id = :'l_f' \gset
rollback;
select tests.ok(:'l_nc1' = 'cancelled',
  'NC2 with app.lineage_has_effective_payout() answering false, the same call succeeds');

-- NC3 · and it is the ANCESTOR's payout the helper is finding. Reverse only
-- that, leave the helper alone, and the same call succeeds on its own merits.
begin;
  select tests.as_user('a2000000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'l_pay3', 'recorded_by_mistake', 'control');
  select public.cancel_distribution(:'l_f', 'negative control');
  select status::text as l_nc3 from public.tip_distributions where id = :'l_f' \gset
rollback;
select tests.ok(:'l_nc3' = 'cancelled',
  'NC3 reverse the ancestor''s payment instead and it also succeeds — that payout is what refused');

-- NC4 · the profile identity guard.
begin;
  alter table public.profiles disable trigger profiles_identity_guard;
  select tests.as_user('a2000000-0000-0000-0000-000000000003');
  update public.profiles set email = 'claimed@test.local' where id = auth.uid();
  select email::text as p_nc4 from public.profiles where id = 'a2000000-0000-0000-0000-000000000003' \gset
rollback;
select tests.ok(:'p_nc4' = 'claimed@test.local',
  'NC4 switch the identity guard off and the rewrite goes through — the trigger is what refuses');

select tests.ok(
  (select status = 'sent' and cancelled_at is null from public.tip_distributions where id = :'l_f')
  and app.payout_is_effective(:'l_pay3')
  and (select email::text = 'lc.other@test.local' from public.profiles where id = 'a2000000-0000-0000-0000-000000000003'),
  'NC5 …and every control rolled back: F still sent and paid, the address still its owner''s');
