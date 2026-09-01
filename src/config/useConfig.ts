import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyConfigError, countFromError, type ConfigFailure } from '@/config/errors';
import * as api from '@/config/queries';
import type { ConfigState } from '@/config/queries';
import type { AreaUsage, RoleUsage } from '@/config/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ConfigActionResult<T = void> {
  ok: boolean;
  failure?: ConfigFailure;
  /** The number the database counted, when it refused because something is in use. */
  count?: number | null;
  value?: T;
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
 * Areas and roles, for the manager who configures them.
 *
 * `enabled` is false in demo mode, without credentials, or for an employee, and
 * every read and write below is behind it — so the demo build performs no
 * Supabase call at all, and an employee who reaches the route by typing it gets
 * a locked screen rather than a broken one.
 */
export function useConfig() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const isManager = membership?.role === 'manager';
  const enabled = Boolean(client) && workplace.enabled && isManager;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ConfigState | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!client || !membership || !enabled) {
      setStatus('idle');
      setState(null);
      return;
    }
    setStatus('loading');
    try {
      const next = await api.fetchConfig(client, membership);
      if (!alive.current) return;
      setState(next);
      setStatus('ready');
    } catch {
      if (!alive.current) return;
      setStatus('error');
    }
  }, [client, membership, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async <T,>(
      work: (c: TipCrewClient, m: NonNullable<typeof membership>) => Promise<T>,
      { reload = true } = {},
    ): Promise<ConfigActionResult<T>> => {
      if (!client) return { ok: false, failure: 'notConfigured' };
      if (!membership || !enabled) return { ok: false, failure: 'notManager' };
      setBusy(true);
      try {
        const value = await work(client, membership);
        if (reload) await load();
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          failure: classifyConfigError(error),
          count: countFromError(error),
        };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, enabled, load],
  );

  return {
    enabled,
    status,
    busy,
    state,
    refresh: load,

    areaUsage: (areaId: string) =>
      run<AreaUsage>((c) => api.fetchAreaUsage(c, areaId), { reload: false }),
    roleUsage: (roleId: string) =>
      run<RoleUsage>((c) => api.fetchRoleUsage(c, roleId), { reload: false }),

    createArea: (name: string, poolEligible: boolean) =>
      run((c, m) => api.createArea(c, m, name, poolEligible)),
    updateArea: (areaId: string, patch: { name?: string; isPoolEligible?: boolean }) =>
      run((c, m) => api.updateArea(c, m, areaId, patch)),
    archiveArea: (areaId: string) => run((c) => api.archiveArea(c, areaId)),
    restoreArea: (areaId: string) => run((c) => api.restoreArea(c, areaId)),
    deleteArea: (areaId: string) => run((c, m) => api.deleteArea(c, m, areaId)),
    reorderAreas: (ids: string[]) => run((c, m) => api.reorderAreas(c, m, ids)),

    createRole: (areaId: string, name: string, points: number) =>
      run((c, m) => api.createRole(c, m, areaId, name, points)),
    updateRole: (roleId: string, patch: { name?: string; points?: number }) =>
      run((c, m) => api.updateRole(c, m, roleId, patch)),
    archiveRole: (roleId: string) => run((c) => api.archiveRole(c, roleId)),
    restoreRole: (roleId: string) => run((c) => api.restoreRole(c, roleId)),
    deleteRole: (roleId: string) => run((c, m) => api.deleteRole(c, m, roleId)),
    reorderRoles: (areaId: string, ids: string[]) => run((c) => api.reorderRoles(c, areaId, ids)),
  };
}
