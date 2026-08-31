/**
 * Wall-clock → instant, in the WORKPLACE's timezone.
 *
 * The browser's own timezone is never consulted. A manager in Berlin reviewing
 * from a hotel in Bangkok must see the same shift on the same night, and the
 * database derives `work_date` from `starts_at` using
 * `workplaces.timezone` and `business_day_start_hour` — so the client has to
 * build the instant in that same zone or the two will disagree by a day.
 *
 * There is no date library here on purpose: `Intl.DateTimeFormat` already knows
 * every IANA zone and its DST history, and the whole conversion is fifteen
 * lines.
 */

/** Minutes the given zone is ahead of UTC at that instant. */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // What the wall clock in that zone reads, expressed as if it were UTC.
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return (asUtc - utcMs) / 60000;
}

/**
 * The instant at which a given wall-clock time occurs in a given zone.
 *
 * Two passes: guess, measure the offset that guess landed in, correct, then
 * re-measure in case the correction crossed a DST boundary.
 */
export function zonedWallClockToInstant(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const first = zoneOffsetMinutes(guess, timeZone);
  let instant = guess - first * 60000;
  const second = zoneOffsetMinutes(instant, timeZone);
  if (second !== first) instant = guess - second * 60000;
  return new Date(instant);
}

/** "2026-08-22" → its three numbers, with no timezone in the way. */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/** Add whole days to an ISO date string, staying in plain calendar arithmetic. */
export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Today's date in a given zone, as YYYY-MM-DD. */
export function todayInZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * The business day in progress right now — the same arithmetic
 * `app.business_day()` does in SQL, so the default date the app offers matches
 * the one the database will derive.
 */
export function currentBusinessDate(
  timeZone: string,
  businessDayStartHour: number,
  now = new Date(),
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  const hour = Number(value('hour')) % 24;
  return hour < businessDayStartHour ? addDays(date, -1) : date;
}

export interface ShiftInstants {
  startsAt: string;
  endsAt: string;
  /** Elapsed minutes between the two instants, before the break. */
  spanMinutes: number;
}

/**
 * Turn what the person typed into the two instants the database stores.
 *
 * `startMinutes` and `endMinutes` are minutes from midnight of the shift day,
 * the form the screens have always used. Two rules do all the work:
 *
 *   The start defines the night. If it falls before the workplace's cut-off
 *   hour it belongs to the following calendar day — 01:00 on a business day
 *   with a 05:00 cut-off is the small hours of the NEXT morning, which is why
 *   `app.business_day()` will hand back the date the person chose.
 *
 *   The end is the start plus the elapsed time, not a second wall-clock
 *   lookup. 18:00 → 02:00 is eight hours whether or not the clocks changed in
 *   between, and elapsed time is what somebody is paid for.
 */
export function toShiftInstants(
  businessDate: string,
  startMinutes: number,
  endMinutes: number,
  timeZone: string,
  businessDayStartHour: number,
): ShiftInstants {
  const cutoff = businessDayStartHour * 60;

  const startDayOffset = Math.floor(startMinutes / 1440);
  const startInDay = ((startMinutes % 1440) + 1440) % 1440;
  const calendarDate = addDays(
    businessDate,
    startDayOffset + (startInDay < cutoff ? 1 : 0),
  );

  const { year, month, day } = parseIsoDate(calendarDate);
  const start = zonedWallClockToInstant(year, month, day, startInDay, timeZone);

  let spanMinutes = endMinutes - startMinutes;
  if (spanMinutes <= 0) spanMinutes += 1440; // crossed midnight
  const end = new Date(start.getTime() + spanMinutes * 60000);

  return { startsAt: start.toISOString(), endsAt: end.toISOString(), spanMinutes };
}

/** An instant back to minutes from midnight, in the workplace's zone. */
export function instantToWallMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (value('hour') % 24) * 60 + value('minute');
}
