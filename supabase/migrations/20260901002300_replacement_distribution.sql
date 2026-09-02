-- ═════════════════════════════════════════════════════════════════════════════
-- 23 · Replacement distributions.
--
-- Phase 3I let a manager say "yes, this is wrong" and stop there. This one
-- gives that finding somewhere to go: a corrected distribution that replaces
-- the original without touching a cent of it.
--
-- THE MONEY QUESTION, FIRST. A replacement reuses the ORIGINAL POOL. That is
-- the whole double-counting defence and it is structural, not a rule anyone has
-- to remember: `tip_pool_sources_report_key` is unique on tip_report_id, so a
-- tip report funds exactly one pool, for ever. Original and replacement are two
-- descriptions of one pool — one money event — and only one of them is ever
-- live. Building a second pool from the same reports is impossible; the unique
-- index refuses it.
--
-- WHAT THE AUDIT FOUND. calculate_distribution() would happily run again on a
-- pool that had already been sent, producing a second distribution with no
-- lineage to the first. Both would read as current, funded by the same reports.
-- Nothing in the schema prevented it and nothing recorded that it had happened.
-- That is closed here: a pool that has paid out may only be recalculated as an
-- explicit replacement of the distribution that paid it.
--
-- SEMANTICS OF supersedes_id. The column has existed since Phase 2 and has
-- never been written. It lives on the NEW row and points BACKWARDS: "this
-- distribution supersedes that one". So each row has at most one predecessor by
-- construction, and a partial unique index gives it at most one live successor.
-- A chain, never a fork:  A <- B <- C.
--
-- THE ORIGINAL'S FATE. `cancelled` is reused rather than inventing a status.
-- It is already non-actionable everywhere (app.distribution_is_actionable),
-- already visible in member_distributions, and already understood by every
-- screen. The reason it was cancelled is expressed by lineage — something
-- supersedes it — and the UI reads "Replaced" from that. A new enum value would
-- have bought a word and cost a change to every path that switches on status.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── one live PAYOUT per pool, and one draft beside it ──────────────────────
-- Phase 2 held `unique (tip_pool_id) where status in ('draft','sent','confirmed')`.
-- That is the guarantee a pool pays out once, and it is not being weakened: it
-- is being stated more precisely. A draft pays nobody, and a correction must be
-- calculable and readable beside the distribution it is going to replace —
-- otherwise the manager would have to retire the original before knowing what
-- the corrected figures are, which is exactly backwards.
--
-- After this there are still at most:
--   · one sent-or-confirmed distribution per pool  — the live payout
--   · one draft per pool                           — the correction being prepared
-- and calculate_distribution() above refuses to produce that draft at all
-- unless it names the distribution the pool already paid.
drop index if exists public.tip_distributions_pool_live_key;

create unique index tip_distributions_pool_paid_key
  on public.tip_distributions (tip_pool_id)
  where status in ('sent', 'confirmed');

create unique index tip_distributions_pool_draft_key
  on public.tip_distributions (tip_pool_id)
  where status = 'draft';

-- ── the link back to the question that caused it ───────────────────────────
alter table public.tip_distributions
  add column trigger_query_id uuid references public.distribution_queries (id) on delete set null;

comment on column public.tip_distributions.trigger_query_id is
  'Migration 23: the query whose correction_required resolution caused this replacement. '
  'A foreign key rather than copied text, so the question keeps one home.';

-- Nothing may supersede itself.
alter table public.tip_distributions
  add constraint distributions_no_self_supersede
  check (supersedes_id is null or supersedes_id <> id);

-- One live successor per original. A cancelled child does not hold the slot, so
-- a correction that was itself abandoned can be redone; two competing live
-- replacements cannot exist, whatever two browser tabs try.
create unique index distributions_one_live_replacement
  on public.tip_distributions (supersedes_id)
  where supersedes_id is not null and status <> 'cancelled';

-- ── lineage is written by the engine, never by a client ────────────────────
-- SECURITY INVOKER on purpose: inside the definer RPCs current_user is the
-- table owner and app.is_trusted_context() is true, which is exactly where
-- these columns are allowed to be set. A manager editing a draft by hand is
-- not, and neither is anybody else.
create or replace function app.guard_distribution_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_at    uuid;
  v_steps integer := 0;
begin
  if not app.is_trusted_context() then
    if tg_op = 'INSERT' then
      if new.supersedes_id is not null or new.trigger_query_id is not null then
        raise exception 'a replacement is created by create_replacement_distribution(), not by hand'
          using errcode = '42501';
      end if;
    elsif (new.supersedes_id, new.trigger_query_id)
          is distinct from (old.supersedes_id, old.trigger_query_id) then
      raise exception 'the lineage of a distribution is not editable'
        using errcode = '42501';
    end if;
  end if;

  -- Walk the ancestry. Single-parent plus an already-sent parent makes a cycle
  -- hard to reach, but "hard to reach" is not "refused", and this is the money.
  if new.supersedes_id is not null then
    v_at := new.supersedes_id;
    while v_at is not null and v_steps < 64 loop
      if v_at = new.id then
        raise exception 'that would make a replacement chain that loops back on itself'
          using errcode = '23514';
      end if;
      select d.supersedes_id into v_at from public.tip_distributions d where d.id = v_at;
      v_steps := v_steps + 1;
    end loop;
    if v_steps >= 64 then
      raise exception 'that replacement chain is too long to verify' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Runs after tip_distributions_stamp_inputs (alphabetically 'l' < 's'), which
-- only fills the fingerprint, so the order is immaterial — but it is stated
-- here so a future reader does not have to work it out.
create trigger tip_distributions_lineage
  before insert or update on public.tip_distributions
  for each row execute function app.guard_distribution_lineage();

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
  -- Phase 3J lineage. Transaction-local settings, set only by
  -- create_replacement_distribution() — the same mechanism app.audit_reason
  -- already uses. A client cannot set them, and even if one could they grant
  -- nothing: the original named here is re-validated against this very pool.
  v_replacing  uuid;
  v_trigger_q  uuid;
  v_live       uuid;
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

  -- ── one pool, one live payout ────────────────────────────────────────────
  -- Before Phase 3J this function would happily calculate a second
  -- distribution for a pool that had already been sent, with no lineage
  -- between them: the same tip reports funding two payouts that each looked
  -- current. A pool that has paid out may now only be recalculated as an
  -- explicit replacement of the distribution that paid it.
  select d.id into v_live
  from public.tip_distributions d
  where d.tip_pool_id = p_pool_id and d.status in ('sent', 'confirmed')
  limit 1;

  if v_live is not null then
    v_replacing := nullif(pg_catalog.current_setting('app.replacement_for', true), '')::uuid;
    if v_replacing is null then
      raise exception
        'this pool has already been distributed; correct it with a replacement rather than a second payout'
        using errcode = '42501';
    end if;
    if v_replacing is distinct from v_live then
      raise exception 'that is not the distribution this pool paid out' using errcode = '42501';
    end if;
    v_trigger_q := nullif(pg_catalog.current_setting('app.replacement_query', true), '')::uuid;
  end if;

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
    rules_snapshot, inputs_snapshot, engine_version, entries_total_cents, calculated_by,
    supersedes_id, trigger_query_id
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
    app.engine_version(), v_assigned, v_actor,
    v_replacing, v_trigger_q
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

-- ── starting a correction ──────────────────────────────────────────────────
-- One call: verify, then recalculate the original's own pool through the same
-- engine that produced it. Nothing is copied — the replacement is calculated
-- fresh from whatever the authoritative inputs say now, which is the point: the
-- manager fixes the shift, the role, the multiplier or the rule, and then asks
-- for the arithmetic again.
--
-- It does NOT send. The manager reads the correction, compares it with what was
-- paid, and sends when they are satisfied. Calling it again simply recalculates
-- the same draft, so a double click, a second tab and a retried request all
-- converge on one draft rather than racing.
create or replace function public.create_replacement_distribution(
  p_original_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig  public.tip_distributions%rowtype;
  v_query uuid;
  v_new   uuid;
begin
  select * into v_orig from public.tip_distributions
  where id = p_original_id for update;

  if v_orig.id is null or not app.is_manager(v_orig.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  if v_orig.status = 'draft' then
    raise exception 'a draft is corrected by recalculating it, not by replacing it'
      using errcode = '42501';
  end if;
  if v_orig.status = 'cancelled' then
    raise exception 'this distribution has already been replaced or cancelled'
      using errcode = '42501';
  end if;

  -- A correction needs a reason on the record. Phase 3I's resolution is that
  -- reason: a manager who has looked at a question and agreed it is wrong.
  select q.id into v_query
  from public.distribution_queries q
  where q.distribution_id = p_original_id
    and q.status = 'resolved'
    and q.outcome = 'correction_required'
  order by q.resolved_at desc
  limit 1;

  if v_query is null then
    raise exception
      'nothing on this distribution says it needs correcting; answer the question with "a correction is needed" first'
      using errcode = '42501';
  end if;

  -- Belt and braces over the unique index: say why, rather than let a
  -- constraint name reach the manager.
  if exists (
    select 1 from public.tip_distributions d
    where d.supersedes_id = p_original_id and d.status <> 'cancelled' and d.status <> 'draft')
  then
    raise exception 'this distribution has already been corrected' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.replacement_for', p_original_id::text, true);
  perform pg_catalog.set_config('app.replacement_query', v_query::text, true);
  v_new := public.calculate_distribution(v_orig.tip_pool_id);
  perform pg_catalog.set_config('app.replacement_for', '', true);
  perform pg_catalog.set_config('app.replacement_query', '', true);

  return v_new;
end;
$$;

-- ── finalising a correction ────────────────────────────────────────────────
-- The stale-input check is the same one every distribution gets: correcting a
-- payout is not a reason to send arithmetic that no longer matches the hours.
-- The original is retired in the same transaction that publishes the
-- replacement, so there is no instant where both read as current.
create or replace function public.send_distribution(p_distribution_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dist public.tip_distributions%rowtype;
  v_now  text;
begin
  select * into v_dist from public.tip_distributions where id = p_distribution_id for update;
  if v_dist.id is null or not app.is_manager(v_dist.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  if v_dist.status <> 'draft' then
    raise exception 'only a draft can be sent' using errcode = '42501';
  end if;

  v_now := app.distribution_fingerprint(v_dist.tip_pool_id);
  if v_dist.inputs_fingerprint is not null and v_now is distinct from v_dist.inputs_fingerprint then
    raise exception
      'the hours or the rule changed since this distribution was calculated; recalculate before sending'
      using errcode = '23514';
  end if;

  -- Lock the predecessor before either row moves, so two sends cannot both
  -- believe they retired it.
  if v_dist.supersedes_id is not null then
    perform 1 from public.tip_distributions
    where id = v_dist.supersedes_id for update;
  end if;

  -- Retire the predecessor BEFORE publishing this one. tip_distributions_pool_paid_key
  -- allows one sent-or-confirmed distribution per pool and is checked per
  -- statement, not at commit, so publishing first would collide with the very
  -- row this send is retiring. Both statements are in one transaction, so no
  -- reader ever sees the gap — and none ever sees two live payouts either.
  if v_dist.supersedes_id is not null then
    update public.tip_distributions
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = app.member_id(v_dist.workplace_id),
        cancel_reason = coalesce(cancel_reason, 'Replaced by a corrected distribution')
    where id = v_dist.supersedes_id
      and status in ('sent', 'confirmed');
  end if;

  update public.tip_distributions
  set status = 'sent', sent_at = now(), sent_by = app.member_id(v_dist.workplace_id)
  where id = p_distribution_id;

  update public.tip_pools set status = 'distributed' where id = v_dist.tip_pool_id;
end;
$$;

-- ── what the employee can see of a chain ───────────────────────────────────
-- Adds the two lineage columns, so a person can tell which record is current
-- and follow it back. A draft replacement is still invisible: the view filters
-- drafts, so nobody reads a correction before their manager has sent it.
create or replace view public.member_distributions
with (security_invoker = false) as
select
  d.id,
  d.workplace_id,
  d.period_start,
  d.period_end,
  d.status,
  d.rule_version,
  d.people_count,
  d.sent_at,
  d.confirmed_at,
  d.method,
  d.min_overlap_minutes,
  case when w.pool_amount_visible_to_members then d.pool_cents end as pool_cents,
  w.pool_amount_visible_to_members as pool_amount_visible,
  coalesce((d.rules_snapshot ->> 'acknowledgement_required')::boolean, true)
    as acknowledgement_required,
  d.supersedes_id,
  (select r.id from public.tip_distributions r
    where r.supersedes_id = d.id and r.status not in ('draft', 'cancelled')
    limit 1) as superseded_by
from public.tip_distributions d
join public.workplaces w on w.id = d.workplace_id
where d.status <> 'draft'
  and exists (
    select 1
    from public.tip_distribution_entries e
    join public.workplace_members m on m.id = e.member_id
    where e.distribution_id = d.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );

comment on view public.member_distributions is
  'Employee-facing list of distributions they took part in. SECURITY DEFINER: '
  'the WHERE clause is the security boundary, pool_cents is null unless the '
  'workplace has released it, acknowledgement_required is the value frozen into '
  'rules_snapshot, and superseded_by names the correction that replaced this one.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;

revoke all on function public.create_replacement_distribution(uuid) from public;
grant execute on function public.create_replacement_distribution(uuid) to authenticated;

comment on function public.create_replacement_distribution(uuid) is
  'Migration 23: recalculates the original''s own pool as a corrected draft, linked by '
  'supersedes_id. Reuses the pool on purpose — a tip report funds exactly one pool, so '
  'original and replacement are two descriptions of one money event, never two payouts.';
