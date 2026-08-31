/**
 * Shift and tip-report failures, translated.
 *
 * The database says things like `23P01 conflicting key value violates exclusion
 * constraint "shifts_no_member_overlap"`. A server reads "You already have a
 * shift that overlaps this one."
 */

import type { StringKey } from '@/i18n/strings';

export type ShiftFailure =
  | 'overlap'
  | 'invalidRange'
  | 'tooLong'
  | 'breakTooLong'
  | 'notAllowed'
  | 'alreadyReviewed'
  | 'locked'
  | 'staleShift'
  | 'areaMismatch'
  | 'noMembership'
  | 'network'
  | 'notConfigured'
  | 'invalidAmount'
  | 'duplicateReport'
  | 'unknown';

export const SHIFT_FAILURE_KEY: Record<ShiftFailure, StringKey> = {
  overlap: 'shErrOverlap',
  invalidRange: 'shErrRange',
  tooLong: 'shErrTooLong',
  breakTooLong: 'shErrBreak',
  notAllowed: 'shErrNotAllowed',
  alreadyReviewed: 'shErrReviewed',
  locked: 'shErrLocked',
  staleShift: 'shErrStale',
  areaMismatch: 'shErrArea',
  noMembership: 'shErrNoMembership',
  network: 'authNetwork',
  notConfigured: 'authNotConfigured',
  invalidAmount: 'shErrAmount',
  duplicateReport: 'shErrDuplicateReport',
  unknown: 'authUnknown',
};

interface PostgrestErrorish {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  name?: string;
}

export function classifyShiftError(error: unknown): ShiftFailure {
  if (!error) return 'unknown';
  const e = error as PostgrestErrorish;
  const message = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  const code = e.code ?? '';

  if (
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }

  // 23P01: the gist exclusion constraint — one person, two places at once.
  if (code === '23P01' || message.includes('shifts_no_member_overlap')) return 'overlap';
  if (message.includes('tip_reports_member_day_key')) return 'duplicateReport';
  if (code === '23505') return 'duplicateReport';

  if (message.includes('shifts_end_after_start')) return 'invalidRange';
  if (message.includes('shifts_max_length')) return 'tooLong';
  if (message.includes('break_minutes')) return 'breakTooLong';

  if (message.includes('this shift is locked')) return 'locked';
  if (message.includes('effective area') || message.includes('area belongs to a different workplace')) {
    return 'areaMismatch';
  }
  if (message.includes('role belongs to a different workplace')) return 'areaMismatch';
  if (message.includes('only a manager')) return 'notAllowed';
  if (message.includes('review details are written')) return 'notAllowed';
  if (message.includes('unknown member') || message.includes('different workplace')) {
    return 'noMembership';
  }

  // 42501 from RLS, and PGRST's own "no rows matched" on a filtered write.
  if (code === '42501' || code === 'PGRST301' || code === '42P01') return 'notAllowed';
  if (code === 'PGRST116') return 'staleShift';

  return 'unknown';
}
