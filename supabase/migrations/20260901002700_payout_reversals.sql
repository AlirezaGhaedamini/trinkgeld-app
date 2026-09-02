-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3M · payout reversal events
--
-- A payout recorded by mistake is not edited and not deleted. A second,
-- immutable event says it should no longer count, and both rows stay on the
-- record for ever. History reads
--
--     Distribution  €1,000
--     Payout        +€1,000
--     Reversal      -€1,000
--     Payout        +€1,000
--
-- and never "unpaid", because "unpaid" would be a claim that nothing ever
-- happened.
--
-- ── WHAT A REVERSAL IS NOT ────────────────────────────────────────────────
-- It does not recover cash, reverse a transfer, correct a payslip or ask
-- anybody for money back. It says one thing only: TipCrew's record of that
-- payment should no longer count as settled. The wording on every screen says
-- so, because a manager who believes otherwise would stop chasing a real debt.
--
-- ── THE AUDIT, AND THE FOUR THINGS IT CHANGED ─────────────────────────────
--
-- 1. THE UNIQUENESS RULE. Migration 26 held `unique (distribution_id)` on
--    distribution_payouts — one payout per distribution, for ever. That is now
--    wrong: after a reversal a distribution may legitimately be paid again. The
--    index is REPLACED, not removed, by the invariant it was standing in for:
--    at most one payout per distribution that has not been reversed.
--
--    That invariant spans two tables, so no index can express it. It is held by
--    a trigger that first takes a row lock on the distribution, which is what
--    makes check-then-insert atomic. Every writer goes through the trigger —
--    including a direct INSERT that never touches the RPC — so the guarantee
--    does not depend on callers behaving.
--
-- 2. THE SETTLEMENT BASIS. app.settled_basis() looked for the existence of a
--    payout row. It now looks for an EFFECTIVE one, so a reversed payment stops
--    counting the moment it is reversed, and the next correction settles the
--    full amount rather than a difference against money that no longer counts.
--
-- 3. DOWNSTREAM DEPENDENCY. If a later payout was calculated against this one —
--    A paid €1,000, B corrected to €1,050, B settled the +€50 difference — then
--    reversing A's payout would leave B's stored arithmetic describing a
--    settlement that never happened. Rather than rewrite B, this refuses: a
--    payout whose distribution has a settled descendant cannot be reversed.
--    Blocking is the honest answer; retroactive accounting is not.
--
-- 4. THE STATE WORD. 'reversed' is not "has a reversal anywhere in its history".
--    A distribution paid, reversed and paid again is PAID. The state is read off
--    the effective event: paid when an effective payout exists, reversed when
--    one was reversed and nothing replaced it, unpaid when there never was one.
--
-- ── WHY A NEW ENUM RATHER THAN A NEW VALUE ────────────────────────────────
-- `alter type ... add value` cannot be followed by a use of that value in the
-- same transaction, and `supabase db push` applies a migration in one. Measured,
-- not assumed: adding 'reversed' to payout_status and selecting it two lines
-- later fails with "unsafe use of new value". A new type has no such problem,
-- so payout_state is created whole and the views move to it. payout_status is
-- left exactly as migration 26 wrote it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── vocabulary ─────────────────────────────────────────────────────────────
create type public.payout_reversal_reason as enum (
  'recorded_by_mistake',
  'wrong_method',
  'wrong_distribution',
  'payment_not_completed',
  'duplicate_record',
  'other');

-- unpaid   — nothing was ever recorded
-- paid     — an effective payout exists right now
-- reversed — one was recorded and reversed, and nothing has replaced it
create type public.payout_state as enum ('unpaid', 'paid', 'reversed');

-- ── the other half of the ledger ───────────────────────────────────────────
create table public.distribution_payout_reversals (
  id              uuid primary key default gen_random_uuid(),
  workplace_id    uuid not null references public.workplaces (id) on delete cascade,
  -- restrict on both: a reversal pins the rows it talks about. Neither the
  -- payout it reverses nor the distribution they belong to can be deleted out
  -- from under it.
  payout_id       uuid not null references public.distribution_payouts (id) on delete restrict,
  distribution_id uuid not null references public.tip_distributions (id) on delete restrict,

  reason          public.payout_reversal_reason not null,
  note            text not null,

  reversed_at     timestamptz not null default now(),
  reversed_by     uuid references public.workplace_members (id) on delete set null,
  created_at      timestamptz not null default now(),

  -- Migration 25's definition of blank, not a second opinion about it: every
  -- whitespace character named explicitly, so a note of tabs is not a reason.
  constraint reversals_note_shape
    check (length(app.trimmed_note(note)) between 1 and 500)
);

-- One reversal per payout, and this one IS indexable: it is a single-table fact.
create unique index distribution_payout_reversals_one_per_payout
  on public.distribution_payout_reversals (payout_id);
create index distribution_payout_reversals_workplace_idx
  on public.distribution_payout_reversals (workplace_id, reversed_at desc);
create index distribution_payout_reversals_distribution_idx
  on public.distribution_payout_reversals (distribution_id);

comment on table public.distribution_payout_reversals is
  'Phase 3M: one immutable event saying a recorded payout should no longer count as '
  'settled. It is not a refund, a clawback or a bank reversal — only a correction to '
  'TipCrew''s own record.';

-- ── effectiveness, in one place ────────────────────────────────────────────
create or replace function app.payout_is_effective(p_payout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.distribution_payout_reversals r where r.payout_id = p_payout_id);
$$;

/**
 * The one payout on this distribution that still counts, or null.
 *
 * "Still counts" is the whole vocabulary of this phase: a distribution may
 * carry any number of payout rows over its life, and at most one of them is
 * effective at a time.
 */
create or replace function app.effective_payout(p_distribution_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.distribution_payouts p
  where p.distribution_id = p_distribution_id
    and not exists (
      select 1 from public.distribution_payout_reversals r where r.payout_id = p.id)
  limit 1;
$$;

revoke all on function app.payout_is_effective(uuid) from public;
revoke all on function app.effective_payout(uuid) from public;
grant execute on function app.payout_is_effective(uuid) to authenticated;
grant execute on function app.effective_payout(uuid) to authenticated;

-- ── the invariant migration 26's index used to hold ─────────────────────────
create or replace function app.guard_one_effective_payout()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The lock, first. Two managers, two tabs or a retried request all serialise
  -- on this row, which is what makes the test below atomic rather than a race
  -- somebody eventually loses. record_distribution_payout() takes the same lock;
  -- taking it here too means a direct INSERT cannot skip the ordering.
  perform 1 from public.tip_distributions d where d.id = new.distribution_id for update;

  if exists (
    select 1 from public.distribution_payouts p
    where p.distribution_id = new.distribution_id
      and p.id <> new.id
      and not exists (
        select 1 from public.distribution_payout_reversals r where r.payout_id = p.id))
  then
    raise exception 'this distribution already has a payout that has not been reversed'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop index if exists public.distribution_payouts_one_per_distribution;
create index distribution_payouts_distribution_idx
  on public.distribution_payouts (distribution_id);

create trigger payouts_one_effective
  before insert on public.distribution_payouts
  for each row execute function app.guard_one_effective_payout();

-- ── a reversal is written once and never edited ────────────────────────────
create or replace function app.guard_reversal_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a reversal is a record of a decision; it cannot be edited'
      using errcode = '42501';
  end if;
  raise exception 'a reversal cannot be deleted; it is what explains the payout beside it'
    using errcode = '42501';
end;
$$;

-- No trusted-context escape, exactly as on the payout itself: nothing in this
-- product legitimately edits one, so an escape hatch would only mean "immutable
-- unless you came from the right function".
create trigger reversals_are_immutable
  before update or delete on public.distribution_payout_reversals
  for each row execute function app.guard_reversal_immutable();

-- ── the reversal's own shape, checked at the row ───────────────────────────
create or replace function app.guard_reversal_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pay public.distribution_payouts%rowtype;
begin
  perform 1 from public.tip_distributions d where d.id = new.distribution_id for update;

  select * into v_pay from public.distribution_payouts p where p.id = new.payout_id;
  if v_pay.id is null then
    raise exception 'that payout does not exist' using errcode = '23503';
  end if;
  -- The client sends neither of these; the RPC derives them. Checking anyway
  -- means a row that disagrees with the payout it names cannot exist at all.
  if new.distribution_id <> v_pay.distribution_id or new.workplace_id <> v_pay.workplace_id then
    raise exception 'a reversal belongs to the payout it names, and to nothing else'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger reversals_match_their_payout
  before insert on public.distribution_payout_reversals
  for each row execute function app.guard_reversal_shape();

create trigger audit_distribution_payout_reversals
  after insert or update or delete on public.distribution_payout_reversals
  for each row execute function app.write_audit();

-- ── who may see one ────────────────────────────────────────────────────────
-- Managers of the workplace. An employee is told the STATE of their payout
-- through member_distributions and never reads this table, whose rows name the
-- actor and the internal reason category.
alter table public.distribution_payout_reversals enable row level security;

create policy reversals_read_manager on public.distribution_payout_reversals
  for select to authenticated
  using (app.is_manager(workplace_id));

-- No insert, update or delete policy. The definer RPC is the only way in.

revoke all on public.distribution_payout_reversals from public, anon;
grant select on public.distribution_payout_reversals to authenticated;

-- ── the settlement basis now means EFFECTIVE settlement ────────────────────
-- Byte-for-byte migration 26's walk except that a payout only counts while it
-- has not been reversed. Status is still not filtered: the ancestor is normally
-- cancelled precisely because it was replaced.
create or replace function app.settled_basis(p_distribution_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at    uuid;
  v_hit   uuid;
  v_steps integer := 0;
begin
  select d.supersedes_id into v_at
  from public.tip_distributions d where d.id = p_distribution_id;

  while v_at is not null and v_steps < 64 loop
    v_hit := app.effective_payout(v_at);
    if v_hit is not null then
      return v_at;
    end if;
    select d.supersedes_id into v_at from public.tip_distributions d where d.id = v_at;
    v_steps := v_steps + 1;
  end loop;

  if v_steps >= 64 then
    raise exception 'that replacement chain is too long to settle' using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function app.settled_entitlement(p_distribution_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.entitlement_cents
       from public.distribution_payouts p
      where p.id = app.effective_payout(app.settled_basis(p_distribution_id))),
    0);
$$;

comment on function app.settled_basis(uuid) is
  'Phase 3M: the nearest ancestor whose payout still counts. A reversed payment is '
  'history, not a settlement, so the walk goes past it.';

-- ── is anything downstream standing on this payment? ───────────────────────
/**
 * Whether a later version of this distribution has itself been settled.
 *
 * If one has, its stored previous_entitlement_cents was derived from this
 * payment, and reversing this payment would leave that arithmetic describing a
 * settlement that never happened. The walk goes forward through every
 * descendant, not only the live one: a cancelled version that was paid still
 * counts as money handed over.
 */
create or replace function app.has_settled_descendant(p_distribution_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_found boolean := false;
begin
  with recursive descendants as (
    select d.id, 1 as depth
    from public.tip_distributions d
    where d.supersedes_id = p_distribution_id
    union all
    select d.id, descendants.depth + 1
    from public.tip_distributions d
    join descendants on d.supersedes_id = descendants.id
    where descendants.depth < 64
  )
  select exists (
    select 1 from descendants
    where app.effective_payout(descendants.id) is not null)
  into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function app.has_settled_descendant(uuid) from public;
grant execute on function app.has_settled_descendant(uuid) to authenticated;

-- ── recording a reversal ───────────────────────────────────────────────────
create or replace function public.reverse_distribution_payout(
  p_payout_id uuid,
  p_reason    public.payout_reversal_reason default null,
  p_note      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.distribution_payouts%rowtype;
  v_note  text := app.trimmed_note(p_note);
  v_actor uuid;
  v_id    uuid;
begin
  select * into v_pay from public.distribution_payouts p where p.id = p_payout_id;
  if v_pay.id is null then
    raise exception 'payout not found' using errcode = '42501';
  end if;

  -- The lock that orders this against another reversal, and against a payout
  -- being recorded on the same distribution at the same instant.
  perform 1 from public.tip_distributions d where d.id = v_pay.distribution_id for update;

  if not app.is_manager(v_pay.workplace_id) then
    raise exception 'payout not found' using errcode = '42501';
  end if;
  v_actor := app.member_id(v_pay.workplace_id);

  if p_reason is null then
    raise exception 'say why this payout is being reversed' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'a reversal needs a sentence saying what happened' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'that reason is too long; 500 characters is the limit' using errcode = '22023';
  end if;

  if exists (select 1 from public.distribution_payout_reversals r
             where r.payout_id = p_payout_id) then
    raise exception 'this payout has already been reversed' using errcode = '23505';
  end if;

  -- The safety rule. A later version that has been settled did its arithmetic
  -- against this payment; taking the payment away would make that arithmetic
  -- false. Refuse, and say what has to happen first.
  if app.has_settled_descendant(v_pay.distribution_id) then
    raise exception
      'a later corrected version of this distribution has already been settled against this payment; reverse that one first'
      using errcode = '42501';
  end if;

  insert into public.distribution_payout_reversals
    (workplace_id, payout_id, distribution_id, reason, note, reversed_by)
  values
    (v_pay.workplace_id, p_payout_id, v_pay.distribution_id, p_reason, v_note, v_actor)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'this payout has already been reversed' using errcode = '23505';
end;
$$;

revoke all on function
  public.reverse_distribution_payout(uuid, public.payout_reversal_reason, text) from public;
grant execute on function
  public.reverse_distribution_payout(uuid, public.payout_reversal_reason, text) to authenticated;

comment on function public.reverse_distribution_payout(uuid, public.payout_reversal_reason, text) is
  'Phase 3M: the one way to reverse a payout record. Derives the workplace, the '
  'distribution and the actor from the payout and the session — the client sends a '
  'payout, a reason and a sentence, and nothing else.';

-- ── recording a payout, now that "already paid" can stop being true ────────
-- Migration 26's function with one clause changed: the block is an EFFECTIVE
-- payout, not any payout. Everything else — the lock, the manager test, the
-- status test, the derived amount, the method rule — is unchanged.
create or replace function public.record_distribution_payout(
  p_distribution_id uuid,
  p_method          public.payout_method default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dist     public.tip_distributions%rowtype;
  v_note     text := app.trimmed_note(p_note);
  v_previous bigint;
  v_amount   bigint;
  v_actor    uuid;
  v_id       uuid;
begin
  select * into v_dist from public.tip_distributions
  where id = p_distribution_id for update;

  if v_dist.id is null or not app.is_manager(v_dist.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;

  if v_dist.status = 'draft' then
    raise exception 'a draft has not been sent to anybody; there is nothing to pay yet'
      using errcode = '42501';
  end if;
  if v_dist.status = 'cancelled' then
    raise exception 'this distribution is no longer current; pay the version that replaced it'
      using errcode = '42501';
  end if;

  v_actor := app.member_id(v_dist.workplace_id);

  -- A reversed payout is history and does not stand in the way of a real one.
  if app.effective_payout(p_distribution_id) is not null then
    raise exception 'this distribution has already been marked paid' using errcode = '23505';
  end if;

  -- Derived from what the lineage has EFFECTIVELY settled, which is what makes
  -- a reversal upstream turn a difference back into a full amount.
  v_previous := app.settled_entitlement(p_distribution_id);
  v_amount   := v_dist.entries_total_cents - v_previous;

  if v_amount <> 0 and p_method is null then
    raise exception 'say how this was paid' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'that note is too long; 500 characters is the limit' using errcode = '22023';
  end if;

  insert into public.distribution_payouts (
    workplace_id, distribution_id, entitlement_cents, previous_entitlement_cents,
    amount_cents, method, note, paid_by)
  values (
    v_dist.workplace_id, p_distribution_id, v_dist.entries_total_cents, v_previous,
    v_amount, p_method, v_note, v_actor)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'this distribution has already been marked paid' using errcode = '23505';
end;
$$;

revoke all on function
  public.record_distribution_payout(uuid, public.payout_method, text) from public;
grant execute on function
  public.record_distribution_payout(uuid, public.payout_method, text) to authenticated;

-- ── what the manager reads ─────────────────────────────────────────────────
-- Dropped and rebuilt rather than replaced: `create or replace view` refuses to
-- change a column's type, and payout_status moves from payout_status to
-- payout_state here. Nothing depends on either view, so the drop is local.
drop view if exists public.distribution_settlement;
create view public.distribution_settlement
with (security_invoker = true) as
select
  d.id                              as distribution_id,
  d.workplace_id,
  d.status,
  d.supersedes_id,
  d.entries_total_cents             as entitlement_cents,
  app.settled_entitlement(d.id)     as settled_entitlement_cents,
  -- What is owed RIGHT NOW, which is nothing once this version has a payout that
  -- still counts. Migration 26 computed only "entitlement minus what the
  -- ancestors settled", which is the amount a payout WOULD record — correct
  -- while unpaid, and easy to misread as an outstanding debt on a paid row.
  (case when app.effective_payout(d.id) is not null then 0
        else d.entries_total_cents - app.settled_entitlement(d.id) end)
                                    as settlement_due_cents,
  (case
     when p.id is not null then 'paid'
     when exists (select 1 from public.distribution_payouts q
                  where q.distribution_id = d.id) then 'reversed'
     else 'unpaid'
   end)::public.payout_state        as payout_status,
  p.id                              as payout_id,
  p.amount_cents                    as payout_amount_cents,
  p.method                          as payout_method,
  p.note                            as payout_note,
  p.paid_at,
  p.paid_by,
  m.display_name                    as paid_by_name,
  (select count(*) from public.distribution_payout_reversals r
    where r.distribution_id = d.id) as reversal_count,
  -- Whether the manager may reverse the payment that is standing right now.
  (p.id is not null and not app.has_settled_descendant(d.id)) as can_reverse
from public.tip_distributions d
left join public.distribution_payouts p on p.id = app.effective_payout(d.id)
left join public.workplace_members m on m.id = p.paid_by
where d.status <> 'draft';

comment on view public.distribution_settlement is
  'Phase 3M, manager side: entitlement, what the lineage has EFFECTIVELY settled, what '
  'is still due, and the payout that currently stands. payout_status is read off the '
  'effective event, so paid → reversed → paid again ends at paid.';

revoke all on public.distribution_settlement from public, anon;
grant select on public.distribution_settlement to authenticated;

-- ── every event, in order ──────────────────────────────────────────────────
-- The manager screen must never collapse a payment, its reversal and the
-- payment that replaced it into one "Paid". This is the list that stops it.
create view public.distribution_payout_events
with (security_invoker = true) as
select
  p.distribution_id,
  p.workplace_id,
  p.id                    as payout_id,
  null::uuid              as reversal_id,
  'payout'::text          as kind,
  p.paid_at               as event_at,
  p.amount_cents,
  p.method,
  null::public.payout_reversal_reason as reason,
  p.note,
  m.display_name          as actor_name,
  app.payout_is_effective(p.id) as still_counts
from public.distribution_payouts p
left join public.workplace_members m on m.id = p.paid_by
union all
select
  r.distribution_id,
  r.workplace_id,
  r.payout_id,
  r.id                    as reversal_id,
  'reversal'::text        as kind,
  r.reversed_at           as event_at,
  -- Shown as the negative of what it takes back, so a column of amounts adds up
  -- to what actually still counts as handed over.
  -p.amount_cents         as amount_cents,
  null::public.payout_method as method,
  r.reason,
  r.note,
  m.display_name          as actor_name,
  true                    as still_counts
from public.distribution_payout_reversals r
join public.distribution_payouts p on p.id = r.payout_id
left join public.workplace_members m on m.id = r.reversed_by;

comment on view public.distribution_payout_events is
  'Phase 3M: one row per payout and per reversal, oldest first, with a reversal''s '
  'amount shown negative so the column sums to what still counts as settled.';

revoke all on public.distribution_payout_events from public, anon;
grant select on public.distribution_payout_events to authenticated;

-- ── what the employee is told ──────────────────────────────────────────────
-- Whether it currently counts as paid, how, and when — plus whether the record
-- was ever reversed, because "it said paid last week and says unpaid today"
-- needs an explanation. Still never a figure, and never who.
drop view if exists public.member_distributions;
create view public.member_distributions
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
  and exists (
    select 1 from public.tip_distribution_entries e
    where e.distribution_id = d.id
      and e.member_id = app.member_id(d.workplace_id)
  );

comment on view public.member_distributions is
  'Definer view: a member sees the distributions they have an entry in. payout_status '
  'is the CURRENT state — paid, reversed, or never paid — read off the payout that '
  'still counts, never off the presence of a reversal somewhere in the history.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;
