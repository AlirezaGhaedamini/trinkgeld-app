/**
 * Every Supabase call about shifts. Screens do not query; they call a hook,
 * the hook calls these.
 *
 * WHAT THE BROWSER IS ALLOWED TO SEND
 *
 * An employee's insert names exactly six things: the workplace and member of
 * their own active membership, two instants, a break, and optionally the area
 * they worked. It does not send `status = 'approved'`, a role, review details,
 * `locked`, `source`, `work_date` or `worked_minutes` — the first five are
 * refused by `app.guard_shift_columns()` (migration 14) and the last two are
 * derived by the database. Sending them would be the client asserting things
 * that are not its to assert.
 *
 * Phase 2 created no approve/reject function, so a manager's review is a
 * guarded UPDATE: `shifts_update` restricts it to their own workplace,
 * `app.guard_shift_columns()` lets a manager write the review columns, and
 * `audit_shifts` records before and after. There is no privileged RPC being
 * bypassed here — there is none to bypass.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Membership } from '@/workplace/types';
import { toShift, type Shift, type ShiftDraft } from '@/shifts/types';
import { toShiftInstants } from '@/shifts/time';

/** The signed-in member's own shifts, newest business day first. */
export async function fetchOwnShifts(
  client: TipCrewClient,
  membership: Membership,
  limit = 20,
): Promise<Shift[]> {
  const { data, error } = await client
    .from('shifts')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .eq('member_id', membership.id)
    .order('work_date', { ascending: false })
    .order('starts_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => toShift(row, membership.workplace.timezone));
}

/**
 * Shifts awaiting review in the active workplace, with the member's name and
 * the effective area attached.
 *
 * Three reads rather than a PostgREST embed: the generated types carry no
 * relationship metadata, and RLS filters each of them independently anyway.
 */
export async function fetchReviewQueue(
  client: TipCrewClient,
  membership: Membership,
  statuses: readonly ('draft' | 'submitted' | 'approved' | 'rejected')[] = ['submitted'],
): Promise<Shift[]> {
  const { data: shiftRows, error } = await client
    .from('shifts')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .in('status', [...statuses])
    .order('work_date', { ascending: false })
    .order('starts_at', { ascending: true })
    .limit(200);

  if (error) throw error;
  if (!shiftRows || shiftRows.length === 0) return [];

  const [{ data: memberRows }, { data: areaRows }] = await Promise.all([
    client
      .from('workplace_members')
      .select('id, display_name, area_id')
      .eq('workplace_id', membership.workplaceId),
    client
      .from('workplace_areas')
      .select('id, name, key')
      .eq('workplace_id', membership.workplaceId),
  ]);

  const memberById = new Map((memberRows ?? []).map((m) => [m.id, m]));
  const areaById = new Map((areaRows ?? []).map((a) => [a.id, a]));

  return shiftRows.map((row) => {
    const shift = toShift(row, membership.workplace.timezone);
    const member = memberById.get(row.member_id);
    // effective_area = shift.area_id ?? member.area_id — the Phase 2 rule,
    // resolved for display only. The database resolves it again when it counts.
    const effectiveAreaId = row.area_id ?? member?.area_id ?? null;
    return {
      ...shift,
      memberName: member?.display_name,
      areaName: effectiveAreaId ? areaById.get(effectiveAreaId)?.name : undefined,
      areaFromShift: row.area_id !== null,
    };
  });
}

/** The areas of the active workplace, for an area override the UI may offer. */
export async function fetchAreas(
  client: TipCrewClient,
  workplaceId: string,
): Promise<Array<{ id: string; key: string; name: string }>> {
  const { data, error } = await client
    .from('workplace_areas')
    .select('id, key, name, sort_order')
    .eq('workplace_id', workplaceId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(({ id, key, name }) => ({ id, key, name }));
}

/**
 * Submit a shift.
 *
 * `workplace_id` and `member_id` come from the active membership object, not
 * from anything the screen holds, so there is no code path in which the browser
 * could name another person or another workplace — and if one were written, the
 * insert policy would refuse it.
 */
export async function submitShift(
  client: TipCrewClient,
  membership: Membership,
  draft: ShiftDraft,
  workplace: { timezone: string; businessDayStartHour: number },
): Promise<Shift> {
  const { startsAt, endsAt } = toShiftInstants(
    draft.businessDate,
    draft.startMinutes,
    draft.endMinutes,
    workplace.timezone,
    workplace.businessDayStartHour,
  );

  const { data, error } = await client
    .from('shifts')
    .insert({
      workplace_id: membership.workplaceId,
      member_id: membership.id,
      // NOT NULL with no default, so a value has to be present — but
      // app.shifts_before_write() immediately recomputes it from starts_at
      // with the workplace's timezone and cut-off. The authority is the
      // trigger's; this is only what satisfies the column.
      work_date: draft.businessDate,
      starts_at: startsAt,
      ends_at: endsAt,
      break_minutes: draft.breakMinutes,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      ...(draft.areaId ? { area_id: draft.areaId } : {}),
    })
    .select('*')
    .single();

  if (error) throw error;
  return toShift(data, workplace.timezone);
}

/** Change a shift the employee has already submitted but nobody has approved. */
export async function updateOwnShift(
  client: TipCrewClient,
  membership: Membership,
  shiftId: string,
  draft: ShiftDraft,
  workplace: { timezone: string; businessDayStartHour: number },
): Promise<Shift> {
  const { startsAt, endsAt } = toShiftInstants(
    draft.businessDate,
    draft.startMinutes,
    draft.endMinutes,
    workplace.timezone,
    workplace.businessDayStartHour,
  );

  const { data, error } = await client
    .from('shifts')
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
      break_minutes: draft.breakMinutes,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      ...(draft.areaId !== undefined ? { area_id: draft.areaId } : {}),
    })
    .eq('id', shiftId)
    .eq('member_id', membership.id)
    .select('*')
    .single();

  if (error) throw error;
  return toShift(data, workplace.timezone);
}

/* ── manager review ──────────────────────────────────────────────────────── */

interface ReviewContext {
  membership: Membership;
  note?: string;
}

async function review(
  client: TipCrewClient,
  { membership, note }: ReviewContext,
  shiftId: string,
  status: 'approved' | 'rejected',
): Promise<Shift> {
  const { data, error } = await client
    .from('shifts')
    .update({
      status,
      reviewed_by: membership.id,
      reviewed_at: new Date().toISOString(),
      ...(note !== undefined ? { review_note: note } : {}),
    })
    .eq('id', shiftId)
    .eq('workplace_id', membership.workplaceId)
    .select('*')
    .single();

  if (error) throw error;
  return toShift(data, membership.workplace.timezone);
}

export function approveShift(client: TipCrewClient, membership: Membership, shiftId: string, note?: string) {
  return review(client, { membership, note }, shiftId, 'approved');
}

export function rejectShift(client: TipCrewClient, membership: Membership, shiftId: string, note?: string) {
  return review(client, { membership, note }, shiftId, 'rejected');
}

/**
 * A manager's correction to the end of a shift.
 *
 * The original values are not overwritten silently: `audit_shifts` (migration
 * 13) writes a row with the whole `before` and `after` for every update, so
 * "who changed my hours, and to what" has an answer without a second audit
 * system being invented here.
 */
export async function correctShiftEnd(
  client: TipCrewClient,
  membership: Membership,
  shift: Shift,
  deltaMinutes: number,
): Promise<Shift> {
  const endsAt = new Date(new Date(shift.endsAt).getTime() + deltaMinutes * 60000);
  if (endsAt.getTime() <= new Date(shift.startsAt).getTime()) {
    throw { code: 'CLIENT', message: 'shifts_end_after_start' };
  }

  const { data, error } = await client
    .from('shifts')
    .update({ ends_at: endsAt.toISOString() })
    .eq('id', shift.id)
    .eq('workplace_id', membership.workplaceId)
    .select('*')
    .single();

  if (error) throw error;
  return toShift(data, membership.workplace.timezone);
}

/** Freeze or release a shift. Manager only — the guard enforces it. */
export async function setShiftLocked(
  client: TipCrewClient,
  membership: Membership,
  shiftId: string,
  locked: boolean,
): Promise<Shift> {
  const { data, error } = await client
    .from('shifts')
    .update({ locked })
    .eq('id', shiftId)
    .eq('workplace_id', membership.workplaceId)
    .select('*')
    .single();

  if (error) throw error;
  return toShift(data, membership.workplace.timezone);
}
