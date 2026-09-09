-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3R-B · what a standalone cancellation may not do
-- (migrations 36 and 37).
--
-- Two guards, one function. Migration 36 stopped a cancellation rewriting a
-- CLOSED period; migration 37 stopped one abandoning a night whose money has
-- already gone out, in any period. Sections A–H and the correction/settlement
-- sections pin the close rule; section J pins the payment rule; the negative
-- controls at the end prove each of them bites on its own.
--
-- The 3R audit proved, against a live project, that one call —
-- cancel_distribution() on a sent and fully paid distribution inside a closed
-- week — moved that week's current entitlement by €900, drove outstanding
-- negative, and left records_after_close reading 0. The export could not see it
-- because it marks a record as after-close by comparing a CREATION time, and a
-- cancellation is a state change on a row that existed before the close.
--
-- What this suite pins is a rule with a shape: the close does not stop a
-- correction, because a correction arrives as its own row that the export marks
-- and counts. It stops money leaving a closed period with nothing put in its
-- place. So the same week must still accept a correction, a payout and a
-- reversal after the close, and must still allow a cancellation in the week
-- NEXT to it, which no close covers.
--
-- Two negative controls at the end switch the guard off inside a rolled-back
-- transaction and watch the cancellation go through, so nobody can claim these
-- assertions pass for some other reason.
-- ─────────────────────────────────────────────────────────────────────────────

-- The message a statement was refused with, or the empty string if it was
-- allowed. Lets a test say WHICH guard bit, not merely that something did.
-- Empty rather than null on purpose: psql's \gset leaves a variable UNSET when
-- the column is null, and the next :'var' would then reach the server as
-- literal text and fail as a syntax error rather than as an assertion.
create or replace function tests.refusal(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.refusal(text) to authenticated;

-- One night of the lab: the boss files the report, the staff member works
-- 18:00–00:00 local. Staged but not pooled, so a night can be left as raw
-- material for a pool built later.
create or replace function tests.guard_stage(
  p_wp uuid, p_boss uuid, p_staff uuid, p_area uuid, p_role uuid, p_day date, p_cash integer
) returns void language plpgsql as $$
begin
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (p_wp, p_boss, p_day, p_cash);
  insert into public.shifts
    (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values
    (p_wp, p_staff, (p_day::text || ' 16:00Z')::timestamptz, (p_day::text || ' 22:00Z')::timestamptz,
     0, 'approved', p_area, p_role);
end $$;
grant execute on function tests.guard_stage(uuid, uuid, uuid, uuid, uuid, date, integer) to authenticated;

create or replace function tests.guard_night(
  p_wp uuid, p_boss uuid, p_staff uuid, p_area uuid, p_role uuid, p_day date, p_cash integer
) returns uuid language plpgsql as $$
begin
  perform tests.guard_stage(p_wp, p_boss, p_staff, p_area, p_role, p_day, p_cash);
  return public.create_pool_from_reports(p_wp, p_day, p_day);
end $$;
grant execute on function tests.guard_night(uuid, uuid, uuid, uuid, uuid, date, integer) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1500000-0000-0000-0000-000000000001', 'cg.boss@test.local',  '{"full_name":"CG Boss"}'),
  ('a1500000-0000-0000-0000-000000000002', 'cg.staff@test.local', '{"full_name":"CG Staff"}')
on conflict do nothing;

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.create_workplace('Close Guard Lab', 'Kiel') as gw \gset
commit;

select id as g_service from public.workplace_areas   where workplace_id = :'gw' and key = 'service' \gset
select id as g_server  from public.workplace_roles   where workplace_id = :'gw' and key = 'server'  \gset
select id as g_boss    from public.workplace_members where workplace_id = :'gw' and role = 'manager' \gset

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select token from public.create_invitation(
    :'gw', 'cg.staff@test.local', 'CG Staff', 'employee', :'g_service', :'g_server') as t \gset tok_g_
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_g_token') as g_staff \gset
commit;

-- Service takes the whole pool, so one approved service shift is a full night
-- and each night's entitlement is exactly the cash that was reported.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select id as g_rule from public.distribution_rules where workplace_id = :'gw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'g_rule';
  update public.distribution_rule_areas set percentage = 100
    where rule_id = :'g_rule' and area_id = :'g_service';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'g_rule' and area_id <> :'g_service';
  select public.activate_rule(:'g_rule');
commit;

-- ── the week that will be closed: 2022-05-02 … 2022-05-08 ──────────────────
-- One call to create_pool_from_reports() per transaction: it keeps a temp table
-- until commit.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-03', 90000) as g_p1 \gset
  select public.calculate_distribution(:'g_p1') as g_d1 \gset
  select public.send_distribution(:'g_d1');
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-04', 60000) as g_p2 \gset
  select public.calculate_distribution(:'g_p2') as g_d2 \gset
  select public.send_distribution(:'g_d2');
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-05', 40000) as g_p3 \gset
  select public.calculate_distribution(:'g_p3') as g_d3 \gset
  select public.send_distribution(:'g_d3');
commit;
-- Raw material inside the week, never pooled. An unpooled report does not block
-- a close (readiness counts drafts and questions, not reports), so this survives
-- the close and gives section H a draft to make afterwards.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_stage(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-06', 25000);
commit;

-- Two nights are settled before the close. The €900 one is the audit's subject.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'g_d1', 'cash', 'paid in full') as g_pay1 \gset
  select public.record_distribution_payout(:'g_d3', 'cash', 'paid in full') as g_pay3 \gset
commit;

-- ── the neighbouring week, which is never closed: 2022-05-09 … 2022-05-15 ──
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-10', 30000) as g_p4 \gset
  select public.calculate_distribution(:'g_p4') as g_d4 \gset
  select public.send_distribution(:'g_d4');
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-11', 20000) as g_p5 \gset
  select public.calculate_distribution(:'g_p5') as g_d5 \gset
  select public.send_distribution(:'g_d5');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- A · the baseline: a cancellation is a normal thing to do to an open period
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.cancel_distribution(:'g_d4', 'Redoing it.');
commit;
select tests.ok(
  (select status = 'cancelled' and sent_at is not null and cancel_reason = 'Redoing it.'
     from public.tip_distributions where id = :'g_d4'),
  'G1  with no close over it, a sent distribution can still be cancelled');

-- ═════════════════════════════════════════════════════════════════════════════
-- B · close the week, and write down what it says
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.close_financial_period(:'gw', '2022-05-02', '2022-05-08', 'audit fixture') as g_close \gset
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-02', '2022-05-08') as g_ex0 \gset
commit;
select (:'g_ex0'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint as g_ent0 \gset
select (:'g_ex0'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint  as g_set0 \gset
select (:'g_ex0'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint        as g_out0 \gset
select (:'g_ex0'::jsonb -> 'summary' ->> 'records_after_close')::int         as g_aft0 \gset

select tests.ok(:'g_ent0'::bigint = 190000 and :'g_set0'::bigint = 130000
            and :'g_out0'::bigint = 60000  and :'g_aft0'::int = 0,
  'G2  the closed week opens at €1900 owed, €1300 settled, €600 outstanding, nothing after the close');

-- ═════════════════════════════════════════════════════════════════════════════
-- C · the defect: a standalone cancellation inside the closed week
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.cancel_distribution(%L, ''take it back'')', :'g_d1'),
    'G3  a sent, fully paid distribution inside a closed period cannot be cancelled');
  select tests.denied(format('select public.cancel_distribution(%L, ''take it back'')', :'g_d2'),
    'G4  …and neither can an unpaid one: it is the close that refuses, not the payment');
  select tests.refusal(format('select public.cancel_distribution(%L, ''x'')', :'g_d1')) as g_msg \gset
commit;
select tests.ok(:'g_msg' like '%period is closed%' and :'g_msg' like '%correct%',
  'G5  …and the refusal names the close and points at the correction path');

select tests.ok(
  (select status = 'sent' and cancelled_at is null and cancel_reason is null
     from public.tip_distributions where id = :'g_d1'),
  'G6  the refusal changed nothing: the distribution is still sent, uncancelled');
select tests.ok(
  (select count(*) = 1 from public.distribution_payouts where distribution_id = :'g_d1')
  and (select amount_cents = 90000 from public.distribution_payouts where id = :'g_pay1')
  and (select count(*) = 0 from public.distribution_payout_reversals where payout_id = :'g_pay1'),
  'G7  …the payout row is untouched, and unreversed');
select tests.ok(
  (select status = 'distributed' from public.tip_pools where id = :'g_p1'),
  'G8  …and the pool was not moved to locked behind it');

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-02', '2022-05-08') as g_ex1 \gset
commit;
select tests.ok(
  (:'g_ex1'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = :'g_ent0'::bigint,
  'G9  the closed week still owes exactly what it owed');
select tests.ok(
  (:'g_ex1'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint = :'g_set0'::bigint,
  'G10 …the settled figure has not moved');
select tests.ok(
  (:'g_ex1'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint = :'g_out0'::bigint,
  'G11 …outstanding has not moved, and is not negative');
select tests.ok(
  (:'g_ex1'::jsonb -> 'summary' ->> 'records_after_close')::int = :'g_aft0'::int,
  'G12 …and nothing claims to have arrived after the close');
select tests.ok(
  (select period_start = '2022-05-02'::date and period_end = '2022-05-08'::date and note = 'audit fixture'
     from public.financial_period_closes where id = :'g_close'),
  'G13 …the close row is exactly as it was recorded');

-- ═════════════════════════════════════════════════════════════════════════════
-- D · and not by hand either
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.tip_distributions set status = ''cancelled'' where id = %L', :'g_d1'),
    'G14 a manager cannot PATCH the closed distribution to cancelled');
  select tests.denied(format(
    'update public.tip_distributions set cancelled_at = now(), entries_total_cents = 0 where id = %L', :'g_d1'),
    'G15 …nor retire it by rewriting its total');
  -- changes_nothing, not denied: distributions_delete_draft narrows DELETE to
  -- drafts in its USING clause, so a sent row is filtered away rather than
  -- refused. Silently touching nothing is the right answer here, and the only
  -- one the caller can tell apart from success.
  select tests.changes_nothing(format('delete from public.tip_distributions where id = %L', :'g_d1'),
    'G16 …nor delete it');
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'update public.tip_distributions set status = ''cancelled'' where id = %L', :'g_d1'),
    'G17 and neither can the employee it pays');
commit;
select tests.ok(
  (select status = 'sent' from public.tip_distributions where id = :'g_d1'),
  'G18 …after all four attempts it is still sent');

-- ═════════════════════════════════════════════════════════════════════════════
-- E · the guard is scoped to the closed period, not to the workplace
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.cancel_distribution(:'g_d5', 'Different week.');
commit;
select tests.ok(
  (select status = 'cancelled' from public.tip_distributions where id = :'g_d5'),
  'G19 a distribution in the NEXT week, which no close covers, can still be cancelled');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-02', '2022-05-08') as g_ex2 \gset
commit;
select tests.ok(
  (:'g_ex2'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = :'g_ent0'::bigint
  and (:'g_ex2'::jsonb -> 'summary' ->> 'records_after_close')::int = :'g_aft0'::int,
  'G20 …and the closed week beside it did not feel it');

-- ═════════════════════════════════════════════════════════════════════════════
-- F · the correction path is untouched — which is the whole point of the rule
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'g_d2', 'hours', 'Lena stayed until closing.') as g_d2b \gset
commit;
select tests.ok(:'g_d2b' is not null
  and (select status = 'draft' and supersedes_id = :'g_d2'
         from public.tip_distributions where id = :'g_d2b'),
  'G21 a distribution inside the closed week can still be corrected');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.send_distribution(:'g_d2b');
commit;
select tests.ok(
  (select status = 'sent' from public.tip_distributions where id = :'g_d2b')
  and (select status = 'cancelled' and sent_at is not null from public.tip_distributions where id = :'g_d2'),
  'G22 …publishing it retires the original, which cancel_distribution() itself may not do');

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-02', '2022-05-08') as g_ex3 \gset
commit;
select tests.ok(
  (select bool_or((d ->> 'id') = :'g_d2b' and (d ->> 'after_close')::boolean)
     from jsonb_array_elements(:'g_ex3'::jsonb -> 'distributions') d),
  'G23 …and unlike a cancellation, the correction IS marked as after the close');
select tests.ok(
  (:'g_ex3'::jsonb -> 'summary' ->> 'records_after_close')::int = :'g_aft0'::int + 1,
  'G24 …and counted, so nobody believes the closed figures contained it');
select tests.ok(
  (:'g_ex3'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = :'g_ent0'::bigint
  and (:'g_ex3'::jsonb -> 'summary' ->> 'replaced_entitlement_cents')::bigint = 60000,
  'G25 …the corrected night is counted once, with the version it replaced reported beside it');

-- ═════════════════════════════════════════════════════════════════════════════
-- G · settlement after the close is still the modelled, flagged event
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'g_d2b', 'bank_transfer', 'with the payroll run') as g_pay2 \gset
commit;
select tests.ok(:'g_pay2' is not null,
  'G26 a payout can still be recorded after the close');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'g_pay3', 'wrong_method', 'It went by bank.') as g_rev3 \gset
commit;
select tests.ok(:'g_rev3' is not null
  and not app.payout_is_effective(:'g_pay3'),
  'G27 …and a payout made BEFORE the close can still be reversed after it');

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-02', '2022-05-08') as g_ex4 \gset
commit;
select tests.ok(
  (:'g_ex4'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint = 150000,
  'G28 …the settled figure follows both: €1300 + €600 paid − €400 reversed');
select tests.ok(
  (:'g_ex4'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint = 40000,
  'G29 …outstanding is what is owed minus that, and stays a number a manager can act on');
select tests.ok(
  (:'g_ex4'::jsonb -> 'summary' ->> 'records_after_close')::int = :'g_aft0'::int + 3,
  'G30 …and all three post-close events are counted: the correction, the payout, the reversal');

-- ═════════════════════════════════════════════════════════════════════════════
-- H · the shapes around the guard that must not change
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.refusal(format('select public.cancel_distribution(%L, ''again'')', :'g_d2')) as g_recan \gset
commit;
select tests.ok(:'g_recan' = ''
  and (select status = 'cancelled' and cancel_reason = 'Replaced by a corrected distribution'
         from public.tip_distributions where id = :'g_d2'),
  'G31 cancelling an already-cancelled distribution inside a closed period is still a quiet no-op');

-- A draft made inside the closed week, from the report staged and never pooled.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.create_pool_from_reports(:'gw', '2022-05-06', '2022-05-06') as g_p6 \gset
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.calculate_distribution(:'g_p6') as g_d6 \gset
  select tests.refusal(format('select public.cancel_distribution(%L, ''x'')', :'g_d6')) as g_draftmsg \gset
commit;
select tests.ok(:'g_draftmsg' like '%draft is discarded%',
  'G32 a draft inside a closed period is still refused as a draft, not as a close');
select tests.ok(
  (select status = 'draft' from public.tip_distributions where id = :'g_d6'),
  'G33 …and it is still a draft');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  delete from public.tip_distributions where id = :'g_d6';
commit;
select tests.ok(
  (select count(*) = 0 from public.tip_distributions where id = :'g_d6'),
  'G34 …and discarding it, which is what a draft is for, still works inside a closed period');

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.cancel_distribution(%L, ''mine now'')', :'g_d1'),
    'G35 an employee still cannot cancel anything, closed period or not');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- J · migration 37 · money that has gone out is not abandoned
--
-- Deliberately in the week BESIDE the closed one, so nothing here can be the
-- close talking. A night is sent and paid in full, and then somebody tries to
-- abandon it. The audit measured what used to happen: owed fell by the night's
-- amount, settled did not move, and outstanding went negative — while the
-- employee's own row still said they had been paid.
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-12', 80000) as g_p7 \gset
  select public.calculate_distribution(:'g_p7') as g_d7 \gset
  select public.send_distribution(:'g_d7');
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'g_d7', 'cash', 'paid in full') as g_pay7 \gset
  select public.financial_period_export(:'gw', '2022-05-09', '2022-05-15') as g_open0 \gset
commit;
select (:'g_open0'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint as g_oent0 \gset
select (:'g_open0'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint  as g_oset0 \gset
select (:'g_open0'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint        as g_oout0 \gset
select tests.ok(:'g_oent0'::bigint = 80000 and :'g_oset0'::bigint = 80000 and :'g_oout0'::bigint = 0,
  'J1  the open week opens at 80000 owed, 80000 settled, nothing outstanding');

begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.cancel_distribution(%L, ''take it back'')', :'g_d7'),
    'J2  a sent, fully paid distribution in an OPEN period cannot be cancelled');
  select tests.refusal(format('select public.cancel_distribution(%L, ''x'')', :'g_d7')) as g_paidmsg \gset
commit;
select tests.ok(:'g_paidmsg' like '%has been paid%' and :'g_paidmsg' like '%reverse the payment%',
  'J3  …and the refusal names the payment and the way through it');
select tests.ok(
  (select status = 'sent' and cancelled_at is null and cancel_reason is null
     from public.tip_distributions where id = :'g_d7'),
  'J4  …the distribution is still sent, and still current');
select tests.ok((select status = 'distributed' from public.tip_pools where id = :'g_p7'),
  'J5  …its pool is still distributed, not quietly returned to locked');
select tests.ok(app.payout_is_effective(:'g_pay7'),
  'J6  …and the payment still stands, untouched');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-09', '2022-05-15') as g_open1 \gset
commit;
select tests.ok(
  (:'g_open1'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = :'g_oent0'::bigint
  and (:'g_open1'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint = :'g_oset0'::bigint
  and (:'g_open1'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint = :'g_oout0'::bigint,
  'J7  …so owed, settled and outstanding are all exactly where they were');

-- The way through: take the money back first, and then the night may go.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'g_pay7', 'recorded_by_mistake', 'never actually paid') as g_rev7 \gset
commit;
select tests.ok(:'g_rev7' is not null and not app.payout_is_effective(:'g_pay7'),
  'J8  reversing the payment is allowed, and the payment stops counting');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.refusal(format('select public.cancel_distribution(%L, ''abandon it'')', :'g_d7')) as g_after \gset
commit;
select tests.ok(:'g_after' = '',
  'J9  …and only then may the night be abandoned');
select tests.ok(
  (select status = 'cancelled' from public.tip_distributions where id = :'g_d7')
  and (select status = 'locked' from public.tip_pools where id = :'g_p7'),
  'J10 …the distribution is cancelled and its pool returns to locked');
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'gw', '2022-05-09', '2022-05-15') as g_open2 \gset
commit;
select tests.ok(
  (:'g_open2'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint = 0
  and (:'g_open2'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint = 0,
  'J11 …the week now owes nothing and has settled nothing');
select tests.ok(
  (:'g_open2'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint = 0,
  'J12 …and outstanding is zero — never the negative number the audit measured');

-- A third week, one night, paid and left alone: the untouched subject the
-- payment guard's negative control needs.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select tests.guard_night(:'gw', :'g_boss', :'g_staff', :'g_service', :'g_server', '2022-05-17', 15000) as g_p8 \gset
  select public.calculate_distribution(:'g_p8') as g_d8 \gset
  select public.send_distribution(:'g_d8');
commit;
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'g_d8', 'cash', 'paid in full') as g_pay8 \gset
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- NC · each guard is load-bearing on its own
--
-- Two guards now stand between a manager and a cancellation, and a control that
-- switches off one while the other is still biting proves nothing. So each
-- control below takes the OTHER guard out of the way first — legitimately,
-- through the product's own reversal RPC — and only then switches off the guard
-- under test. Everything runs inside a transaction that is rolled back.
-- ═════════════════════════════════════════════════════════════════════════════

-- NC1 · the close bites even when the payment does not. g_d1 is both closed and
-- paid; reverse the payment, and the close alone still refuses — and says so.
begin;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'g_pay1', 'recorded_by_mistake', 'control');
  select tests.refusal(format('select public.cancel_distribution(%L, ''control'')', :'g_d1')) as g_nc1 \gset
rollback;
select tests.ok(:'g_nc1' like '%period is closed%',
  'NC1 take the payment out of the way and the close still refuses, naming itself');

-- NC2 · …and it is app.distribution_is_in_closed_period() doing it. Same
-- transaction, plus a helper that always answers "not closed" — as the owner,
-- which nothing in the product can do — and the cancellation lands.
begin;
  create or replace function app.distribution_is_in_closed_period(p_distribution_id uuid)
  returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'g_pay1', 'recorded_by_mistake', 'control');
  select public.cancel_distribution(:'g_d1', 'negative control');
  select status::text as g_nc2 from public.tip_distributions where id = :'g_d1' \gset
rollback;
select tests.ok(:'g_nc2' = 'cancelled',
  'NC2 …with that helper answering false, the same call succeeds — the helper is what refused');

-- NC3 · and it is the close ROW that makes the helper true. Move the close off
-- this week, past its own immutability trigger, and the cancellation lands
-- again. So it is the close, not the status, the pool or anything else.
begin;
  alter table public.financial_period_closes disable trigger closes_are_immutable;
  update public.financial_period_closes
    set period_start = '2021-01-04', period_end = '2021-01-10' where id = :'g_close';
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'g_pay1', 'recorded_by_mistake', 'control');
  select public.cancel_distribution(:'g_d1', 'negative control');
  select status::text as g_nc3 from public.tip_distributions where id = :'g_d1' \gset
rollback;
select tests.ok(:'g_nc3' = 'cancelled',
  'NC3 move the close off this week and the same call succeeds — the close row is what refuses');

-- NC4 · the payment guard, on a night no close covers, so the close cannot be
-- what is talking. Answer app.effective_payout() with null and the same call
-- lands — so it is the standing payment that refuses, and migration 37's check
-- is the thing doing it.
begin;
  create or replace function app.effective_payout(p_distribution_id uuid)
  returns uuid language sql stable security definer set search_path = '' as $$ select null::uuid $$;
  select tests.as_user('a1500000-0000-0000-0000-000000000001');
  select public.cancel_distribution(:'g_d8', 'negative control');
  select status::text as g_nc4 from public.tip_distributions where id = :'g_d8' \gset
rollback;
select tests.ok(:'g_nc4' = 'cancelled',
  'NC4 with app.effective_payout() answering null, the paid night cancels — the payment is what refuses');

select tests.ok(
  (select status = 'sent' and cancelled_at is null from public.tip_distributions where id = :'g_d1')
  and (select status = 'sent' and cancelled_at is null from public.tip_distributions where id = :'g_d8')
  and app.payout_is_effective(:'g_pay1') and app.payout_is_effective(:'g_pay8')
  and (select period_start = '2022-05-02'::date from public.financial_period_closes where id = :'g_close'),
  'NC5 …and every control rolled back: both nights still sent and still paid, the close still on its week');
