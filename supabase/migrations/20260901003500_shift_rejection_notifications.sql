-- ─────────────────────────────────────────────────────────────────────────────
-- 35 · Phase 3R-D · a shift sent back tells the person whose shift it is
--
-- The manual release test found the gap: a manager rejects a shift, the
-- employee is never told, and by the time they look the night has moved out of
-- the two the hours form can open. The client side of that (a deep link to the
-- exact shift) needs no schema. This side does: the inbox has no way to say
-- "your shift", so this migration gives it one.
--
-- ── WHO, AND WHO NOT ───────────────────────────────────────────────────────
-- Exactly the member whose shift was sent back, and only if they can be told
-- (app.notifiable_members: an active membership with an account). No manager
-- hears about it — they did it — and no colleague does.
--
-- ── WHAT IT CARRIES ────────────────────────────────────────────────────────
-- The business date, and nothing else. The manager's note is NOT copied here.
-- It lives on the shift, where the employee reads it through their own row
-- policy when the deep link opens the shift, and where the manager's next
-- decision overwrites it. Copying prose into an immutable row would freeze a
-- sentence the manager may later replace.
--
-- ── IDENTITY, AND A SECOND REJECTION ───────────────────────────────────────
-- The dedupe index gains shift_id at the front of its coalesce, so the
-- identity of this event is (member, 'shift_rejected', shift). A shift can be
-- rejected, corrected, resubmitted and rejected AGAIN; there is no review
-- history table to key a second row on, and a second inbox row for the same
-- shift would say nothing the first does not. So V1 keeps ONE row per shift
-- and re-arms it: a repeat rejection sets read_at back to null. That is the
-- one column app.guard_notification_immutable() lets move, so the re-arm is
-- inside the existing rule rather than an exception to it; the row's id,
-- created_at and payload never change.
--
-- ── WHY TWO MIGRATIONS ─────────────────────────────────────────────────────
-- Migration 34 added the enum value and nothing else, because a value added
-- inside a transaction cannot be used in that transaction. This file is the
-- first transaction in which 'shift_rejected' may be spelled.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the source column ──────────────────────────────────────────────────────
-- Cascade, like every other source reference on this table: a notification is
-- about its source row and has no meaning without it. (No client can delete a
-- rejected shift anyway — the only delete policy is the owner's own draft.)
alter table public.member_notifications
  add column shift_id uuid references public.shifts (id) on delete cascade;

comment on column public.member_notifications.shift_id is
  'Phase 3R-D: the shift a shift_rejected row is about. Null for every other type.';

create index member_notifications_shift_idx
  on public.member_notifications (shift_id)
  where shift_id is not null;

-- ── the shape rule, with the new branch ────────────────────────────────────
-- Every existing branch now also demands shift_id IS NULL, so a money event
-- can never point at a shift, and the new branch demands the reverse.
alter table public.member_notifications drop constraint notifications_source_shape;

alter table public.member_notifications add constraint notifications_source_shape check (
  case type
    when 'distribution_sent'      then distribution_id is not null
                                   and query_id is null and payout_id is null and reversal_id is null
                                   and shift_id is null
    when 'distribution_corrected' then distribution_id is not null
                                   and query_id is null and payout_id is null and reversal_id is null
                                   and shift_id is null
    when 'query_raised'           then query_id is not null and distribution_id is not null
                                   and payout_id is null and reversal_id is null
                                   and shift_id is null
    when 'query_resolved'         then query_id is not null and distribution_id is not null
                                   and payout_id is null and reversal_id is null
                                   and shift_id is null
    when 'payout_recorded'        then payout_id is not null and distribution_id is not null
                                   and query_id is null and reversal_id is null
                                   and shift_id is null
    when 'payout_reversed'        then reversal_id is not null and payout_id is not null
                                   and distribution_id is not null and query_id is null
                                   and shift_id is null
    when 'shift_rejected'         then shift_id is not null
                                   and distribution_id is null and query_id is null
                                   and payout_id is null and reversal_id is null
    -- A type this constraint does not know has no valid shape. Adding an enum
    -- value without adding its branch here is refused, never silently allowed.
    else false
  end
);

-- ── identity ───────────────────────────────────────────────────────────────
-- shift_id first: it is the most specific source a shift_rejected row has, and
-- it is null for every other type, so the existing identities are unchanged.
drop index public.member_notifications_dedupe;

create unique index member_notifications_dedupe
  on public.member_notifications
     (member_id, type, coalesce(shift_id, reversal_id, payout_id, query_id, distribution_id));

-- ── the guard learns the new column ────────────────────────────────────────
-- Same rule as migration 30, one more column in the tuple: only read_at moves.
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
      new.query_id, new.payout_id, new.reversal_id, new.shift_id, new.payload, new.created_at)
     is distinct from
     (old.id, old.workplace_id, old.member_id, old.type, old.distribution_id,
      old.query_id, old.payout_id, old.reversal_id, old.shift_id, old.payload, old.created_at)
  then
    raise exception 'a notification is not editable; only whether it has been read can change'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ── the writer, republished with the new source ────────────────────────────
-- A parameter list cannot be extended with CREATE OR REPLACE, so the function
-- is dropped and recreated with p_shift_id appended and defaulted. Migration
-- 30's five trigger functions pass named arguments and resolve this by name at
-- run time, so they keep working unchanged.
drop function app.notify_members(uuid, uuid[], public.notification_type,
  uuid, uuid, uuid, uuid, jsonb);

create function app.notify_members(
  p_workplace_id    uuid,
  p_member_ids      uuid[],
  p_type            public.notification_type,
  p_distribution_id uuid default null,
  p_query_id        uuid default null,
  p_payout_id       uuid default null,
  p_reversal_id     uuid default null,
  p_payload         jsonb default '{}'::jsonb,
  p_shift_id        uuid default null
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
    (workplace_id, member_id, type, distribution_id, query_id, payout_id, reversal_id, shift_id, payload)
  select p_workplace_id, m, p_type, p_distribution_id, p_query_id, p_payout_id, p_reversal_id,
         p_shift_id, coalesce(p_payload, '{}'::jsonb)
  from unnest(p_member_ids) as m
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.notify_members(uuid, uuid[], public.notification_type,
  uuid, uuid, uuid, uuid, jsonb, uuid) from public;

comment on function app.notify_members(uuid, uuid[], public.notification_type,
  uuid, uuid, uuid, uuid, jsonb, uuid) is
  'Phase 3O: the only inserter. SECURITY DEFINER because it writes a table no client may '
  'write — it makes no decision from current_user, so this is not the INVOKER case the '
  'guard triggers document. Migration 35 added p_shift_id for shift_rejected.';

-- ── 7 · a shift was sent back ──────────────────────────────────────────────
/**
 * To the person whose shift it is, and to nobody else.
 *
 * Fires on the transition INTO rejected, whoever made it — the row policy
 * already limits that to a manager of the workplace (an employee's WITH CHECK
 * allows only draft and submitted). A repeat rejection of the same shift after
 * a correction collides on the dedupe index and inserts nothing; the UPDATE
 * that follows re-arms the existing row by clearing read_at. That is the only
 * column the immutability guard permits to change, so this function needs no
 * escape from it and gets none.
 */
create or replace function app.notify_shift_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
begin
  v_members := app.notifiable_members(array[new.member_id]);

  perform app.notify_members(
    new.workplace_id, v_members, 'shift_rejected',
    p_shift_id => new.id,
    -- The business date only. The note stays on the shift, behind the
    -- employee's own row policy, where the next decision may replace it.
    p_payload  => jsonb_build_object('work_date', new.work_date));

  -- Rejected again after a resubmission: the same row, unread again. The
  -- WHERE keeps the first rejection, and an unread repeat, from touching the
  -- row at all.
  update public.member_notifications
     set read_at = null
   where type = 'shift_rejected'
     and shift_id = new.id
     and member_id = any(v_members)
     and read_at is not null;

  return null;
end;
$$;

revoke all on function app.notify_shift_rejected() from public;

comment on function app.notify_shift_rejected() is
  'Phase 3R-D: tells the member whose shift was sent back — and only them. One row per '
  'shift; a repeat rejection re-arms it (read_at = null) instead of adding a second.';

create trigger shifts_notify_rejected
  after update on public.shifts
  for each row
  when (new.status = 'rejected' and old.status is distinct from 'rejected')
  execute function app.notify_shift_rejected();

comment on trigger shifts_notify_rejected on public.shifts is
  'Phase 3R-D: the transition into rejected notifies the shift''s own member. The '
  'rejection itself is already on audit_log through audit_shifts (migration 13).';
