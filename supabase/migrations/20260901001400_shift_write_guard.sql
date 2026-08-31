-- ═════════════════════════════════════════════════════════════════════════════
-- 14 · the shift write guard
--
-- WHY THIS EXISTS
--
-- Migration 08 gave shifts a sound row-level policy: an employee may write
-- their own shift while it is not approved and not locked, and the WITH CHECK
-- stops them setting `status = 'approved'`. That covers *which rows* they may
-- touch, but RLS cannot say *which columns*, and three of the columns on this
-- table are not theirs to write:
--
--   workplace_role_id  decides the weighting used for the shift. The engine in
--                      migration 11 reads coalesce(sh.workplace_role_id, …) and
--                      turns it into `points`, which is money. An employee who
--                      could name their own role on their own shift could pick
--                      the best-paid role in their area and be approved on the
--                      hours, which is what a manager actually checks.
--   reviewed_by /      the record of who checked the shift and when. Writable
--   reviewed_at /      by the person being checked, it means nothing.
--   review_note
--   locked             a manager's freeze. An employee could set it, or clear
--                      their own — the existing locked guard only fires when
--                      the row is ALREADY locked, so setting it was open.
--   source             claims a shift came from a manager or an import.
--
-- Nothing here restricts the area override: `area_id` is the employee saying
-- which area they actually worked, which migration 08 designed for and which a
-- manager reviews before approving. `app.shifts_before_write()` still enforces
-- that a named role belongs to the effective area.
--
-- SECURITY INVOKER on purpose, as with every other guard in this schema: as
-- DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard entirely.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.guard_shift_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Our own SECURITY DEFINER functions are trusted; a client is not.
  if app.is_trusted_context() then
    return new;
  end if;

  -- A manager of this workplace may write all of it.
  if app.is_manager(new.workplace_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.workplace_role_id is not null then
      raise exception 'only a manager may set the role for a shift' using errcode = '42501';
    end if;
    if new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null then
      raise exception 'review details are written by the reviewing manager' using errcode = '42501';
    end if;
    if new.locked then
      raise exception 'only a manager may lock a shift' using errcode = '42501';
    end if;
    if new.source <> 'employee' then
      raise exception 'a shift entered here is an employee shift' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE. The identity of a shift never changes under a non-manager.
  if new.workplace_id is distinct from old.workplace_id
     or new.member_id is distinct from old.member_id then
    raise exception 'a shift cannot be moved to another member or workplace' using errcode = '42501';
  end if;

  if new.workplace_role_id is distinct from old.workplace_role_id then
    raise exception 'only a manager may change the role for a shift' using errcode = '42501';
  end if;
  if new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_note is distinct from old.review_note then
    raise exception 'review details are written by the reviewing manager' using errcode = '42501';
  end if;
  if new.locked is distinct from old.locked then
    raise exception 'only a manager may lock or unlock a shift' using errcode = '42501';
  end if;
  if new.source is distinct from old.source then
    raise exception 'the source of a shift is not editable' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.guard_shift_columns() is
  'Column-level guard for shifts: RLS decides which rows a person may write, '
  'this decides which columns. Manager-only columns are the ones that decide '
  'weighting, review and locking.';

create trigger shifts_column_guard
  before insert or update on public.shifts
  for each row execute function app.guard_shift_columns();

-- ── the same question for tip reports ───────────────────────────────────────
-- tip_reports has no manager-only column, but its policies let a member write
-- rows for their own membership only. That is already column-safe: every
-- column on the table is theirs to state. Nothing to guard here — recorded so
-- the omission is a decision rather than an oversight.
