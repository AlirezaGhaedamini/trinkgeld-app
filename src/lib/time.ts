import type { OverlapGrouping, OverlapRow, ShiftTimes } from '@/types';

/** Minutes in a day. Anything past this belongs to the next calendar day. */
export const MINUTES_PER_DAY = 1440;

/** Format minutes-from-midnight as a 24h clock, wrapping past midnight. */
export function formatClock(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Parse "17:30" into minutes from midnight. Returns null when unparseable. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** Worked time: the span minus the break, never negative. */
export function workedMinutes(times: ShiftTimes | undefined): number {
  if (!times) return 0;
  return Math.max(0, times.endMinutes - times.startMinutes - (times.breakMinutes || 0));
}

/** Minutes two shifts were both running. Zero when they never met. */
export function overlapMinutes(a: ShiftTimes, b: ShiftTimes): number {
  return Math.max(0, Math.min(a.endMinutes, b.endMinutes) - Math.max(a.startMinutes, b.startMinutes));
}

/** Decimal hours, for display and for the units calculation. */
export function toHours(minutes: number): number {
  return minutes / 60;
}

/**
 * Who worked this shift together.
 *
 * The night's *anchor* is the longest effective shift. Everyone else has to
 * share at least `minOverlap` minutes with that anchor to join the pool — the
 * rule that keeps a lunch shift out of the evening's tips. Ties on length are
 * broken by the earlier start, so the grouping is deterministic.
 */
export function groupByOverlap(
  hours: Record<string, ShiftTimes>,
  names: Record<string, string>,
  minOverlap: number,
): OverlapGrouping {
  const worked: OverlapRow[] = Object.entries(hours)
    .filter(([, times]) => workedMinutes(times) > 0)
    .map(([employeeId, times]) => ({
      employeeId,
      name: names[employeeId] ?? employeeId,
      times,
      workedMinutes: workedMinutes(times),
      overlapMinutes: 0,
      isAnchor: false,
      included: false,
    }));

  if (worked.length === 0) return { anchor: null, rows: [] };

  const anchor = [...worked].sort(
    (a, b) => b.workedMinutes - a.workedMinutes || a.times.startMinutes - b.times.startMinutes,
  )[0];

  const rows = worked.map((row) => {
    const isAnchor = row.employeeId === anchor.employeeId;
    const overlap = isAnchor ? row.workedMinutes : overlapMinutes(row.times, anchor.times);
    return {
      ...row,
      overlapMinutes: overlap,
      isAnchor,
      included: isAnchor || overlap >= minOverlap,
    };
  });

  return { anchor: rows.find((r) => r.isAnchor) ?? null, rows };
}
