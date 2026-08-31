-- ═════════════════════════════════════════════════════════════════════════════
-- 11 · The calculation engine and the distribution lifecycle.
--
-- Two levels of largest-remainder rounding, so the entries always sum to the
-- pool to the cent:
--   pool  → areas   weighted by the rule's percentages
--   area  → people  weighted by units
--
-- Determinism matters as much as accuracy: ties are broken by an explicit
-- ordering, so the same inputs always produce the same cents.
-- ═════════════════════════════════════════════════════════════════════════════

-- Shared time between two shifts, in whole minutes. The intersection of two
-- ranges is a range, so it has to be measured, not extracted directly.
create or replace function app.overlap_minutes(p_a tstzrange, p_b tstzrange)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_a is null or p_b is null then 0
    when pg_catalog.isempty(p_a * p_b) then 0
    else greatest(0, floor(
      extract(epoch from (pg_catalog.upper(p_a * p_b) - pg_catalog.lower(p_a * p_b))) / 60
    )::integer)
  end
$$;

create or replace function app.engine_version()
returns text language sql immutable set search_path = '' as $$ select 'pg-1.0.0'::text $$;

create or replace function public.calculate_distribution(p_pool_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool     public.tip_pools%rowtype;
  v_rule     public.distribution_rules%rowtype;
  v_actor    uuid;
  v_dist     uuid;
  v_anchor   record;
  v_pool_c   bigint;
  v_assigned bigint;
  v_people   integer;
begin
  select * into v_pool from public.tip_pools where id = p_pool_id for update;
  if v_pool.id is null then
    raise exception 'pool not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_pool.workplace_id) then
    raise exception 'only a manager of this workplace may run a distribution' using errcode = '42501';
  end if;

  -- Serialise: two managers pressing the button at once must not both write.
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

  -- A pool can only have one live distribution: replace an existing draft.
  delete from public.tip_distributions
  where tip_pool_id = p_pool_id and status = 'draft';

  v_actor  := app.member_id(v_pool.workplace_id);
  v_pool_c := v_pool.total_cents;

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
      -- Moved into another area with no role named: take that area's first
      -- role, never the weighting that belongs to their home area.
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

  -- The anchor: the longest effective shift of the period. Ties go to the
  -- earlier start, so the choice never depends on row order.
  select shift_id, during, worked_minutes
  into v_anchor
  from tmp_shift_rows
  order by worked_minutes desc, lower(during) asc, shift_id asc
  limit 1;

  if v_anchor.shift_id is null then
    raise exception 'no approved hours in this period; approve the shifts first'
      using errcode = '22023';
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
    (case when s.shift_id = v_anchor.shift_id
          then s.worked_minutes
          else app.overlap_minutes(s.during, v_anchor.during) end) as overlap_minutes
  from tmp_shift_rows s
  left join public.workplace_areas wa on wa.id = s.area_id
  left join public.workplace_roles wr on wr.id = s.role_id
  left join public.distribution_rule_areas ar
         on ar.rule_id = v_rule.id and ar.area_id = s.area_id
  left join public.distribution_rule_roles rr
         on rr.rule_id = v_rule.id and rr.workplace_role_id = s.role_id;

  drop table if exists tmp_eligible;
  create temp table tmp_eligible on commit drop as
  select
    r.*,
    (r.shift_id = v_anchor.shift_id or r.overlap_minutes >= v_rule.min_overlap_minutes)
      as clears_overlap,
    case
      when r.area_id is null then 'no_area'
      when coalesce(r.percentage, 0) <= 0 then 'area_not_in_pool'
      when r.shift_id = v_anchor.shift_id then 'anchor'
      when r.overlap_minutes < v_rule.min_overlap_minutes then 'below_min_overlap'
      else 'included'
    end as eligibility
  from tmp_resolved r;

  -- Aggregate to one row per member per area: a split shift in the same area
  -- is one entry; Bar plus Service is two.
  drop table if exists tmp_entries;
  create temp table tmp_entries on commit drop as
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
  where e.eligibility = 'included' or e.eligibility = 'anchor'
  group by e.member_id, e.area_id;

  -- Units by method. `equal` means one unit per person per area.
  alter table tmp_entries add column units numeric(12,4);
  update tmp_entries set units = case v_rule.method
    when 'equal'  then 1.0
    when 'hours'  then round((worked_minutes / 60.0)::numeric, 4)
    else round((worked_minutes / 60.0 * points * multiplier)::numeric, 4)
  end;
  delete from tmp_entries where units <= 0;

  -- ── level 1: pool → areas ────────────────────────────────────────────────
  -- Areas with a percentage but nobody eligible are skipped, and their share
  -- is absorbed proportionally by the areas that do have people. Otherwise the
  -- entries could not add up to the pool.
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
    select a.*,
           (v_pool_c * a.percentage) / nullif(sum(a.percentage) over (), 0) as exact_cents
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
    select j.*,
           (j.area_cents * j.units) / nullif(j.area_units, 0) as exact_cents
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
      'anchor_shift_id', v_anchor.shift_id,
      'anchor_worked_minutes', v_anchor.worked_minutes,
      'pool', jsonb_build_object('card_cents', v_pool.card_cents, 'cash_cents', v_pool.cash_cents,
                                 'total_cents', v_pool.total_cents, 'source', v_pool.source),
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

  -- Freeze the inputs this distribution rests on.
  update public.shifts set locked = true
  where id in (select unnest(shift_ids) from tmp_amounts);

  update public.tip_pools
  set status = 'locked', locked_at = coalesce(locked_at, now())
  where id = p_pool_id and status = 'open';

  return v_dist;
end;
$$;

-- ── lifecycle transitions ───────────────────────────────────────────────────
create or replace function public.send_distribution(p_distribution_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dist public.tip_distributions%rowtype;
begin
  select * into v_dist from public.tip_distributions where id = p_distribution_id for update;
  if v_dist.id is null or not app.is_manager(v_dist.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  if v_dist.status <> 'draft' then
    raise exception 'only a draft can be sent' using errcode = '42501';
  end if;

  update public.tip_distributions
  set status = 'sent', sent_at = now(), sent_by = app.member_id(v_dist.workplace_id)
  where id = p_distribution_id;

  update public.tip_pools set status = 'distributed' where id = v_dist.tip_pool_id;
end;
$$;

create or replace function public.cancel_distribution(p_distribution_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dist public.tip_distributions%rowtype;
begin
  select * into v_dist from public.tip_distributions where id = p_distribution_id for update;
  if v_dist.id is null or not app.is_manager(v_dist.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  if v_dist.status = 'cancelled' then
    return;
  end if;

  update public.tip_distributions
  set status = 'cancelled', cancelled_at = now(),
      cancelled_by = app.member_id(v_dist.workplace_id),
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_distribution_id;

  update public.tip_pools set status = 'locked' where id = v_dist.tip_pool_id;
end;
$$;

-- The employee's own confirmation. Marks the distribution confirmed once every
-- entry that *can* be acknowledged has been: a roster placeholder with no
-- account cannot confirm, so it is not counted.
create or replace function public.acknowledge_entry(
  p_entry_id uuid, p_status public.entry_ack_status, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tip_distribution_entries%rowtype;
  v_open  integer;
begin
  select * into v_entry from public.tip_distribution_entries where id = p_entry_id for update;
  if v_entry.id is null or v_entry.member_id is distinct from app.member_id(v_entry.workplace_id) then
    raise exception 'entry not found' using errcode = '42501';
  end if;
  if p_status not in ('acknowledged', 'queried') then
    raise exception 'an entry can only be acknowledged or queried' using errcode = '22023';
  end if;

  update public.tip_distribution_entries
  set ack_status      = p_status,
      acknowledged_at = case when p_status = 'acknowledged' then now() else acknowledged_at end,
      queried_at      = case when p_status = 'queried' then now() else queried_at end,
      query_note      = case when p_status = 'queried'
                             then nullif(btrim(coalesce(p_note, '')), '') else query_note end
  where id = p_entry_id;

  select count(*) into v_open
  from public.tip_distribution_entries e
  join public.workplace_members m on m.id = e.member_id
  where e.distribution_id = v_entry.distribution_id
    and m.user_id is not null
    and e.ack_status = 'pending';

  if v_open = 0 then
    update public.tip_distributions
    set status = 'confirmed', confirmed_at = now()
    where id = v_entry.distribution_id and status = 'sent';
  end if;
end;
$$;

revoke all on function
  public.calculate_distribution(uuid),
  public.send_distribution(uuid),
  public.cancel_distribution(uuid, text),
  public.acknowledge_entry(uuid, public.entry_ack_status, text)
from public;

grant execute on function
  public.calculate_distribution(uuid),
  public.send_distribution(uuid),
  public.cancel_distribution(uuid, text),
  public.acknowledge_entry(uuid, public.entry_ack_status, text)
to authenticated;
