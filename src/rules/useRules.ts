import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyRuleError, type RuleFailure } from '@/rules/errors';
import * as api from '@/rules/queries';
import type {
  DraftPatch,
  RulesState,
  WorkplaceSettings,
} from '@/rules/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RuleActionResult<T = void> {
  ok: boolean;
  failure?: RuleFailure;
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
 * The rules editor, backed by the real schema.
 *
 * `enabled` is false in demo mode, without credentials, or for an employee —
 * and every write below is behind it, so the demo screens keep their local
 * reducer state and perform no Supabase call at all. The role comes from the
 * active membership row, never from anything the browser stores.
 */
export function useRules() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const isManager = membership?.role === 'manager';
  const enabled = Boolean(client) && workplace.enabled && isManager;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<RulesState | null>(null);

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
      const next = await api.fetchRulesState(client, membership);
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

  /** Every write funnels through here, so failures are classified in one place. */
  const run = useCallback(
    async <T,>(
      work: (c: TipCrewClient, m: NonNullable<typeof membership>) => Promise<T>,
    ): Promise<RuleActionResult<T>> => {
      if (!client) return { ok: false, failure: 'notConfigured' };
      if (!membership || !enabled) return { ok: false, failure: 'notManager' };
      setBusy(true);
      try {
        const value = await work(client, membership);
        await load();
        return { ok: true, value };
      } catch (error) {
        return { ok: false, failure: classifyRuleError(error) };
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

    /** Opens the draft, creating it from the active rule when there is none. */
    openDraft: () => run((c, m) => api.ensureDraft(c, m)),

    saveDraft: (draftId: string, patch: DraftPatch) =>
      run((c, m) => api.saveDraft(c, m, draftId, patch)),

    /** Write the draft and activate it in one go, so a half-saved draft cannot be activated. */
    saveAndActivate: (draftId: string, patch: DraftPatch) =>
      run<number>(async (c, m) => {
        await api.saveDraft(c, m, draftId, patch);
        return api.activateDraft(c, draftId);
      }),

    discardDraft: (draftId: string) => run((c, m) => api.discardDraft(c, m, draftId)),

    saveRolePoints: (changes: Array<{ roleId: string; points: number }>) =>
      run((c, m) => api.saveRolePoints(c, m, changes)),

    saveSettings: (settings: WorkplaceSettings) =>
      run((c, m) => api.saveWorkplaceSettings(c, m, settings)),
  };
}
