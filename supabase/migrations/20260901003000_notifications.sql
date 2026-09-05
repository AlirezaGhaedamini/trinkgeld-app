-- ─────────────────────────────────────────────────────────────────────────────
-- 30 · Phase 3O · in-app notifications
--
-- TipCrew tells a person when something that concerns THEM happened. Six events,
-- no more: a share arrived, a share was corrected, a question was answered, a
-- payment was recorded, a payment record was taken back, and — for managers —
-- somebody asked about their share.
--
-- ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
-- Not an activity feed. audit_log is already the authoritative history and its
-- `before`/`after` columns are full row images; projecting them at a person
-- would hand out pool totals and colleagues' hours. Not realtime, not email,
-- not push. A workplace produces about one distribution a night, so polling on
-- mount is enough and every one of those channels is infrastructure this
-- product does not have.
--
-- ── THE PRIVACY RULE THAT SHAPES THE WHOLE TABLE ───────────────────────────
-- A notification carries NO MONEY. Not the pool, not a payout amount, not a
-- peer's share. It says "your share for 3 September is ready" and the figure is
-- read live through member_distributions when the screen renders. That keeps
-- workplaces.pool_amount_visible_to_members and peer_entry_visibility enforced
-- in exactly one place. Copying an amount in here would make the inbox a second,
-- weaker path to money and would defeat the separation migration 10 built on
-- purpose. It also carries no auth user id, no actor and no correction note.
--
-- ── NO PROSE IN THE DATABASE ───────────────────────────────────────────────
-- A typed event plus a tiny payload of neutral rendering facts. The sentence is
-- built by src/i18n/strings.ts, so German and English stay in one place and a
-- wording fix is not a data migration.
--
-- ── DEDUPLICATION IS AGAINST THE SOURCE EVENT, NOT THE DISTRIBUTION ────────
-- The obvious key (member_id, type, distribution_id) is WRONG, in two sequences
-- that really happen:
--
--   · payout → reversal → repayout. record_distribution_payout() blocks only on
--     an EFFECTIVE payout, so a second payment on the same distribution is
--     legitimate. That key would collapse the second and lose a real financial
--     event.
--   · question → resolve → question again → resolve. Its unique index is
--     `where status = 'open'`, so a member may raise a new one after each
--     resolution. That key would collapse the second answer.
--
-- So each row names the SOURCE ROW it was born from, and the unique index is an
-- expression over whichever source that type uses. Repeating the same source
-- event is idempotent; two distinct events stay two rows.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.notification_type as enum (
  'distribution_sent',
  'distribution_corrected',
  'query_resolved',
  'payout_recorded',
  'payout_reversed',
  'query_raised'
);

-- ── the inbox ──────────────────────────────────────────────────────────────
create table public.member_notifications (
  id              uuid primary key default gen_random_uuid(),
  workplace_id    uuid not null references public.workplaces (id) on delete cascade,

  -- The recipient is a MEMBERSHIP, not a user. One person may belong to several
  -- workplaces, each with its own inbox and its own badge, and app.member_id()
  -- already requires status = 'active', so suspension removes access without
  -- deleting anything.
  --
  -- RESTRICT, not CASCADE. A membership is never physically deleted anywhere in
  -- this product: there is no delete policy on workplace_members, no migration
  -- deletes one, and src/team/queries.ts removes people with status = 'left'.
  -- Every other SUBJECT reference to a membership restricts for the same reason
  -- (shifts, tip_reports, tip_distribution_entries, distribution_queries);
  -- only ACTOR columns use set null. Cascade here would be inconsistent with
  -- all of them and would silently destroy a person's history.
  member_id       uuid not null references public.workplace_members (id) on delete restrict,

  type            public.notification_type not null,

  -- The source event this notification IS. Exactly which one is required is
  -- decided per type by notifications_source_shape below, and the unique index
  -- keys on it, so identity comes from the event rather than from the subject.
  distribution_id uuid references public.tip_distributions (id) on delete cascade,
  query_id        uuid references public.distribution_queries (id) on delete cascade,
  payout_id       uuid references public.distribution_payouts (id) on delete cascade,
  reversal_id     uuid references public.distribution_payout_reversals (id) on delete cascade,

  -- Neutral rendering facts only: a business date, a period. Never an amount,
  -- never a note, never a peer's name on an employee-facing row.
  payload         jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  read_at         timestamptz,

  -- A type cannot exist without the reference its identity depends on, so the
  -- deduplication index can never key on null and silently collapse rows.
  constraint notifications_source_shape check (
    case type
      when 'distribution_sent'      then distribution_id is not null
                                     and query_id is null and payout_id is null and reversal_id is null
      when 'distribution_corrected' then distribution_id is not null
                                     and query_id is null and payout_id is null and reversal_id is null
      when 'query_raised'           then query_id is not null and distribution_id is not null
                                     and payout_id is null and reversal_id is null
      when 'query_resolved'         then query_id is not null and distribution_id is not null
                                     and payout_id is null and reversal_id is null
      when 'payout_recorded'        then payout_id is not null and distribution_id is not null
                                     and query_id is null and reversal_id is null
      when 'payout_reversed'        then reversal_id is not null and payout_id is not null
                                     and distribution_id is not null and query_id is null
      -- A type this constraint does not know has no valid shape. Adding an enum
      -- value without adding its branch here is refused, never silently allowed.
      else false
    end
  )
);

-- One row per recipient per event. coalesce picks the most specific source the
-- type carries, so a repeated trigger for the SAME event collides here, while a
-- second genuine payout or a second answered question does not.
create unique index member_notifications_dedupe
  on public.member_notifications
     (member_id, type, coalesce(reversal_id, payout_id, query_id, distribution_id));

create index member_notifications_inbox_idx
  on public.member_notifications (member_id, created_at desc);
create index member_notifications_unread_idx
  on public.member_notifications (member_id)
  where read_at is null;
create index member_notifications_workplace_idx
  on public.member_notifications (workplace_id, created_at desc);

comment on table public.member_notifications is
  'Phase 3O: one row per recipient per event. Carries no money, no actor and no auth id — '
  'the figure is read live from member_distributions when the screen renders, so the inbox '
  'can never become a second path to something the privacy rules hide.';

-- ── only read_at ever moves ────────────────────────────────────────────────
-- NO trusted-context escape, exactly as on payouts (26), reversals (27) and
-- period closes (28). The mark-read RPCs only ever write read_at, so there is
-- nothing legitimate for an escape to let through, and leaving one open would
-- make "immutable" a question of which function you arrived from.
create or replace function app.guard_notification_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a notification is a record of something that happened; it cannot be deleted'
      using errcode = '42501';
  end if;

  if (new.id, new.workplace_id, new.member_id, new.type, new.distribution_id,
      new.query_id, new.payout_id, new.reversal_id, new.payload, new.created_at)
     is distinct from
     (old.id, old.workplace_id, old.member_id, old.type, old.distribution_id,
      old.query_id, old.payout_id, old.reversal_id, old.payload, old.created_at)
  then
    raise exception 'a notification is not editable; only whether it has been read can change'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger notifications_are_immutable
  before update or delete on public.member_notifications
  for each row execute function app.guard_notification_immutable();

-- ── who may look ───────────────────────────────────────────────────────────
alter table public.member_notifications enable row level security;

-- An inbox is personal. A manager has no policy to read anybody else's, which
-- is deliberate: oversight is what audit_log is for. app.member_id() resolves
-- from auth.uid() and requires status = 'active', so a suspended or departed
-- member loses access while the history stays on the record.
create policy notifications_read_own on public.member_notifications
  for select to authenticated
  using (member_id = app.member_id(workplace_id));

-- No insert, update or delete policy exists, and no such privilege is granted:
-- a direct PATCH or POST is refused at the privilege layer before RLS is even
-- consulted. The definer triggers write; the two RPCs below move read_at.
revoke all on public.member_notifications from public, anon;
grant select on public.member_notifications to authenticated;

-- ── the writer ─────────────────────────────────────────────────────────────
/**
 * Insert one notification per recipient, ignoring anyone already told.
 *
 * SECURITY DEFINER, and that is NOT the mistake the guard triggers warn about.
 * A guard must be INVOKER because it asks who the caller is; this asks nothing
 * about the caller and simply writes into a table no client may write. As
 * INVOKER it could not insert at all.
 *
 * `on conflict do nothing` against the dedup index makes a repeated trigger for
 * the same source event a no-op rather than an error, so nothing upstream has to
 * remember whether it already fired.
 */
create or replace function app.notify_members(
  p_workplace_id    uuid,
  p_member_ids      uuid[],
  p_type            public.notification_type,
  p_distribution_id uuid default null,
  p_query_id        uuid default null,
  p_payout_id       uuid default null,
  p_reversal_id     uuid default null,
  p_payload         jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_member_ids is null or pg_catalog.array_length(p_member_ids, 1) is null then
    return 0;
  end if;

  insert into public.member_notifications
    (workplace_id, member_id, type, distribution_id, query_id, payout_id, reversal_id, payload)
  select p_workplace_id, m, p_type, p_distribution_id, p_query_id, p_payout_id, p_reversal_id,
         coalesce(p_payload, '{}'::jsonb)
  from unnest(p_member_ids) as m
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.notify_members(uuid, uuid[], public.notification_type,
  uuid, uuid, uuid, uuid, jsonb) from public;

comment on function app.notify_members(uuid, uuid[], public.notification_type,
  uuid, uuid, uuid, uuid, jsonb) is
  'Phase 3O: the only writer. SECURITY DEFINER because it writes a table no client may '
  'write — it makes no decision from current_user, so this is not the INVOKER case the '
  'guard triggers document.';

/**
 * Who can actually be told.
 *
 * A roster placeholder has no account, so there is nobody to notify and a row
 * for them would be unreadable for ever and would inflate a badge the moment
 * somebody claimed the membership. This is the same set distribution_ack_state()
 * calls `can_acknowledge` and app.open_answers() counts, so the product has one
 * definition of "a person who can answer".
 */
create or replace function app.notifiable_members(p_member_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[])
  from public.workplace_members m
  where m.id = any(p_member_ids)
    and m.user_id is not null
    and m.status = 'active'
$$;

revoke all on function app.notifiable_members(uuid[]) from public;

-- ── 1 + 2 · a distribution reaches the team ────────────────────────────────
-- Fires when a draft is published, never when one is calculated: a draft has
-- been shown to nobody. `distribution_corrected` when it supersedes something,
-- `distribution_sent` when it is the first version of that night.
--
-- WHO A CORRECTION REACHES. The people in the replacement, and ALSO the people
-- in the version it replaces. A member can vanish from a correction entirely —
-- their hours were rejected, or their area moved to a zero share — and reading
-- only the new version's entries would leave exactly that person, the one whose
-- share fell to nothing, as the one person never told. They still hold an
-- entry on the retired version, which they can read, and the notification
-- names the replacement so the screen can walk the lineage from there.
create or replace function app.notify_distribution_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
  v_type    public.notification_type;
begin
  select app.notifiable_members(pg_catalog.array_agg(distinct e.member_id))
  into v_members
  from public.tip_distribution_entries e
  where e.distribution_id = new.id
     or (new.supersedes_id is not null and e.distribution_id = new.supersedes_id);

  v_type := case when new.supersedes_id is not null
                 then 'distribution_corrected' else 'distribution_sent' end;

  perform app.notify_members(
    new.workplace_id, v_members, v_type,
    p_distribution_id => new.id,
    -- The business date only. The amount is read live from member_distributions.
    p_payload => jsonb_build_object('period_start', new.period_start,
                                    'period_end', new.period_end));
  return null;
end;
$$;

create trigger distributions_notify_sent
  after update on public.tip_distributions
  for each row
  when (new.status = 'sent' and old.status is distinct from 'sent')
  execute function app.notify_distribution_sent();

-- ── 3 · somebody asked ─────────────────────────────────────────────────────
-- Every active manager, except the person asking: a manager holds entries too
-- and may query their own share, and telling them about their own question is
-- noise.
create or replace function app.notify_query_raised()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_managers uuid[];
  v_period   date;
begin
  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[]) into v_managers
  from public.workplace_members m
  where m.workplace_id = new.workplace_id
    and m.role = 'manager' and m.status = 'active'
    and m.user_id is not null
    and m.id <> new.member_id;

  select d.period_start into v_period
  from public.tip_distributions d where d.id = new.distribution_id;

  perform app.notify_members(
    new.workplace_id, v_managers, 'query_raised',
    p_distribution_id => new.distribution_id,
    p_query_id        => new.id,
    -- A manager may already read the roster, so the asker's snapshot name is
    -- nothing new to them. An employee never receives this type.
    p_payload => jsonb_build_object('member_name', new.member_name,
                                    'period_start', v_period));
  return null;
end;
$$;

create trigger queries_notify_raised
  after insert on public.distribution_queries
  for each row execute function app.notify_query_raised();

-- ── 4 · the manager answered ───────────────────────────────────────────────
-- To the person who asked, and to nobody else. The outcome travels in the
-- payload because it decides the sentence: 'no_correction' hands the
-- confirmation back, 'correction_required' says a corrected version is coming.
create or replace function app.notify_query_resolved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
begin
  select d.period_start into v_period
  from public.tip_distributions d where d.id = new.distribution_id;

  perform app.notify_members(
    new.workplace_id, array[new.member_id], 'query_resolved',
    p_distribution_id => new.distribution_id,
    p_query_id        => new.id,
    p_payload => jsonb_build_object('outcome', new.outcome, 'period_start', v_period));
  return null;
end;
$$;

create trigger queries_notify_resolved
  after update on public.distribution_queries
  for each row
  when (new.status = 'resolved' and old.status is distinct from 'resolved')
  execute function app.notify_query_resolved();

-- ── 5 · a payment was recorded ─────────────────────────────────────────────
/**
 * Only the people whose OWN settlement moved.
 *
 * Phase 3L's finding is that a replacement reuses the original's pool, so the
 * workplace-level difference across a correction is always zero while the money
 * moves BETWEEN people. Telling somebody whose own share did not change that
 * they were "paid" would be false. So the recipient set is computed per member:
 * their total on this version against their total on the version the lineage
 * had already settled, which is 0 when nothing was ever settled.
 *
 * That one rule covers both cases. On a first payout there is no settled basis,
 * so every member's difference is their whole share and everybody is told. On a
 * correction to a settled lineage only those up or down hear about it.
 *
 * app.settled_basis() walks ANCESTORS, so the payout being inserted here does
 * not affect it.
 */
create or replace function app.notify_payout_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis   uuid;
  v_members uuid[];
  v_period  date;
begin
  v_basis := app.settled_basis(new.distribution_id);

  select coalesce(pg_catalog.array_agg(t.member_id), '{}'::uuid[]) into v_members
  from (
    select e.member_id, sum(e.amount_cents) as now_cents,
           coalesce((select sum(b.amount_cents)
                       from public.tip_distribution_entries b
                      where b.distribution_id = v_basis
                        and b.member_id = e.member_id), 0) as was_cents
    from public.tip_distribution_entries e
    where e.distribution_id = new.distribution_id
    group by e.member_id
  ) t
  where t.now_cents <> t.was_cents;

  select d.period_start into v_period
  from public.tip_distributions d where d.id = new.distribution_id;

  perform app.notify_members(
    new.workplace_id, app.notifiable_members(v_members), 'payout_recorded',
    p_distribution_id => new.distribution_id,
    p_payout_id       => new.id,
    -- The method is how it was handed over, not how much. No amount here.
    p_payload => jsonb_build_object('method', new.method, 'period_start', v_period));
  return null;
end;
$$;

create trigger payouts_notify_recorded
  after insert on public.distribution_payouts
  for each row execute function app.notify_payout_recorded();

-- ── 6 · that payment record was taken back ─────────────────────────────────
/**
 * Exactly the people who were told about the payment being reversed.
 *
 * Read straight off the notifications that payout produced, which guarantees
 * symmetry: nobody is told a payment was taken back when they were never told
 * it happened, and nobody who was told is left thinking they are still paid.
 * It stays correct across payout → reversal → repayout, because each payout has
 * its own recipient set keyed by its own payout_id.
 *
 * The copy this feeds must stay neutral. A reversal corrects TIPCREW'S RECORD.
 * It does not recover cash, reverse a transfer or payslip, and never means the
 * employee owes anything back.
 */
create or replace function app.notify_payout_reversed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
  v_period  date;
begin
  select coalesce(pg_catalog.array_agg(n.member_id), '{}'::uuid[]) into v_members
  from public.member_notifications n
  where n.payout_id = new.payout_id
    and n.type = 'payout_recorded';

  select d.period_start into v_period
  from public.tip_distributions d where d.id = new.distribution_id;

  perform app.notify_members(
    new.workplace_id, app.notifiable_members(v_members), 'payout_reversed',
    p_distribution_id => new.distribution_id,
    p_payout_id       => new.payout_id,
    p_reversal_id     => new.id,
    p_payload => jsonb_build_object('period_start', v_period));
  return null;
end;
$$;

create trigger reversals_notify_reversed
  after insert on public.distribution_payout_reversals
  for each row execute function app.notify_payout_reversed();

-- ── the only client write doors ────────────────────────────────────────────
-- One door each, as Phase 3H learned: two paths that refuse different things is
-- how a hole gets left open. There is no update policy and no update privilege,
-- so these definer functions are the whole of it.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.member_notifications%rowtype;
begin
  select * into v_row from public.member_notifications where id = p_notification_id;
  if v_row.id is null or v_row.member_id is distinct from app.member_id(v_row.workplace_id) then
    -- Same answer for "no such row" and "not yours": a notification id must not
    -- be a probe for whether somebody else received something.
    raise exception 'notification not found' using errcode = '42501';
  end if;

  -- coalesce, not now(): the moment it was first read is a fact about the past
  -- and re-reading changes nothing.
  update public.member_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;
end;
$$;

create or replace function public.mark_all_notifications_read(p_workplace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member  uuid;
  v_touched integer;
begin
  v_member := app.member_id(p_workplace_id);
  if v_member is null then
    raise exception 'your access to this workplace is paused or has ended'
      using errcode = '42501';
  end if;

  update public.member_notifications
  set read_at = coalesce(read_at, now())
  where member_id = v_member
    and workplace_id = p_workplace_id
    and read_at is null;

  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

comment on function public.mark_notification_read(uuid) is
  'Phase 3O: the only way a client moves read_at on one row. Derives the recipient from '
  'the session, so a notification id belonging to somebody else is refused as not found.';
comment on function public.mark_all_notifications_read(uuid) is
  'Phase 3O: marks the caller''s unread notifications in ONE workplace read. Scoped to the '
  'caller''s membership, so a person in two workplaces clears one inbox at a time.';
