/**
 * One server business day per active workplace, shared by every screen.
 *
 * A provider rather than a per-screen hook because Home mounts the shift hook
 * and the report hook side by side, and the wizard and the review screen both
 * ask as well: one answer, one request, and every consumer agrees on the day.
 *
 * WHEN IT ASKS AGAIN. On mount, on a workplace switch, whenever the tab
 * becomes visible or the window regains focus, and on demand. That is how the
 * cut-off is crossed while the app stays open: the phone in a pocket from
 * 04:50 to 05:10 comes back, the next visibility change fetches Day B, and
 * every financial action from then on uses Day B. Nothing in progress is
 * rewritten — the wizard pins the day of a pool it has already found (see
 * useDistributionWizard) — only the day offered for the NEXT thing changes.
 *
 * WHAT A SWITCH DOES. The date is cleared the moment the workplace id changes,
 * so no screen can file a report or open a pool under workplace B with a date
 * that workplace A answered, and a late answer from A is dropped by the token.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BusinessDayContext } from '@/businessDay/businessDayContext';
import { fetchCurrentBusinessDay } from '@/businessDay/queries';
import type { BusinessDayStatus, BusinessDayValue } from '@/businessDay/types';
import { useWorkplace } from '@/hooks/useWorkplace';
import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';

export function BusinessDayProvider({ children }: { children: ReactNode }) {
  const workplace = useWorkplace();
  const [client] = useState<TipCrewClient | null>(() => {
    if (!isSupabaseConfigured()) return null;
    try {
      return getSupabase();
    } catch {
      return null;
    }
  });

  const workplaceId = workplace.activeMembership?.workplaceId ?? null;
  // Demo mode never reaches this: workplace.enabled is false there.
  const enabled = client !== null && workplace.enabled && workplaceId !== null;

  const [status, setStatus] = useState<BusinessDayStatus>('idle');
  const [date, setDate] = useState<string | null>(null);
  const [dateFor, setDateFor] = useState<string | null>(null);

  const alive = useRef(true);
  const token = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !workplaceId) return;
    const mine = (token.current += 1);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const next = await fetchCurrentBusinessDay(client, workplaceId);
      if (!alive.current || mine !== token.current) return;
      setDate(next);
      setDateFor(workplaceId);
      setStatus('ready');
    } catch {
      if (!alive.current || mine !== token.current) return;
      setStatus('error');
    }
  }, [client, workplaceId]);

  // A new workplace (or losing one) starts from nothing: the old date goes at
  // once and an answer still in flight for it is retired by the token.
  useEffect(() => {
    token.current += 1;
    setDate(null);
    setDateFor(null);
    setStatus('idle');
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  // Crossing the cut-off while the app stays open: ask again whenever the
  // person comes back to it.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onFocus = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, refresh]);

  const value = useMemo<BusinessDayValue>(
    () => ({
      enabled,
      status,
      // A date only ever stands beside the workplace that answered it.
      date: dateFor === workplaceId ? date : null,
      workplaceId,
      refresh,
    }),
    [enabled, status, date, dateFor, workplaceId, refresh],
  );

  return <BusinessDayContext.Provider value={value}>{children}</BusinessDayContext.Provider>;
}
