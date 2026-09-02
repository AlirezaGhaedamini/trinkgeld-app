-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3J · replacement distributions.
--
-- Correcting a payout without touching it: what may be replaced, by whom, what
-- happens to the original, and the one that matters most — that the same tip
-- reports can never fund two live payouts.
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('50000000-0000-0000-0000-000000000001', 'r.boss@test.local',  '{"full_name":"R Boss"}'),
  ('50000000-0000-0000-0000-000000000002', 'r.staff@test.local', '{"full_name":"R Staff"}'),
  ('50000000-0000-0000-0000-000000000003', 'r.rival@test.local', '{"full_name":"R Rival"}')
on conflict do nothing;

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select public.create_workplace('Repl Lab', 'Marburg') as rw \gset
commit;
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000003');
  select public.create_workplace('Repl Rival', 'Kassel') as rx \gset
commit;

select id as r_service from public.workplace_areas where workplace_id = :'rw' and key = 'service' \gset
select id as r_bar     from public.workplace_areas where workplace_id = :'rw' and key = 'bar' \gset
select id as r_server  from public.workplace_roles where workplace_id = :'rw' and key = 'server' \gset
select id as r_keep    from public.workplace_roles where workplace_id = :'rw' and key = 'bartender' \gset
select id as r_boss    from public.workplace_members where workplace_id = :'rw' and role = 'manager' \gset

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  update public.workplace_members set area_id = :'r_service', workplace_role_id = :'r_server'
    where id = :'r_boss';
  select token from public.create_invitation(
    :'rw', 'r.staff@test.local', 'Robin Staff', 'employee', :'r_service', :'r_server') as t \gset tok_r_
commit;
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select public.accept_invitation(:'tok_r_token') as r_staff \gset
commit;

-- The employee works two areas, so the correction has to compare a member
-- across a changing set of areas rather than a single row.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select id as r_rule from public.distribution_rules where workplace_id = :'rw' and status = 'draft' \gset
  update public.distribution_rules
    set method = 'hours_points', min_overlap_minutes = 15, acknowledgement_required = true
    where id = :'r_rule';
  update public.distribution_rule_areas set percentage = 60 where rule_id = :'r_rule' and area_id = :'r_service';
  update public.distribution_rule_areas set percentage = 40 where rule_id = :'r_rule' and area_id = :'r_bar';
  update public.distribution_rule_areas set percentage = 0
    where rule_id = :'r_rule' and area_id not in (:'r_service', :'r_bar');
  select public.activate_rule(:'r_rule');

  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'rw', :'r_boss', '2020-05-02', 30000) returning id as r_report \gset

  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'rw', :'r_staff', '2020-05-02 16:00Z', '2020-05-02 20:00Z', 0, 'approved', :'r_service', :'r_server'),
         (:'rw', :'r_staff', '2020-05-02 20:00Z', '2020-05-02 23:00Z', 0, 'approved', :'r_bar',     :'r_keep'),
         (:'rw', :'r_boss',  '2020-05-02 16:00Z', '2020-05-02 23:00Z', 0, 'approved', :'r_service', :'r_server');
  select public.create_pool_from_reports(:'rw', '2020-05-02', '2020-05-02') as r_pool \gset
  select public.calculate_distribution(:'r_pool') as r_orig \gset
  select public.send_distribution(:'r_orig');
commit;

select sum(amount_cents) as r_orig_total from public.tip_distribution_entries
  where distribution_id = :'r_orig' \gset
select sum(amount_cents) as r_orig_staff from public.tip_distribution_entries
  where distribution_id = :'r_orig' and member_id = :'r_staff' \gset
select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as r_orig_money from public.tip_distribution_entries where distribution_id = :'r_orig' \gset

select tests.ok(:'r_orig_total'::bigint = 30000,
  'S1  the original pays out the whole pool');

-- The funding lineage, before any correction exists.
select count(*) as r_src_before from public.tip_pool_sources
  where tip_report_id = :'r_report' \gset
select pool_id as r_src_pool_before from public.tip_pool_sources
  where tip_report_id = :'r_report' \gset

select tests.ok(:'r_src_before'::int = 1 and :'r_src_pool_before' = :'r_pool',
  'S1b the report that funds it has exactly one source row, pointing at this pool');

-- ═════════════════════════════════════════════════════════════════════════════
-- a pool pays out once
-- ═════════════════════════════════════════════════════════════════════════════
-- The defect this migration closes: before it, this call produced a second
-- distribution from the same reports, with no lineage, and both read as live.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.calculate_distribution(%L)', :'r_pool'),
    'S2  a pool that has paid out cannot simply be distributed again');
commit;

select count(*) as r_live from public.tip_distributions
  where tip_pool_id = :'r_pool' and status in ('sent', 'confirmed') \gset
select tests.ok(:'r_live'::int = 1, 'S3  …so the pool still has exactly one live payout');

-- ═════════════════════════════════════════════════════════════════════════════
-- a correction needs a reason
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_orig'),
    'S4  a distribution nobody has questioned cannot be replaced');
commit;

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'r_orig', 'My shift started at 14:00, not 16:00.');
commit;

select id as r_query from public.distribution_queries
  where distribution_id = :'r_orig' and status = 'open' \gset

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_orig'),
    'S5  …nor one whose question has not been answered yet');
  select public.resolve_query(:'r_query', 'no_correction', 'Looks right to me.');
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_orig'),
    'S6  …nor one the manager decided was already correct');
commit;

-- Now the manager looks again and agrees.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'r_orig', 'acknowledged');
  select public.query_distribution(:'r_orig', 'My start time is still wrong on this.');
commit;
select id as r_query2 from public.distribution_queries
  where distribution_id = :'r_orig' and status = 'open' \gset
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select public.resolve_query(:'r_query2', 'correction_required', 'You are right, the roster says 14:00 — redoing it.');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- who may correct it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_orig'),
    'S7  an employee cannot start a correction');
commit;
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000003');
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_orig'),
    'S8  nor a manager of another workplace');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- correcting the input, then the arithmetic
-- ═════════════════════════════════════════════════════════════════════════════
-- The missing Bar shift is added to the source data. Nothing edits the sent
-- distribution; the replacement simply reads what is true now.
-- A distributed shift is locked by the engine, which is the right default: the
-- hours behind a payment do not drift. Correcting one is therefore a deliberate
-- act — unlock, correct, then ask for the arithmetic again.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select tests.denied(
    format('update public.shifts set starts_at = ''2020-05-02 14:00Z'' where member_id = %L and area_id = %L',
           :'r_staff', :'r_service'),
    'S8b a shift that has been paid out cannot be quietly corrected');
commit;

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'r_staff' and area_id = :'r_service' and starts_at = '2020-05-02 16:00Z';
  update public.shifts set starts_at = '2020-05-02 14:00Z'
    where member_id = :'r_staff' and area_id = :'r_service' and starts_at = '2020-05-02 16:00Z';
  select public.create_replacement_distribution(:'r_orig') as r_repl \gset
commit;

select tests.ok(:'r_repl' is not null and :'r_repl' <> :'r_orig',
  'S9  the manager can create a replacement, and it is a new distribution');

select status as r_repl_status, supersedes_id as r_repl_super, trigger_query_id as r_repl_q,
       tip_pool_id as r_repl_pool
  from public.tip_distributions where id = :'r_repl' \gset

select tests.ok(:'r_repl_status' = 'draft' and :'r_repl_super' = :'r_orig',
  'S10 …a draft, pointing back at the one it replaces');
select tests.ok(:'r_repl_q' = :'r_query2',
  'S11 …carrying the question that caused it');
select tests.ok(:'r_repl_pool' = :'r_pool',
  'S12 …and funded by the very same pool, not a second one');

select status as r_orig_status2 from public.tip_distributions where id = :'r_orig' \gset
select tests.ok(:'r_orig_status2' = 'sent',
  'S13 the original is untouched while the correction is only a draft');

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select count(*) as r_sees_draft from public.member_distributions where id = :'r_repl' \gset
commit;
select tests.ok(:'r_sees_draft'::int = 0,
  'S14 …and the employee cannot read a correction before it is sent');

-- ═════════════════════════════════════════════════════════════════════════════
-- freshly calculated, not copied
-- ═════════════════════════════════════════════════════════════════════════════
select sum(amount_cents) as r_repl_staff from public.tip_distribution_entries
  where distribution_id = :'r_repl' and member_id = :'r_staff' \gset
select sum(amount_cents) as r_repl_total from public.tip_distribution_entries
  where distribution_id = :'r_repl' \gset

select tests.ok(:'r_repl_staff'::bigint <> :'r_orig_staff'::bigint,
  'S15 the correction is calculated from the fixed hours, not copied from the original');
select tests.ok(:'r_repl_total'::bigint = 30000,
  'S16 …and still pays out exactly the pool, no more and no less');

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as r_orig_money2 from public.tip_distribution_entries where distribution_id = :'r_orig' \gset
select tests.ok(:'r_orig_money' = :'r_orig_money2',
  'S17 …while not one cent of the original moved');

-- ═════════════════════════════════════════════════════════════════════════════
-- no forks, no loops
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  -- A second attempt recalculates the same draft rather than forking: this is
  -- the double click and the second browser tab.
  select public.create_replacement_distribution(:'r_orig') as r_repl2 \gset
commit;

select count(*) as r_children from public.tip_distributions
  where supersedes_id = :'r_orig' and status <> 'cancelled' \gset
select tests.ok(:'r_children'::int = 1,
  'S18 asking twice gives one draft, never two competing corrections');

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select tests.denied(format(
    'update public.tip_distributions set supersedes_id = %L where id = %L', :'r_repl2', :'r_repl2'),
    'S19 nothing may supersede itself');
  select tests.denied(format(
    'update public.tip_distributions set supersedes_id = %L where id = %L', :'r_repl2', :'r_orig'),
    'S20 …and a chain cannot be bent into a loop by hand');
commit;

-- An employee has no UPDATE policy on tip_distributions at all, so this matches
-- no row and raises nothing. Zero rows IS the refusal; assert the outcome.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select tests.attempt(format(
    'update public.tip_distributions set supersedes_id = null where id = %L', :'r_repl2'));
commit;

select tests.ok(
  (select supersedes_id = :'r_orig' from public.tip_distributions where id = :'r_repl2'),
  'S21 an employee reaches lineage not at all — the row is untouched');

-- ═════════════════════════════════════════════════════════════════════════════
-- stale input protection applies to corrections too
-- ═════════════════════════════════════════════════════════════════════════════
-- The realistic stale case in a correction: the manager fixes one more thing
-- after the preview was calculated. The fingerprint covers the shift set, so
-- the send refuses and the manager recalculates — no exception for corrections.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  update public.shifts set locked = false
    where member_id = :'r_boss' and area_id = :'r_service' and starts_at = '2020-05-02 16:00Z';
  -- Lengthen, not shorten: this shift is the anchor the overlap model measures
  -- against, and cutting it back would strand the Bar shift outside it.
  update public.shifts set ends_at = '2020-05-02 23:30Z'
    where member_id = :'r_boss' and area_id = :'r_service' and starts_at = '2020-05-02 16:00Z';
  select tests.denied(format('select public.send_distribution(%L)', :'r_repl2'),
    'S22 a correction whose inputs moved since it was calculated cannot be sent');
commit;

select status as r_stale_status from public.tip_distributions where id = :'r_repl2' \gset
select tests.ok(:'r_stale_status' = 'draft',
  'S22b …and it is still only a draft afterwards');

-- Recalculating picks the change up, and the same draft is replaced.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select public.create_replacement_distribution(:'r_orig') as r_repl2 \gset
commit;
select tests.ok(:'r_repl2' is not null,
  'S22c …and recalculating the correction is how the manager moves on');

-- ═════════════════════════════════════════════════════════════════════════════
-- sending it
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select public.send_distribution(:'r_repl2');
commit;

select status as r_repl_sent from public.tip_distributions where id = :'r_repl2' \gset
select status as r_orig_final, cancelled_at as r_orig_cancelled, cancel_reason as r_orig_reason
  from public.tip_distributions where id = :'r_orig' \gset

select tests.ok(:'r_repl_sent' = 'sent', 'S23 the correction becomes the live distribution');
select tests.ok(:'r_orig_final' = 'cancelled' and :'r_orig_cancelled' is not null,
  'S24 …and the original is retired in the same breath');
select tests.ok(:'r_orig_reason' like '%eplaced%',
  'S25 …with the reason on the record');

select count(*) as r_live2 from public.tip_distributions
  where tip_pool_id = :'r_pool' and status in ('sent', 'confirmed') \gset
select tests.ok(:'r_live2'::int = 1,
  'S26 …so the pool has one live payout, not two');

-- ═════════════════════════════════════════════════════════════════════════════
-- the money question, stated plainly
-- ═════════════════════════════════════════════════════════════════════════════
select count(*) as r_pools from public.tip_pool_sources where tip_report_id = :'r_report' \gset
select sum(d.pool_cents) as r_live_cents from public.tip_distributions d
  where d.tip_pool_id = :'r_pool' and d.status in ('sent', 'confirmed') \gset

select tests.ok(:'r_pools'::int = 1,
  'S27 the tip report that funded this still funds exactly one pool');
select tests.ok(:'r_live_cents'::bigint = 30000,
  'S28 …and the live payouts against that pool total the pool once, not twice');

-- ═════════════════════════════════════════════════════════════════════════════
-- the original is history now
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select tests.denied(format('select public.acknowledge_distribution(%L, ''acknowledged'')', :'r_orig'),
    'S29 a replaced distribution accepts no confirmation');
  select tests.denied(format('select public.query_distribution(%L, ''Wait.'')', :'r_orig'),
    'S30 …and no new question');
  select count(*) as r_sees_both from public.member_distributions where workplace_id = :'rw' \gset
  select superseded_by as r_super_by from public.member_distributions where id = :'r_orig' \gset
commit;

select tests.ok(:'r_sees_both'::int = 2,
  'S31 …while the employee sees both records, the old one and the correction');
select tests.ok(:'r_super_by' = :'r_repl2',
  'S32 …and can tell which one replaced which');

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_orig'),
    'S33 a replaced distribution cannot be replaced a second time');
  select tests.denied(format('select public.send_distribution(%L)', :'r_orig'),
    'S34 …nor sent again');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- acknowledgement starts fresh
-- ═════════════════════════════════════════════════════════════════════════════
select count(*) as r_repl_pending from public.tip_distribution_entries
  where distribution_id = :'r_repl2' and ack_status = 'pending' \gset
select count(*) as r_repl_stamped from public.tip_distribution_entries
  where distribution_id = :'r_repl2' and acknowledged_at is not null \gset
select count(*) as r_orig_queried from public.tip_distribution_entries
  where distribution_id = :'r_orig' and ack_status = 'queried' \gset

select tests.ok(:'r_repl_pending'::int = 3 and :'r_repl_stamped'::int = 0,
  'S35 every entry on the correction starts unanswered, with no timestamp carried over');
-- The employee confirmed the original and then asked a second question, so its
-- entries end queried. Whatever state they ended in is the state they keep: the
-- correction does not reach back and tidy it.
select tests.ok(:'r_orig_queried'::int = 2,
  'S36 …while the original keeps whatever its people last said about it');

select count(*) as r_orig_queries from public.distribution_queries
  where distribution_id = :'r_orig' \gset
select count(*) as r_repl_queries from public.distribution_queries
  where distribution_id = :'r_repl2' \gset
select tests.ok(:'r_orig_queries'::int = 2 and :'r_repl_queries'::int = 0,
  'S37 the questions stay on the distribution they were asked about');

begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select public.acknowledge_distribution(:'r_repl2', 'acknowledged') as r_ack \gset
commit;
select tests.ok(:'r_ack'::int > 0,
  'S38 …and the employee confirms the correction the ordinary way');

-- ═════════════════════════════════════════════════════════════════════════════
-- a second correction extends the chain
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000002');
  select public.query_distribution(:'r_repl2', 'My role was wrong on this one.');
commit;
select id as r_query3 from public.distribution_queries
  where distribution_id = :'r_repl2' and status = 'open' \gset
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select public.resolve_query(:'r_query3', 'correction_required', 'Fixing the role.');
  select public.create_replacement_distribution(:'r_repl2') as r_repl3 \gset
  select public.send_distribution(:'r_repl3');
commit;

select supersedes_id as r_chain3 from public.tip_distributions where id = :'r_repl3' \gset
select status as r_repl2_final from public.tip_distributions where id = :'r_repl2' \gset
select tests.ok(:'r_chain3' = :'r_repl2' and :'r_repl2_final' = 'cancelled',
  'S39 a correction can itself be corrected, and the chain keeps its order');

select count(*) as r_live3 from public.tip_distributions
  where tip_pool_id = :'r_pool' and status in ('sent', 'confirmed') \gset
select tests.ok(:'r_live3'::int = 1,
  'S40 …with still exactly one live payout at the end of it');

select md5(string_agg(member_name || '|' || area_name || '|' || amount_cents::text, ';' order by id::text))
  as r_orig_money3 from public.tip_distribution_entries where distribution_id = :'r_orig' \gset
select tests.ok(:'r_orig_money' = :'r_orig_money3',
  'S41 …and the first distribution is still exactly what it always was');

-- ═════════════════════════════════════════════════════════════════════════════
-- what the other workplace can see of any of this
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000003');
  select count(*) as r_rival_sees from public.tip_distributions where workplace_id = :'rw' \gset
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_repl3'),
    'S42 a manager elsewhere cannot correct this workplace''s distribution');
commit;
select tests.ok(:'r_rival_sees'::int = 0,
  'S43 …and cannot read the chain at all');

-- ═════════════════════════════════════════════════════════════════════════════
-- the trail
-- ═════════════════════════════════════════════════════════════════════════════
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  select count(*) as r_audit from public.audit_log
    where workplace_id = :'rw' and table_name = 'tip_distributions' \gset
commit;
select tests.ok(:'r_audit'::int >= 6,
  'S44 creating, sending and retiring each version is all on the audit trail');

-- ═════════════════════════════════════════════════════════════════════════════
-- the funding lineage, end to end
-- ═════════════════════════════════════════════════════════════════════════════
-- The invariant the whole design rests on, stated as one chain: a report funds
-- one pool, that pool carries the original and every correction of it, and a
-- correction adds no new funding relationship. The live script asserted this
-- against a column that does not exist, so it is pinned here where the schema
-- itself would object.
select count(*) as r_src_after from public.tip_pool_sources
  where tip_report_id = :'r_report' \gset
select pool_id as r_src_pool_after from public.tip_pool_sources
  where tip_report_id = :'r_report' \gset
select count(*) as r_src_for_pool from public.tip_pool_sources
  where pool_id = :'r_pool' \gset
select count(*) as r_dists_on_pool from public.tip_distributions
  where tip_pool_id = :'r_pool' \gset

select tests.ok(:'r_src_after'::int = 1 and :'r_src_after' = :'r_src_before',
  'S46 after two corrections the report still has exactly one source row');
select tests.ok(:'r_src_pool_after' = :'r_src_pool_before' and :'r_src_pool_after' = :'r_pool',
  'S47 …still pointing at the same pool it always did');
select tests.ok(:'r_src_for_pool'::int = 1 and :'r_dists_on_pool'::int >= 3,
  'S48 …while that one pool carries the original and both corrections');

select sum(d.pool_cents) as r_live_total from public.tip_distributions d
  where d.tip_pool_id = :'r_pool' and d.status in ('sent', 'confirmed') \gset
select tests.ok(:'r_live_total'::bigint = 30000,
  'S48b …and the money the report brought in is live exactly once');

-- ═════════════════════════════════════════════════════════════════════════════
-- the fork and cycle guards, isolated
-- ═════════════════════════════════════════════════════════════════════════════
-- S18-S20 above are satisfied by guards that already existed, so they say
-- nothing about the two this migration added. These do: a second pool gives a
-- second live distribution that is legal in its own right, and the attempts run
-- as the table owner, where guard_sent_distribution() steps aside and only the
-- new index and the cycle walk are left to refuse.
begin;
  select tests.as_user('50000000-0000-0000-0000-000000000001');
  insert into public.tip_reports (workplace_id, member_id, work_date, cash_cents)
  values (:'rw', :'r_boss', '2020-06-06', 12000);
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id, workplace_role_id)
  values (:'rw', :'r_staff', '2020-06-06 16:00Z', '2020-06-06 22:00Z', 0, 'approved', :'r_service', :'r_server'),
         (:'rw', :'r_boss',  '2020-06-06 16:00Z', '2020-06-06 22:00Z', 0, 'approved', :'r_bar',     :'r_keep');
  select public.create_pool_from_reports(:'rw', '2020-06-06', '2020-06-06') as r_pool2 \gset
  select public.calculate_distribution(:'r_pool2') as r_other \gset
  select public.send_distribution(:'r_other');
commit;

reset role;
select tests.denied(format(
  'update public.tip_distributions set supersedes_id = %L where id = %L', :'r_repl2', :'r_other'),
  'S49 one original cannot have two live replacements, even by direct write as the owner');

select tests.denied(format(
  'update public.tip_distributions set supersedes_id = %L where id = %L', :'r_repl3', :'r_orig'),
  'S50 …and a chain cannot be closed into a loop, even by the owner');

select tests.ok(
  (select supersedes_id is null from public.tip_distributions where id = :'r_other')
  and (select supersedes_id is null from public.tip_distributions where id = :'r_orig'),
  'S51 …and neither attempt left anything behind');

-- ═════════════════════════════════════════════════════════════════════════════
-- without a session
-- ═════════════════════════════════════════════════════════════════════════════
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;

begin;
  select set_config('role', 'anon', true);
  select tests.denied(format('select public.create_replacement_distribution(%L)', :'r_repl3'),
    'S45 an anonymous caller cannot start a correction');
commit;
