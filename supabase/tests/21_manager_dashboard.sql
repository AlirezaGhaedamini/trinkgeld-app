-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3P · the manager dashboard.
--
-- One RPC, and every figure in it must be a figure the schema already knew.
-- What is proved here: that the day is the database's day, that a night is
-- counted once however many times it was corrected, that acknowledgement is
-- tallied per person and not per entry, that what is owed survives a payout,
-- its reversal and a repayment, that an empty workplace reads as empty rather
-- than as somebody else's, and that nobody but an active manager of the
-- workplace is answered at all.
--
-- Expected values are derived from the rows the fixture creates and from the
-- views the RPC is supposed to agree with — never from a number typed here.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1200000-0000-0000-0000-000000000001', 'd.boss@test.local',   '{"full_name":"D Boss"}'),
  ('a1200000-0000-0000-0000-000000000002', 'd.staff@test.local',  '{"full_name":"D Staff"}'),
  ('a1200000-0000-0000-0000-000000000003', 'd.bar@test.local',    '{"full_name":"D Bar"}'),
  ('a1200000-0000-0000-0000-000000000004', 'd.rival@test.local',  '{"full_name":"D Rival"}'),
  ('a1200000-0000-0000-0000-000000000005', 'd.second@test.local', '{"full_name":"D Second"}'),
  ('a1200000-0000-0000-0000-000000000006', 'd.joiner@test.local', '{"full_name":"D Joiner"}')
on conflict do nothing;

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.create_workplace('Dash Lab', 'Marburg') as dw \gset
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000004');
  select public.create_workplace('Dash Rival', 'Kassel') as dx \gset
commit;

select id as d_service from public.workplace_areas where workplace_id = :'dw' and key = 'service' \gset
select id as d_bar     from public.workplace_areas where workplace_id = :'dw' and key = 'bar' \gset
select id as d_server  from public.workplace_roles where workplace_id = :'dw' and key = 'server' \gset
select id as d_keep    from public.workplace_roles where workplace_id = :'dw' and key = 'bartender' \gset
select id as d_boss    from public.workplace_members where workplace_id = :'dw' and role = 'manager' \gset
select join_code as d_code from public.workplaces where id = :'dw' \gset

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'d_service', workplace_role_id = :'d_server'
    where id = :'d_boss';
  select token from public.create_invitation(
    :'dw', 'd.staff@test.local', 'Dana Staff', 'employee', :'d_service', :'d_server') as t \gset tok_d1_
  select token from public.create_invitation(
    :'dw', 'd.bar@test.local', 'Bo Bar', 'employee', :'d_bar', :'d_keep') as t \gset tok_d2_
  select token from public.create_invitation(
    :'dw', 'd.second@test.local', 'Sam Second', 'manager', :'d_service', :'d_server') as t \gset tok_d3_
commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000002');
       select public.accept_invitation(:'tok_d1_token') as d_staff \gset
commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000003');
       select public.accept_invitation(:'tok_d2_token') as d_bar_m \gset
commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000005');
       select public.accept_invitation(:'tok_d3_token') as d_second \gset
commit;

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select id as d_rule from public.distribution_rules where workplace_id = :'dw' and status = 'draft' \gset
  update public.distribution_rules set method = 'hours_points', min_overlap_minutes = 15,
         acknowledgement_required = true where id = :'d_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'d_rule' and area_id = :'d_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'d_rule' and area_id = :'d_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'d_rule' and area_id not in (:'d_service', :'d_bar');
  select public.activate_rule(:'d_rule');
commit;

-- A past night, sent. Boss and staff in service, Bo in bar.
create or replace function tests.dash_night(
  p_wp uuid, p_boss uuid, p_staff uuid, p_bar_m uuid, p_svc uuid, p_bar uuid,
  p_srv uuid, p_keep uuid, p_day date, p_cash bigint)
returns uuid language plpgsql as $$
declare v_pool uuid; v_dist uuid;
begin
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (p_wp, p_boss, p_day, p_cash);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (p_wp, p_boss,  (p_day + time '16:00') at time zone 'Europe/Berlin', (p_day + time '23:00') at time zone 'Europe/Berlin', 0, 'approved', p_svc, p_srv),
         (p_wp, p_staff, (p_day + time '16:00') at time zone 'Europe/Berlin', (p_day + time '20:00') at time zone 'Europe/Berlin', 0, 'approved', p_svc, p_srv),
         (p_wp, p_bar_m, (p_day + time '18:00') at time zone 'Europe/Berlin', (p_day + time '22:00') at time zone 'Europe/Berlin', 0, 'approved', p_bar, p_keep);
  v_pool := public.create_pool_from_reports(p_wp, p_day, p_day);
  v_dist := public.calculate_distribution(v_pool);
  perform public.send_distribution(v_dist);
  return v_dist;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- an empty workplace reads as empty
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000004');
  select public.manager_dashboard(:'dx') as d_empty \gset
commit;
select tests.ok(
  (:'d_empty'::jsonb -> 'attention' ->> 'submitted_shifts')::int = 0
  and (:'d_empty'::jsonb -> 'attention' ->> 'open_questions')::int = 0
  and (:'d_empty'::jsonb -> 'attention' ->> 'draft_distributions')::int = 0
  and (:'d_empty'::jsonb -> 'attention' ->> 'pending_join_requests')::int = 0,
  'D1  a workplace with nothing in it has nothing needing attention');
select tests.ok(
  (:'d_empty'::jsonb -> 'latest') = 'null'::jsonb
  and (:'d_empty'::jsonb -> 'close') = 'null'::jsonb
  and (:'d_empty'::jsonb -> 'tonight' -> 'pool') = 'null'::jsonb
  and jsonb_array_length(:'d_empty'::jsonb -> 'recent') = 0,
  'D2  …no latest night, no close, no pool, no recent list');
select tests.ok(
  (:'d_empty'::jsonb -> 'week' ->> 'entitlement_cents')::bigint = 0
  and (:'d_empty'::jsonb -> 'settlement' ->> 'outstanding_cents')::bigint = 0
  and (:'d_empty'::jsonb -> 'settlement' ->> 'unpaid_distributions')::int = 0,
  'D3  …and owes nothing');
select tests.ok(
  (:'d_empty'::jsonb -> 'team' ->> 'active_members')::int
    = (select count(*) from public.workplace_members where workplace_id = :'dx' and status = 'active'),
  'D4  …while the team count is the roster it does have');

-- ═════════════════════════════════════════════════════════════════════════════
-- the day is the database's day
-- ═════════════════════════════════════════════════════════════════════════════
select app.business_day(now(), :'dw') as d_today \gset
select (pg_catalog.date_trunc('week', :'d_today'::date::timestamp))::date as d_week_start \gset
select (:'d_week_start'::date + 6) as d_week_end \gset

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.manager_dashboard(:'dw') as d_0 \gset
commit;
select tests.ok((:'d_0'::jsonb ->> 'business_date')::date = :'d_today'::date,
  'D5  business_date is app.business_day(now(), workplace), not the caller''s clock');
select tests.ok(
  (:'d_0'::jsonb ->> 'week_start')::date = :'d_week_start'::date
  and (:'d_0'::jsonb ->> 'week_end')::date = :'d_week_end'::date
  and extract(isodow from (:'d_0'::jsonb ->> 'week_start')::date) = 1
  and (:'d_0'::jsonb ->> 'week_end')::date - (:'d_0'::jsonb ->> 'week_start')::date = 6,
  'D6  the week runs Monday to Sunday around that day');

-- ═════════════════════════════════════════════════════════════════════════════
-- history first: four past nights, so the recent list has something to cap
-- ═════════════════════════════════════════════════════════════════════════════
begin; select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select tests.dash_night(:'dw', :'d_boss', :'d_staff', :'d_bar_m', :'d_service', :'d_bar',
    :'d_server', :'d_keep', '2024-03-01', 50000) as d_h1 \gset
commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select tests.dash_night(:'dw', :'d_boss', :'d_staff', :'d_bar_m', :'d_service', :'d_bar',
    :'d_server', :'d_keep', '2024-03-02', 50000) as d_h2 \gset
commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select tests.dash_night(:'dw', :'d_boss', :'d_staff', :'d_bar_m', :'d_service', :'d_bar',
    :'d_server', :'d_keep', '2024-03-03', 50000) as d_h3 \gset
commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select tests.dash_night(:'dw', :'d_boss', :'d_staff', :'d_bar_m', :'d_service', :'d_bar',
    :'d_server', :'d_keep', '2024-03-04', 50000) as d_h4 \gset
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- tonight: hours across the 05:00 boundary, a submitted shift, a report
-- ═════════════════════════════════════════════════════════════════════════════
-- Boss anchors the night, 18:00 through to 04:45. Bo works twice after
-- midnight — bar 01:00–03:00, then service 03:00–04:30 — so Bo is ONE person
-- with TWO entries. Dana only submits. All of it belongs to today's business
-- day even though most of it happens on tomorrow's calendar date.
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'dw', :'d_boss', :'d_today', 100000);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id) values
    (:'dw', :'d_boss',  (:'d_today'::date + time '18:00') at time zone 'Europe/Berlin',
                        (:'d_today'::date + 1 + time '04:45') at time zone 'Europe/Berlin', 0, 'approved', :'d_service', :'d_server'),
    (:'dw', :'d_bar_m', (:'d_today'::date + 1 + time '01:00') at time zone 'Europe/Berlin',
                        (:'d_today'::date + 1 + time '03:00') at time zone 'Europe/Berlin', 0, 'approved', :'d_bar', :'d_keep'),
    (:'dw', :'d_bar_m', (:'d_today'::date + 1 + time '03:00') at time zone 'Europe/Berlin',
                        (:'d_today'::date + 1 + time '04:30') at time zone 'Europe/Berlin', 0, 'approved', :'d_service', :'d_server'),
    (:'dw', :'d_staff', (:'d_today'::date + time '16:00') at time zone 'Europe/Berlin',
                        (:'d_today'::date + time '20:00') at time zone 'Europe/Berlin', 0, 'submitted', :'d_service', :'d_server');
commit;

-- Bo's two shifts start on TOMORROW's calendar date in Berlin and are filed
-- under TONIGHT's business day. Measured in the workplace's zone, not the
-- session's, so the assertion means the same thing in summer and winter.
select tests.ok(
  (select count(*) from public.shifts
    where workplace_id = :'dw' and member_id = :'d_bar_m'
      and (starts_at at time zone 'Europe/Berlin')::date = :'d_today'::date + 1
      and work_date = :'d_today'::date) = 2,
  'D7  a shift starting at 01:00 tomorrow belongs to tonight''s business day');

select count(distinct member_id) as d_appr_people, coalesce(sum(worked_minutes), 0) as d_appr_minutes
  from public.shifts where workplace_id = :'dw' and work_date = :'d_today' and status = 'approved' \gset
select count(*) as d_sub_all from public.shifts where workplace_id = :'dw' and status = 'submitted' \gset

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.manager_dashboard(:'dw') as d_1 \gset
commit;
select tests.ok(
  (:'d_1'::jsonb -> 'tonight' ->> 'approved_people')::int = :'d_appr_people'::int
  and (:'d_1'::jsonb -> 'tonight' ->> 'approved_minutes')::int = :'d_appr_minutes'::int,
  'D8  tonight''s approved hours are the shifts on that business day, people and minutes');
select tests.ok((:'d_1'::jsonb -> 'tonight' ->> 'approved_people')::int = 2,
  'D9  …two people, because Bo''s two shifts are one person');
select tests.ok(
  (:'d_1'::jsonb -> 'tonight' ->> 'submitted_shifts')::int = 1
  and (:'d_1'::jsonb -> 'attention' ->> 'submitted_shifts')::int = :'d_sub_all'::int,
  'D10 the submitted shift is tonight''s one to review and the workplace''s one to review');
select tests.ok(
  (:'d_1'::jsonb -> 'tonight' ->> 'reports_count')::int = 1
  and (:'d_1'::jsonb -> 'tonight' ->> 'reports_total_cents')::bigint = 100000,
  'D11 tonight''s report is counted and summed');
select tests.ok((:'d_1'::jsonb -> 'tonight' -> 'pool') = 'null'::jsonb,
  'D12 …and there is no pool yet');
select tests.ok(
  (:'d_1'::jsonb -> 'latest' ->> 'id') = :'d_h4'
  and jsonb_array_length(:'d_1'::jsonb -> 'recent') = 4
  and (:'d_1'::jsonb -> 'recent' -> 0 ->> 'id') = :'d_h4'
  and (:'d_1'::jsonb -> 'recent' -> 3 ->> 'id') = :'d_h1',
  'D13 the latest night is the most recent one sent, and recent is capped at four, newest first');

-- Isolation: work in the rival workplace must not appear here.
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000004');
  select id as dx_boss from public.workplace_members where workplace_id = :'dx' and role = 'manager' \gset
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, status)
  values (:'dx', :'dx_boss', '2024-03-01 16:00+01', '2024-03-01 20:00+01', 'submitted');
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.manager_dashboard(:'dw') as d_iso \gset
commit;
select tests.ok(
  (:'d_iso'::jsonb -> 'attention' ->> 'submitted_shifts')::int = :'d_sub_all'::int,
  'D14 another workplace''s submitted shift does not count here');

-- ═════════════════════════════════════════════════════════════════════════════
-- tonight becomes a pool, a draft, then a sent night
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.create_pool_from_reports(:'dw', :'d_today', :'d_today') as d_pool \gset
  select public.manager_dashboard(:'dw') as d_2 \gset
commit;
select tests.ok(
  (:'d_2'::jsonb -> 'tonight' -> 'pool' ->> 'status') = 'open'
  and (:'d_2'::jsonb -> 'tonight' -> 'pool' ->> 'total_cents')::bigint = 100000
  and (:'d_2'::jsonb -> 'tonight' -> 'distribution') = 'null'::jsonb,
  'D15 an open pool with no distribution yet');

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.calculate_distribution(:'d_pool') as d_a \gset
  select public.manager_dashboard(:'dw') as d_3 \gset
commit;
select tests.ok(
  (:'d_3'::jsonb -> 'tonight' -> 'distribution' ->> 'status') = 'draft'
  and (:'d_3'::jsonb -> 'attention' ->> 'draft_distributions')::int = 1
  and (:'d_3'::jsonb -> 'attention' ->> 'draft_distribution_id') = :'d_a',
  'D16 a draft is tonight''s distribution and an attention item, naming itself');
select tests.ok(
  (select count(*) from jsonb_array_elements(:'d_3'::jsonb -> 'recent') e where e ->> 'id' = :'d_a') = 0,
  'D16b …and a draft is never a recent night: recent lists only what was sent');
select tests.ok(
  (:'d_3'::jsonb -> 'latest' ->> 'id') = :'d_h4',
  'D17 …but a draft is never the latest night, because it was sent to nobody');

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.send_distribution(:'d_a');
  select public.manager_dashboard(:'dw') as d_4 \gset
commit;
select entries_total_cents as d_a_total from public.tip_distributions where id = :'d_a' \gset
select tests.ok(
  (:'d_4'::jsonb -> 'attention' ->> 'draft_distributions')::int = 0
  and (:'d_4'::jsonb -> 'tonight' -> 'distribution' ->> 'status') = 'sent'
  and (:'d_4'::jsonb -> 'latest' ->> 'id') = :'d_a',
  'D18 sending it clears the draft and makes it the latest night');

-- ═════════════════════════════════════════════════════════════════════════════
-- acknowledgement is tallied per person
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  (select count(*) from public.tip_distribution_entries where distribution_id = :'d_a' and member_id = :'d_bar_m') = 2,
  'D19 the fixture really gave Bo two entries');
select tests.ok(
  (:'d_4'::jsonb -> 'latest' ->> 'participants')::int = 2
  and (:'d_4'::jsonb -> 'latest' ->> 'answerable_people')::int = 2
  and (:'d_4'::jsonb -> 'latest' ->> 'pending_people')::int = 2
  and (:'d_4'::jsonb -> 'latest' ->> 'confirmed_people')::int = 0,
  'D20 two people owe an answer — Bo once, not twice');

begin; select tests.as_user('a1200000-0000-0000-0000-000000000003');
       select public.acknowledge_distribution(:'d_a', 'acknowledged'); commit;
begin; select tests.as_user('a1200000-0000-0000-0000-000000000001');
       select public.query_distribution(:'d_a', 'My own share looks short.');
       select public.manager_dashboard(:'dw') as d_5 \gset
commit;
select tests.ok(
  (:'d_5'::jsonb -> 'latest' ->> 'confirmed_people')::int = 1
  and (:'d_5'::jsonb -> 'latest' ->> 'queried_people')::int = 1
  and (:'d_5'::jsonb -> 'latest' ->> 'pending_people')::int = 0,
  'D21 one confirmed, one queried, nobody pending');
select tests.ok(
  (:'d_5'::jsonb -> 'latest' ->> 'open_questions')::int = 1
  and (:'d_5'::jsonb -> 'attention' ->> 'open_questions')::int = 1
  and (:'d_5'::jsonb -> 'attention' ->> 'open_question_distribution_id') = :'d_a',
  'D22 the question is open on the night and on the attention list, naming the night');
select tests.ok(
  position('looks short' in :'d_5') = 0,
  'D23 …and the words of the question are not in the dashboard');

-- The manager agrees, and has not yet sent the correction.
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select id as d_q from public.distribution_queries where distribution_id = :'d_a' and status = 'open' \gset
  select public.resolve_query(:'d_q', 'correction_required', 'You are right.');
  select public.manager_dashboard(:'dw') as d_6 \gset
commit;
select tests.ok(
  (:'d_6'::jsonb -> 'attention' ->> 'open_questions')::int = 0
  and (:'d_6'::jsonb -> 'attention' ->> 'agreed_corrections_not_sent')::int = 1
  and (:'d_6'::jsonb -> 'attention' ->> 'agreed_correction_distribution_id') = :'d_a',
  'D24 an agreed correction with nothing sent is the attention item, naming the night');

-- ═════════════════════════════════════════════════════════════════════════════
-- money: pay A, correct it, reverse, repay, correct again
-- ═════════════════════════════════════════════════════════════════════════════
-- Everything below is asserted against distribution_settlement, the view the
-- RPC is supposed to agree with — and once against plain arithmetic, so the
-- view is not merely agreeing with itself.
create or replace function tests.dash_expected(p_wp uuid, out unpaid int, out outstanding bigint)
language sql as $$
  select count(*) filter (where payout_status <> 'paid')::int,
         coalesce(sum(settlement_due_cents), 0)::bigint
  from public.distribution_settlement
  where workplace_id = p_wp and status in ('sent', 'confirmed')
$$;

select unpaid as d_exp_unpaid0, outstanding as d_exp_out0 from tests.dash_expected(:'dw') \gset
select tests.ok(
  (:'d_6'::jsonb -> 'settlement' ->> 'unpaid_distributions')::int = :'d_exp_unpaid0'::int
  and (:'d_6'::jsonb -> 'settlement' ->> 'outstanding_cents')::bigint = :'d_exp_out0'::bigint,
  'D25 unpaid and outstanding are the settlement view''s answer');
select tests.ok(
  :'d_exp_out0'::bigint = (select sum(entries_total_cents) from public.tip_distributions
                            where workplace_id = :'dw' and status in ('sent', 'confirmed')),
  'D26 …and with nothing paid yet, outstanding is every current night''s total');

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'d_a', 'cash', 'Paid on the night.') as d_pa \gset
  select public.manager_dashboard(:'dw') as d_7 \gset
commit;
select unpaid as d_exp_unpaid1, outstanding as d_exp_out1 from tests.dash_expected(:'dw') \gset
select tests.ok(
  (:'d_7'::jsonb -> 'latest' ->> 'payout_state') = 'paid'
  and (:'d_7'::jsonb -> 'latest' ->> 'settlement_due_cents')::bigint = 0,
  'D27 paying the latest night marks it paid with nothing due');
select tests.ok(
  (:'d_7'::jsonb -> 'settlement' ->> 'outstanding_cents')::bigint = :'d_exp_out1'::bigint
  and :'d_exp_out1'::bigint = :'d_exp_out0'::bigint - :'d_a_total'::bigint
  and (:'d_7'::jsonb -> 'settlement' ->> 'unpaid_distributions')::int = :'d_exp_unpaid0'::int - 1,
  'D28 …outstanding falls by exactly that night, and unpaid by one');

-- Correct A into B. The pool is the same, so B is worth what A was, and A's
-- payment still counts: B owes nothing more, yet nobody has recorded paying B.
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'d_bar_m' and area_id = :'d_service' and work_date = :'d_today';
  update public.shifts set ends_at = (:'d_today'::date + 1 + time '04:00') at time zone 'Europe/Berlin'
    where member_id = :'d_bar_m' and area_id = :'d_service' and work_date = :'d_today';
  select public.create_replacement_distribution(:'d_a') as d_b \gset
  select public.manager_dashboard(:'dw') as d_8 \gset
commit;
select tests.ok(
  (:'d_8'::jsonb -> 'attention' ->> 'draft_corrections')::int = 1
  and (:'d_8'::jsonb -> 'attention' ->> 'draft_correction_id') = :'d_b'
  and (:'d_8'::jsonb -> 'attention' ->> 'agreed_corrections_not_sent')::int = 1
  and (:'d_8'::jsonb -> 'latest' ->> 'id') = :'d_a',
  'D29 a prepared correction is an attention item; the agreement still stands; A is still latest');
select tests.ok(
  (select count(*) from jsonb_array_elements(:'d_8'::jsonb -> 'recent') e where e ->> 'id' = :'d_b') = 0
  and (select count(*) from jsonb_array_elements(:'d_8'::jsonb -> 'recent') e where e ->> 'id' = :'d_a') = 1,
  'D29b …and the draft correction is not recent: the night is listed once, as its sent original');

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.send_distribution(:'d_b');
  select public.manager_dashboard(:'dw') as d_9 \gset
commit;
select entries_total_cents as d_b_total from public.tip_distributions where id = :'d_b' \gset
select unpaid as d_exp_unpaid2, outstanding as d_exp_out2 from tests.dash_expected(:'dw') \gset
select tests.ok(
  (:'d_9'::jsonb -> 'attention' ->> 'draft_corrections')::int = 0
  and (:'d_9'::jsonb -> 'attention' ->> 'agreed_corrections_not_sent')::int = 0,
  'D30 sending the correction clears both attention items');
select tests.ok(
  (:'d_9'::jsonb -> 'latest' ->> 'id') = :'d_b'
  and (:'d_9'::jsonb -> 'latest' ->> 'is_correction')::boolean
  and (:'d_9'::jsonb -> 'tonight' -> 'distribution' ->> 'id') = :'d_b'
  and (:'d_9'::jsonb -> 'tonight' -> 'distribution' ->> 'is_correction')::boolean,
  'D31 the correction is now the latest night and tonight''s distribution');
select tests.ok(
  (:'d_9'::jsonb -> 'latest' ->> 'payout_state') = 'unpaid'
  and (:'d_9'::jsonb -> 'latest' ->> 'settlement_due_cents')::bigint = 0
  and (:'d_9'::jsonb -> 'settlement' ->> 'outstanding_cents')::bigint = :'d_exp_out2'::bigint
  and :'d_exp_out2'::bigint = :'d_exp_out1'::bigint,
  'D32 B is unpaid yet owes nothing: A''s payment still settles the lineage');
select tests.ok(
  (:'d_9'::jsonb -> 'latest' ->> 'pending_people')::int = 2
  and (:'d_9'::jsonb -> 'latest' ->> 'confirmed_people')::int = 0,
  'D33 …and a correction is confirmed from scratch');
select tests.ok(
  :'d_a_total'::bigint = :'d_b_total'::bigint,
  'D34 the fixture holds: a correction is worth exactly what it replaced');

-- The week counts the night once, however many versions it has.
select coalesce(sum(entries_total_cents), 0) as d_exp_week from public.tip_distributions
  where workplace_id = :'dw' and status in ('sent', 'confirmed')
    and period_start between :'d_week_start' and :'d_week_end' \gset
select tests.ok(
  (:'d_9'::jsonb -> 'week' ->> 'entitlement_cents')::bigint = :'d_exp_week'::bigint
  and (:'d_9'::jsonb -> 'week' ->> 'entitlement_cents')::bigint = :'d_b_total'::bigint
  and (:'d_9'::jsonb -> 'week' ->> 'distributions')::int = 1,
  'D35 the week owes the corrected night once, never the original and the correction together');
select tests.ok(
  (select count(*) from jsonb_array_elements(:'d_9'::jsonb -> 'recent') e where e ->> 'id' = :'d_a') = 0
  and (select count(*) from jsonb_array_elements(:'d_9'::jsonb -> 'recent') e where e ->> 'id' = :'d_b') = 1,
  'D36 the retired original leaves the recent list and the correction takes its place');

-- Reverse A's payment. Nothing downstream is settled, so it is allowed — and
-- B, which owed nothing, now owes everything.
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.reverse_distribution_payout(:'d_pa', 'payment_not_completed', 'The cash never went out.');
  select public.manager_dashboard(:'dw') as d_10 \gset
commit;
select unpaid as d_exp_unpaid3, outstanding as d_exp_out3 from tests.dash_expected(:'dw') \gset
select tests.ok(
  (:'d_10'::jsonb -> 'latest' ->> 'settlement_due_cents')::bigint = :'d_b_total'::bigint
  and (:'d_10'::jsonb -> 'settlement' ->> 'outstanding_cents')::bigint = :'d_exp_out3'::bigint
  and :'d_exp_out3'::bigint = :'d_exp_out2'::bigint + :'d_b_total'::bigint,
  'D37 reversing the payment upstream turns B''s difference back into its full amount');

-- Pay B properly, then correct it once more into C. C owes nothing beyond B.
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'d_b', 'payroll', 'With the run.') as d_pb \gset
  select public.manager_dashboard(:'dw') as d_11 \gset
commit;
select tests.ok(
  (:'d_11'::jsonb -> 'latest' ->> 'payout_state') = 'paid'
  and (:'d_11'::jsonb -> 'settlement' ->> 'outstanding_cents')::bigint = :'d_exp_out2'::bigint,
  'D38 paying B brings outstanding back to where it was');

begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'d_bar_m' and area_id = :'d_service' and work_date = :'d_today';
  update public.shifts set ends_at = (:'d_today'::date + 1 + time '03:45') at time zone 'Europe/Berlin'
    where member_id = :'d_bar_m' and area_id = :'d_service' and work_date = :'d_today';
  select public.create_replacement_distribution(:'d_b', 'hours', 'Earlier still.') as d_c \gset
  select public.send_distribution(:'d_c');
  select public.manager_dashboard(:'dw') as d_12 \gset
commit;
select entries_total_cents as d_c_total from public.tip_distributions where id = :'d_c' \gset
select tests.ok(
  (:'d_12'::jsonb -> 'latest' ->> 'id') = :'d_c'
  and (:'d_12'::jsonb -> 'latest' ->> 'settlement_due_cents')::bigint = 0
  and (:'d_12'::jsonb -> 'week' ->> 'entitlement_cents')::bigint = :'d_c_total'::bigint
  and (:'d_12'::jsonb -> 'week' ->> 'distributions')::int = 1,
  'D39 down A <- B <- C only C is current, and the week still counts the night once');
select tests.ok(
  (:'d_12'::jsonb -> 'attention' ->> 'agreed_corrections_not_sent')::int = 0,
  'D40 A''s agreed correction stays satisfied although B has been retired (migration 29 semantics)');
select tests.ok(
  (select count(*) from jsonb_array_elements(:'d_12'::jsonb -> 'recent') e
    where e ->> 'id' in (:'d_a', :'d_b')) = 0
  and (:'d_12'::jsonb -> 'recent' -> 0 ->> 'id') = :'d_c'
  and jsonb_array_length(:'d_12'::jsonb -> 'recent') = 4,
  'D41 neither retired version is recent; C leads the list of four');
select tests.ok(
  (select count(*) from public.tip_distributions
    where tip_pool_id = :'d_pool' and status in ('sent', 'confirmed')) = 1,
  'D42 the fixture holds: one live payout per pool');

-- ═════════════════════════════════════════════════════════════════════════════
-- join requests, the team, the last close
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000006');
  select public.request_join(:'d_code') as d_req \gset
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.manager_dashboard(:'dw') as d_13 \gset
commit;
select tests.ok((:'d_13'::jsonb -> 'attention' ->> 'pending_join_requests')::int = 1,
  'D43 a join request is an attention item');
select tests.ok(
  (:'d_13'::jsonb -> 'team' ->> 'active_members')::int
    = (select count(*) from public.workplace_members where workplace_id = :'dw' and status = 'active'),
  'D44 the team count is the active roster');
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.approve_join_request(:'d_req');
  select public.manager_dashboard(:'dw') as d_14 \gset
commit;
select tests.ok(
  (:'d_14'::jsonb -> 'attention' ->> 'pending_join_requests')::int = 0
  and (:'d_14'::jsonb -> 'team' ->> 'active_members')::int
      = (:'d_13'::jsonb -> 'team' ->> 'active_members')::int + 1,
  'D45 approving it clears the item and grows the team by one');

select tests.ok((:'d_14'::jsonb -> 'close') = 'null'::jsonb,
  'D46 no period has been closed');
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  select public.close_financial_period(:'dw', '2020-01-01', '2020-01-07');
  select public.close_financial_period(:'dw', '2020-01-08', '2020-01-14');
  select public.manager_dashboard(:'dw') as d_15 \gset
commit;
select tests.ok(
  (:'d_15'::jsonb -> 'close' ->> 'period_start') = '2020-01-08'
  and (:'d_15'::jsonb -> 'close' ->> 'period_end') = '2020-01-14',
  'D47 the last close is the most recent period, not the first one made');

-- ═════════════════════════════════════════════════════════════════════════════
-- who is answered
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.manager_dashboard(%L)', :'dw'),
    'D48 an employee is refused');
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000004');
  select tests.denied(format('select public.manager_dashboard(%L)', :'dw'),
    'D49 a manager of another workplace is refused');
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'d_second';
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000005');
  select tests.denied(format('select public.manager_dashboard(%L)', :'dw'),
    'D50 a suspended manager is refused');
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'d_second';
commit;
begin;
  select tests.as_user('a1200000-0000-0000-0000-000000000005');
  select public.manager_dashboard(:'dw') as d_second_sees \gset
commit;
select tests.ok(
  (:'d_second_sees'::jsonb ->> 'business_date') = (:'d_15'::jsonb ->> 'business_date'),
  'D51 …and answered again once reinstated, with the same day');
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;
begin;
  select set_config('role', 'anon', true);
  select tests.denied(format('select public.manager_dashboard(%L)', :'dw'),
    'D52 nobody without a session is answered');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- what the dashboard must never carry
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(position('@' in :'d_15') = 0,
  'D53 no email address anywhere in the dashboard');
select tests.ok(position('a1200000-0000-0000-0000' in :'d_15') = 0,
  'D54 …nor any auth user id');
select tests.ok(
  position('looks short' in :'d_15') = 0 and position('Earlier still' in :'d_15') = 0
  and position('You are right' in :'d_15') = 0,
  'D55 …nor a question, a correction note or a manager''s answer');
select tests.ok(
  position('Dana' in :'d_15') = 0 and position('Bo Bar' in :'d_15') = 0,
  'D56 …nor anybody''s name: counts, ids, dates and amounts only');
