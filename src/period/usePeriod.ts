/**
 * The period-close screen's data.
 *
 * Deliberately thin: the readiness check and the export are both server
 * answers, and this hook does not cache, merge or recompute either. A figure
 * this screen shows is a figure the database produced.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyDistributionError } from '@/distribution/errors';
import * as api from '@/period/queries';
import type { PeriodClose, PeriodExport, PeriodReadiness } from '@/period/types';

function useClient(): TipCrewClient | null {
  return isSupabaseConfigured() ? getSupabase() : null;
}

export function usePeriodClose() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const workplaceId = membership?.workplaceId ?? null;
  /* The screen is manager-only, and the guard is the database's; this only
     decides whether to ask at all. */
  const enabled = Boolean(client) && workplace.enabled && membership?.role === 'manager';

  const [closes, setCloses] = useState<PeriodClose[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !workplaceId) return;
    try {
      const rows = await api.fetchCloses(client, workplaceId);
      if (alive.current) setCloses(rows);
    } catch {
      if (alive.current) setCloses([]);
    }
  }, [client, workplaceId]);

  useEffect(() => {
    if (!enabled) {
      setCloses([]);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const readiness = useCallback(
    async (start: string, end: string): Promise<PeriodReadiness | null> => {
      if (!client || !workplaceId) return null;
      try {
        return await api.fetchReadiness(client, workplaceId, start, end);
      } catch {
        return null;
      }
    },
    [client, workplaceId],
  );

  const close = useCallback(
    async (start: string, end: string, note?: string) => {
      if (!client || !workplaceId) {
        return { ok: false as const, failure: 'notConfigured' as const };
      }
      try {
        await api.closePeriod(client, workplaceId, start, end, note);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      }
    },
    [client, workplaceId, refresh],
  );

  const load = useCallback(
    async (start: string, end: string): Promise<PeriodExport | null> => {
      if (!client || !workplaceId) return null;
      try {
        return await api.fetchExport(client, workplaceId, start, end);
      } catch {
        return null;
      }
    },
    [client, workplaceId],
  );

  return { enabled, workplaceId, closes, refresh, readiness, close, load };
}
