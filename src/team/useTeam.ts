import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyTeamError, type TeamFailure } from '@/team/errors';
import * as api from '@/team/queries';
import type { MemberPatch, MemberRole, TeamState } from '@/team/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TeamActionResult<T = void> {
  ok: boolean;
  failure?: TeamFailure;
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
 * The roster, for the manager who administers it.
 *
 * Disabled in demo mode, without credentials, and for an employee — so the demo
 * build makes no Supabase call at all, and an employee who types the route sees
 * a locked screen rather than a broken one. The role comes from the active
 * membership row; nothing the browser stores can change it.
 *
 * After a write that can end the caller's own access — suspending yourself is
 * refused, but demoting yourself while another manager exists is not — the
 * workplace layer is refreshed as well, so the app re-resolves who the signed-in
 * person now is instead of holding a stale role.
 */
export function useTeam() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const isManager = membership?.role === 'manager';
  const enabled = Boolean(client) && workplace.enabled && isManager;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<TeamState | null>(null);

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
      const next = await api.fetchTeam(client, membership);
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
      { reloadWorkplace = false } = {},
    ): Promise<TeamActionResult<T>> => {
      if (!client) return { ok: false, failure: 'notConfigured' };
      if (!membership || !enabled) return { ok: false, failure: 'notManager' };
      setBusy(true);
      try {
        const value = await work(client, membership);
        await load();
        if (reloadWorkplace) await workplace.refresh();
        return { ok: true, value };
      } catch (error) {
        return { ok: false, failure: classifyTeamError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, enabled, load, workplace],
  );

  return {
    enabled,
    status,
    busy,
    state,
    /** The signed-in manager's own membership id, so a screen can say "you". */
    selfMembershipId: membership?.id ?? null,
    refresh: load,

    saveMember: (memberId: string, patch: MemberPatch) =>
      run((c, m) => api.saveMember(c, m, memberId, patch), {
        reloadWorkplace: memberId === membership?.id,
      }),

    setStatus: (memberId: string, next: 'active' | 'suspended' | 'left') =>
      run((c, m) => api.setMemberStatus(c, m, memberId, next), {
        reloadWorkplace: memberId === membership?.id,
      }),

    approveRequest: (invitationId: string, areaId: string | null, roleId: string | null) =>
      run((c) => api.approveRequest(c, invitationId, areaId, roleId)),
    declineRequest: (invitationId: string) =>
      run((c, m) => api.declineRequest(c, m, invitationId)),
    revokeInvite: (invitationId: string) => run((c, m) => api.revokeInvite(c, m, invitationId)),

    createInvitation: (input: {
      email: string;
      displayName: string;
      role: MemberRole;
      areaId: string | null;
      workplaceRoleId: string | null;
    }) => run((c, m) => api.createInvitation(c, m, input)),
  };
}
