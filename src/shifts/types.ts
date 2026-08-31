/**
 * The shift as the screens want it: wall-clock minutes in the workplace's own
 * timezone, the status the database actually stores, and the worked minutes the
 * database actually computed.
 */

import type { Enums, Tables } from '@/types/database';
import { instantToWallMinutes } from '@/shifts/time';

export type ShiftStatus = Enums<'shift_status'>;
export type ShiftSource = Enums<'shift_source'>;

export interface Shift {
  id: string;
  workplaceId: string;
  memberId: string;
  /** The business day, exactly as the database derived it. Never recomputed. */
  workDate: string;
  startsAt: string;
  endsAt: string;
  /** Wall-clock minutes from midnight, in the workplace's zone, for the UI. */
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  /** Generated column: (end − start) − break. Displayed, never calculated here. */
  workedMinutes: number;
  status: ShiftStatus;
  source: ShiftSource;
  locked: boolean;
  areaId: string | null;
  workplaceRoleId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Filled in for the manager's list; the roster is readable to the workplace. */
  memberName?: string;
  areaName?: string;
}

/**
 * `endMinutes` is expressed past midnight when the shift crosses it — 02:00 on
 * the following morning is 1560 — which is the form the hours screen has always
 * used, so an overnight shift reads as one continuous span rather than a
 * negative one.
 */
export function toShift(row: Tables<'shifts'>, timeZone: string): Shift {
  const startMinutes = instantToWallMinutes(row.starts_at, timeZone);
  const rawEnd = instantToWallMinutes(row.ends_at, timeZone);
  const spanMinutes = Math.round(
    (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000,
  );

  return {
    id: row.id,
    workplaceId: row.workplace_id,
    memberId: row.member_id,
    workDate: row.work_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startMinutes,
    endMinutes: rawEnd < startMinutes ? startMinutes + spanMinutes : rawEnd,
    breakMinutes: row.break_minutes,
    workedMinutes: row.worked_minutes ?? 0,
    status: row.status,
    source: row.source,
    locked: row.locked,
    areaId: row.area_id,
    workplaceRoleId: row.workplace_role_id,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
  };
}

/** What the employee is allowed to send. Nothing else is ever in the payload. */
export interface ShiftDraft {
  businessDate: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  /** Optional area override; must belong to the active workplace. */
  areaId?: string | null;
}

export const MIN_SHIFT_MINUTES = 15;
export const MAX_BREAK_MINUTES = 720;

export type ShiftValidation =
  | { ok: true; spanMinutes: number; workedMinutes: number }
  | { ok: false; reason: 'noStart' | 'noEnd' | 'tooShort' | 'tooLong' | 'badBreak' | 'breakTooLong' };

/**
 * The checks worth making before a round trip. Every one of them is also
 * enforced in the database — `shifts_end_after_start`, `shifts_max_length`, the
 * break CHECK and the generated `worked_minutes` — so this is a courtesy to the
 * person typing, not the guarantee.
 */
export function validateDraft(draft: {
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number | null;
}): ShiftValidation {
  if (draft.startMinutes === null) return { ok: false, reason: 'noStart' };
  if (draft.endMinutes === null) return { ok: false, reason: 'noEnd' };

  const breakMinutes = draft.breakMinutes ?? 0;
  if (breakMinutes < 0 || !Number.isFinite(breakMinutes)) return { ok: false, reason: 'badBreak' };
  if (breakMinutes > MAX_BREAK_MINUTES) return { ok: false, reason: 'breakTooLong' };

  let spanMinutes = draft.endMinutes - draft.startMinutes;
  if (spanMinutes <= 0) spanMinutes += 1440;

  if (spanMinutes >= 1440) return { ok: false, reason: 'tooLong' };
  const workedMinutes = spanMinutes - breakMinutes;
  if (workedMinutes < MIN_SHIFT_MINUTES) {
    return { ok: false, reason: breakMinutes >= spanMinutes ? 'breakTooLong' : 'tooShort' };
  }

  return { ok: true, spanMinutes, workedMinutes };
}
