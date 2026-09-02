-- ═════════════════════════════════════════════════════════════════════════════
-- 24 · Manager-initiated corrections.
--
-- Phase 3J could only correct a payout somebody had complained about. A manager
-- who spots the error themselves had no way in — the honest workaround would
-- have been to write a fake complaint in the employee's name, which is exactly
-- what this avoids.
--
-- WHAT THE AUDIT FOUND. The requirement was one line in one function:
--
--     if v_query is null then raise exception 'nothing on this distribution
--       says it needs correcting; answer the question with "a correction is
--       needed" first';
--
-- and nothing else. `trigger_query_id` is nullable, no constraint or index
-- assumes a query exists, and calculate_distribution() already reads its
-- transaction-local setting through nullif(), so a replacement with no query
-- was always representable. This migration relaxes that one guard and gives the
-- manager's reason somewhere to live. The engine is not touched.
--
-- ONE ENGINE, TWO DOORS. Both paths still go through the same
-- create_replacement_distribution() → calculate_distribution() → send, with the
-- same lineage, the same pool, the same one-live-payout index, the same stale
-- fingerprint and the same fresh acknowledgement. What differs is only why:
--
--     employee door   trigger_query_id set,     correction_reason null
--     manager door    trigger_query_id null,    correction_reason set
--
-- so `correction_source` is not stored. It is the answer to "is
-- trigger_query_id null", and a stored copy could disagree with the lineage.
-- ═════════════════════════════════════════════════════════════════════════════

create type public.correction_reason as enum (
  'hours', 'area', 'role', 'multiplier', 'tip_amount', 'rule', 'other'
);

alter table public.tip_distributions
  add column correction_reason public.correction_reason,
  add column correction_note   text,
  -- Server-derived, always. The browser never sends who it is.
  add column initiated_by      uuid references public.workplace_members (id) on delete set null,
  add column initiated_at      timestamptz;

-- A reason only means anything on a replacement, and a manager who gives one
-- has to say what they found: the note is the historical record of why money
-- moved, so a blank one is worse than useless.
alter table public.tip_distributions
  add constraint distributions_correction_reason_shape check (
    correction_reason is null
    or (supersedes_id is not null
        and correction_note is not null
        and length(btrim(correction_note)) between 1 and 500)
  );

-- The two doors are mutually exclusive. A replacement is either the answer to
-- somebody's question or the manager's own finding, never both — otherwise
-- "who noticed this" has two answers and the history is ambiguous.
alter table public.tip_distributions
  add constraint distributions_one_correction_source check (
    trigger_query_id is null or correction_reason is null
  );

comment on column public.tip_distributions.correction_reason is
  'Migration 24: why a manager corrected this, when no employee query prompted it. '
  'Null on an employee-reported correction, where trigger_query_id is the reason.';
comment on column public.tip_distributions.initiated_by is
  'Migration 24: the membership that started the correction, derived from auth.uid() '
  'inside the RPC. Set on both correction paths.';

-- ── the new columns are the engine's to write, like the rest of lineage ────
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
      if new.supersedes_id is not null or new.trigger_query_id is not null
         or new.correction_reason is not null or new.correction_note is not null
         or new.initiated_by is not null or new.initiated_at is not null then
        raise exception 'a replacement is created by create_replacement_distribution(), not by hand'
          using errcode = '42501';
      end if;
    elsif (new.supersedes_id, new.trigger_query_id, new.correction_reason,
           new.correction_note, new.initiated_by, new.initiated_at)
          is distinct from
          (old.supersedes_id, old.trigger_query_id, old.correction_reason,
           old.correction_note, old.initiated_by, old.initiated_at) then
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

-- ── one entry point, two reasons to use it ─────────────────────────────────
-- The old one-argument signature is dropped rather than left beside this one:
-- two overloads reachable by the same single-key call is an ambiguity PostgREST
-- would have to guess at. Callers that pass only p_original_id resolve here,
-- with both new arguments defaulting to null, so the Phase 3J employee path is
-- unchanged.
--
-- IDEMPOTENCY. Calling again replaces the draft, exactly as in Phase 3J, and
-- the new draft carries the reason given on that call. That is deliberate: a
-- draft has been sent to nobody, so there is no history to overwrite — the
-- manager corrected their own wording before publishing anything. Once sent,
-- the reason is frozen with the distribution, and correcting again is a new
-- link in the chain with a reason of its own. Every attempt is in audit_log
-- either way.
drop function if exists public.create_replacement_distribution(uuid);

create or replace function public.create_replacement_distribution(
  p_original_id uuid,
  p_reason      public.correction_reason default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig  public.tip_distributions%rowtype;
  v_query uuid;
  v_note  text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_new   uuid;
  v_actor uuid;
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

  -- app.is_manager() is status-aware, so a suspended manager never reaches
  -- here; app.member_id() is the same test, and gives us the actor.
  v_actor := app.member_id(v_orig.workplace_id);

  if p_reason is null then
    -- The employee door: a manager who has read a question and agreed with it.
    select q.id into v_query
    from public.distribution_queries q
    where q.distribution_id = p_original_id
      and q.status = 'resolved'
      and q.outcome = 'correction_required'
    order by q.resolved_at desc
    limit 1;

    if v_query is null then
      raise exception
        'say what needs correcting, or answer the question on this distribution with "a correction is needed" first'
        using errcode = '42501';
    end if;
    if v_note is not null then
      raise exception 'this correction already has its reason: the question somebody asked'
        using errcode = '22023';
    end if;
  else
    -- The manager door: their own finding, in their own words.
    if v_note is null then
      raise exception 'a correction needs a sentence saying what was wrong'
        using errcode = '22023';
    end if;
    if length(v_note) > 500 then
      raise exception 'that reason is too long; 500 characters is the limit'
        using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.tip_distributions d
    where d.supersedes_id = p_original_id and d.status <> 'cancelled' and d.status <> 'draft')
  then
    raise exception 'this distribution has already been corrected' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.replacement_for', p_original_id::text, true);
  perform pg_catalog.set_config('app.replacement_query', coalesce(v_query::text, ''), true);
  v_new := public.calculate_distribution(v_orig.tip_pool_id);
  perform pg_catalog.set_config('app.replacement_for', '', true);
  perform pg_catalog.set_config('app.replacement_query', '', true);

  -- Stamped after the engine has written the draft, in the same transaction.
  -- Doing it here rather than inside calculate_distribution() keeps the money
  -- path untouched by this phase.
  update public.tip_distributions
  set correction_reason = p_reason,
      correction_note   = case when p_reason is null then null else v_note end,
      initiated_by      = v_actor,
      initiated_at      = now()
  where id = v_new;

  return v_new;
end;
$$;

revoke all on function
  public.create_replacement_distribution(uuid, public.correction_reason, text) from public;
grant execute on function
  public.create_replacement_distribution(uuid, public.correction_reason, text) to authenticated;

comment on function public.create_replacement_distribution(uuid, public.correction_reason, text) is
  'Migration 24: the one way to start a correction, by either door. With a reason it is the '
  'manager''s own finding; without one it answers a query the manager resolved as '
  'correction_required. Same engine, same pool, same lineage, same protections either way.';

-- ── what the employee is told ──────────────────────────────────────────────
-- The reason is added to the member view because a person whose payout changed
-- deserves to know why in the manager's own words. Nothing else about the
-- correction is exposed: not who started it, not when, not the audit trail.
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
    limit 1) as superseded_by,
  d.correction_reason,
  d.correction_note
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
  'rules_snapshot, superseded_by names the correction that replaced this one, and '
  'correction_reason/note say why a manager corrected it — never who or when.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;
