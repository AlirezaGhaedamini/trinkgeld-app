/**
 * The business day, as the server decides it.
 *
 * `app.business_day(now(), workplace)` is the one definition of "which night
 * is this" — the workplace's timezone minus its cut-off hour — and every shift
 * is filed under it. Phase 3R-B stops the browser mirroring that arithmetic
 * from the device clock for anything financial: the date a report is filed
 * under and the date a pool is opened for both come from here.
 */

export type BusinessDayStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BusinessDayValue {
  /** False in demo mode or without an active workplace: no request is ever made. */
  enabled: boolean;
  status: BusinessDayStatus;
  /** YYYY-MM-DD in the workplace's own calendar, or null until the server answered. */
  date: string | null;
  /** The workplace the date belongs to, so a consumer can see a switch coming. */
  workplaceId: string | null;
  refresh: () => Promise<void>;
}
