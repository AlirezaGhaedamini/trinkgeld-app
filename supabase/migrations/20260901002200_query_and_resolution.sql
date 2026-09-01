-- ═════════════════════════════════════════════════════════════════════════════
-- 22 · The query loop.
--
-- Phase 3H gave an employee two answers — confirm, or query — and then had
-- nowhere for the second one to go. A query set a status and a note on the
-- entry, and nobody could act on it. This migration closes that loop, and fixes
-- four things the audit found wrong along the way.
--
--   1 · A queried entry did not count as open. The auto-confirm in both
--       acknowledge RPCs counted only 'pending', so one person disputing their
--       share still let the distribution flip to 'confirmed'. A query is an
--       open question; it is now counted as one.
--
--   2 · An employee could answer their own query. Nothing stopped a queried
--       entry going straight back to 'acknowledged' by the person who raised
--       it, which quietly erased the dispute. The manager resolves first.
--
--   3 · A cancelled distribution was writable. app.distribution_is_published()
--       means 'not a draft', and was doing duty as both "may be read" and "may
--       be answered". Those are different questions and now have different
--       functions.
--
--   4 · There was nowhere to record what the manager did about it. Resolution
--       state does not belong on the financial rows, so it gets its own small
--       table — one row per member per distribution, never per entry.
--
-- What this migration does NOT do: correct anything. A sent distribution stays
-- immutable. An outcome of 'correction_required' records the manager's finding
-- and stops there; replacement distributions are Phase 3J.
-- ═════════════════════════════════════════════════════════════════════════════

create type public.query_status  as enum ('open', 'resolved');
create type public.query_outcome as enum ('no_correction', 'correction_required');

-- ── the record of a question, and what was done about it ───────────────────
-- One row per member per distribution — not per entry. Somebody who worked two
-- areas asks one question about their share, not two.
create table public.distribution_queries (
  id               uuid primary key default gen_random_uuid(),
  workplace_id     uuid not null references public.workplaces (id) on delete cascade,
  distribution_id  uuid not null references public.tip_distributions (id) on delete cascade,
  member_id        uuid not null references public.workplace_members (id) on delete restrict,

  -- Snapshot, exactly like the entries: a later rename must not rewrite the
  -- name attached to a question somebody asked months ago.
  member_name      text not null,

  note             text not null check (length(btrim(note)) between 1 and 500),
  raised_at        timestamptz not null default now(),

  status           public.query_status not null default 'open',
  outcome          public.query_outcome,
  manager_response text check (manager_response is null or length(btrim(manager_response)) <= 500),
  resolved_at      timestamptz,
  resolved_by      uuid references public.workplace_members (id) on delete set null,

  created_at       timestamptz not null default now(),

  -- A resolved row must say how, and an open row must not pretend to.
  constraint queries_resolution_coherent check (
    (status = 'open'     and outcome is null and resolved_at is null and resolved_by is null)
    or
    (status = 'resolved' and outcome is not null and resolved_at is not null)
  )
);

-- One open question per person per distribution. Asking again while one is open
-- updates the note rather than stacking rows; asking after a resolution opens a
-- new one, so the history of a long-running dispute is a list, not an overwrite.
create unique index distribution_queries_open_key
  on public.distribution_queries (distribution_id, member_id)
  where status = 'open';
create index distribution_queries_distribution_idx
  on public.distribution_queries (distribution_id, status);

-- The employee's words are theirs. Nothing may edit them afterwards — not the
-- manager, not the resolve RPC, not the owner of the table. No trusted-context
-- escape here on purpose: this guard has no exceptions.
create or replace function app.guard_query_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.note, new.member_id, new.distribution_id, new.workplace_id, new.raised_at)
     is distinct from
     (old.note, old.member_id, old.distribution_id, old.workplace_id, old.raised_at)
  then
    raise exception 'the question as it was asked cannot be edited'
      using errcode = '42501';
  end if;
  if old.status = 'resolved' and new.status = 'open' then
    raise exception 'a resolved question is not reopened; ask a new one'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger distribution_queries_immutable
  before update on public.distribution_queries
  for each row execute function app.guard_query_immutable();

create trigger audit_distribution_queries
  after insert or update or delete on public.distribution_queries
  for each row execute function app.write_audit();

-- Acknowledgement is the only thing an entry lets anybody change, so auditing
-- updates there is auditing exactly the answers — without the noise of one row
-- per entry at calculation time.
create trigger audit_entry_acknowledgement
  after update on public.tip_distribution_entries
  for each row execute function app.write_audit();

alter table public.distribution_queries enable row level security;

-- Readable by the manager, and by the person who asked. There is deliberately
-- no insert, update or delete policy: every write goes through the definer
-- functions below, so an employee cannot write a resolution and a manager
-- cannot write somebody's question.
create policy queries_select on public.distribution_queries
  for select to authenticated
  using (
    app.is_manager(workplace_id)
    or member_id = app.member_id(workplace_id)
  );

revoke all on public.distribution_queries from public, anon;
grant select on public.distribution_queries to authenticated;

-- ── readable is not the same as answerable ─────────────────────────────────
-- app.distribution_is_published() stays exactly as it was: it answers "is this
-- visible", and a cancelled distribution still is. Whether it may be *answered*
-- is a different question, and this is it.
create or replace function app.distribution_is_actionable(p_distribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tip_distributions d
    where d.id = p_distribution_id and d.status in ('sent', 'confirmed')
  )
$$;

revoke all on function app.distribution_is_actionable(uuid) from public;
grant execute on function app.distribution_is_actionable(uuid) to authenticated, service_role;

-- The direct PostgREST path must refuse what the RPCs refuse. Republished here
-- so a cancelled distribution is read-only through every door.
drop policy if exists entries_update_own_ack on public.tip_distribution_entries;
create policy entries_update_own_ack on public.tip_distribution_entries
  for update to authenticated
  using (
    member_id = app.member_id(workplace_id)
    and app.distribution_is_actionable(distribution_id)
  )
  with check (member_id = app.member_id(workplace_id));

-- ── how many answers are still outstanding ─────────────────────────────────
-- Both acknowledge RPCs and the resolver share this, so the count that closes a
-- distribution and the count the manager reads can never disagree. A query is
-- open; a placeholder with no account is not.
create or replace function app.open_answers(p_distribution_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.tip_distribution_entries e
  join public.workplace_members m on m.id = e.member_id
  where e.distribution_id = p_distribution_id
    and m.user_id is not null
    and e.ack_status in ('pending', 'queried')
$$;

revoke all on function app.open_answers(uuid) from public;
grant execute on function app.open_answers(uuid) to authenticated, service_role;

-- ── why a queried entry cannot be confirmed ────────────────────────────────
-- Always raises. Which sentence depends on what the manager has done, because
-- "your question is still open" and "your manager is redoing this one" are
-- different situations and the person deserves the true one.
create or replace function app.refuse_confirm_while_queried(
  p_distribution_id uuid, p_member_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outcome public.query_outcome;
  v_status  public.query_status;
begin
  select q.status, q.outcome into v_status, v_outcome
  from public.distribution_queries q
  where q.distribution_id = p_distribution_id and q.member_id = p_member_id
  order by q.raised_at desc
  limit 1;

  if v_status = 'resolved' and v_outcome = 'correction_required' then
    raise exception 'your manager is correcting this one; there is nothing to confirm yet'
      using errcode = '42501';
  end if;
  raise exception 'your question is still open; your manager answers it before you confirm'
    using errcode = '42501';
end;
$$;

revoke all on function app.refuse_confirm_while_queried(uuid, uuid) from public;
grant execute on function app.refuse_confirm_while_queried(uuid, uuid) to authenticated, service_role;

-- ── acknowledging, with the two corrections ────────────────────────────────
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
begin
  select * into v_entry from public.tip_distribution_entries where id = p_entry_id for update;
  if v_entry.id is null or v_entry.member_id is distinct from app.member_id(v_entry.workplace_id) then
    raise exception 'entry not found' using errcode = '42501';
  end if;
  if p_status not in ('acknowledged', 'queried') then
    raise exception 'an entry can only be acknowledged or queried' using errcode = '22023';
  end if;
  if not app.distribution_is_actionable(v_entry.distribution_id) then
    raise exception 'this distribution is not open for answers' using errcode = '42501';
  end if;

  -- You cannot answer your own question. The entry's own state is the test,
  -- not whether a query row is open: resolving with 'no_correction' puts it
  -- back to pending and lets this through, while resolving with
  -- 'correction_required' deliberately leaves it queried, because nobody should
  -- be asked to confirm a share their manager agrees is wrong.
  if p_status = 'acknowledged' and v_entry.ack_status = 'queried' then
    perform app.refuse_confirm_while_queried(v_entry.distribution_id, v_entry.member_id);
  end if;

  if p_status = 'queried' then
    perform app.raise_query(v_entry.distribution_id, v_entry.member_id, p_note);
  end if;

  update public.tip_distribution_entries
  set ack_status      = p_status,
      acknowledged_at = case when p_status = 'acknowledged'
                             then coalesce(acknowledged_at, now()) else acknowledged_at end,
      queried_at      = case when p_status = 'queried'
                             then coalesce(queried_at, now()) else queried_at end,
      query_note      = case when p_status = 'queried'
                             then nullif(pg_catalog.btrim(coalesce(p_note, '')), '') else query_note end
  where distribution_id = v_entry.distribution_id
    and member_id = v_entry.member_id;

  if app.open_answers(v_entry.distribution_id) = 0 then
    update public.tip_distributions
    set status = 'confirmed', confirmed_at = now()
    where id = v_entry.distribution_id and status = 'sent';
  end if;
end;
$$;

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
begin
  select d.workplace_id into v_workplace
  from public.tip_distributions d where d.id = p_distribution_id;
  if v_workplace is null then
    raise exception 'distribution not found' using errcode = '42501';
  end if;

  v_member := app.member_id(v_workplace);
  if v_member is null then
    raise exception 'your access to this workplace is paused or has ended'
      using errcode = '42501';
  end if;
  if p_status not in ('acknowledged', 'queried') then
    raise exception 'an entry can only be acknowledged or queried' using errcode = '22023';
  end if;
  if not app.distribution_is_actionable(p_distribution_id) then
    raise exception 'this distribution is not open for answers' using errcode = '42501';
  end if;
  if p_status = 'acknowledged' and exists (
    select 1 from public.tip_distribution_entries e
    where e.distribution_id = p_distribution_id and e.member_id = v_member
      and e.ack_status = 'queried')
  then
    perform app.refuse_confirm_while_queried(p_distribution_id, v_member);
  end if;

  if p_status = 'queried' then
    perform app.raise_query(p_distribution_id, v_member, p_note);
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

  if app.open_answers(p_distribution_id) = 0 then
    update public.tip_distributions
    set status = 'confirmed', confirmed_at = now()
    where id = p_distribution_id and status = 'sent';
  end if;

  return v_touched;
end;
$$;

-- ── raising the question ───────────────────────────────────────────────────
-- Internal, so both acknowledge paths and query_distribution() write the record
-- the same way. Asking again while a question is open replaces the words, not
-- the row, and never touches when it was first asked.
create or replace function app.raise_query(
  p_distribution_id uuid, p_member_id uuid, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note  text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_name  text;
  v_wp    uuid;
  v_id    uuid;
begin
  if v_note is null then
    raise exception 'a question needs a sentence saying what looks wrong'
      using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'that question is too long; 500 characters is the limit'
      using errcode = '22023';
  end if;

  select e.workplace_id, e.member_name into v_wp, v_name
  from public.tip_distribution_entries e
  where e.distribution_id = p_distribution_id and e.member_id = p_member_id
  limit 1;
  if v_wp is null then
    raise exception 'entry not found' using errcode = '42501';
  end if;

  -- Asking again while a question is open is accepted and changes nothing: the
  -- words somebody used the first time are the record, and re-tapping a button
  -- is not a reason to rewrite them. `do nothing` returns no row, so the
  -- existing one is read back.
  insert into public.distribution_queries
    (workplace_id, distribution_id, member_id, member_name, note)
  values (v_wp, p_distribution_id, p_member_id, coalesce(v_name, 'Member'), v_note)
  on conflict (distribution_id, member_id) where (status = 'open')
  do nothing
  returning id into v_id;

  if v_id is null then
    select q.id into v_id from public.distribution_queries q
    where q.distribution_id = p_distribution_id and q.member_id = p_member_id
      and q.status = 'open';
  end if;

  return v_id;
end;
$$;

-- ── the employee's action ──────────────────────────────────────────────────
-- One call for the whole distribution, exactly like confirming: the browser
-- sends a distribution id and a sentence, and which entries that means is
-- decided here from auth.uid().
create or replace function public.query_distribution(
  p_distribution_id uuid, p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.acknowledge_distribution(p_distribution_id, 'queried', p_note);
end;
$$;

-- ── the manager's answer ───────────────────────────────────────────────────
-- 'no_correction' puts that person's entries back to pending, so they confirm
-- for themselves — the manager never marks anybody acknowledged.
-- 'correction_required' records that the manager agrees something is wrong and
-- leaves the entries queried, because a share the manager believes is wrong is
-- not something to ask somebody to confirm. The sent distribution is untouched
-- either way; replacing it is Phase 3J.
create or replace function public.resolve_query(
  p_query_id uuid, p_outcome public.query_outcome, p_response text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query    public.distribution_queries%rowtype;
  v_response text := nullif(pg_catalog.btrim(coalesce(p_response, '')), '');
begin
  select * into v_query from public.distribution_queries where id = p_query_id for update;
  if v_query.id is null or not app.is_manager(v_query.workplace_id) then
    raise exception 'question not found' using errcode = '42501';
  end if;
  if v_query.status <> 'open' then
    raise exception 'this question has already been answered' using errcode = '42501';
  end if;
  if v_response is not null and length(v_response) > 500 then
    raise exception 'that answer is too long; 500 characters is the limit'
      using errcode = '22023';
  end if;

  update public.distribution_queries
  set status = 'resolved', outcome = p_outcome, manager_response = v_response,
      resolved_at = now(), resolved_by = app.member_id(v_query.workplace_id)
  where id = p_query_id;

  if p_outcome = 'no_correction' then
    update public.tip_distribution_entries
    set ack_status = 'pending'
    where distribution_id = v_query.distribution_id
      and member_id = v_query.member_id
      and ack_status = 'queried';
  end if;
end;
$$;

-- ── what the manager reads ─────────────────────────────────────────────────
create or replace function public.distribution_query_list(p_distribution_id uuid)
returns table (
  query_id         uuid,
  member_id        uuid,
  member_name      text,
  note             text,
  raised_at        timestamptz,
  status           public.query_status,
  outcome          public.query_outcome,
  manager_response text,
  resolved_at      timestamptz,
  amount_cents     bigint
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
    raise exception 'only a manager of this workplace may read its questions'
      using errcode = '42501';
  end if;

  return query
  select q.id, q.member_id, q.member_name, q.note, q.raised_at,
         q.status, q.outcome, q.manager_response, q.resolved_at,
         -- sum(bigint) is numeric; the column this returns into is bigint.
         (select coalesce(sum(e.amount_cents), 0)::bigint
            from public.tip_distribution_entries e
           where e.distribution_id = q.distribution_id and e.member_id = q.member_id)
  from public.distribution_queries q
  where q.distribution_id = p_distribution_id
  order by q.status, q.raised_at;
end;
$$;

revoke all on function
  app.raise_query(uuid, uuid, text),
  public.query_distribution(uuid, text),
  public.resolve_query(uuid, public.query_outcome, text),
  public.distribution_query_list(uuid)
from public;

grant execute on function
  public.query_distribution(uuid, text),
  public.resolve_query(uuid, public.query_outcome, text),
  public.distribution_query_list(uuid)
to authenticated;

comment on table public.distribution_queries is
  'Migration 22: one question per member per distribution, with the manager''s answer. '
  'Kept off the financial rows on purpose; the note is immutable once asked.';
comment on function app.open_answers(uuid) is
  'Migration 22: entries still owing an answer — pending OR queried. A question is an open '
  'question, so one person disputing their share stops the distribution auto-confirming.';
comment on function app.distribution_is_actionable(uuid) is
  'Migration 22: may this distribution still be answered. Distinct from '
  'app.distribution_is_published(), which asks only whether it may be read — a cancelled '
  'distribution stays visible and stops accepting answers.';
