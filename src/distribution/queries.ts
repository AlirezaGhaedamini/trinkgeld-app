/**
 * Every Supabase call about pools and distributions.
 *
 * WHERE THE AUTHORITY IS
 *
 * The browser never computes a payout. It opens a pool, sets the area shares,
 * and then calls two functions:
 *
 *   calculate_distribution(pool)  writes the draft, the area subtotals and one
 *                                 entry per member per area, in one transaction,
 *                                 with an advisory lock so two managers pressing
 *                                 at once cannot both write.
 *   send_distribution(dist)       finalises it, after re-deriving the input
 *                                 fingerprint and refusing if the hours or the
 *                                 rule moved since the draft was calculated.
 *
 * There is no INSERT grant on tip_distributions, tip_distribution_areas or
 * tip_distribution_entries at all, so the client could not manufacture a payout
 * even with a bug in this file.
 *
 * The pool total is summed by the database from the tip reports whenever there
 * are any: `create_pool_from_reports()` also records which reports it consumed,
 * and a unique index makes counting the same report twice impossible.
 */

import type { Tables } from '@/types/database';
import type { TipCrewClient } from '@/lib/supabase';
import type { Membership } from '@/workplace/types';
import type { AckStateRow, CorrectionReason, MyQuery, QueryRow } from '@/distribution/ack';
import {
  toArea,
  toDistribution,
  toEntry,
  toMemberDistribution,
  toMemberSettlement,
  toPayoutEvent,
  toPool,
  toSettlement,
  type Distribution,
  type DistributionDetail,
  type DistributionEntry,
  type MemberSettlement,
  type PayoutEvent,
  type PayoutMethod,
  type ReversalReason,
  type Settlement,
  type TipPool,
} from '@/distribution/types';

/* ── pools ───────────────────────────────────────────────────────────────── */

export async function fetchOpenPool(
  client: TipCrewClient,
  membership: Membership,
  periodStart: string,
  periodEnd: string,
): Promise<TipPool | null> {
  const { data, error } = await client
    .from('tip_pools')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .in('status', ['open', 'locked'])
    .limit(1);

  if (error) throw error;
  return data && data[0] ? toPool(data[0]) : null;
}

/** Unused tip reports for a period, and what they add up to. */
export async function fetchUnusedReportTotal(
  client: TipCrewClient,
  membership: Membership,
  periodStart: string,
  periodEnd: string,
): Promise<{ count: number; cardCents: number; cashCents: number }> {
  const { data: reports, error } = await client
    .from('tip_reports')
    .select('id, card_cents, cash_cents')
    .eq('workplace_id', membership.workplaceId)
    .gte('work_date', periodStart)
    .lte('work_date', periodEnd);

  if (error) throw error;
  if (!reports || reports.length === 0) return { count: 0, cardCents: 0, cashCents: 0 };

  const { data: used } = await client
    .from('tip_pool_sources')
    .select('tip_report_id')
    .eq('workplace_id', membership.workplaceId);
  const consumed = new Set((used ?? []).map((row) => row.tip_report_id));

  const free = reports.filter((row) => !consumed.has(row.id));
  return {
    count: free.length,
    cardCents: free.reduce((sum, r) => sum + r.card_cents, 0),
    cashCents: free.reduce((sum, r) => sum + r.cash_cents, 0),
  };
}

/** Sum the reports server-side and open a pool from them. */
export async function createPoolFromReports(
  client: TipCrewClient,
  membership: Membership,
  periodStart: string,
  periodEnd: string,
  label = '',
): Promise<string> {
  const { data, error } = await client.rpc('create_pool_from_reports', {
    p_workplace_id: membership.workplaceId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_label: label,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('create_pool_from_reports returned no id');
  return data;
}

/**
 * A pool the manager typed in, for the case the database has nothing to derive
 * from — no reports for the period. `source` records which of the two it was.
 */
export async function createManualPool(
  client: TipCrewClient,
  membership: Membership,
  periodStart: string,
  periodEnd: string,
  cardCents: number,
  cashCents: number,
  label = '',
): Promise<TipPool> {
  const { data, error } = await client
    .from('tip_pools')
    .insert({
      workplace_id: membership.workplaceId,
      period: periodStart === periodEnd ? 'day' : 'custom',
      period_start: periodStart,
      period_end: periodEnd,
      label,
      card_cents: cardCents,
      cash_cents: cashCents,
      source: 'manual',
      status: 'open',
      created_by: membership.id,
    })
    .select('*')
    .single();

  if (error) throw error;
  return toPool(data);
}

export async function updatePoolAmounts(
  client: TipCrewClient,
  membership: Membership,
  poolId: string,
  cardCents: number,
  cashCents: number,
): Promise<TipPool> {
  const { data, error } = await client
    .from('tip_pools')
    .update({ card_cents: cardCents, cash_cents: cashCents })
    .eq('id', poolId)
    .eq('workplace_id', membership.workplaceId)
    .select('*')
    .single();
  if (error) throw error;
  return toPool(data);
}

/* ── the active rule and its area shares ─────────────────────────────────── */

export interface RuleAreaShare {
  areaId: string;
  areaKey: string;
  areaName: string;
  percentage: number;
  isPoolEligible: boolean;
}

export interface ActiveRule {
  id: string;
  version: number | null;
  method: string;
  minOverlapMinutes: number;
  overlapBasis: string;
  roundingAreaId: string | null;
  shares: RuleAreaShare[];
}

export async function fetchActiveRule(
  client: TipCrewClient,
  membership: Membership,
): Promise<ActiveRule | null> {
  const { data: rules, error } = await client
    .from('distribution_rules')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .eq('status', 'active')
    .limit(1);
  if (error) throw error;
  const rule = rules?.[0];
  if (!rule) return null;

  const [{ data: shares }, { data: areas }] = await Promise.all([
    client.from('distribution_rule_areas').select('*').eq('rule_id', rule.id),
    client
      .from('workplace_areas')
      .select('id, key, name, is_pool_eligible, sort_order')
      .eq('workplace_id', membership.workplaceId)
      .is('archived_at', null),
  ]);

  const shareByArea = new Map((shares ?? []).map((s) => [s.area_id, Number(s.percentage)]));

  return {
    id: rule.id,
    version: rule.version,
    method: rule.method,
    minOverlapMinutes: rule.min_overlap_minutes,
    overlapBasis: rule.overlap_basis,
    roundingAreaId: rule.rounding_area_id,
    shares: (areas ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((a) => ({
        areaId: a.id,
        areaKey: a.key,
        areaName: a.name,
        percentage: shareByArea.get(a.id) ?? 0,
        isPoolEligible: a.is_pool_eligible,
      })),
  };
}

/**
 * Save new area shares as a new rule version.
 *
 * A rule is a version, not a setting: editing the live one would rewrite the
 * terms under distributions already calculated. `create_rule_draft()` copies
 * the live rule, the shares are written onto the copy, and `activate_rule()`
 * validates that they total exactly 100 and freezes the role points.
 */
export async function saveAreaShares(
  client: TipCrewClient,
  membership: Membership,
  shares: Array<{ areaId: string; areaKey: string; percentage: number }>,
): Promise<number> {
  const { data: draftId, error: draftError } = await client.rpc('create_rule_draft', {
    p_workplace_id: membership.workplaceId,
  });
  if (draftError) throw draftError;
  if (typeof draftId !== 'string') throw new Error('create_rule_draft returned no id');

  const { error: clearError } = await client
    .from('distribution_rule_areas')
    .delete()
    .eq('rule_id', draftId);
  if (clearError) throw clearError;

  const { error: insertError } = await client.from('distribution_rule_areas').insert(
    shares.map((share) => ({
      rule_id: draftId,
      workplace_id: membership.workplaceId,
      area_id: share.areaId,
      area_key: share.areaKey,
      percentage: share.percentage,
    })),
  );
  if (insertError) throw insertError;

  const { data: version, error: activateError } = await client.rpc('activate_rule', {
    p_rule_id: draftId,
  });
  if (activateError) throw activateError;
  return typeof version === 'number' ? version : 0;
}

/* ── calculate, send, cancel ─────────────────────────────────────────────── */

export async function calculateDistribution(
  client: TipCrewClient,
  poolId: string,
): Promise<string> {
  const { data, error } = await client.rpc('calculate_distribution', { p_pool_id: poolId });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('calculate_distribution returned no id');
  return data;
}

export async function sendDistribution(client: TipCrewClient, distributionId: string): Promise<void> {
  const { error } = await client.rpc('send_distribution', { p_distribution_id: distributionId });
  if (error) throw error;
}

export async function cancelDistribution(
  client: TipCrewClient,
  distributionId: string,
  reason: string,
): Promise<void> {
  const { error } = await client.rpc('cancel_distribution', {
    p_distribution_id: distributionId,
    p_reason: reason,
  });
  if (error) throw error;
}

/* ── reading distributions back ──────────────────────────────────────────── */

export async function fetchDistributions(
  client: TipCrewClient,
  membership: Membership,
  limit = 30,
): Promise<Distribution[]> {
  const { data, error } = await client
    .from('tip_distributions')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .order('period_start', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toDistribution);
}

/**
 * A distribution and its stored entries.
 *
 * Read back from the historical record — the entries, the area subtotals and
 * the snapshots written when it was calculated. Nothing here recomputes
 * anything against today's rules, which is what makes an old payout still
 * explainable after the rules change.
 */
export async function fetchDistributionDetail(
  client: TipCrewClient,
  membership: Membership,
  distributionId: string,
): Promise<DistributionDetail | null> {
  const { data: rows, error } = await client
    .from('tip_distributions')
    .select('*')
    .eq('id', distributionId)
    .eq('workplace_id', membership.workplaceId)
    .limit(1);
  if (error) throw error;
  const row = rows?.[0];
  if (!row) return null;

  const [{ data: areas }, { data: entries }] = await Promise.all([
    client.from('tip_distribution_areas').select('*').eq('distribution_id', distributionId),
    client.from('tip_distribution_entries').select('*').eq('distribution_id', distributionId),
  ]);

  return {
    distribution: toDistribution(row),
    areas: (areas ?? []).map(toArea),
    entries: (entries ?? []).map(toEntry).sort((a, b) => b.amountCents - a.amountCents),
  };
}

/** The draft the wizard is previewing, if the pool already has one. */
export async function fetchPoolDistribution(
  client: TipCrewClient,
  membership: Membership,
  poolId: string,
): Promise<Distribution | null> {
  const { data, error } = await client
    .from('tip_distributions')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .eq('tip_pool_id', poolId)
    .in('status', ['draft', 'sent', 'confirmed'])
    .limit(1);
  if (error) throw error;
  return data && data[0] ? toDistribution(data[0]) : null;
}

/* ── the employee's side ─────────────────────────────────────────────────── */

/**
 * What the signed-in member has been paid.
 *
 * Through `member_distributions`, the one SECURITY DEFINER view in the schema:
 * employees have no policy on `tip_distributions` at all, and the view masks
 * the pool total unless the workplace has released it.
 */
export async function fetchMyDistributions(client: TipCrewClient): Promise<Distribution[]> {
  const { data, error } = await client
    .from('member_distributions')
    .select('*')
    .order('period_start', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(toMemberDistribution);
}

/** The member's own entries. Peer rows are filtered out by RLS, not by this code. */
export async function fetchMyEntries(client: TipCrewClient): Promise<DistributionEntry[]> {
  const { data, error } = await client
    .from('member_distribution_entries')
    .select('*')
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id ?? '',
    distributionId: row.distribution_id ?? '',
    memberId: row.member_id ?? '',
    memberName: row.member_name ?? '',
    areaId: row.area_id ?? '',
    areaKey: row.area_key ?? '',
    areaName: row.area_name ?? '',
    areaSource: (row.area_source ?? 'member') as DistributionEntry['areaSource'],
    roleKey: row.role_key,
    roleName: row.role_name,
    points: Number(row.points ?? 1),
    multiplier: Number(row.multiplier ?? 1),
    workedMinutes: row.worked_minutes ?? 0,
    overlapMinutes: row.overlap_minutes ?? 0,
    units: Number(row.units ?? 0),
    amountCents: row.amount_cents ?? 0,
    roundingAdjustmentCents: row.rounding_adjustment_cents ?? 0,
    shiftIds: [],
    ackStatus: (row.ack_status ?? 'pending') as DistributionEntry['ackStatus'],
    acknowledgedAt: row.acknowledged_at,
    queriedAt: row.queried_at,
    queryNote: row.query_note,
    isOwn: row.is_own ?? undefined,
  }));
}

/**
 * The area subtotals for one distribution, as far as the caller may see them.
 *
 * For an employee this returns nothing unless the workplace has released pool
 * amounts — sum(total_cents) is the pool. An empty array is the normal, correct
 * answer, not an error, so the explanation on screen simply starts a step later.
 */
export async function fetchVisibleAreas(
  client: TipCrewClient,
  distributionId: string,
): Promise<ReturnType<typeof toArea>[]> {
  const { data, error } = await client
    .from('tip_distribution_areas')
    .select('*')
    .eq('distribution_id', distributionId);
  if (error) return [];
  return (data ?? []).map(toArea);
}

/**
 * Confirms every entry the caller owns in one distribution.
 *
 * The browser sends a distribution id and never a member id — which entries
 * that means is decided in the database from the signed-in user. A member who
 * worked two areas therefore answers both in one statement, so the screen can
 * never claim a confirmation that only half happened.
 */
export async function acknowledgeDistribution(
  client: TipCrewClient,
  distributionId: string,
  status: 'acknowledged' | 'queried',
  note?: string,
): Promise<number> {
  const { data, error } = await client.rpc('acknowledge_distribution', {
    p_distribution_id: distributionId,
    p_status: status,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** The manager's per-entry acknowledgement state. Snapshot names only. */
export async function fetchAckState(
  client: TipCrewClient,
  distributionId: string,
): Promise<AckStateRow[]> {
  const { data, error } = await client.rpc('distribution_ack_state', {
    p_distribution_id: distributionId,
  });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      entry_id: string;
      member_id: string;
      member_name: string;
      area_name: string;
      ack_status: DistributionEntry['ackStatus'];
      acknowledged_at: string | null;
      queried_at: string | null;
      can_acknowledge: boolean;
    }>
  ).map((r) => ({
    entryId: r.entry_id,
    memberId: r.member_id,
    memberName: r.member_name,
    areaName: r.area_name,
    ackStatus: r.ack_status,
    acknowledgedAt: r.acknowledged_at,
    queriedAt: r.queried_at,
    canAcknowledge: r.can_acknowledge,
  }));
}

/**
 * Raises one question about a whole distribution.
 *
 * Same shape as confirming: a distribution id and a sentence, and the database
 * decides which entries that covers. A member who worked two areas asks once.
 */
export async function queryDistribution(
  client: TipCrewClient,
  distributionId: string,
  note: string,
): Promise<number> {
  const { data, error } = await client.rpc('query_distribution', {
    p_distribution_id: distributionId,
    p_note: note,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** The caller's own questions. RLS returns theirs and nobody else's. */
export async function fetchMyQueries(client: TipCrewClient): Promise<MyQuery[]> {
  const { data, error } = await client
    .from('distribution_queries')
    .select('id, distribution_id, member_id, member_name, note, raised_at, status, outcome, manager_response, resolved_at')
    .order('raised_at', { ascending: false })
    .limit(100);
  if (error) return [];
  return (data ?? []).map(toMyQuery);
}

/** Every question on one distribution, for the manager who has to answer them. */
export async function fetchQueries(
  client: TipCrewClient,
  distributionId: string,
): Promise<QueryRow[]> {
  const { data, error } = await client.rpc('distribution_query_list', {
    p_distribution_id: distributionId,
  });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      query_id: string; member_id: string; member_name: string; note: string;
      raised_at: string; status: 'open' | 'resolved';
      outcome: 'no_correction' | 'correction_required' | null;
      manager_response: string | null; resolved_at: string | null; amount_cents: number;
    }>
  ).map((r) => ({
    id: r.query_id,
    distributionId,
    memberId: r.member_id,
    memberName: r.member_name,
    note: r.note,
    raisedAt: r.raised_at,
    status: r.status,
    outcome: r.outcome,
    managerResponse: r.manager_response,
    resolvedAt: r.resolved_at,
    amountCents: r.amount_cents,
  }));
}

/**
 * The manager's answer. `no_correction` hands the confirmation back to the
 * employee; `correction_required` records that the manager agrees and leaves
 * the entries queried, because the sent distribution is never edited in place.
 */
export async function resolveQuery(
  client: TipCrewClient,
  queryId: string,
  outcome: 'no_correction' | 'correction_required',
  response?: string,
): Promise<void> {
  const { error } = await client.rpc('resolve_query', {
    p_query_id: queryId,
    p_outcome: outcome,
    ...(response ? { p_response: response } : {}),
  });
  if (error) throw error;
}

function toMyQuery(row: {
  id: string; distribution_id: string; member_id: string; member_name: string;
  note: string; raised_at: string; status: string; outcome: string | null;
  manager_response: string | null; resolved_at: string | null;
}): MyQuery {
  return {
    id: row.id,
    distributionId: row.distribution_id,
    memberId: row.member_id,
    memberName: row.member_name,
    note: row.note,
    raisedAt: row.raised_at,
    status: row.status as MyQuery['status'],
    outcome: row.outcome as MyQuery['outcome'],
    managerResponse: row.manager_response,
    resolvedAt: row.resolved_at,
  };
}

/**
 * Starts a correction: the database recalculates the original's own pool as a
 * fresh draft, linked back to what it replaces. Nothing is sent.
 */
export async function createReplacement(
  client: TipCrewClient,
  originalId: string,
  correction?: { reason: CorrectionReason; note: string },
): Promise<string> {
  const { data, error } = await client.rpc('create_replacement_distribution', {
    p_original_id: originalId,
    // Sent only for a manager-initiated correction. Without them the database
    // takes the employee-query path, exactly as it did in Phase 3J. The caller
    // never sends a workplace, a member or a lineage id — the server derives
    // every one of those.
    ...(correction ? { p_reason: correction.reason, p_note: correction.note } : {}),
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

/**
 * Record that a distribution was handed over.
 *
 * The client sends a distribution, a method and an optional note — never an
 * amount. What is settled is derived on the server from this version's
 * entitlement and whatever its lineage already settled, because the amount is
 * the one number in this product a browser must not be able to choose.
 */
export async function recordPayout(
  client: TipCrewClient,
  distributionId: string,
  method: PayoutMethod | null,
  note?: string,
): Promise<string> {
  const { data, error } = await client.rpc('record_distribution_payout', {
    p_distribution_id: distributionId,
    p_method: method,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

/** Entitlement, what the lineage already settled, and the payout if there is one. */
export async function fetchSettlement(
  client: TipCrewClient,
  distributionId: string,
): Promise<Settlement | null> {
  const { data, error } = await client
    .from('distribution_settlement')
    // One literal, not two joined with `+`: TypeScript widens a concatenation to
    // `string`, and supabase-js can only parse a select whose literal type it can
    // see. A split select silently types every row as GenericStringError.
    .select('distribution_id,entitlement_cents,settled_entitlement_cents,settlement_due_cents,payout_status,payout_id,payout_amount_cents,payout_method,payout_note,paid_at,paid_by_name')
    .eq('distribution_id', distributionId)
    .limit(1);
  if (error || !data?.[0]) return null;
  return toSettlement(data[0] as Tables<'distribution_settlement'>);
}

/**
 * Record that a payout should no longer count.
 *
 * The client sends a payout, a category and a sentence. It sends no workplace,
 * no distribution, no amount, no actor and no timestamp — every one of those is
 * derived from the payout row and the session, because a reversal is a claim
 * about a specific past payment and the browser must not get to choose which.
 */
export async function reversePayout(
  client: TipCrewClient,
  payoutId: string,
  reason: ReversalReason,
  note: string,
): Promise<string> {
  const { data, error } = await client.rpc('reverse_distribution_payout', {
    p_payout_id: payoutId,
    p_reason: reason,
    p_note: note,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

/** Every payment and reversal on one distribution, oldest first. */
export async function fetchPayoutEvents(
  client: TipCrewClient,
  distributionId: string,
): Promise<PayoutEvent[]> {
  const { data, error } = await client
    .from('distribution_payout_events')
    .select('distribution_id,payout_id,reversal_id,kind,event_at,amount_cents,method,reason,note,actor_name,still_counts')
    .eq('distribution_id', distributionId)
    .order('event_at');
  if (error) throw error;
  return (data ?? []).map((row) => toPayoutEvent(row as Tables<'distribution_payout_events'>));
}

/** Every distribution's settlement in one read, for the history list. */
export async function fetchSettlements(
  client: TipCrewClient,
  workplaceId: string,
): Promise<Record<string, Settlement>> {
  const { data, error } = await client
    .from('distribution_settlement')
    .select('distribution_id,entitlement_cents,settled_entitlement_cents,settlement_due_cents,payout_status,payout_id,payout_amount_cents,payout_method,payout_note,paid_at,paid_by_name')
    .eq('workplace_id', workplaceId);
  if (error) return {};
  const out: Record<string, Settlement> = {};
  for (const row of data ?? []) {
    const mapped = toSettlement(row as Tables<'distribution_settlement'>);
    out[mapped.distributionId] = mapped;
  }
  return out;
}

/** What each person's share did between the settled version and this one. */
export async function fetchMemberSettlement(
  client: TipCrewClient,
  distributionId: string,
): Promise<MemberSettlement[]> {
  const { data, error } = await client
    .from('distribution_member_settlement')
    .select('member_id,member_name,entitlement_cents,previously_settled_cents,difference_cents')
    .eq('distribution_id', distributionId)
    .order('member_name');
  if (error) throw error;
  return (data ?? []).map((row) =>
    toMemberSettlement(row as Tables<'distribution_member_settlement'>),
  );
}

/** The correction that replaced this distribution, if one has been sent. */
export async function fetchSupersededBy(
  client: TipCrewClient,
  distributionId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('tip_distributions')
    .select('id')
    .eq('supersedes_id', distributionId)
    // The live successor: a draft correction has replaced nothing yet, and a
    // cancelled one was abandoned.
    .in('status', ['sent', 'confirmed'])
    .limit(1);
  if (error) return null;
  return data?.[0]?.id ?? null;
}

export async function acknowledgeEntry(
  client: TipCrewClient,
  entryId: string,
  status: 'acknowledged' | 'queried',
  note?: string,
): Promise<void> {
  const { error } = await client.rpc('acknowledge_entry', {
    p_entry_id: entryId,
    p_status: status,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw error;
}
