-- ═════════════════════════════════════════════════════════════════════════════
-- 21 · Acknowledgement.
--
-- The employee's half of the loop: a distribution has been sent, and the person
-- it names says they have seen it. Everything the flow needs was already in the
-- schema — the entry_ack_status enum, the ack columns, acknowledge_entry() —
-- but four things were missing, and this migration adds exactly those.
--
--   1 · The employee could not find out whether acknowledgement was even
--       required. It is frozen into tip_distributions.rules_snapshot at
--       calculation time, and no member-facing relation exposed it.
--
--   2 · acknowledge_entry() is SECURITY DEFINER and so bypasses RLS. The
--       direct PostgREST path (policy entries_update_own_ack) refuses a draft
--       through app.distribution_is_published(); the RPC did not. Two doors to
--       the same room, one of them unlocked.
--
--   3 · Acknowledging twice moved acknowledged_at forward. The moment somebody
--       first confirmed is a fact about the past and should not drift.
--
--   4 · A member who worked in two areas has two entries in one distribution
--       (calculate_distribution groups by member_id, area_id). Confirming one
--       of them is not confirming the distribution, and the browser must not
--       loop writes to pretend otherwise.
--
-- Nothing here widens who may acknowledge: it is still the member the entry
-- names, still nobody else, and still never a manager on their behalf.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1 · the requirement, as it was frozen, to the person it binds ───────────
-- Read from rules_snapshot, never from the live rule: a distribution sent under
-- a rule that required confirmation keeps requiring it after the rule changes.
-- Still no pool_cents unless released, and still no inputs_snapshot.
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
    as acknowledgement_required
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
  'workplace has released it, and acknowledgement_required is the value frozen '
  'into rules_snapshot when the distribution was calculated.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;

-- ── 2 and 3 · the RPC now refuses what the policy refuses ──────────────────
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
  -- Same test the entries_update_own_ack policy applies to the direct path.
  -- Without it this definer function was the one way to confirm a draft.
  if not app.distribution_is_published(v_entry.distribution_id) then
    raise exception 'this distribution has not been sent yet' using errcode = '42501';
  end if;

  update public.tip_distribution_entries
  set ack_status      = p_status,
      -- coalesce, not now(): the first time somebody confirmed is a fact about
      -- the past. Re-confirming is harmless and changes no timestamp.
      acknowledged_at = case when p_status = 'acknowledged'
                             then coalesce(acknowledged_at, now()) else acknowledged_at end,
      queried_at      = case when p_status = 'queried'
                             then coalesce(queried_at, now()) else queried_at end,
      query_note      = case when p_status = 'queried'
                             then nullif(pg_catalog.btrim(coalesce(p_note, '')), '') else query_note end
  where id = p_entry_id;

  -- Placeholder members have no account and can never answer, so they are not
  -- counted as outstanding. This is the definition the manager's summary below
  -- reuses, so both halves of the product agree on who owes a confirmation.
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

-- ── 4 · one action, every entry the caller owns in that distribution ────────
-- The browser sends a distribution id and never a member id. Which entries
-- that means is decided here, from auth.uid(), in one statement — so a member
-- with two areas confirms both or neither, and a partial write cannot leave the
-- screen claiming more than happened.
create or replace function public.acknowledge_distribution(
  p_distribution_id uuid, p_status public.entry_ack_status, p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workplace uuid;
  v_member    uuid;
  v_touched   integer;
  v_open      integer;
begin
  select d.workplace_id into v_workplace
  from public.tip_distributions d where d.id = p_distribution_id;
  if v_workplace is null then
    raise exception 'distribution not found' using errcode = '42501';
  end if;

  -- Status-aware: a suspended or departed member has no member_id here, and so
  -- cannot acknowledge, which is the same rule that governs the rest of their
  -- financial access.
  v_member := app.member_id(v_workplace);
  if v_member is null then
    -- Distinct from 'entry not found' on purpose: the caller already knows
    -- their own standing, so telling them why is helpful rather than a leak.
    raise exception 'your access to this workplace is paused or has ended'
      using errcode = '42501';
  end if;
  if p_status not in ('acknowledged', 'queried') then
    raise exception 'an entry can only be acknowledged or queried' using errcode = '22023';
  end if;
  if not app.distribution_is_published(p_distribution_id) then
    raise exception 'this distribution has not been sent yet' using errcode = '42501';
  end if;

  update public.tip_distribution_entries
  set ack_status      = p_status,
      acknowledged_at = case when p_status = 'acknowledged'
                             then coalesce(acknowledged_at, now()) else acknowledged_at end,
      queried_at      = case when p_status = 'queried'
                             then coalesce(queried_at, now()) else queried_at end,
      query_note      = case when p_status = 'queried'
                             then nullif(pg_catalog.btrim(coalesce(p_note, '')), '') else query_note end
  where distribution_id = p_distribution_id
    and member_id = v_member;

  get diagnostics v_touched = row_count;
  if v_touched = 0 then
    raise exception 'entry not found' using errcode = '42501';
  end if;

  select count(*) into v_open
  from public.tip_distribution_entries e
  join public.workplace_members m on m.id = e.member_id
  where e.distribution_id = p_distribution_id
    and m.user_id is not null
    and e.ack_status = 'pending';

  if v_open = 0 then
    update public.tip_distributions
    set status = 'confirmed', confirmed_at = now()
    where id = p_distribution_id and status = 'sent';
  end if;

  return v_touched;
end;
$$;

-- ── 5 · the two doors must refuse the same things ──────────────────────────
-- The RPCs above refuse a transition back to 'pending'. The direct PostgREST
-- path (policy entries_update_own_ack) did not, so a person could quietly
-- un-confirm themselves after the manager had seen the count — and could write
-- any timestamp they liked into acknowledged_at, because the existing column
-- guard froze the money but not the answer.
--
-- This runs as SECURITY INVOKER, so app.is_trusted_context() is true only
-- inside the definer RPCs, which is precisely where the timestamps are supposed
-- to be set. Everything the guard already froze stays frozen, word for word.
create or replace function app.guard_entry_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;

  if (new.distribution_id, new.workplace_id, new.member_id, new.member_name,
      new.area_id, new.area_key, new.area_name, new.area_source,
      new.role_key, new.role_name, new.points, new.multiplier,
      new.worked_minutes, new.overlap_minutes, new.units,
      new.amount_cents, new.rounding_adjustment_cents, new.shift_ids)
     is distinct from
     (old.distribution_id, old.workplace_id, old.member_id, old.member_name,
      old.area_id, old.area_key, old.area_name, old.area_source,
      old.role_key, old.role_name, old.points, old.multiplier,
      old.worked_minutes, old.overlap_minutes, old.units,
      old.amount_cents, old.rounding_adjustment_cents, old.shift_ids)
  then
    raise exception 'distribution entries are calculated; only the acknowledgement can change'
      using errcode = '42501';
  end if;

  -- An answer, once given, is not withdrawn into silence. Changing your mind
  -- between acknowledged and queried is a different thing and stays allowed.
  if new.ack_status = 'pending' and old.ack_status <> 'pending' then
    raise exception 'an acknowledgement cannot be taken back; query it instead'
      using errcode = '42501';
  end if;

  -- When the answer was given is the database's to record, not the caller's.
  if (new.acknowledged_at, new.queried_at) is distinct from (old.acknowledged_at, old.queried_at) then
    raise exception 'acknowledgement timestamps are set by the server'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ── the manager's side of the same count ────────────────────────────────────
-- One row per entry, so the screen's totals and the engine's auto-confirm are
-- derived from the same definition of "still owes an answer". Manager-only, and
-- it carries snapshot names — never a profile, never an email.
create or replace function public.distribution_ack_state(p_distribution_id uuid)
returns table (
  entry_id        uuid,
  member_id       uuid,
  member_name     text,
  area_name       text,
  ack_status      public.entry_ack_status,
  acknowledged_at timestamptz,
  queried_at      timestamptz,
  can_acknowledge boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workplace uuid;
begin
  select d.workplace_id into v_workplace
  from public.tip_distributions d where d.id = p_distribution_id;
  if v_workplace is null or not app.is_manager(v_workplace) then
    raise exception 'only a manager of this workplace may read its acknowledgements'
      using errcode = '42501';
  end if;

  return query
  select e.id, e.member_id, e.member_name, e.area_name,
         e.ack_status, e.acknowledged_at, e.queried_at,
         (m.user_id is not null)
  from public.tip_distribution_entries e
  join public.workplace_members m on m.id = e.member_id
  where e.distribution_id = p_distribution_id
  order by e.area_name, e.member_name;
end;
$$;

revoke all on function
  public.acknowledge_distribution(uuid, public.entry_ack_status, text),
  public.distribution_ack_state(uuid)
from public;

grant execute on function
  public.acknowledge_distribution(uuid, public.entry_ack_status, text),
  public.distribution_ack_state(uuid)
to authenticated;

comment on function public.acknowledge_distribution(uuid, public.entry_ack_status, text) is
  'Migration 21: acknowledges every entry the caller owns in one distribution, in one statement. '
  'The caller supplies a distribution id; which entries that means is decided from auth.uid().';
comment on function public.distribution_ack_state(uuid) is
  'Migration 21: per-entry acknowledgement state for a manager, with snapshot names only. '
  'can_acknowledge is false for a roster placeholder with no account, which is exactly the '
  'set the auto-confirm in acknowledge_entry() ignores.';
