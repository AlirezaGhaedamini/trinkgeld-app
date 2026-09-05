/**
 * The manager dashboard's data.
 *
 * Deliberately thin, like `usePeriodClose`: one server answer, held as it
 * arrived. Nothing here sums, filters or re-derives a figure — the point of the
 * RPC is that the database decided what day it is, what is current and what is
 * owed, and a screen that recomputed any of that would be a second opinion.
 *
 * A dropped request keeps the last good answer rather than blanking the screen:
 * an empty dashboard would read as "nothing needs you", which is a claim.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyDashboardError, type DashboardFailure } from '@/dashboard/errors';
import * as api from '@/dashboard/queries';
import type { ManagerDashboard } from '@/dashboard/types';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

function useClient(): TipCrewClient | null {
  return isSupabaseConfigured() ? getSupabase() : null;
}

export function useDashboard() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const workplaceId = membership?.workplaceId ?? null;

  /* The gate every manager hook computes. False in demo mode or with no
     credentials, and then NOT ONE request goes out — the demo dashboard keeps
     its sample dataset and never touches the database. */
  const enabled = Boolean(client) && workplace.enabled && membership?.role === 'manager';

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [data, setData] = useState<ManagerDashboard | null>(null);
  const [failure, setFailure] = useState<DashboardFailure | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !workplaceId) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const next = await api.fetchDashboard(client, workplaceId);
      if (!alive.current) return;
      setData(next);
      setFailure(null);
      setStatus('ready');
    } catch (error) {
      if (!alive.current) return;
      setFailure(classifyDashboardError(error));
      setStatus('error');
    }
  }, [client, workplaceId]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setStatus('idle');
      setFailure(null);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return { enabled, status, data, failure, refresh };
}
