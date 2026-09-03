-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3N · period close and the read-only financial export.
--
-- A close is a checkpoint over records that are already immutable. The export
-- is what the database says now, with everything that arrived after the close
-- marked as such — and with totals that can never add an original and its
-- replacement together as though the workplace owed both.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-000000000001', 'c.boss@test.local',  '{"full_name":"C Boss"}'),
  ('90000000-0000-0000-0000-000000000002', 'c.staff@test.local', '{"full_name":"C Staff"}'),
  ('90000000-0000-0000-0000-000000000003', 'c.rival@test.local', '{"full_name":"C Rival"}'),
  ('90000000-0000-0000-0000-000000000004', 'c.second@test.local','{"full_name":"C Second"}')
on conflict do nothing;

begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.create_workplace('Close Lab', 'Marburg') as cw \gset
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000003');
  select public.create_workplace('Close Rival', 'Kassel') as cx \gset
commit;

select id as c_service from public.workplace_areas where workplace_id = :'cw' and key = 'service' \gset
select id as c_bar     from public.workplace_areas where workplace_id = :'cw' and key = 'bar' \gset
select id as c_server  from public.workplace_roles where workplace_id = :'cw' and key = 'server' \gset
select id as c_keep    from public.workplace_roles where workplace_id = :'cw' and key = 'bartender' \gset
select id as c_boss    from public.workplace_members where workplace_id = :'cw' and role = 'manager' \gset

begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'c_service', workplace_role_id = :'c_server'
    where id = :'c_boss';
  select token from public.create_invitation(
    :'cw', 'c.staff@test.local', 'Clara Staff', 'employee', :'c_service', :'c_server') as t \gset tok_c_
  select token from public.create_invitation(
    :'cw', 'c.second@test.local', 'Cem Second', 'manager', :'c_service', :'c_server') as t \gset tok_c2_
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_c_token') as c_staff \gset
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000004');
  select public.accept_invitation(:'tok_c2_token') as c_second \gset
commit;

begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select id as c_rule from public.distribution_rules where workplace_id = :'cw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'c_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'c_rule' and area_id = :'c_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'c_rule' and area_id = :'c_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'c_rule' and area_id not in (:'c_service', :'c_bar');
  select public.activate_rule(:'c_rule');
commit;

-- Three nights: two inside the period to be closed, one outside it. The
-- manager's shift is the longest_shift anchor, so it stays longest throughout.
create or replace function tests.close_lab_night(
  p_wp uuid, p_boss uuid, p_staff uuid, p_svc uuid, p_bar uuid,
  p_srv uuid, p_keep uuid, p_day date, p_cash bigint)
returns uuid language plpgsql as $$
declare v_pool uuid; v_dist uuid;
begin
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (p_wp, p_boss, p_day, p_cash);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (p_wp, p_staff, (p_day + time '16:00') at time zone 'UTC', (p_day + time '20:00') at time zone 'UTC', 0, 'approved', p_svc, p_srv),
         (p_wp, p_staff, (p_day + time '20:00') at time zone 'UTC', (p_day + time '23:00') at time zone 'UTC', 0, 'approved', p_bar, p_keep),
         (p_wp, p_boss,  (p_day + time '16:00') at time zone 'UTC', (p_day + time '23:00') at time zone 'UTC', 0, 'approved', p_svc, p_srv);
  v_pool := public.create_pool_from_reports(p_wp, p_day, p_day);
  v_dist := public.calculate_distribution(v_pool);
  perform public.send_distribution(v_dist);
  return v_dist;
end $$;

-- One night per transaction: create_pool_from_reports() builds a temp table
-- with `on commit drop`, so two calls inside one transaction collide on it.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select tests.close_lab_night(:'cw', :'c_boss', :'c_staff', :'c_service', :'c_bar',
    :'c_server', :'c_keep', '2023-09-03', 90000) as c_d1 \gset
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select tests.close_lab_night(:'cw', :'c_boss', :'c_staff', :'c_service', :'c_bar',
    :'c_server', :'c_keep', '2023-09-05', 60000) as c_d2 \gset
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select tests.close_lab_night(:'cw', :'c_boss', :'c_staff', :'c_service', :'c_bar',
    :'c_server', :'c_keep', '2023-09-20', 50000) as c_out \gset
commit;

select entries_total_cents as c_d1_total from public.tip_distributions where id = :'c_d1' \gset
select entries_total_cents as c_d2_total from public.tip_distributions where id = :'c_d2' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- who may look, and who may close
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000002');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C1  an employee cannot close a period');
  select tests.denied(format(
    'select public.financial_period_export(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C2  …nor read the manager export');
  select tests.denied(format(
    'select public.financial_period_readiness(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C3  …nor the readiness check');
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000003');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C4  a manager of another workplace cannot close this one');
  select tests.denied(format(
    'select public.financial_period_export(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C5  …nor export it');
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'suspended' where id = :'c_second';
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000004');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C6  a suspended manager cannot close a period');
commit;
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;
begin;
  select set_config('role', 'anon', true);
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C7  …and without a session, nobody at all');
  select tests.denied(format(
    'select public.financial_period_export(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C8  …with nothing to export either');
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  update public.workplace_members set status = 'active' where id = :'c_second';
commit;

select count(*) as c_none from public.financial_period_closes where workplace_id = :'cw' \gset
select tests.ok(:'c_none'::int = 0, 'C9  …and none of those refusals closed anything');

-- ═════════════════════════════════════════════════════════════════════════════
-- a period has to be a period
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-07'', ''2023-09-01'')', :'cw'),
    'C10 a period that ends before it starts is refused');
  select tests.denied(format(
    'select public.close_financial_period(%L, null, ''2023-09-07'')', :'cw'),
    'C11 …and one with no start');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'', %L)',
    :'cw', repeat('x', 501)),
    'C13 …and a note longer than the column allows is refused');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- what stands in the way of closing
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select (public.financial_period_readiness(:'cw', '2023-09-01', '2023-09-07') ->> 'can_close')::boolean
    as c_ready0 \gset
  select (public.financial_period_readiness(:'cw', '2023-09-01', '2023-09-07')
           -> 'warnings' ->> 'unpaid_distributions')::int as c_unpaid0 \gset
commit;
select tests.ok(:'c_ready0'::boolean,
  'C14 a period of sent, unpaid distributions is ready to close');
select tests.ok(:'c_unpaid0'::int = 2,
  'C15 …with the unpaid ones surfaced as a warning, not as a blocker');

-- A draft distribution is work in progress, and blocks.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'cw', :'c_boss', '2023-09-06', 40000);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'cw', :'c_staff', '2023-09-06 16:00Z', '2023-09-06 20:00Z', 0, 'approved', :'c_service', :'c_server'),
         (:'cw', :'c_staff', '2023-09-06 20:00Z', '2023-09-06 23:00Z', 0, 'approved', :'c_bar', :'c_keep'),
         (:'cw', :'c_boss',  '2023-09-06 16:00Z', '2023-09-06 23:00Z', 0, 'approved', :'c_service', :'c_server');
  select public.create_pool_from_reports(:'cw', '2023-09-06', '2023-09-06') as c_pool3 \gset
  select public.calculate_distribution(:'c_pool3') as c_draft \gset
  select (public.financial_period_readiness(:'cw', '2023-09-01', '2023-09-07')
           -> 'blocking' ->> 'draft_distributions')::int as c_drafts \gset
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C16 a period with a draft distribution in it cannot be closed');
commit;
select tests.ok(:'c_drafts'::int = 1, 'C17 …and the readiness check names it');

begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.send_distribution(:'c_draft');
commit;

-- An unanswered question blocks; answering it "no correction" clears it.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'c_d2', 'My hours look short.');
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select (public.financial_period_readiness(:'cw', '2023-09-01', '2023-09-07')
           -> 'blocking' ->> 'open_questions')::int as c_openq \gset
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C18 a period with an unanswered question cannot be closed');
  select id as c_query from public.distribution_queries
    where distribution_id = :'c_d2' and status = 'open' \gset
  select public.resolve_query(:'c_query', 'no_correction', 'The roster is right.');
commit;
select tests.ok(:'c_openq'::int = 1, 'C19 …and the readiness check names that too');

-- An agreed correction that has not been sent blocks: the result is undecided.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'c_d1', 'queried', 'And mine on the 3rd.');
commit;
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select id as c_query2 from public.distribution_queries
    where distribution_id = :'c_d1' and status = 'open' \gset
  select public.resolve_query(:'c_query2', 'correction_required', 'You are right.');
  select (public.financial_period_readiness(:'cw', '2023-09-01', '2023-09-07')
           -> 'blocking' ->> 'agreed_corrections_not_sent')::int as c_agreed \gset
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C20 …and so does a correction everybody agreed on but nobody has sent');
commit;
select tests.ok(:'c_agreed'::int = 1, 'C21 …which the readiness check also names');

-- Send it, and the period is ready.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'c_staff' and area_id = :'c_service' and work_date = '2023-09-03';
  update public.shifts set starts_at = '2023-09-03 15:00Z'
    where member_id = :'c_staff' and area_id = :'c_service' and work_date = '2023-09-03';
  select public.create_replacement_distribution(:'c_d1') as c_d1b \gset
  select (public.financial_period_readiness(:'cw', '2023-09-01', '2023-09-07')
           -> 'blocking' ->> 'draft_corrections')::int as c_repl \gset
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C22 a prepared but unsent correction blocks the close as well');
  select public.send_distribution(:'c_d1b');
commit;
select tests.ok(:'c_repl'::int = 1, 'C23 …and is named as a draft correction');

select entries_total_cents as c_d1b_total from public.tip_distributions where id = :'c_d1b' \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- closing it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.close_financial_period(:'cw', '2023-09-01', '2023-09-07',
    '  Reviewed with the payroll run.  ') as c_close \gset
commit;

select tests.ok(
  (select period_start = '2023-09-01'::date and period_end = '2023-09-07'::date
      and workplace_id = :'cw'::uuid
     from public.financial_period_closes where id = :'c_close'),
  'C24 the close records the period it was asked to close');
select tests.ok(
  (select closed_by = :'c_boss'::uuid and closed_at is not null
     from public.financial_period_closes where id = :'c_close'),
  'C25 …with the actor from the session and the time from the server');
select tests.ok(
  (select note = 'Reviewed with the payroll run.'
     from public.financial_period_closes where id = :'c_close'),
  'C26 …and the note stored trimmed');

-- ═════════════════════════════════════════════════════════════════════════════
-- overlapping and adjacent
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-05'', ''2023-09-10'')', :'cw'),
    'C27 a period overlapping a closed one is refused');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-09-01'', ''2023-09-07'')', :'cw'),
    'C28 …including the identical one, so a double click closes nothing twice');
  select tests.denied(format(
    'select public.close_financial_period(%L, ''2023-08-25'', ''2023-09-02'')', :'cw'),
    'C29 …and one that overlaps only at the start');
  select public.close_financial_period(:'cw', '2023-09-08', '2023-09-14') as c_close2 \gset
commit;
select tests.ok(:'c_close2' is not null,
  'C30 …while the next period along is allowed, because adjacent is not overlapping');

reset role;
select tests.denied(format(
  'insert into public.financial_period_closes (workplace_id, period_start, period_end)
   values (%L, ''2023-09-02'', ''2023-09-04'')', :'cw'),
  'C31 …and the exclusion constraint refuses an overlap written straight into the table');

-- ═════════════════════════════════════════════════════════════════════════════
-- a close is a record of a decision
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.financial_period_closes set period_end = ''2023-09-30'' where id = %L', :'c_close'),
    'C32 a manager cannot move a closed period''s dates');
  select tests.denied(format(
    'delete from public.financial_period_closes where id = %L', :'c_close'),
    'C33 …nor delete the close');
commit;
reset role;
select tests.denied(format(
  'update public.financial_period_closes set note = ''different'' where id = %L', :'c_close'),
  'C34 …and neither can the owner: the guard has no trusted-context escape');
select tests.denied(format(
  'update public.financial_period_closes set closed_by = %L where id = %L', :'c_staff', :'c_close'),
  'C35 …nor rewrite who closed it');
select tests.denied(format(
  'update public.financial_period_closes set closed_at = now() - interval ''1 year'' where id = %L', :'c_close'),
  'C36 …nor when');
select tests.denied(format(
  'delete from public.financial_period_closes where id = %L', :'c_close'),
  'C37 …nor delete it');

-- ═════════════════════════════════════════════════════════════════════════════
-- the export: scope, and never double counting
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_exp \gset
commit;

select (:'c_exp'::jsonb -> 'summary' ->> 'distributions_current')::int as c_cur \gset
select (:'c_exp'::jsonb -> 'summary' ->> 'distributions_replaced')::int as c_rep \gset
select (:'c_exp'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint as c_cur_cents \gset
select (:'c_exp'::jsonb -> 'summary' ->> 'replaced_entitlement_cents')::bigint as c_rep_cents \gset
select jsonb_array_length(:'c_exp'::jsonb -> 'distributions') as c_rows \gset

select tests.ok(:'c_rows'::int = 4,
  'C38 the export carries every non-draft version in the period, replaced ones included');
select tests.ok(:'c_cur'::int = 3 and :'c_rep'::int = 1,
  'C39 …counted as three current and one replaced');
select tests.ok(:'c_cur_cents'::bigint = :'c_d1b_total'::bigint + :'c_d2_total'::bigint + 40000,
  'C40 …and the entitlement total counts the CORRECTION, never the version it replaced');
select tests.ok(:'c_rep_cents'::bigint = :'c_d1_total'::bigint,
  'C41 …while the replaced amount is reported beside it, never added to it');
select tests.ok(:'c_cur_cents'::bigint <> :'c_cur_cents'::bigint + :'c_rep_cents'::bigint,
  'C42 …so the two are not the same number, which is the whole point');

select tests.ok(
  not (:'c_exp'::jsonb -> 'distributions') @> jsonb_build_array(jsonb_build_object('id', :'c_out')),
  'C43 a distribution outside the period is not in the export');
select tests.ok(
  (select count(*) = 0 from jsonb_array_elements(:'c_exp'::jsonb -> 'distributions') e
    where e ->> 'id' = :'c_out'),
  'C44 …checked by id, not by hoping');
select tests.ok(
  (select count(*) = 1 from jsonb_array_elements(:'c_exp'::jsonb -> 'distributions') e
    where e ->> 'id' = :'c_d1' and (e ->> 'is_current')::boolean = false
      and (e ->> 'is_correction')::boolean = false),
  'C45 …and the replaced original is present, marked as no longer current');
select tests.ok(
  (select (e ->> 'is_correction')::boolean and e ->> 'supersedes_id' = :'c_d1'
      and e ->> 'correction_source' = 'employee_query'
     from jsonb_array_elements(:'c_exp'::jsonb -> 'distributions') e
    where e ->> 'id' = :'c_d1b'),
  'C46 …with the correction showing what it replaces and which door it came through');

-- ═════════════════════════════════════════════════════════════════════════════
-- the export: people, and what it must not contain
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  (select count(*) >= 2 from jsonb_array_elements(:'c_exp'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'members') m
    where e ->> 'id' = :'c_d2' and m ->> 'member_name' is not null),
  'C47 every distribution carries its people');
select tests.ok(
  (select bool_and(m ->> 'member_name' in ('C Boss', 'Clara Staff'))
     from jsonb_array_elements(:'c_exp'::jsonb -> 'distributions') e,
          jsonb_array_elements(e -> 'members') m),
  'C48 …under the snapshot names frozen at calculation, not today''s profile');
select tests.ok(
  (select position('@' in :'c_exp') = 0),
  'C49 …and no email address appears anywhere in the export');
select tests.ok(
  (select position('90000000-0000-0000-0000-000000000002' in :'c_exp') = 0),
  'C50 …nor any auth user id');
select tests.ok(
  (select count(*) = 0 from jsonb_array_elements(:'c_exp'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'members') m
    where m ? 'member_id' or m ? 'user_id' or m ? 'email'),
  'C51 …and a member row carries no identifier at all, only what they were paid');

-- ═════════════════════════════════════════════════════════════════════════════
-- the export: settlement, and the money that still counts
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.record_distribution_payout(:'c_d2', 'cash', 'Paid on the night.') as c_pay2 \gset
  select public.record_distribution_payout(:'c_d1b', 'payroll') as c_pay1 \gset
  select public.reverse_distribution_payout(:'c_pay1', 'payment_not_completed',
    'The transfer never went out.') as c_rev1 \gset
  select public.record_distribution_payout(:'c_d1b', 'cash', 'Paid in cash instead.') as c_pay1b \gset
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_exp2 \gset
commit;

select (:'c_exp2'::jsonb -> 'summary' ->> 'payout_events')::int as c_pe \gset
select (:'c_exp2'::jsonb -> 'summary' ->> 'payout_total_cents')::bigint as c_pt \gset
select (:'c_exp2'::jsonb -> 'summary' ->> 'reversal_events')::int as c_re \gset
select (:'c_exp2'::jsonb -> 'summary' ->> 'reversal_total_cents')::bigint as c_rt \gset
select (:'c_exp2'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint as c_eff \gset
select (:'c_exp2'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint as c_out_cents \gset
select (:'c_exp2'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint as c_cur2 \gset

select tests.ok(:'c_pe'::int = 3 and :'c_re'::int = 1,
  'C52 the export counts every payout event and every reversal');
select tests.ok(:'c_pt'::bigint = :'c_d2_total'::bigint + (2 * :'c_d1b_total'::bigint),
  'C53 …with the gross of all payout events, the reversed one included');
select tests.ok(:'c_rt'::bigint = :'c_d1b_total'::bigint,
  'C54 …and what the reversal took back');
select tests.ok(:'c_eff'::bigint = :'c_d2_total'::bigint + :'c_d1b_total'::bigint,
  'C55 …while the money that STILL COUNTS excludes the reversed payment entirely');
select tests.ok(:'c_out_cents'::bigint = :'c_cur2'::bigint - :'c_eff'::bigint,
  'C56 …and what is outstanding is the current entitlement minus that, and nothing else');
select tests.ok(:'c_eff'::bigint <> :'c_pt'::bigint,
  'C57 …which is a different number from the gross, as it must be after a reversal');

select tests.ok(
  (select count(*) = 4 from jsonb_array_elements(:'c_exp2'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'settlement') s),
  'C58 every settlement event appears on the distribution it belongs to');
select tests.ok(
  (select count(*) = 1 from jsonb_array_elements(:'c_exp2'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'settlement') s
    where s ->> 'kind' = 'payout' and (s ->> 'still_counts')::boolean = false),
  'C59 …with the reversed one marked as no longer counting');
select tests.ok(
  (select count(*) = 1 from jsonb_array_elements(:'c_exp2'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'settlement') s
    where s ->> 'kind' = 'reversal' and (s ->> 'amount_cents')::bigint < 0),
  'C60 …and the reversal shown as a negative amount');

-- ═════════════════════════════════════════════════════════════════════════════
-- after the close: corrections and settlements still belong to the period
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  (select count(*) >= 3 from jsonb_array_elements(:'c_exp2'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'settlement') s
    where (s ->> 'after_close')::boolean),
  'C61 settlement recorded after the close still belongs to the period it settles');
select tests.ok(
  (:'c_exp2'::jsonb -> 'summary' ->> 'records_after_close')::int >= 3,
  'C62 …and the export says how many records arrived after the close was made');

begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'c_staff' and area_id = :'c_service' and work_date = '2023-09-05';
  update public.shifts set starts_at = '2023-09-05 15:00Z'
    where member_id = :'c_staff' and area_id = :'c_service' and work_date = '2023-09-05';
  select public.create_replacement_distribution(:'c_d2', 'hours',
    'Found in October: Clara started at 15:00.') as c_d2b \gset
  select public.send_distribution(:'c_d2b');
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_exp3 \gset
commit;

select tests.ok(
  (select (e ->> 'after_close')::boolean
     from jsonb_array_elements(:'c_exp3'::jsonb -> 'distributions') e
    where e ->> 'id' = :'c_d2b'),
  'C63 a correction made after the close is allowed, and is marked as post-close');
select tests.ok(
  (select period_start = '2023-09-01'::date and period_end = '2023-09-07'::date
      and note = 'Reviewed with the payroll run.'
     from public.financial_period_closes where id = :'c_close'),
  'C64 …while the close itself is exactly the record it always was');
select tests.ok(
  (:'c_exp3'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint
    = (:'c_exp2'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint,
  'C65 …and the entitlement did not double, because the pool behind it never moved');
select tests.ok(
  (:'c_exp3'::jsonb -> 'summary' ->> 'distributions_replaced')::int = 2,
  'C66 …only the count of replaced versions grew');
select tests.ok(
  (:'c_exp3'::jsonb -> 'period' ->> 'basis') = 'current',
  'C67 …and the export says plainly that it is current, not a reconstruction of the close');

-- ═════════════════════════════════════════════════════════════════════════════
-- the period metadata, and the close on it
-- ═════════════════════════════════════════════════════════════════════════════
select tests.ok(
  (:'c_exp3'::jsonb -> 'period' ->> 'timezone') = 'Europe/Berlin'
  and (:'c_exp3'::jsonb -> 'period' ->> 'business_day_start_hour') = '5',
  'C68 the export names the business-day rules the dates are measured by');
select tests.ok(
  (:'c_exp3'::jsonb -> 'period' -> 'close' ->> 'closed_by_name') = 'C Boss'
  and (:'c_exp3'::jsonb -> 'period' -> 'close' ->> 'note') = 'Reviewed with the payroll run.',
  'C69 …and carries the close it belongs to');
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'cw', '2023-09-15', '2023-09-30') as c_exp4 \gset
commit;
select tests.ok(
  (:'c_exp4'::jsonb -> 'period' -> 'close') = 'null'::jsonb,
  'C70 a period nobody closed says so, rather than borrowing a neighbour''s close');
select tests.ok(
  (select count(*) = 1 from jsonb_array_elements(:'c_exp4'::jsonb -> 'distributions') e
    where e ->> 'id' = :'c_out'),
  'C71 …and contains the distribution that really is in it');

-- ═════════════════════════════════════════════════════════════════════════════
-- ordering, so two exports of the same period are the same file
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_again \gset
commit;
select tests.ok(
  (:'c_again'::jsonb -> 'distributions') = (:'c_exp3'::jsonb -> 'distributions'),
  'C72 two exports of one period list everything in the same order');

-- ═════════════════════════════════════════════════════════════════════════════
-- the trail
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select count(*) as c_audit from public.audit_log
    where workplace_id = :'cw' and table_name = 'financial_period_closes' \gset
  select count(*) as c_closes from public.financial_period_closes where workplace_id = :'cw' \gset
  select actor_member_id as c_audit_actor from public.audit_log
    where table_name = 'financial_period_closes' and record_id = :'c_close'::uuid \gset
  select (after ->> 'period_start') as c_audit_start from public.audit_log
    where table_name = 'financial_period_closes' and record_id = :'c_close'::uuid \gset
commit;
select tests.ok(:'c_audit'::int = :'c_closes'::int and :'c_closes'::int = 2,
  'C73 every close is on the audit trail, one row each');
select tests.ok(:'c_audit_actor' = :'c_boss', 'C74 …with the manager who made it');
select tests.ok(:'c_audit_start' = '2023-09-01', 'C75 …and the period it covered');

-- ═════════════════════════════════════════════════════════════════════════════
-- tenancy, one last time
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000003');
  select count(*) as c_rival_sees from public.financial_period_closes \gset
commit;
select tests.ok(:'c_rival_sees'::int = 0,
  'C76 a manager of another workplace reads none of these closes');
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000002');
  select count(*) as c_emp_sees from public.financial_period_closes \gset
commit;
select tests.ok(:'c_emp_sees'::int = 0, 'C77 …and neither does an employee');

-- ═════════════════════════════════════════════════════════════════════════════
-- migration 29 · a correction that was published stays published
--
-- The regression for the defect migration 29 fixes. Down a chain A <- B <- C,
-- sending C cancels B, and B was the only row superseding A. If the readiness
-- check asks whether A's replacement is still LIVE rather than whether it was
-- ever SENT, A's long-since-answered query re-arms `agreed_corrections_not_sent`
-- and the period can never be closed again — resolve_query() refuses a resolved
-- question, create_replacement_distribution() refuses a cancelled original, and
-- the query cannot be moved.
--
-- Run against the period 15–30 September, which this suite deliberately never
-- closes, so `overlapping_close` cannot mask the assertion.
-- ═════════════════════════════════════════════════════════════════════════════

-- A: c_out, already sent on 2023-09-20. The employee asks about it.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'c_out', 'My hours look short on the 20th.');
commit;

begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select id as c_outq from public.distribution_queries
    where distribution_id = :'c_out' and status = 'open' \gset
  select public.resolve_query(:'c_outq', 'correction_required', 'You are right.');
  select (public.financial_period_readiness(:'cw', '2023-09-15', '2023-09-30')
           -> 'blocking' ->> 'agreed_corrections_not_sent')::int as c_chain0 \gset
commit;
select tests.ok(:'c_chain0'::int = 1,
  'C78 an agreed correction with nothing sent arms the blocker');

-- B: the correction the question asked for. The employee door, so no reason.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'c_out') as c_out_b \gset
  select public.send_distribution(:'c_out_b');
  select (public.financial_period_readiness(:'cw', '2023-09-15', '2023-09-30')
           -> 'blocking' ->> 'agreed_corrections_not_sent')::int as c_chain1 \gset
  select (public.financial_period_readiness(:'cw', '2023-09-15', '2023-09-30')
           ->> 'can_close')::boolean as c_can1 \gset
commit;
select tests.ok(:'c_chain1'::int = 0, 'C79 publishing the correction clears it');
select tests.ok(:'c_can1'::boolean, 'C80 …and the period becomes closeable');

-- C: a second correction on the same night. B carries no question of its own,
-- so this is the manager door. Sending it retires B.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'c_out_b', 'other',
    'A second correction on the same night.') as c_out_c \gset
  select public.send_distribution(:'c_out_c');
  select (public.financial_period_readiness(:'cw', '2023-09-15', '2023-09-30')
           -> 'blocking' ->> 'agreed_corrections_not_sent')::int as c_chain2 \gset
  select (public.financial_period_readiness(:'cw', '2023-09-15', '2023-09-30')
           ->> 'can_close')::boolean as c_can2 \gset
  select status as c_b_status, (sent_at is not null) as c_b_sent
    from public.tip_distributions where id = :'c_out_b' \gset
commit;
select tests.ok(:'c_chain2'::int = 0,
  'C81 correcting the correction does not re-arm a question already answered');
select tests.ok(:'c_can2'::boolean,
  'C82 …and the period stays closeable down a two-step chain');
select tests.ok(:'c_b_status' = 'cancelled' and :'c_b_sent'::boolean,
  'C83 …because the retired correction still records that it was published');

-- ═════════════════════════════════════════════════════════════════════════════
-- the two gaps the live run found
--
-- Both are period-level properties the assertions above never reached, because
-- until now this suite only ever measured a period holding ONE replaced version
-- and never paid a lineage that had already been settled in full.
--
-- A · the replaced aggregate spans every superseded version in the period
-- B · correcting a fully settled lineage settles a delta of exactly zero
--
-- Everything is derived from the rows the export returns, so a fixture that
-- grows another correction cannot silently invalidate the expectation.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A · two replaced versions, one aggregate ────────────────────────────────
-- By now 1–7 September holds two corrected nights: c_d1 → c_d1b and, after the
-- close, c_d2 → c_d2b. That is the shape the live run tripped over.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_agg \gset
commit;

select entries_total_cents as c_d2b_total from public.tip_distributions where id = :'c_d2b' \gset

select (:'c_agg'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint  as c_ag_cur \gset
select (:'c_agg'::jsonb -> 'summary' ->> 'replaced_entitlement_cents')::bigint as c_ag_rep \gset
select (:'c_agg'::jsonb -> 'summary' ->> 'distributions_replaced')::int        as c_ag_repn \gset
select coalesce(sum((e ->> 'entitlement_cents')::bigint), 0) as c_ag_cur_rows
  from jsonb_array_elements(:'c_agg'::jsonb -> 'distributions') e
  where (e ->> 'is_current')::boolean \gset
select coalesce(sum((e ->> 'entitlement_cents')::bigint), 0) as c_ag_rep_rows
  from jsonb_array_elements(:'c_agg'::jsonb -> 'distributions') e
  where not (e ->> 'is_current')::boolean \gset
select coalesce(sum((e ->> 'entitlement_cents')::bigint), 0) as c_ag_all_rows
  from jsonb_array_elements(:'c_agg'::jsonb -> 'distributions') e \gset
select count(*) as c_ag_rep_n2 from jsonb_array_elements(:'c_agg'::jsonb -> 'distributions') e
  where not (e ->> 'is_current')::boolean \gset

select tests.ok(:'c_ag_rep_n'::int = 2 and :'c_ag_rep_n2'::int = 2,
  'C84 the period holds two superseded versions, not one');
select tests.ok(:'c_ag_rep'::bigint = :'c_ag_rep_rows'::bigint,
  'C85 …and the replaced total is the aggregate of every one of them');
select tests.ok(:'c_ag_rep'::bigint = :'c_d1_total'::bigint + :'c_d2_total'::bigint,
  'C86 …which is both originals added together, and no more');
select tests.ok(:'c_ag_cur'::bigint = :'c_ag_cur_rows'::bigint,
  'C87 the current total is the aggregate of the current versions');
select tests.ok(
  :'c_ag_cur'::bigint + :'c_ag_rep'::bigint = :'c_ag_all_rows'::bigint,
  'C88 …the two partition the whole exported history, nothing lost or counted twice');
select tests.ok(:'c_ag_cur'::bigint < :'c_ag_all_rows'::bigint,
  'C89 …and what is owed excludes the history, which would otherwise read larger');
select tests.ok(:'c_d1_total'::bigint = (select entries_total_cents from public.tip_distributions where id = :'c_d1b')
            and :'c_d2_total'::bigint = :'c_d2b_total'::bigint,
  'C90 a correction carries the same total as the version it replaces');

-- ── B · correcting a settled lineage settles nothing further ────────────────
-- c_d2 was paid in full (c_pay2) and only afterwards replaced by c_d2b. The
-- replacement reuses c_d2's pool, so it is worth the same, and the ancestor's
-- payout still counts — the delta is zero. A new event, and no new money.
begin;
  select tests.as_user('90000000-0000-0000-0000-000000000001');
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_pre \gset
  select public.record_distribution_payout(:'c_d2b', 'payroll',
    'Settled with the payroll run.') as c_pay2b \gset
  select public.financial_period_export(:'cw', '2023-09-01', '2023-09-07') as c_post \gset
commit;

select amount_cents as c_p2b_amt, previous_entitlement_cents as c_p2b_prev,
       entitlement_cents as c_p2b_ent
  from public.distribution_payouts where id = :'c_pay2b' \gset

select tests.ok(:'c_p2b_amt'::bigint = 0,
  'C91 paying a corrected version of an already settled night records a zero delta');
select tests.ok(:'c_p2b_prev'::bigint = :'c_d2_total'::bigint
            and :'c_p2b_ent'::bigint = :'c_d2b_total'::bigint,
  'C92 …because the lineage had already settled exactly what this version is worth');
select tests.ok(
  (:'c_post'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint
  = (:'c_pre'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint,
  'C93 …so the money that still counts does not move');
select tests.ok(
  (:'c_post'::jsonb -> 'summary' ->> 'payout_events')::int
  = (:'c_pre'::jsonb -> 'summary' ->> 'payout_events')::int + 1,
  'C94 …while the event itself is recorded, not swallowed');
select tests.ok(
  (select count(*) = 1 from jsonb_array_elements(:'c_post'::jsonb -> 'distributions') e,
        jsonb_array_elements(e -> 'settlement') s
    where e ->> 'id' = :'c_d2b' and s ->> 'kind' = 'payout'
      and (s ->> 'amount_cents')::bigint = 0),
  'C95 …and it belongs to the night it settles, inside this period');
select tests.ok(
  (:'c_post'::jsonb -> 'summary' ->> 'outstanding_cents')::bigint
  = (:'c_post'::jsonb -> 'summary' ->> 'current_entitlement_cents')::bigint
    - (:'c_post'::jsonb -> 'summary' ->> 'effective_settled_cents')::bigint,
  'C96 …with the period arithmetic still closing afterwards');
