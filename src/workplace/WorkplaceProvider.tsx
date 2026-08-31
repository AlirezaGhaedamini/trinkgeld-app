import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { classifyWorkplaceError } from '@/workplace/errors';
import {
  acceptInvitationRpc,
  createWorkplaceRpc,
  fetchMemberships,
  requestJoinRpc,
} from '@/workplace/queries';
import {
  WorkplaceContext,
  type WorkplaceStatus,
  type WorkplaceValue,
} from '@/workplace/workplaceContext';
import type { Membership } from '@/workplace/types';
import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useAppState } from '@/hooks/useAppState';
import { useAuth } from '@/hooks/useAuth';

const ACTIVE_KEY = 'tipcrew.activeWorkplace';

/**
 * Which workplace the person was last looking at.
 *
 * Worth being precise about what this is and is not. It is a *convenience*: it
 * remembers a choice between two workplaces the user already belongs to. It is
 * not a permission. The stored id is validated against the memberships that
 * came back from the database, and the role is read from the membership row —
 * so editing this value in devtools can, at most, switch you to a workplace you
 * are already a member of, with whatever role you already have there.
 */
function readStoredActive(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeStoredActive(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private mode — the choice just will not survive a reload */
  }
}

export function WorkplaceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { dataMode } = useAppState();

  const [client] = useState<TipCrewClient | null>(() => {
    if (!isSupabaseConfigured()) return null;
    try {
      return getSupabase();
    } catch {
      return null;
    }
  });

  // Demo mode runs entirely on the Phase 1 local dataset and never touches this
  // layer, so a demo switch cannot influence real permissions.
  const enabled = client !== null && auth.enabled && dataMode !== 'demo';

  const [status, setStatus] = useState<WorkplaceStatus>('idle');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => readStoredActive());
  const [busy, setBusy] = useState(false);

  const alive = useRef(true);
  const loadToken = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const userId = auth.userId;

  const load = useCallback(async () => {
    if (!client || !userId) return;
    const token = (loadToken.current += 1);
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    try {
      const rows = await fetchMemberships(client, userId);
      if (!alive.current || token !== loadToken.current) return;
      setMemberships(rows);
      setStatus('ready');
    } catch {
      if (!alive.current || token !== loadToken.current) return;
      // Keep whatever we had. An empty list here would look like "you have no
      // workplace" and bounce the user to onboarding over a dropped request.
      setStatus('error');
    }
  }, [client, userId]);

  // Load on sign-in; clear on sign-out.
  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setMemberships([]);
      return;
    }
    if (auth.status === 'signedIn' && userId) {
      void load();
      return;
    }
    if (auth.status === 'signedOut') {
      loadToken.current += 1;
      setMemberships([]);
      setStatus('idle');
    }
  }, [enabled, auth.status, userId, load]);

  /**
   * Resolve the active membership.
   *
   * The stored id only counts if it is in the list that came back from the
   * database, which is what makes a stale or hand-edited value harmless: it
   * falls back to the single membership, or to the first one, or to nothing.
   */
  const activeMembership = useMemo<Membership | null>(() => {
    if (memberships.length === 0) return null;
    const stored = activeId ? memberships.find((m) => m.workplaceId === activeId) : undefined;
    if (stored) return stored;
    if (memberships.length === 1) return memberships[0] ?? null;
    return null; // several, none chosen — the app asks which one
  }, [memberships, activeId]);

  // Drop a stored id that no longer corresponds to a membership: the user left
  // the workplace, was removed, or the value was tampered with.
  useEffect(() => {
    if (status !== 'ready' || !activeId) return;
    if (!memberships.some((m) => m.workplaceId === activeId)) {
      writeStoredActive(null);
      setActiveId(null);
    }
  }, [status, activeId, memberships]);

  // Remember the single membership so a later second workplace does not make
  // the app forget which one was in use.
  useEffect(() => {
    if (status === 'ready' && memberships.length === 1 && !activeId) {
      const only = memberships[0];
      if (only) {
        writeStoredActive(only.workplaceId);
        setActiveId(only.workplaceId);
      }
    }
  }, [status, memberships, activeId]);

  const setActiveWorkplace = useCallback((workplaceId: string) => {
    writeStoredActive(workplaceId);
    setActiveId(workplaceId);
  }, []);

  /** Shared shape for the three write actions. */
  const run = useCallback(
    async (
      context: 'create' | 'join' | 'invite',
      action: (c: TipCrewClient) => Promise<string>,
      onDone?: (result: string) => void,
    ) => {
      if (!client || !enabled) return { ok: false as const, failure: 'notConfigured' as const };
      setBusy(true);
      try {
        const result = await action(client);
        await load();
        onDone?.(result);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyWorkplaceError(error, context) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, enabled, load],
  );

  const createWorkplace = useCallback<WorkplaceValue['createWorkplace']>(
    async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, failure: 'nameRequired' };
      return run(
        'create',
        (c) => createWorkplaceRpc(c, trimmed, auth.profile?.full_name ?? undefined),
        (workplaceId) => setActiveWorkplace(workplaceId),
      );
    },
    [run, auth.profile, setActiveWorkplace],
  );

  const joinWithCode = useCallback<WorkplaceValue['joinWithCode']>(
    async (code) => {
      const trimmed = code.trim();
      if (!trimmed) return { ok: false, failure: 'invalidCode' };
      const result = await run('join', (c) => requestJoinRpc(c, trimmed));
      // request_join() files a request; a manager still has to approve it, so
      // there is no membership and nothing to make active yet.
      return result.ok ? { ok: true, pendingApproval: true } : result;
    },
    [run],
  );

  const acceptInvitation = useCallback<WorkplaceValue['acceptInvitation']>(
    async (token) => {
      const trimmed = token.trim();
      if (!trimmed) return { ok: false, failure: 'invalidInvite' };
      return run('invite', (c) => acceptInvitationRpc(c, trimmed));
    },
    [run],
  );

  // After accepting an invitation the new membership arrives with the reload
  // inside run(); make it active if nothing else is.
  useEffect(() => {
    if (status !== 'ready' || activeId || memberships.length !== 1) return;
    const only = memberships[0];
    if (only) setActiveWorkplace(only.workplaceId);
  }, [status, activeId, memberships, setActiveWorkplace]);

  const value = useMemo<WorkplaceValue>(
    () => ({
      enabled,
      status,
      memberships,
      activeMembership,
      role: activeMembership?.role ?? null,
      busy,
      setActiveWorkplace,
      refresh: load,
      createWorkplace,
      joinWithCode,
      acceptInvitation,
    }),
    [
      enabled,
      status,
      memberships,
      activeMembership,
      busy,
      setActiveWorkplace,
      load,
      createWorkplace,
      joinWithCode,
      acceptInvitation,
    ],
  );

  return <WorkplaceContext.Provider value={value}>{children}</WorkplaceContext.Provider>;
}
