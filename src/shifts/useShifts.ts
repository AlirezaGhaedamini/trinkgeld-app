import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyShiftError, type ShiftFailure } from '@/shifts/errors';
import {
  approveShift,
  correctShiftEnd,
  fetchOwnShifts,
  fetchReviewQueue,
  rejectShift,
  setShiftLocked,
  submitShift,
  updateOwnShift,
} from '@/shifts/queries';
import { currentBusinessDate } from '@/shifts/time';
import type { Shift, ShiftDraft } from '@/shifts/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

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
 */
export function useOwnShifts() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const enabled = Boolean(client) && workplace.enabled && membership !== null;

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
      setShifts([]);
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  /** The business day currently in progress, in the workplace's own zone. */
  const businessDate = useMemo(() => {
    if (!membership) return null;
    return currentBusinessDate(
      membership.workplace.timezone,
      membership.workplace.businessDayStartHour,
    );
  }, [membership]);

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
        await refresh();
        return { ok: true, shift };
      } catch (error) {
        return { ok: false, failure: classifyShiftError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, refresh],
  );

  return { enabled, status, shifts, busy, businessDate, refresh, submit };
}

/** The manager's queue: everything submitted in the active workplace. */
export function useReviewQueue() {
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

  const refresh = useCallback(async () => {
    if (!client || !membership) return;
    const mine = (token.current += 1);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const rows = await fetchReviewQueue(client, membership, ['submitted', 'approved', 'rejected']);
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
      setShifts([]);
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
