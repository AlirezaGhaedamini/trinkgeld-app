import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useBusinessDay } from '@/hooks/useBusinessDay';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyShiftError, type ShiftFailure } from '@/shifts/errors';
import {
  approveShift,
  correctShiftEnd,
  fetchOwnShift,
  fetchOwnShifts,
  fetchReviewQueue,
  rejectShift,
  setShiftLocked,
  submitShift,
  updateOwnShift,
} from '@/shifts/queries';
import type { Shift, ShiftDraft } from '@/shifts/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The one shift the hours screen was asked to open, and how that went. */
export type FocusStatus = 'idle' | 'loading' | 'ready' | 'notFound' | 'error';

/** A uuid as PostgREST accepts one; anything else is "no such shift" without a round trip. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShiftActionResult {
  ok: boolean;
  failure?: ShiftFailure;
  shift?: Shift;
}

function useClient(): TipCrewClient | null {
  const [client] = useState<TipCrewClient | null>(() => {
    if (!isSupabaseConfigured()) return null;
    try {
      return getSupabase();
    } catch {
      return null;
    }
  });
  return client;
}

/**
 * One hook per screen rather than a global shift store.
 *
 * Shifts are read on the two screens that show them and written from three
 * actions; a provider around the whole app would buy nothing and would have to
 * be invalidated from everywhere. The workplace layer stays the single source
 * for identity — every call here takes the active membership from it, so no
 * screen is ever in a position to name a member or a workplace itself.
 *
 * `focusId` is the shift the screen was asked to open — from a notification
 * or from a row in the log. It is fetched by id under the same membership,
 * separately from the recent list, so a shift older than the list's window
 * still opens, and an id that is not this member's in this workplace comes
 * back as `notFound` rather than as somebody else's row.
 */
export function useOwnShifts(options: { focusId?: string | null } = {}) {
  const focusId = options.focusId ?? null;
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const enabled = Boolean(client) && workplace.enabled && membership !== null;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<{ status: FocusStatus; shift: Shift | null }>({
    status: 'idle',
    shift: null,
  });
  const alive = useRef(true);
  const token = useRef(0);
  const focusToken = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !membership) return;
    const mine = (token.current += 1);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const rows = await fetchOwnShifts(client, membership);
      if (!alive.current || mine !== token.current) return;
      setShifts(rows);
      setStatus('ready');
    } catch {
      if (!alive.current || mine !== token.current) return;
      setStatus('error');
    }
  }, [client, membership]);

  useEffect(() => {
    if (!enabled) {
      setShifts((current) => (current.length === 0 ? current : []));
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const loadFocused = useCallback(async () => {
    const mine = (focusToken.current += 1);
    if (!client || !membership || !focusId) {
      setFocused({ status: 'idle', shift: null });
      return;
    }
    if (!UUID.test(focusId)) {
      setFocused({ status: 'notFound', shift: null });
      return;
    }
    // Re-reading the shift already shown keeps it on screen meanwhile.
    setFocused((f) => (f.shift?.id === focusId ? f : { status: 'loading', shift: null }));
    try {
      const shift = await fetchOwnShift(client, membership, focusId);
      if (!alive.current || mine !== focusToken.current) return;
      setFocused(shift ? { status: 'ready', shift } : { status: 'notFound', shift: null });
    } catch {
      if (!alive.current || mine !== focusToken.current) return;
      setFocused({ status: 'error', shift: null });
    }
  }, [client, membership, focusId]);

  /* The disabled branches here and above return the SAME value when there is
     nothing to clear. React bails out of a re-render on an unchanged state
     value, and a fresh `[]` or `{}` would not be unchanged: any future day on
     which `refresh`/`loadFocused` lose reference stability would turn these
     effects into render -> setState -> render, which React ends with
     "Maximum update depth exceeded" — and with no error boundary in the app
     that is a blank screen, the very failure this phase is closing. */
  useEffect(() => {
    if (!enabled) {
      setFocused((current) =>
        current.status === 'idle' && current.shift === null
          ? current
          : { status: 'idle', shift: null },
      );
      return;
    }
    void loadFocused();
  }, [enabled, loadFocused]);

  /**
   * The business day currently in progress — the server's answer (migration
   * 33), null until it has arrived. The form offers this night and the one
   * before it; the database still derives every shift's work_date from its
   * instants, so this decides only which night the person is shown.
   */
  const businessDay = useBusinessDay();
  const businessDate = businessDay.date;

  const submit = useCallback(
    async (draft: ShiftDraft, existingId?: string): Promise<ShiftActionResult> => {
      if (!client || !membership) return { ok: false, failure: 'notConfigured' };
      setBusy(true);
      try {
        const workplace = {
          timezone: membership.workplace.timezone,
          businessDayStartHour: membership.workplace.businessDayStartHour,
        };
        const shift = existingId
          ? await updateOwnShift(client, membership, existingId, draft, workplace)
          : await submitShift(client, membership, draft, workplace);
        // The row the database returned IS the pinned shift's new state; no
        // second read is needed to show "submitted again".
        if (alive.current && focusId && shift.id === focusId) setFocused({ status: 'ready', shift });
        await refresh();
        return { ok: true, shift };
      } catch (error) {
        return { ok: false, failure: classifyShiftError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, refresh, focusId],
  );

  return {
    enabled,
    status,
    shifts,
    busy,
    focused,
    refreshFocused: loadFocused,
    businessDate,
    businessDayStatus: businessDay.status,
    refreshBusinessDay: businessDay.refresh,
    refresh,
    submit,
  };
}

type QueueStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/**
 * The manager's queue.
 *
 * The review screen wants everything that has been sent in; the distribution
 * wizard wants only what has been approved, because only approved shifts take
 * part in a distribution.
 */
export function useReviewQueue(
  statuses: readonly QueueStatus[] = ['submitted', 'approved', 'rejected'],
  /** Business days to confine the queue to; null means every date. */
  period: { start: string; end: string } | null = null,
) {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const isManager = membership?.role === 'manager';
  const enabled = Boolean(client) && workplace.enabled && isManager;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const token = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A period object is rebuilt on every render; its two dates are the identity.
  const periodKey = period ? `${period.start}..${period.end}` : '';

  const refresh = useCallback(async () => {
    if (!client || !membership) return;
    const mine = (token.current += 1);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const [start, end] = periodKey ? periodKey.split('..') : [undefined, undefined];
      const rows = await fetchReviewQueue(
        client,
        membership,
        statuses,
        start && end ? { start, end } : undefined,
      );
      if (!alive.current || mine !== token.current) return;
      setShifts(rows);
      setStatus('ready');
    } catch {
      if (!alive.current || mine !== token.current) return;
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, membership, statuses.join(','), periodKey]);

  useEffect(() => {
    if (!enabled) {
      setShifts((current) => (current.length === 0 ? current : []));
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const act = useCallback(
    async (run: (c: TipCrewClient, m: NonNullable<typeof membership>) => Promise<Shift>) => {
      if (!client || !membership) return { ok: false as const, failure: 'notConfigured' as const };
      setBusy(true);
      try {
        const shift = await run(client, membership);
        await refresh();
        return { ok: true as const, shift };
      } catch (error) {
        return { ok: false as const, failure: classifyShiftError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, refresh],
  );

  return {
    enabled,
    status,
    shifts,
    busy,
    refresh,
    approve: (id: string, note?: string) => act((c, m) => approveShift(c, m, id, note)),
    reject: (id: string, note?: string) => act((c, m) => rejectShift(c, m, id, note)),
    correctEnd: (shift: Shift, deltaMinutes: number) =>
      act((c, m) => correctShiftEnd(c, m, shift, deltaMinutes)),
    setLocked: (id: string, locked: boolean) => act((c, m) => setShiftLocked(c, m, id, locked)),
  };
}
