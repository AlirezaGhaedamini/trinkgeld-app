/**
 * The area and role the signed-in person holds in the active workplace, by
 * name.
 *
 * The membership row carries only the ids. The employee screens used to fill
 * the gap from the Phase 1 reducer, which always said "Service" — a made-up
 * answer. This reads the two names the membership actually points at, and
 * says nothing when there is nothing to say: a person with no area is told
 * so by the screen, never handed a default.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { fetchAssignmentNames } from '@/workplace/queries';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

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

export function useAssignment() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const enabled = Boolean(client) && workplace.enabled && membership !== null;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [names, setNames] = useState<{ areaName: string | null; roleName: string | null }>({
    areaName: null,
    roleName: null,
  });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !membership) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const next = await fetchAssignmentNames(client, membership);
      if (!alive.current) return;
      setNames(next);
      setStatus('ready');
    } catch {
      if (alive.current) setStatus('error');
    }
  }, [client, membership]);

  useEffect(() => {
    if (!enabled) {
      setNames({ areaName: null, roleName: null });
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return { enabled, status, areaName: names.areaName, roleName: names.roleName, refresh };
}
