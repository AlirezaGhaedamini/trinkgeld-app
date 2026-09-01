import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import {
  areaNamesFromError,
  classifyDistributionError,
  type DistributionFailure,
} from '@/distribution/errors';
import type { AckStateRow, MyQuery, QueryRow } from '@/distribution/ack';
import * as api from '@/distribution/queries';
import type {
  ActiveRule,
} from '@/distribution/queries';
import type {
  Distribution,
  DistributionArea,
  DistributionDetail,
  DistributionEntry,
  TipPool,
} from '@/distribution/types';
import { currentBusinessDate } from '@/shifts/time';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ActionResult<T = void> {
  ok: boolean;
  failure?: DistributionFailure;
  /** The area names the database named, when it refused because one was empty. */
  areas?: string | null;
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
 * The manager's wizard, backed by real data.
 *
 * One hook for the four steps because they are one transaction of intent: the
 * pool, the shares, the hours and the result all belong to the same business
 * day, and splitting them across four hooks would mean four sources of truth
 * for which day that is.
 */
export function useDistributionWizard() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const isManager = membership?.role === 'manager';
  const enabled = Boolean(client) && workplace.enabled && isManager;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState<TipPool | null>(null);
  const [rule, setRule] = useState<ActiveRule | null>(null);
  const [reportTotal, setReportTotal] = useState({ count: 0, cardCents: 0, cashCents: 0 });
  const [draft, setDraft] = useState<Distribution | null>(null);
  const [detail, setDetail] = useState<DistributionDetail | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const businessDate = membership
    ? currentBusinessDate(membership.workplace.timezone, membership.workplace.businessDayStartHour)
    : null;

  const refresh = useCallback(async () => {
    if (!client || !membership || !businessDate) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const [existingPool, activeRule, reports] = await Promise.all([
        api.fetchOpenPool(client, membership, businessDate, businessDate),
        api.fetchActiveRule(client, membership),
        api.fetchUnusedReportTotal(client, membership, businessDate, businessDate),
      ]);
      let existingDraft: Distribution | null = null;
      let existingDetail: DistributionDetail | null = null;
      if (existingPool) {
        existingDraft = await api.fetchPoolDistribution(client, membership, existingPool.id);
        if (existingDraft) {
          existingDetail = await api.fetchDistributionDetail(client, membership, existingDraft.id);
        }
      }
      if (!alive.current) return;
      setPool(existingPool);
      setRule(activeRule);
      setReportTotal(reports);
      setDraft(existingDraft);
      setDetail(existingDetail);
      setStatus('ready');
    } catch {
      if (alive.current) setStatus('error');
    }
  }, [client, membership, businessDate]);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setPool(null);
      setRule(null);
      setDraft(null);
      setDetail(null);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const run = useCallback(
    async <T,>(action: (c: TipCrewClient, m: NonNullable<typeof membership>) => Promise<T>): Promise<ActionResult<T>> => {
      if (!client || !membership) return { ok: false, failure: 'notConfigured' };
      setBusy(true);
      try {
        const value = await action(client, membership);
        await refresh();
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          failure: classifyDistributionError(error),
          areas: areaNamesFromError(error),
        };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, membership, refresh],
  );

  return {
    enabled,
    status,
    busy,
    businessDate,
    pool,
    rule,
    reportTotal,
    draft,
    detail,
    refresh,

    /**
     * Open the pool. Derived from the reports when there are any — the total is
     * summed in the database, not sent from here — and typed in only when there
     * is nothing to derive from.
     */
    openPoolFromReports: (label = '') =>
      run((c, m) => api.createPoolFromReports(c, m, businessDate!, businessDate!, label)),
    openManualPool: (cardCents: number, cashCents: number) =>
      run((c, m) => api.createManualPool(c, m, businessDate!, businessDate!, cardCents, cashCents)),
    setPoolAmounts: (cardCents: number, cashCents: number) =>
      run((c, m) => (pool ? api.updatePoolAmounts(c, m, pool.id, cardCents, cashCents) : Promise.reject(new Error('no pool')))),

    saveShares: (shares: Array<{ areaId: string; areaKey: string; percentage: number }>) =>
      run((c, m) => api.saveAreaShares(c, m, shares)),

    calculate: () => run((c) => api.calculateDistribution(c, pool!.id)),
    send: () => run((c) => api.sendDistribution(c, draft!.id)),
    cancel: (reason: string) => run((c) => api.cancelDistribution(c, draft!.id, reason)),
  };
}

/** The manager's distribution history, read from the stored records. */
export function useDistributionHistory() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const enabled = Boolean(client) && workplace.enabled && membership?.role === 'manager';

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [distributions, setDistributions] = useState<Distribution[]>([]);
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
      const rows = await api.fetchDistributions(client, membership);
      if (!alive.current) return;
      setDistributions(rows);
      setStatus('ready');
    } catch {
      if (alive.current) setStatus('error');
    }
  }, [client, membership]);

  useEffect(() => {
    if (!enabled) {
      setDistributions([]);
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const loadDetail = useCallback(
    async (id: string): Promise<DistributionDetail | null> => {
      if (!client || !membership) return null;
      try {
        return await api.fetchDistributionDetail(client, membership, id);
      } catch {
        return null;
      }
    },
    [client, membership],
  );

  /**
   * Who has answered, per entry, from the database's own definition of who is
   * able to answer at all. Kept separate from loadDetail because a manager
   * opening an old distribution wants the split immediately; the tally is a
   * second, smaller question.
   */
  const loadAckState = useCallback(
    async (id: string): Promise<AckStateRow[]> => {
      if (!client) return [];
      try {
        return await api.fetchAckState(client, id);
      } catch {
        return [];
      }
    },
    [client],
  );

  const loadQueries = useCallback(
    async (id: string): Promise<QueryRow[]> => {
      if (!client) return [];
      try {
        return await api.fetchQueries(client, id);
      } catch {
        return [];
      }
    },
    [client],
  );

  const resolveQuery = useCallback(
    async (
      queryId: string,
      outcome: 'no_correction' | 'correction_required',
      response?: string,
    ) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        await api.resolveQuery(client, queryId, outcome, response);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      }
    },
    [client],
  );

  return {
    enabled, status, distributions, refresh, loadDetail, loadAckState,
    loadQueries, resolveQuery,
  };
}

/**
 * The employee's side: what they have been paid, and the entries that explain
 * it. Both come through the member-facing relations, so the filtering is RLS's
 * job rather than this file's.
 */
export function useMyShare() {
  const client = useClient();
  const workplace = useWorkplace();
  const enabled = Boolean(client) && workplace.enabled && workplace.activeMembership !== null;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [entries, setEntries] = useState<DistributionEntry[]>([]);
  const [areas, setAreas] = useState<Record<string, DistributionArea[]>>({});
  const [queries, setQueries] = useState<MyQuery[]>([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const [dists, rows, mine] = await Promise.all([
        api.fetchMyDistributions(client),
        api.fetchMyEntries(client),
        api.fetchMyQueries(client),
      ]);
      // Area subtotals only when the workplace released the pool; an empty
      // result is the privacy model working, not a failure.
      const byDistribution: Record<string, DistributionArea[]> = {};
      await Promise.all(
        dists.slice(0, 12).map(async (dist) => {
          byDistribution[dist.id] = await api.fetchVisibleAreas(client, dist.id);
        }),
      );
      if (!alive.current) return;
      setDistributions(dists);
      setEntries(rows);
      setQueries(mine);
      setAreas(byDistribution);
      setStatus('ready');
    } catch {
      if (alive.current) setStatus('error');
    }
  }, [client]);

  useEffect(() => {
    if (!enabled) {
      setDistributions([]);
      setEntries([]);
      setQueries([]);
      setAreas({});
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  /**
   * Answers a whole distribution, not one entry.
   *
   * Somebody who worked two areas holds two entries in the same distribution.
   * The database answers both in one statement from the caller's identity, so
   * there is no client-side loop to fail halfway and no way for this screen to
   * report a confirmation that only partly happened.
   */
  const acknowledge = useCallback(
    async (distributionId: string, next: 'acknowledged' | 'queried', note?: string) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      setBusy(true);
      try {
        await api.acknowledgeDistribution(client, distributionId, next, note);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, refresh],
  );

  /**
   * Raises a question about a whole distribution. Separate from acknowledge()
   * because it carries the one thing a confirmation never does — a sentence
   * saying what looks wrong — and because the database refuses it without one.
   */
  const query = useCallback(
    async (distributionId: string, note: string) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      setBusy(true);
      try {
        await api.queryDistribution(client, distributionId, note);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, refresh],
  );

  /** The caller's own question about one distribution, latest first. */
  const queryFor = useCallback(
    (distributionId: string) => queries.find((q) => q.distributionId === distributionId) ?? null,
    [queries],
  );

  return {
    enabled, status, distributions, entries, areas, queries, busy, refresh,
    acknowledge, query, queryFor,
  };
}
