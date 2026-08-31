import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyShiftError, type ShiftFailure } from '@/shifts/errors';
import { currentBusinessDate } from '@/shifts/time';
import { fetchOwnReport, fetchWorkplaceReports, saveOwnReport } from '@/tips/queries';
import { validateReport, type TipReport } from '@/tips/types';

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
 * The member's own report for the night in progress, and the action that files
 * it. A manager gets the whole workplace's reports as well, which is what their
 * reports screen shows and what the pool is later built from.
 */
export function useTipReports() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const enabled = Boolean(client) && workplace.enabled && membership !== null;
  const isManager = membership?.role === 'manager';

  const [own, setOwn] = useState<TipReport | null>(null);
  const [workplaceReports, setWorkplaceReports] = useState<TipReport[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const businessDate = membership
    ? currentBusinessDate(
        membership.workplace.timezone,
        membership.workplace.businessDayStartHour,
      )
    : null;

  const refresh = useCallback(async () => {
    if (!client || !membership || !businessDate) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const mine = await fetchOwnReport(client, membership, businessDate);
      const all = isManager ? await fetchWorkplaceReports(client, membership, businessDate) : [];
      if (!alive.current) return;
      setOwn(mine);
      setWorkplaceReports(all);
      setStatus('ready');
    } catch {
      if (alive.current) setStatus('error');
    }
  }, [client, membership, businessDate, isManager]);

  useEffect(() => {
    if (!enabled) {
      setOwn(null);
      setWorkplaceReports([]);
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const save = useCallback(
    async (
      cardCents: number,
      cashCents: number,
    ): Promise<{ ok: boolean; failure?: ShiftFailure }> => {
      if (!client || !membership || !businessDate) return { ok: false, failure: 'notConfigured' };
      if (!validateReport(cardCents, cashCents)) return { ok: false, failure: 'invalidAmount' };
      setBusy(true);
      try {
        const saved = await saveOwnReport(client, membership, businessDate, cardCents, cashCents);
        if (alive.current) setOwn(saved);
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, failure: classifyShiftError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, businessDate, refresh],
  );

  return { enabled, status, own, workplaceReports, busy, businessDate, refresh, save };
}
