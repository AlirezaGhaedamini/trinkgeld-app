-- ─────────────────────────────────────────────────────────────────────────────
-- 33 · Phase 3R-A · production hardening: the lifecycle belongs to the engine
--
-- Phase 3Q closed with every money-moving screen going through the RPCs. What
-- the 3R audit then found was not in the screens but underneath them: the
-- privilege layer still let a manager's PostgREST client do, by hand, things
-- the product never asks of it, and two definitions still leaned on "status"
-- where the durable fact is "was this ever sent".
--
-- ── 1 · tip_distributions ─────────────────────────────────────────────────
-- Migration 10 granted UPDATE to authenticated and wrote a policy for it, and
-- app.guard_sent_distribution() stops a client editing a row once it has left
-- 'draft'. A DRAFT, though, was fair game: one PATCH could set status = 'sent'
-- without send_distribution() — no fingerprint check, no sent_at, no pool
-- moving to 'distributed', and a notification going out for a row that was
-- never published. The same PATCH could rewrite pool_cents, entries_total_cents
-- or tip_pool_id on the draft that was about to be sent.
--
-- No screen, hook or script has ever issued that UPDATE: every transition is
-- an RPC and the only client write on the table is DELETE of a draft
-- (distributions_delete_draft, which stays). So the fix is total rather than
-- column-by-column — a client may not UPDATE tip_distributions at all — and it
-- is applied three times over: a guard trigger, the policy dropped, the
-- privilege revoked. The engine's own functions are SECURITY DEFINER and run as
-- the table owner, which is exactly what app.is_trusted_context() recognises.
--
-- ── 2 · tip_pools ─────────────────────────────────────────────────────────
-- A pool's amounts were already frozen once it left 'open' (migration 10).
-- Its STATUS was not: a manager could reopen a locked pool and change the
-- total under a calculated draft, mark one 'distributed' by hand, or void a
-- distributed pool — and voiding releases its report sources (migration 15),
-- so the same reports could fund a second pool, which is the one thing that
-- table exists to make impossible. The guard below leaves a client exactly
-- what the app uses: opening a manual pool, and editing amounts, label and
-- note while it is still theirs to edit.
--
-- ── 3 · void_pool ─────────────────────────────────────────────────────────
-- The recovery the 3Q audit found missing. A manager who calculates a draft
-- against a wrong total is stuck: the amount is frozen, no RPC reopens a pool,
-- and a replacement reuses the total. The way out is to discard the draft,
-- void the pool — which releases the reports — and pool them again. void_pool()
-- permits precisely that and nothing that would touch money: an open or
-- locked pool with no draft, no live payout and no version that was ever
-- published. reopen_pool is deliberately not provided.
--
-- ── 4 · publication ───────────────────────────────────────────────────────
-- Migrations 29 and 31 established that "was published" means sent_at is not
-- null, because sent_at is written only by send_distribution() and never
-- cleared. app.distribution_is_published() and member_distributions still said
-- status <> 'draft'. The two agree for every row the engine produces today;
-- they disagree for a row that leaves 'draft' without being sent — which
-- section 1 now prevents and which cancel_distribution() below refuses — and
-- the projection an employee reads should not depend on that never happening.
--
-- ── 5 · the business day ──────────────────────────────────────────────────
-- The server has always decided the business day for shifts (migration 08).
-- The browser mirrored the arithmetic for the date it offers when a report is
-- filed or a pool is opened. current_business_day() hands the server's answer
-- to any active member, so Phase 3R-B can stop consulting the device clock.
--
-- Migrations 1–32 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1 · tip_distributions: written by the engine only ═════════════════════
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_distribution_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  raise exception
    'a distribution is written only by the engine: calculate it, send it, correct it or discard it'
    using errcode = '42501';
end;
$$;

comment on function app.guard_distribution_client_write() is
  'Migration 33: no client UPDATE of tip_distributions, whatever the row''s status. Every '
  'transition — calculate, send, confirm, correct, cancel — is a SECURITY DEFINER function, '
  'which app.is_trusted_context() lets through. Defence in depth beside the dropped policy '
  'and the revoked privilege below.';

-- Fires beside tip_distributions_immutable (migration 10) and
-- tip_distributions_lineage (migration 23); all three raise or pass, so their
-- order is immaterial.
create trigger tip_distributions_client_guard
  before update on public.tip_distributions
  for each row execute function app.guard_distribution_client_write();

-- The policy and the privilege said "a manager may UPDATE"; nothing ever
-- needed it. A client PATCH now fails on privilege before RLS is consulted,
-- and would fail on the trigger if the privilege ever came back.
drop policy if exists distributions_update_manager on public.tip_distributions;
revoke update on public.tip_distributions from authenticated;

-- ═══ 2 · tip_pools: a client opens a manual pool and edits it while open ════
-- SECURITY INVOKER on purpose — see the note on the guard above.
create or replace function app.guard_pool_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A pool is opened open. Calculating, sending and voiding move it on.
    if new.status <> 'open' or new.locked_at is not null then
      raise exception
        'a pool is opened open; calculating, sending and voiding move it from there'
        using errcode = '42501';
    end if;
    -- Reports are pooled by create_pool_from_reports(), which records which
    -- ones it consumed. A pool that CLAIMS to be from reports without that
    -- record would count them twice.
    if new.source <> 'manual' then
      raise exception
        'only a manual pool is opened by hand; reports are pooled by create_pool_from_reports()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE. Identity and lifecycle are the engine's.
  if (new.id, new.status, new.locked_at, new.period, new.period_start, new.period_end,
      new.source, new.workplace_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.status, old.locked_at, old.period, old.period_start, old.period_end,
      old.source, old.workplace_id, old.created_by, old.created_at)
  then
    raise exception
      'the lifecycle of a pool is moved by the engine: calculate, send, or void_pool()'
      using errcode = '42501';
  end if;

  -- Label and note stay editable until the pool is history. The amounts are
  -- app.guard_pool_amounts()'s (migration 10): open pools only.
  if old.status not in ('open', 'locked')
     and (new.label, new.note) is distinct from (old.label, old.note)
  then
    raise exception 'this pool is % and can no longer be edited', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.guard_pool_lifecycle() is
  'Migration 33: a client may INSERT a pool only as open and manual, and may UPDATE only '
  'label and note (and, while open, the amounts guarded by migration 10). status, '
  'locked_at, period, source and identity are moved by calculate_distribution(), '
  'send_distribution(), cancel_distribution() and void_pool() alone.';

-- Sorts between tip_pools_amount_guard and tip_pools_touch_updated_at, so
-- updated_at has not yet been touched when it runs; it is excluded from the
-- comparison anyway.
create trigger tip_pools_lifecycle_guard
  before insert or update on public.tip_pools
  for each row execute function app.guard_pool_lifecycle();

-- ═══ 3 · void_pool ═════════════════════════════════════════════════════════
create or replace function public.void_pool(p_pool_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool   public.tip_pools%rowtype;
  v_reason text := app.trimmed_note(p_reason);
begin
  -- The row first, then the pool's advisory lock — the same order as
  -- calculate_distribution(), so the two can never wait on each other in
  -- opposite order. Holding the calculation lock means no draft can appear
  -- between the check below and the void.
  select * into v_pool from public.tip_pools where id = p_pool_id for update;
  if v_pool.id is null or not app.is_manager(v_pool.workplace_id) then
    raise exception 'pool not found' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('calculate_distribution:' || p_pool_id::text));

  -- A retry after a lost response finds the work done and says nothing.
  if v_pool.status = 'void' then
    return;
  end if;
  if v_pool.status = 'distributed' then
    raise exception
      'this pool has been distributed; its money is on the record and it cannot be voided'
      using errcode = '42501';
  end if;
  if pg_catalog.length(coalesce(v_reason, '')) > 500 then
    raise exception 'that reason is too long; 500 characters is the limit'
      using errcode = '22023';
  end if;

  -- Nothing may stand on the pool: no draft (discard it first), and no version
  -- that was ever published — a cancelled one included, because its sent_at
  -- says the team was told and its entries are their history.
  if exists (
    select 1 from public.tip_distributions d
    where d.tip_pool_id = p_pool_id
      and (d.status in ('draft', 'sent', 'confirmed') or d.sent_at is not null)
  ) then
    raise exception
      'this pool has a distribution; discard the draft first — a published one can never be undone'
      using errcode = '42501';
  end if;
  -- Unreachable while the check above holds (a payout needs a sent
  -- distribution), and stated anyway: settled money pins the pool.
  if exists (
    select 1 from public.distribution_payouts p
    join public.tip_distributions d on d.id = p.distribution_id
    where d.tip_pool_id = p_pool_id
  ) then
    raise exception 'this pool has settled money behind it and cannot be voided'
      using errcode = '42501';
  end if;

  -- The reason is the audit row's, which is the record of this decision
  -- (app.write_audit() reads app.audit_reason). The amounts are not touched;
  -- tip_pools_release_sources (migration 15) frees the reports.
  perform pg_catalog.set_config('app.audit_reason', coalesce(v_reason, ''), true);
  update public.tip_pools
  set status = 'void'
  where id = p_pool_id;
  perform pg_catalog.set_config('app.audit_reason', '', true);
end;
$$;

revoke all on function public.void_pool(uuid, text) from public;
grant execute on function public.void_pool(uuid, text) to authenticated;

comment on function public.void_pool(uuid, text) is
  'Migration 33: retire an open or locked pool that has no draft, no live payout and no '
  'version that was ever published. Manager-only; row-locked and serialised with '
  'calculate_distribution(); idempotent on an already void pool; the reason goes to '
  'audit_log. Releasing the report sources lets the same reports be pooled again. There '
  'is deliberately no reopen: a frozen total stays frozen.';

-- ═══ 4 · publication means sent_at ═════════════════════════════════════════
-- Privileges on a replaced function are kept, so the grants from migration 10
-- stand: authenticated and service_role may execute it.
create or replace function app.distribution_is_published(p_distribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tip_distributions d
    where d.id = p_distribution_id
      and d.status <> 'draft'
      and d.sent_at is not null
  )
$$;

comment on function app.distribution_is_published(uuid) is
  'Migration 33: a distribution is published when send_distribution() wrote sent_at. '
  'status alone is not evidence; sent_at is never cleared, so a replaced or cancelled '
  'version stays readable and a row that never went out stays invisible.';

-- Every column, the security_invoker setting and the joins are what migration
-- 31 published; only the WHERE clause changes, so `create or replace` is safe.
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
    where r.supersedes_id = d.id and r.sent_at is not null
    order by r.sent_at
    limit 1) as superseded_by,
  d.correction_reason,
  d.correction_note,
  (case
     when p.id is not null then 'paid'
     when exists (select 1 from public.distribution_payouts q
                  where q.distribution_id = d.id) then 'reversed'
     else 'unpaid'
   end)::public.payout_state as payout_status,
  p.method  as payout_method,
  p.paid_at as paid_at,
  app.settled_basis(d.id) as settled_basis_id
from public.tip_distributions d
join public.workplaces w on w.id = d.workplace_id
left join public.distribution_payouts p on p.id = app.effective_payout(d.id)
where d.status <> 'draft'
  -- Migration 33: durable evidence, not a status. A never-sent row is nobody's history.
  and d.sent_at is not null
  and exists (
    select 1 from public.tip_distribution_entries e
    where e.distribution_id = d.id
      and e.member_id = app.member_id(d.workplace_id)
  );

comment on view public.member_distributions is
  'Definer view: a member sees the distributions they have an entry in and that were '
  'actually sent (sent_at is not null — migration 33). payout_status is the CURRENT state; '
  'superseded_by names the version that replaced this one, read from durable publication '
  'evidence (migration 31), so a chain A <- B <- C stays traversable after B is retired.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;

-- ═══ 5 · cancel_distribution: a draft is discarded, never cancelled ════════
-- Cancelling a draft would move it out of 'draft' without sent_at — the exact
-- row section 4 refuses to show, and until now the only way to make one. A
-- draft is deleted (distributions_delete_draft) or replaced by the next
-- calculation. Everything else this function did in migration 11 it still does.
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
  if v_dist.status = 'draft' then
    raise exception 'a draft is discarded, not cancelled: delete it, or calculate again'
      using errcode = '42501';
  end if;

  update public.tip_distributions
  set status = 'cancelled', cancelled_at = pg_catalog.now(),
      cancelled_by = app.member_id(v_dist.workplace_id),
      cancel_reason = nullif(pg_catalog.btrim(coalesce(p_reason, '')), '')
  where id = p_distribution_id;

  update public.tip_pools set status = 'locked' where id = v_dist.tip_pool_id;
end;
$$;

comment on function public.cancel_distribution(uuid, text) is
  'Migration 33: retires a SENT or CONFIRMED distribution without a replacement, keeping '
  'sent_at so the team''s history stays readable. A draft is refused: it is deleted or '
  'recalculated, never turned into a cancelled row that was never sent.';

-- ═══ 6 · the server''s business day, for any member ════════════════════════
-- SECURITY INVOKER is enough: both helpers it calls are DEFINER functions that
-- authenticated may execute, and it reads no table of its own. Nothing here
-- takes a timestamp from the caller.
create or replace function public.current_business_day(p_workplace_id uuid)
returns date
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_member(p_workplace_id) then
    raise exception 'only a member of this workplace may read its business day'
      using errcode = '42501';
  end if;
  return app.business_day(pg_catalog.now(), p_workplace_id);
end;
$$;

revoke all on function public.current_business_day(uuid) from public;
grant execute on function public.current_business_day(uuid) to authenticated;

comment on function public.current_business_day(uuid) is
  'Migration 33: the business day in progress right now, by the workplace''s own timezone '
  'and cut-off — app.business_day(now(), workplace). Any active member may ask; a '
  'suspended or departed member, another workplace''s member and an anonymous caller are '
  'refused. The browser mirror in src/shifts/time.ts is a preview of this answer, never '
  'the authority.';

-- ═══ what the new predicate hides, if anything ═════════════════════════════
-- Informational only. A row that left 'draft' without ever being sent could
-- only have come from a raw UPDATE or a cancelled draft, both now refused. If
-- any exist they are now invisible to members, which is the intended state;
-- they are named here so a project that has some knows.
do $$
declare v_hidden integer;
begin
  select count(*) into v_hidden from public.tip_distributions
  where status <> 'draft' and sent_at is null;
  if v_hidden > 0 then
    raise notice 'migration 33: % distribution(s) left draft without being sent; they are no longer member-visible', v_hidden;
  end if;
end $$;
