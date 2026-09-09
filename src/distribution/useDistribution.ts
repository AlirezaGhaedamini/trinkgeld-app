import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import {
  areaNamesFromError,
  classifyDistributionError,
  type DistributionFailure,
} from '@/distribution/errors';
import type { AckStateRow, CorrectionReason, MyQuery, QueryRow } from '@/distribution/ack';
import * as api from '@/distribution/queries';
import type {
  ActiveRule,
} from '@/distribution/queries';
import type {
  Distribution,
  DistributionArea,
  DistributionDetail,
  DistributionEntry,
  PayoutMethod,
  ReversalReason,
  Settlement,
  TipPool,
} from '@/distribution/types';
import { useBusinessDay } from '@/hooks/useBusinessDay';
import {
  discardMayHaveSucceeded,
  discardRecovered,
  sendMayHaveSucceeded,
  sendRecovered,
} from '@/distribution/recovery';

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
export function useDistributionWizard(options: { enabled?: boolean } = {}) {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const isManager = membership?.role === 'manager';
  // A screen shared between the wizard and a standalone flow can hold the
  // hook off; nothing is fetched then, and the business date is still known.
  const enabled = Boolean(client) && workplace.enabled && isManager && (options.enabled ?? true);

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState<TipPool | null>(null);
  const [rule, setRule] = useState<ActiveRule | null>(null);
  const [reportTotal, setReportTotal] = useState({ count: 0, cardCents: 0, cashCents: 0 });
  const [draft, setDraft] = useState<Distribution | null>(null);
  const [detail, setDetail] = useState<DistributionDetail | null>(null);
  /** Nights the manager started and did not finish, newest first. */
  const [unfinishedPools, setUnfinishedPools] = useState<TipPool[]>([]);
  /** The newest version of the current pool that was ever sent, if any. */
  const [publishedId, setPublishedId] = useState<string | null>(null);

  const alive = useRef(true);
  const token = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * WHICH NIGHT. Three answers, in order of authority:
   *
   *   pinned  — the night of the pool this wizard has already found. Once a
   *             pool exists its own stored period is the truth, and a cut-off
   *             passing while the manager is mid-flow must not swing the wizard
   *             onto the next night and strand the pool behind it.
   *   chosen  — a night the manager asked to continue (an unfinished pool
   *             from before, offered on the pool step).
   *   server  — current_business_day() (migration 33), for finding or opening
   *             the NEXT pool when none exists. Never the device clock.
   */
  const businessDay = useBusinessDay();
  const serverDate = businessDay.date;
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const businessDate = pinnedDate ?? chosenDate ?? serverDate;

  const refresh = useCallback(async () => {
    if (!client || !membership || !businessDate) return;
    const mine = (token.current += 1);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const [existingPool, activeRule, reports, unfinished] = await Promise.all([
        api.fetchOpenPool(client, membership, businessDate, businessDate),
        api.fetchActiveRule(client, membership),
        api.fetchUnusedReportTotal(client, membership, businessDate, businessDate),
        api.fetchUnfinishedPools(client, membership),
      ]);
      let existingDraft: Distribution | null = null;
      let existingDetail: DistributionDetail | null = null;
      let published: string | null = null;
      if (existingPool) {
        [existingDraft, published] = await Promise.all([
          api.fetchPoolDistribution(client, membership, existingPool.id),
          api.fetchPoolPublishedId(client, membership, existingPool.id),
        ]);
        if (existingDraft) {
          existingDetail = await api.fetchDistributionDetail(client, membership, existingDraft.id);
        }
      }
      if (!alive.current || mine !== token.current) return;
      setPool(existingPool);
      setRule(activeRule);
      setReportTotal(reports);
      setUnfinishedPools(unfinished);
      setDraft(existingDraft);
      setDetail(existingDetail);
      setPublishedId(published);
      // A pool found is a night pinned; no pool means the wizard follows the
      // server's day again. Same value, no re-render, no second round trip.
      setPinnedDate(existingPool ? existingPool.periodStart : null);
      setStatus('ready');
    } catch {
      if (!alive.current || mine !== token.current) return;
      setStatus('error');
    }
  }, [client, membership, businessDate]);

  useEffect(() => {
    if (!enabled) {
      token.current += 1;
      setStatus('idle');
      setPool(null);
      setRule(null);
      setDraft(null);
      setDetail(null);
      setUnfinishedPools([]);
      setPublishedId(null);
      setPinnedDate(null);
      setChosenDate(null);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  /** Continue an earlier night, or (null) go back to the server's day. */
  const selectDate = useCallback((date: string | null) => {
    setChosenDate(date);
    setPinnedDate(null);
  }, []);

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

  /**
   * Publish the draft. If the server refuses because the row is no longer a
   * draft, that may be this same send whose answer never arrived: the exact
   * record is reloaded, and only a sent or confirmed status counts as done.
   */
  const send = useCallback(async (): Promise<ActionResult<void>> => {
    const id = draft?.id;
    if (!id) return { ok: false, failure: 'unknown' };
    const result = await run((c) => api.sendDistribution(c, id));
    if (result.ok || !sendMayHaveSucceeded(result.failure) || !client || !membership) return result;
    try {
      const row = await api.fetchDistributionDetail(client, membership, id);
      if (sendRecovered(row?.distribution.status)) {
        await refresh();
        return { ok: true };
      }
    } catch {
      /* the reload failed; the refusal stands */
    }
    return result;
  }, [draft?.id, run, client, membership, refresh]);

  return {
    enabled,
    status,
    busy,
    businessDate,
    serverDate,
    chosenDate,
    businessDayStatus: businessDay.status,
    refreshBusinessDay: businessDay.refresh,
    unfinishedPools,
    publishedId,
    selectDate,
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
    send,
    cancel: (reason: string) => run((c) => api.cancelDistribution(c, draft!.id, reason)),
    /**
     * Migration 33: set the current pool aside. The server refuses a pool
     * with a draft, a sent version or published history; the screen offers
     * the action only when none of those is in view, and the refresh that
     * follows shows the night without a pool, ready to be opened again.
     */
    voidPool: (reason?: string) =>
      run((c) =>
        pool ? api.voidPool(c, pool.id, reason) : Promise.reject(new Error('pool not found')),
      ),
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

  /* Settlement for every distribution in one read, so the history list can put
     what was handed over beside what was calculated without a request per row. */
  const [settlements, setSettlements] = useState<Record<string, Settlement>>({});

  const refresh = useCallback(async () => {
    if (!client || !membership) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const [rows, settled] = await Promise.all([
        api.fetchDistributions(client, membership),
        api.fetchSettlements(client, membership.workplaceId),
      ]);
      if (!alive.current) return;
      setDistributions(rows);
      setSettlements(settled);
      setStatus('ready');
    } catch {
      if (alive.current) setStatus('error');
    }
  }, [client, membership]);

  useEffect(() => {
    if (!enabled) {
      setDistributions([]);
      setSettlements({});
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
   * The same read, keeping "no such row" and "the read failed" apart: a
   * screen opened by a deep link has to say which one it is, and a null
   * cannot.
   */
  const loadDetailResult = useCallback(
    async (
      id: string,
    ): Promise<{ status: 'ready'; detail: DistributionDetail | null } | { status: 'error' }> => {
      if (!client || !membership) return { status: 'error' };
      try {
        return { status: 'ready', detail: await api.fetchDistributionDetail(client, membership, id) };
      } catch {
        return { status: 'error' };
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

  /** Starts a correction and returns the draft's id. */
  const createReplacement = useCallback(
    async (originalId: string, correction?: { reason: CorrectionReason; note: string }) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        const id = await api.createReplacement(client, originalId, correction);
        await refresh();
        return { ok: true as const, value: id };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      }
    },
    [client, refresh],
  );

  const loadSupersededBy = useCallback(
    async (id: string) => (client ? api.fetchSupersededBy(client, id) : null),
    [client],
  );

  /**
   * Publishes a draft. The stale-input check lives in the database.
   *
   * "Only a draft can be sent" after a retry may be this very send, whose
   * answer was lost on the way back. The exact record is reloaded, and only
   * a sent or confirmed status turns the refusal into a success; a cancelled
   * or replaced row keeps the error, because that is not what was asked for.
   */
  const send = useCallback(
    async (id: string) => {
      if (!client || !membership) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        await api.sendDistribution(client, id);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        const failure = classifyDistributionError(error);
        if (sendMayHaveSucceeded(failure)) {
          try {
            const row = await api.fetchDistributionDetail(client, membership, id);
            if (sendRecovered(row?.distribution.status)) {
              await refresh();
              return { ok: true as const, recovered: true as const };
            }
          } catch {
            /* the reload failed; the refusal stands */
          }
        }
        return { ok: false as const, failure };
      }
    },
    [client, membership, refresh],
  );

  /**
   * Removes a draft that was never sent. The policy allows nothing else.
   *
   * A DELETE that matched nothing may be a retry of one that already worked.
   * The row is reloaded: gone means discarded — the policy cannot remove a
   * published row, so absence is proof — and still there means a real failure.
   */
  const discardDraft = useCallback(
    async (id: string) => {
      if (!client || !membership) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        await api.deleteDraftDistribution(client, membership, id);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        const failure = classifyDistributionError(error);
        if (discardMayHaveSucceeded(failure)) {
          try {
            const row = await api.fetchDistributionDetail(client, membership, id);
            if (discardRecovered(row !== null)) {
              await refresh();
              return { ok: true as const, recovered: true as const };
            }
            return { ok: false as const, failure: 'discardFailed' as const };
          } catch {
            /* the reload failed; the refusal stands */
          }
        }
        return { ok: false as const, failure };
      }
    },
    [client, membership, refresh],
  );

  /** Entitlement, what the lineage already settled, and the payout if any. */
  const loadSettlement = useCallback(
    async (id: string) => (client ? api.fetchSettlement(client, id) : null),
    [client],
  );

  /** What the correction moved, per person. */
  const loadMemberSettlement = useCallback(
    async (id: string) => (client ? api.fetchMemberSettlement(client, id) : []),
    [client],
  );

  /**
   * Records the payout. No amount is sent: the server derives it, and this
   * function has no way to influence it even if a caller wanted to.
   */
  const recordPayout = useCallback(
    async (id: string, method: PayoutMethod | null, note?: string) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        await api.recordPayout(client, id, method, note);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      }
    },
    [client, refresh],
  );

  /** Every payment and reversal on one distribution, oldest first. */
  const loadPayoutEvents = useCallback(
    async (id: string) => (client ? api.fetchPayoutEvents(client, id) : []),
    [client],
  );

  /**
   * Takes a payout record back. Sends a payout, a category and a sentence —
   * never a workplace, a distribution, an amount or an actor.
   */
  const reversePayout = useCallback(
    async (payoutId: string, reason: ReversalReason, note: string) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        await api.reversePayout(client, payoutId, reason, note);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyDistributionError(error) };
      }
    },
    [client, refresh],
  );

  return {
    enabled, status, distributions, settlements, refresh, loadDetail, loadDetailResult,
    loadAckState, loadQueries, resolveQuery, createReplacement, loadSupersededBy, send,
    discardDraft, loadSettlement, loadMemberSettlement, recordPayout,
    loadPayoutEvents, reversePayout,
  };
}

/**
 * One distribution, read back by id.
 *
 * The sent confirmation needs exactly one record and nothing else: the id
 * arrives in the route, the amount and the headcount are read from the row
 * the engine wrote, and a refresh of that screen reads the same row again. It
 * deliberately does not load the whole history to show one night.
 */
export function useDistributionDetail(distributionId: string | null | undefined) {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const enabled =
    Boolean(client) && workplace.enabled && membership?.role === 'manager' && Boolean(distributionId);

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [detail, setDetail] = useState<DistributionDetail | null>(null);
  const alive = useRef(true);
  const token = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !membership || !distributionId) return;
    const mine = (token.current += 1);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const loaded = await api.fetchDistributionDetail(client, membership, distributionId);
      if (!alive.current || mine !== token.current) return;
      setDetail(loaded);
      setStatus('ready');
    } catch {
      if (!alive.current || mine !== token.current) return;
      setStatus('error');
    }
  }, [client, membership, distributionId]);

  // A different id or workplace starts from nothing: the previous record is
  // gone before the next request leaves, and its late answer — success or
  // error — is retired by the token. Record A is never shown under B's URL.
  useEffect(() => {
    token.current += 1;
    setDetail(null);
    setStatus('idle');
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { enabled, status, detail, refresh };
}

/**
 * The employee's side: what they have been paid, and the entries that explain
 * it. Both come through the member-facing relations, so the filtering is RLS's
 * job rather than this file's.
 */
export function useMyShare() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  // The workplace, not the membership object: the provider hands out a fresh
  // object whenever it re-reads memberships, and that must not throw away and
  // re-fetch the same workplace's rows. A different workplace id must.
  const workplaceId = membership?.workplaceId ?? null;
  const enabled = Boolean(client) && workplace.enabled && workplaceId !== null;

  const [status, setStatus] = useState<LoadStatus>('idle');
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [entries, setEntries] = useState<DistributionEntry[]>([]);
  const [areas, setAreas] = useState<Record<string, DistributionArea[]>>({});
  const [queries, setQueries] = useState<MyQuery[]>([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  /**
   * Which request is the current one. Switching workplace while a load is in
   * flight would otherwise let the old workplace's answer land on top of the
   * new one's; the same guard `useOwnShifts` uses.
   */
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
    const scope = { workplaceId };
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const [dists, rows, own] = await Promise.all([
        api.fetchMyDistributions(client, scope),
        api.fetchMyEntries(client, scope),
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
      if (!alive.current || mine !== token.current) return;
      setDistributions(dists);
      setEntries(rows);
      setQueries(own);
      setAreas(byDistribution);
      setStatus('ready');
    } catch {
      if (!alive.current || mine !== token.current) return;
      setStatus('error');
    }
  }, [client, workplaceId]);

  useEffect(() => {
    // Every change of workplace (or of the gate) starts from nothing: the
    // previous workplace's rows go at once, and its in-flight answer is
    // retired by bumping the token before the new load takes the next one.
    token.current += 1;
    setDistributions([]);
    setEntries([]);
    setQueries([]);
    setAreas({});
    setStatus('idle');
    if (!enabled) return;
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
