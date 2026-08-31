-- ============================================================================
-- Migration 17 -- calculate_distribution(): no unqualified UPDATE
-- ============================================================================
-- Live failure this fixes
-- -----------------------
--   POST /rest/v1/rpc/calculate_distribution  ->  HTTP 400
--   { "code": "21000", "message": "UPDATE requires a WHERE clause" }
--
-- SQLSTATE 21000 is cardinality_violation, and that message text comes from
-- pg_safeupdate, not from PostgreSQL core. Supabase preloads that module into
-- every PostgREST connection (it is set on the `authenticator` role), so the
-- hook is armed for the whole session. It inspects the plan of every UPDATE
-- and DELETE and refuses the ones that carry no qualifier. It does not care
-- whether the statement sits in a SECURITY DEFINER function, nor whether the
-- target is a permanent table or a session-local temp table.
--
-- calculate_distribution() contained exactly one such statement, unchanged
-- since migration 11 and re-published verbatim by migration 16:
--
--     alter table tmp_entries add column units numeric(12,4);
--     update tmp_entries set units = case v_rule.method
--       when 'equal'  then 1.0
--       when 'hours'  then round((worked_minutes / 60.0)::numeric, 4)
--       else round((worked_minutes / 60.0 * points * multiplier)::numeric, 4)
--     end;
--
-- It ran green in every local test because a plain PostgreSQL cluster has no
-- pg_safeupdate loaded; it can only fail on the real Supabase REST path.
--
-- What the statement was for
-- --------------------------
-- tmp_entries is a temp table created `on commit drop` a few lines earlier in
-- the same call, holding one row per member per area for this one pool. The
-- UPDATE was meant to affect *every row of that staging table* -- not one
-- distribution, not one row, and never anything a user owns. So the intent was
-- legitimate; only its shape was.
--
-- The fix
-- -------
-- Derive `units` in the CREATE TABLE ... AS SELECT that builds the staging
-- rows. Same values, same column order (units stays last), same numeric(12,4)
-- type, one statement fewer -- and no write without a qualifier anywhere in
-- the engine.
--
-- Deliberately NOT done: `set local safeupdate.enabled = off`, or a
-- `where <col> is not null` tautology bolted onto the UPDATE. Both keep the
-- unqualified write and merely talk the guard out of complaining. Nothing in
-- this migration changes a policy, a grant, a guard trigger, or the numbers
-- the engine produces.
--
-- Everything else in this function is byte-identical to migration 16.
-- Migrations 15 and 16 are untouched.
-- ============================================================================

create or replace function public.calculate_distribution(p_pool_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool       public.tip_pools%rowtype;
  v_rule       public.distribution_rules%rowtype;
  v_actor      uuid;
  v_dist       uuid;
  -- Scalars, not a record: under pairwise there is no anchor at all, and a
  -- plpgsql record raises on field access when it was never assigned — even
  -- from a CASE branch that will not be taken.
  v_anchor_shift   uuid;
  v_anchor_during  tstzrange;
  v_anchor_minutes integer;
  v_pool_c     bigint;
  v_assigned   bigint;
  v_people     integer;
  v_pairwise   boolean;
  v_candidates integer;
  v_groups     integer;
  v_orphan     text;
begin
  select * into v_pool from public.tip_pools where id = p_pool_id for update;
  if v_pool.id is null then
    raise exception 'pool not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_pool.workplace_id) then
    raise exception 'only a manager of this workplace may run a distribution' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('calculate_distribution:' || p_pool_id::text));

  if v_pool.status = 'void' then
    raise exception 'this pool is void' using errcode = '42501';
  end if;
  if v_pool.total_cents <= 0 then
    raise exception 'the pool is empty; enter the tips before distributing' using errcode = '22023';
  end if;

  select * into v_rule from public.distribution_rules
  where workplace_id = v_pool.workplace_id and status = 'active';
  if v_rule.id is null then
    raise exception 'this workplace has no active rule; set the area shares and activate them first'
      using errcode = '42501';
  end if;
  if not app.engine_supports_basis(v_rule.overlap_basis) then
    raise exception
      'the % overlap model is not implemented; choose longest_shift or pairwise',
      v_rule.overlap_basis using errcode = '0A000';
  end if;

  v_pairwise := (v_rule.overlap_basis = 'pairwise');

  delete from public.tip_distributions
  where tip_pool_id = p_pool_id and status = 'draft';

  v_actor  := app.member_id(v_pool.workplace_id);
  v_pool_c := v_pool.total_cents;

  -- ── candidates ───────────────────────────────────────────────────────────
  drop table if exists tmp_shift_rows;
  create temp table tmp_shift_rows on commit drop as
  select
    sh.id                                   as shift_id,
    sh.member_id,
    m.display_name                          as member_name,
    m.multiplier,
    sh.worked_minutes,
    sh.during,
    coalesce(sh.area_id, m.area_id)         as area_id,
    (case when sh.area_id is not null then 'shift' else 'member' end)::public.area_source
                                            as area_source,
    coalesce(
      sh.workplace_role_id,
      case when m.area_id is not distinct from coalesce(sh.area_id, m.area_id)
           then m.workplace_role_id end,
      (select r.id from public.workplace_roles r
       where r.workplace_id = sh.workplace_id
         and r.area_id = coalesce(sh.area_id, m.area_id)
         and r.archived_at is null
       order by r.sort_order, r.key
       limit 1)
    )                                       as role_id
  from public.shifts sh
  join public.workplace_members m on m.id = sh.member_id
  where sh.workplace_id = v_pool.workplace_id
    and sh.work_date between v_pool.period_start and v_pool.period_end
    and sh.status = 'approved'
    and sh.worked_minutes > 0;

  if not exists (select 1 from tmp_shift_rows) then
    raise exception 'no approved hours in this period; approve the shifts first'
      using errcode = '22023';
  end if;

  select count(distinct member_id) into v_candidates from tmp_shift_rows;

  -- ── the overlap graph ────────────────────────────────────────────────────
  -- Every unordered pair once, with the total minutes the two were both at
  -- work. Built for both models: under longest_shift it is recorded for the
  -- audit trail without deciding anything.
  drop table if exists tmp_pairs;
  create temp table tmp_pairs on commit drop as
  select a.member_id                              as member_a,
         b.member_id                              as member_b,
         sum(app.overlap_minutes(a.during, b.during))::integer as minutes
  from tmp_shift_rows a
  join tmp_shift_rows b on a.member_id < b.member_id
  group by a.member_id, b.member_id;

  drop table if exists tmp_links;
  create temp table tmp_links on commit drop as
  select member_a, member_b, minutes
  from tmp_pairs
  where minutes >= v_rule.min_overlap_minutes;

  -- The strongest link each member has, for the entry's overlap_minutes.
  drop table if exists tmp_best;
  create temp table tmp_best on commit drop as
  select member_id, max(minutes) as minutes from (
    select member_a as member_id, minutes from tmp_pairs
    union all
    select member_b, minutes from tmp_pairs
  ) t group by member_id;

  -- ── the anchor, for longest_shift only ───────────────────────────────────
  if not v_pairwise then
    select shift_id, during, worked_minutes
    into v_anchor_shift, v_anchor_during, v_anchor_minutes
    from tmp_shift_rows
    order by worked_minutes desc, lower(during) asc, shift_id asc
    limit 1;
  end if;

  drop table if exists tmp_resolved;
  create temp table tmp_resolved on commit drop as
  select
    s.*,
    ar.percentage,
    coalesce(rr.points, wr.points, 1.00)              as points,
    wr.key                                            as role_key,
    wr.name                                           as role_name,
    wa.key                                            as area_key,
    wa.name                                           as area_name,
    (case
       when v_pairwise then coalesce((select minutes from tmp_best b where b.member_id = s.member_id), 0)
       when s.shift_id = v_anchor_shift then s.worked_minutes
       else app.overlap_minutes(s.during, v_anchor_during)
     end) as overlap_minutes
  from tmp_shift_rows s
  left join public.workplace_areas wa on wa.id = s.area_id
  left join public.workplace_roles wr on wr.id = s.role_id
  left join public.distribution_rule_areas ar
         on ar.rule_id = v_rule.id and ar.area_id = s.area_id
  left join public.distribution_rule_roles rr
         on rr.rule_id = v_rule.id and rr.workplace_role_id = s.role_id;

  -- ── eligibility ──────────────────────────────────────────────────────────
  drop table if exists tmp_eligible;
  create temp table tmp_eligible on commit drop as
  select
    r.*,
    case
      when r.area_id is null then 'no_area'
      when coalesce(r.percentage, 0) <= 0 then 'area_not_in_pool'
      when v_pairwise then
        case
          when v_candidates = 1 then 'sole_worker'
          when exists (select 1 from tmp_links l
                       where l.member_a = r.member_id or l.member_b = r.member_id)
            then 'included'
          else 'no_pairwise_overlap'
        end
      when r.shift_id = v_anchor_shift then 'anchor'
      when r.overlap_minutes < v_rule.min_overlap_minutes then 'below_min_overlap'
      else 'included'
    end as eligibility
  from tmp_resolved r;

  -- ── connectivity: two crews who never met are not one distribution ───────
  if v_pairwise then
    drop table if exists tmp_components;
    create temp table tmp_components on commit drop as
    with recursive included as (
      select distinct member_id from tmp_eligible
      where eligibility in ('included', 'sole_worker')
    ),
    edges as (
      select l.member_a as a, l.member_b as b from tmp_links l
      union all
      select l.member_b, l.member_a from tmp_links l
    ),
    reach (root, node) as (
      select i.member_id, i.member_id from included i
      union
      select r.root, e.b
      from reach r
      join edges e on e.a = r.node
      join included i on i.member_id = e.b
    )
    select node as member_id, min(root::text) as component
    from reach group by node;

    select count(distinct component) into v_groups from tmp_components;
    if v_groups > 1 then
      raise exception
        'these hours fall into % groups who never worked together; split the period into separate pools',
        v_groups using errcode = '23514';
    end if;
  end if;

  -- ── an area with a share and nobody in it stops the distribution ─────────
  select string_agg(a.name, ', ' order by a.name) into v_orphan
  from public.distribution_rule_areas ra
  join public.workplace_areas a on a.id = ra.area_id
  where ra.rule_id = v_rule.id
    and ra.percentage > 0
    and not exists (
      select 1 from tmp_eligible e
      where e.area_id = ra.area_id and e.eligibility in ('included', 'anchor', 'sole_worker')
    );

  if v_orphan is not null then
    raise exception
      'no eligible hours in %, which the rule gives a share of the pool; nothing has been distributed',
      v_orphan using errcode = '23514';
  end if;

  -- ── one row per member per area ──────────────────────────────────────────
  drop table if exists tmp_entries;
  -- `units` is derived here, in the same statement that stages the rows,
  -- instead of by a follow-up `update tmp_entries set units = ...` with no
  -- WHERE clause. That earlier statement meant "every row of this staging
  -- table", which is exactly what pg_safeupdate -- preloaded on Supabase's
  -- `authenticator` role, and therefore active for every PostgREST request,
  -- including inside SECURITY DEFINER functions and on temp tables -- refuses
  -- with SQLSTATE 21000, "UPDATE requires a WHERE clause". Computing the
  -- column at construction states the same intent without any unqualified
  -- write, so no guard has to be disabled for the engine to run.
  create temp table tmp_entries on commit drop as
  with grouped as (
    select
      e.member_id,
      max(e.member_name)      as member_name,
      e.area_id,
      max(e.area_key)         as area_key,
      max(e.area_name)        as area_name,
      (array_agg(e.area_source order by e.worked_minutes desc, e.shift_id))[1] as area_source,
      (array_agg(e.role_key   order by e.worked_minutes desc, e.shift_id))[1]  as role_key,
      (array_agg(e.role_name  order by e.worked_minutes desc, e.shift_id))[1]  as role_name,
      (array_agg(e.points     order by e.worked_minutes desc, e.shift_id))[1]  as points,
      max(e.multiplier)       as multiplier,
      max(e.percentage)       as percentage,
      sum(e.worked_minutes)::integer as worked_minutes,
      max(e.overlap_minutes)::integer as overlap_minutes,
      array_agg(e.shift_id order by e.shift_id) as shift_ids
    from tmp_eligible e
    where e.eligibility in ('included', 'anchor', 'sole_worker')
    group by e.member_id, e.area_id
  )
  select
    g.*,
    (case v_rule.method
       when 'equal'  then 1.0
       when 'hours'  then round((g.worked_minutes / 60.0)::numeric, 4)
       else round((g.worked_minutes / 60.0 * g.points * g.multiplier)::numeric, 4)
     end)::numeric(12,4) as units
  from grouped g;

  delete from tmp_entries where units <= 0;

  -- ── level 1: pool → areas ────────────────────────────────────────────────
  -- Every area with a share now has people in it, so the percentages of the
  -- active areas already total 100. The denominator below is that total; it is
  -- no longer a renormalisation, because nothing is being absorbed.
  drop table if exists tmp_areas;
  create temp table tmp_areas on commit drop as
  with active as (
    select area_id, max(area_key) as area_key, max(area_name) as area_name,
           max(percentage) as percentage,
           sum(units) as units, count(distinct member_id)::integer as people_count
    from tmp_entries
    group by area_id
  ),
  weighted as (
    select a.*, (v_pool_c * a.percentage) / nullif(sum(a.percentage) over (), 0) as exact_cents
    from active a
  ),
  based as (
    select w.*, floor(w.exact_cents)::bigint as base_cents,
           w.exact_cents - floor(w.exact_cents) as remainder
    from weighted w
  ),
  ranked as (
    select b.*,
           row_number() over (
             order by b.remainder desc,
                      (b.area_id = v_rule.rounding_area_id) desc,
                      b.percentage desc,
                      b.area_key asc
           ) as rank_pos,
           (v_pool_c - sum(b.base_cents) over ())::bigint as leftover
    from based b
  )
  select area_id, area_key, area_name, percentage, units, people_count,
         (base_cents + case when rank_pos <= leftover then 1 else 0 end)::bigint as total_cents
  from ranked;

  -- ── level 2: area → people ───────────────────────────────────────────────
  drop table if exists tmp_amounts;
  create temp table tmp_amounts on commit drop as
  with joined as (
    select e.*, a.total_cents as area_cents, a.units as area_units
    from tmp_entries e
    join tmp_areas a on a.area_id = e.area_id
  ),
  based as (
    select j.*, (j.area_cents * j.units) / nullif(j.area_units, 0) as exact_cents
    from joined j
  ),
  floored as (
    select b.*, floor(b.exact_cents)::bigint as base_cents,
           b.exact_cents - floor(b.exact_cents) as remainder
    from based b
  ),
  ranked as (
    select f.*,
           row_number() over (
             partition by f.area_id
             order by f.remainder desc, f.units desc, f.member_id::text asc
           ) as rank_pos,
           (f.area_cents - sum(f.base_cents) over (partition by f.area_id))::bigint as leftover
    from floored f
  )
  select *,
         (base_cents + case when rank_pos <= leftover then 1 else 0 end)::bigint as amount_cents,
         (case when rank_pos <= leftover then 1 else 0 end)::integer as rounding_adjustment_cents
  from ranked;

  select count(distinct member_id)::integer into v_people from tmp_amounts;
  select coalesce(sum(amount_cents), 0) into v_assigned from tmp_amounts;

  if v_people = 0 then
    raise exception 'nobody is eligible for this pool: check the area shares and the approved hours'
      using errcode = '22023';
  end if;
  if v_assigned <> v_pool_c then
    raise exception 'rounding error: % cents assigned against a pool of %', v_assigned, v_pool_c
      using errcode = '23514';
  end if;

  -- ── write it down ────────────────────────────────────────────────────────
  insert into public.tip_distributions (
    workplace_id, tip_pool_id, rule_id, rule_version, period_start, period_end,
    pool_cents, people_count, status, method, min_overlap_minutes, overlap_basis,
    rules_snapshot, inputs_snapshot, engine_version, entries_total_cents, calculated_by
  )
  values (
    v_pool.workplace_id, p_pool_id, v_rule.id, coalesce(v_rule.version, 0),
    v_pool.period_start, v_pool.period_end,
    v_pool_c, v_people, 'draft', v_rule.method, v_rule.min_overlap_minutes, v_rule.overlap_basis,
    jsonb_build_object(
      'rule_id', v_rule.id,
      'version', v_rule.version,
      'method', v_rule.method,
      'min_overlap_minutes', v_rule.min_overlap_minutes,
      'overlap_basis', v_rule.overlap_basis,
      'acknowledgement_required', v_rule.acknowledgement_required,
      'rounding_area_id', v_rule.rounding_area_id,
      'adopted_by', v_rule.adopted_by,
      'agreement_reference', v_rule.agreement_reference,
      'agreement_date', v_rule.agreement_date,
      'areas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'area_id', ra.area_id, 'area_key', ra.area_key, 'percentage', ra.percentage)
                  order by ra.area_key), '[]'::jsonb)
                from public.distribution_rule_areas ra where ra.rule_id = v_rule.id),
      'roles', (select coalesce(jsonb_agg(jsonb_build_object(
                  'role_id', rr.workplace_role_id, 'role_key', rr.role_key, 'points', rr.points)
                  order by rr.role_key), '[]'::jsonb)
                from public.distribution_rule_roles rr where rr.rule_id = v_rule.id)
    ),
    jsonb_build_object(
      'anchor_shift_id', v_anchor_shift,
      'anchor_worked_minutes', v_anchor_minutes,
      'pool', jsonb_build_object('card_cents', v_pool.card_cents, 'cash_cents', v_pool.cash_cents,
                                 'total_cents', v_pool.total_cents, 'source', v_pool.source),
      -- The whole overlap graph, so the result can be re-argued from the record.
      'pairs', (select coalesce(jsonb_agg(jsonb_build_object(
                  'member_a', p.member_a, 'member_b', p.member_b, 'minutes', p.minutes,
                  'linked', p.minutes >= v_rule.min_overlap_minutes)
                  order by p.member_a, p.member_b), '[]'::jsonb)
                from tmp_pairs p),
      'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
                    'shift_id', el.shift_id, 'member_id', el.member_id,
                    'member_name', el.member_name,
                    'area_id', el.area_id, 'area_key', el.area_key, 'area_source', el.area_source,
                    'role_key', el.role_key, 'points', el.points, 'multiplier', el.multiplier,
                    'worked_minutes', el.worked_minutes, 'overlap_minutes', el.overlap_minutes,
                    'eligibility', el.eligibility) order by el.shift_id), '[]'::jsonb)
                 from tmp_eligible el)
    ),
    app.engine_version(), v_assigned, v_actor
  )
  returning id into v_dist;

  insert into public.tip_distribution_areas
    (distribution_id, workplace_id, area_id, area_key, area_name, percentage, units, total_cents, people_count)
  select v_dist, v_pool.workplace_id, area_id, area_key, coalesce(area_name, area_key),
         percentage, units, total_cents, people_count
  from tmp_areas;

  insert into public.tip_distribution_entries (
    distribution_id, workplace_id, member_id, member_name,
    area_id, area_key, area_name, area_source, role_key, role_name,
    points, multiplier, worked_minutes, overlap_minutes, units,
    amount_cents, rounding_adjustment_cents, shift_ids
  )
  select v_dist, v_pool.workplace_id, member_id, member_name,
         area_id, area_key, coalesce(area_name, area_key), area_source, role_key, role_name,
         points, multiplier, worked_minutes, overlap_minutes, units,
         amount_cents, rounding_adjustment_cents, shift_ids
  from tmp_amounts;

  update public.shifts set locked = true
  where id in (select unnest(shift_ids) from tmp_amounts);

  update public.tip_pools
  set status = 'locked', locked_at = coalesce(locked_at, now())
  where id = p_pool_id and status = 'open';

  return v_dist;
end;
$$;

comment on function public.calculate_distribution(uuid) is
  'Builds a draft distribution for one pool. Republished by migration 17 with '
  'no unqualified UPDATE, so it survives pg_safeupdate on the PostgREST path. '
  'Behaviour, security and arithmetic are unchanged from migration 16.';
