-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3L · payout / paid status
--
-- TipCrew records whether a finalised distribution was actually handed over.
-- Nothing here moves money, talks to a bank, a payroll provider or an accounting
-- system: a payout row is an operational fact a manager asserts — "we paid this"
-- — and is never proof that a transfer settled.
--
-- ── WHY A TABLE AND NOT COLUMNS ────────────────────────────────────────────
-- A payout is an EVENT, and this product has lineages: a paid distribution can
-- be replaced by a corrected one, and what the workplace then owes is the
-- DIFFERENCE, not a second full amount. Columns on tip_distributions would
-- record the latest state; a ledger records what happened, in order, and lets
-- the difference be derived rather than remembered.
--
-- ── THE ARITHMETIC, AND WHY EACH ROW CARRIES IT ────────────────────────────
-- Every row stores three numbers:
--
--     entitlement_cents           what this distribution says the team is owed
--     previous_entitlement_cents  what the lineage had already settled
--     amount_cents                what actually changed hands  (= the difference)
--
-- and a check constraint holds them together, so a row cannot lie about its own
-- arithmetic. The consequence is a telescoping sum: across any lineage, the
-- payout amounts add up to the entitlement of the most recently settled
-- version. €1,000 then +€50 is €1,050 settled — never €2,050.
--
--     A  €1,000  paid   entitlement 1000, previous    0, amount +1000
--     B  €1,050  paid   entitlement 1050, previous 1000, amount   +50
--     C  €1,020  paid   entitlement 1020, previous 1050, amount   -30
--                                                        ─────────────
--                                              sum = 1020 = C's entitlement
--
-- If A had never been paid, B's previous is 0 and B settles the full €1,050.
-- That is the whole distinction between "paid, then replaced" and "never paid,
-- then replaced", and it falls out of one question: which ancestor was settled
-- last.
--
-- ── WHAT THE AUDIT FOUND, AND WHY IT MATTERS HERE ──────────────────────────
-- In THIS product the workplace-level difference between a distribution and its
-- replacement is always zero, and that is structural rather than incidental:
--
--   · a replacement reuses the original's pool (Phase 3J's double-count defence)
--   · app.guard_pool_amounts() freezes a pool's amounts once it is distributed
--   · the engine refuses to write a distribution whose entries do not sum to the
--     pool exactly
--
-- so every version in a lineage has the same pool_cents and the same
-- entries_total_cents. Measured, not assumed: 100000 → 100000 across a
-- correction, while the split moved 61818/38182 → 67692/32308.
--
-- The money that has to move after a correction is therefore PER PERSON —
-- +58.74 to one, -58.74 from another — not per workplace. The workplace-level
-- arithmetic above is still what stops a lineage being paid twice, and still
-- gives the right answer when the original was never paid; the per-person
-- arithmetic in distribution_member_settlement below is what a manager actually
-- has to act on. Both are derived; neither is stored twice.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
-- No undo. A payout is immutable and cannot be reversed by this migration; if
-- the product later needs one it should be an explicit reversal EVENT, not an
-- update or a delete, so the history stays readable. No partial payouts and no
-- per-person payment: nothing in the product supports settling one member and
-- not another, and inventing it would put a second, weaker path next to the
-- lineage arithmetic above. No 'failed' state: TipCrew never learns whether a
-- transfer settled, so it must not pretend to.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── vocabulary ─────────────────────────────────────────────────────────────
-- Only methods a restaurant can answer without thinking. 'other' is the escape
-- hatch that keeps the list short instead of growing it once per workplace.
create type public.payout_method as enum ('cash', 'payroll', 'bank_transfer', 'other');

-- Derived, never stored: the ledger is the only truth about whether something
-- was paid. An enum rather than a boolean so a later state has somewhere to go.
create type public.payout_status as enum ('unpaid', 'paid');

-- ── the ledger ─────────────────────────────────────────────────────────────
create table public.distribution_payouts (
  id                         uuid primary key default gen_random_uuid(),
  workplace_id               uuid not null references public.workplaces (id) on delete cascade,
  -- restrict, not cascade: a settled distribution is pinned in place by the fact
  -- that it was paid. History is not deletable underneath its own ledger.
  distribution_id            uuid not null references public.tip_distributions (id) on delete restrict,

  entitlement_cents          bigint not null,
  previous_entitlement_cents bigint not null,
  amount_cents               bigint not null,

  method                     public.payout_method,
  note                       text,

  paid_at                    timestamptz not null default now(),
  paid_by                    uuid references public.workplace_members (id) on delete set null,
  created_at                 timestamptz not null default now(),

  -- The row proves its own arithmetic.
  constraint payouts_amount_is_the_difference
    check (amount_cents = entitlement_cents - previous_entitlement_cents),
  constraint payouts_entitlement_not_negative
    check (entitlement_cents >= 0 and previous_entitlement_cents >= 0),
  -- A correction worth nothing needs no method: forcing one would record a
  -- transfer that never happened. Anything that did change hands names how.
  constraint payouts_method_when_money_moved
    check (method is not null or amount_cents = 0),
  constraint payouts_note_shape
    check (note is null or length(app.trimmed_note(note)) between 1 and 500)
);

-- Exactly-once, enforced by the database rather than by a disabled button.
-- Two tabs, a double click, a retried request after a timeout: the second write
-- loses here, not in the browser.
create unique index distribution_payouts_one_per_distribution
  on public.distribution_payouts (distribution_id);
create index distribution_payouts_workplace_idx
  on public.distribution_payouts (workplace_id, paid_at desc);

comment on table public.distribution_payouts is
  'Phase 3L: one immutable event per settled distribution. amount_cents is the '
  'difference between this version''s entitlement and whatever the lineage had '
  'already settled, so a correction records a delta and never a second payout.';
comment on column public.distribution_payouts.entitlement_cents is
  'The full corrected total of this distribution, frozen at the moment it was settled.';
comment on column public.distribution_payouts.previous_entitlement_cents is
  'The entitlement of the nearest already-settled ancestor, or 0 if none was ever paid.';
comment on column public.distribution_payouts.amount_cents is
  'What actually changed hands. Negative when a correction reduced the entitlement.';

-- ── the lineage question this phase turns on ───────────────────────────────
-- "How much has this lineage already settled?" Walk backwards through
-- supersedes_id and stop at the first ancestor that has a payout. Nothing is
-- filtered on status: the ancestor is normally 'cancelled' precisely because it
-- was replaced, and that is exactly the row whose payment still counts.
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
    select p.distribution_id into v_hit
    from public.distribution_payouts p where p.distribution_id = v_at;
    if v_hit is not null then
      return v_hit;
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
    (select p.entitlement_cents from public.distribution_payouts p
      where p.distribution_id = app.settled_basis(p_distribution_id)),
    0);
$$;

revoke all on function app.settled_basis(uuid) from public;
revoke all on function app.settled_entitlement(uuid) from public;
grant execute on function app.settled_basis(uuid) to authenticated;
grant execute on function app.settled_entitlement(uuid) to authenticated;

comment on function app.settled_basis(uuid) is
  'Phase 3L: the nearest ancestor of this distribution that has been paid, or null if '
  'nothing in the chain ever was. Status is deliberately not filtered — that ancestor is '
  'normally cancelled precisely because it was replaced, and its payment still counts.';
comment on function app.settled_entitlement(uuid) is
  'Phase 3L: what the lineage behind this distribution has already settled — the '
  'entitlement of app.settled_basis(), or 0. The basis every settlement amount derives from.';

-- ── the ledger is written once and never edited ────────────────────────────
create or replace function app.guard_payout_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception
      'a payout is a record of something that happened; it cannot be edited'
      using errcode = '42501';
  end if;
  raise exception
    'a payout cannot be deleted; record a correction instead'
    using errcode = '42501';
end;
$$;

-- No trusted-context escape. The engine never edits a payout either, so there is
-- nothing legitimate for an escape hatch to let through, and leaving one open
-- would make "immutable" a matter of which function you came from.
create trigger payouts_are_immutable
  before update or delete on public.distribution_payouts
  for each row execute function app.guard_payout_immutable();

create trigger audit_distribution_payouts
  after insert or update or delete on public.distribution_payouts
  for each row execute function app.write_audit();

-- ── who may see it ─────────────────────────────────────────────────────────
-- Managers of the workplace, and nobody else. The amounts on this table are
-- workplace totals: an employee reading them would learn the pool even where
-- workplaces.pool_amount_visible_to_members says they may not. What an employee
-- is allowed to know reaches them through member_distributions below, which
-- carries the status and the method and never a figure.
alter table public.distribution_payouts enable row level security;

create policy payouts_read_manager on public.distribution_payouts
  for select to authenticated
  using (app.is_manager(workplace_id));

-- No insert, update or delete policy exists. The only way in is the definer RPC.

revoke all on public.distribution_payouts from public, anon;
grant select on public.distribution_payouts to authenticated;

-- ── the manager's view of settlement ───────────────────────────────────────
-- Invoker, so it inherits the manager-only visibility of tip_distributions
-- rather than restating it.
create view public.distribution_settlement
with (security_invoker = true) as
select
  d.id                              as distribution_id,
  d.workplace_id,
  d.status,
  d.supersedes_id,
  d.entries_total_cents             as entitlement_cents,
  app.settled_entitlement(d.id)     as settled_entitlement_cents,
  d.entries_total_cents - app.settled_entitlement(d.id) as settlement_due_cents,
  (case when p.id is null then 'unpaid' else 'paid' end)::public.payout_status as payout_status,
  p.id                              as payout_id,
  p.amount_cents                    as payout_amount_cents,
  p.method                          as payout_method,
  p.note                            as payout_note,
  p.paid_at,
  p.paid_by,
  m.display_name                    as paid_by_name
from public.tip_distributions d
left join public.distribution_payouts p on p.distribution_id = d.id
left join public.workplace_members m on m.id = p.paid_by
where d.status <> 'draft';

comment on view public.distribution_settlement is
  'Phase 3L, manager side: entitlement, what the lineage already settled, what is '
  'still due for this version, and the payout event if there is one.';

revoke all on public.distribution_settlement from public, anon;
grant select on public.distribution_settlement to authenticated;

-- ── the difference that actually has to change hands ───────────────────────
-- A correction leaves the workplace total alone and moves money BETWEEN people.
-- This is that movement, per member, against whichever version the lineage last
-- settled — or against nothing, if it never settled one, in which case each
-- member's full share is still owed.
--
-- Invoker, so it inherits the entries policy: a manager sees the whole team, and
-- an employee sees exactly the rows that policy already lets them see, which is
-- their own share plus whatever workplaces.peer_entry_visibility permits.
create view public.distribution_member_settlement
with (security_invoker = true) as
select
  d.id                                              as distribution_id,
  d.workplace_id,
  m.member_id,
  coalesce(cur.name, was.name)                      as member_name,
  coalesce(cur.cents, 0)                            as entitlement_cents,
  coalesce(was.cents, 0)                            as previously_settled_cents,
  coalesce(cur.cents, 0) - coalesce(was.cents, 0)   as difference_cents
from public.tip_distributions d
cross join lateral (
  select e.member_id from public.tip_distribution_entries e where e.distribution_id = d.id
  union
  select e.member_id from public.tip_distribution_entries e
    where e.distribution_id = app.settled_basis(d.id)
) m
left join lateral (
  select sum(e.amount_cents) as cents, max(e.member_name) as name
  from public.tip_distribution_entries e
  where e.distribution_id = d.id and e.member_id = m.member_id
) cur on true
left join lateral (
  select sum(e.amount_cents) as cents, max(e.member_name) as name
  from public.tip_distribution_entries e
  where e.distribution_id = app.settled_basis(d.id) and e.member_id = m.member_id
) was on true
where d.status <> 'draft';

comment on view public.distribution_member_settlement is
  'Phase 3L: per member, what this version says they get, what the lineage already '
  'settled for them, and the difference. Someone who left the team between versions '
  'appears with an entitlement of zero and a negative difference, rather than vanishing.';

revoke all on public.distribution_member_settlement from public, anon;
grant select on public.distribution_member_settlement to authenticated;

-- ── recording a payout ─────────────────────────────────────────────────────
-- The browser sends a distribution, a method and an optional note. It does NOT
-- send an amount: the amount is derived here, from the distribution's own
-- entitlement and its lineage, because it is the one number in this product
-- that a client must never be able to choose.
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
  -- The lock serialises two managers, two tabs and a retried request: the second
  -- one waits here and then finds the payout the first one wrote.
  select * into v_dist from public.tip_distributions
  where id = p_distribution_id for update;

  if v_dist.id is null or not app.is_manager(v_dist.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;

  -- Only a live financial record. A draft has been shown to nobody; a cancelled
  -- one is either abandoned or already replaced, and paying it now would settle
  -- a version the team was told is no longer theirs.
  if v_dist.status = 'draft' then
    raise exception 'a draft has not been sent to anybody; there is nothing to pay yet'
      using errcode = '42501';
  end if;
  if v_dist.status = 'cancelled' then
    raise exception 'this distribution is no longer current; pay the version that replaced it'
      using errcode = '42501';
  end if;

  v_actor := app.member_id(v_dist.workplace_id);

  if exists (select 1 from public.distribution_payouts p
             where p.distribution_id = p_distribution_id) then
    raise exception 'this distribution has already been marked paid' using errcode = '23505';
  end if;

  v_previous := app.settled_entitlement(p_distribution_id);
  v_amount   := v_dist.entries_total_cents - v_previous;

  -- A method is how something was handed over. Nothing is handed over when the
  -- correction is worth nothing, so nothing has to be named.
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
    -- Two callers got past the check at the same instant. One of them wrote the
    -- row; both get the same answer, so a retry never reads as a new payment.
    raise exception 'this distribution has already been marked paid' using errcode = '23505';
end;
$$;

revoke all on function
  public.record_distribution_payout(uuid, public.payout_method, text) from public;
grant execute on function
  public.record_distribution_payout(uuid, public.payout_method, text) to authenticated;

comment on function public.record_distribution_payout(uuid, public.payout_method, text) is
  'Phase 3L: the one way to record a payout. Derives the actor from the session and '
  'the amount from the distribution and its lineage — the client chooses neither.';

-- ── what the employee is told ──────────────────────────────────────────────
-- Whether it was paid, how, and when. Never a figure: entitlement_cents and
-- amount_cents are workplace totals. An employee works out their own correction
-- difference from their own entries on this version and on settled_basis_id,
-- both of which they may already read.
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
  d.correction_note,
  (case when p.id is null then 'unpaid' else 'paid' end)::public.payout_status as payout_status,
  p.method  as payout_method,
  p.paid_at as paid_at,
  -- The version whose payment this one is being corrected against, so the
  -- employee's own "previously settled" figure comes from their own entries.
  app.settled_basis(d.id) as settled_basis_id
from public.tip_distributions d
join public.workplaces w on w.id = d.workplace_id
left join public.distribution_payouts p on p.distribution_id = d.id
where d.status <> 'draft'
  and exists (
    select 1 from public.tip_distribution_entries e
    where e.distribution_id = d.id
      and e.member_id = app.member_id(d.workplace_id)
  );

comment on view public.member_distributions is
  'Definer view: a member sees the distributions they have an entry in. pool_cents '
  'is null unless the workplace releases it; correction_reason/note say why a manager '
  'corrected it — never who or when. payout_status/method/paid_at say whether it was '
  'settled; settled_basis_id names the version it was settled against, so a member can '
  'work out their own correction difference from their own entries and nobody else''s.';

revoke all on public.member_distributions from public, anon;
grant select on public.member_distributions to authenticated;
