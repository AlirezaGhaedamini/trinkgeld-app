/**
 * Period close and the financial export.
 *
 * Every shape here mirrors exactly one thing: the JSON that
 * `financial_period_export()` returns. There is no second place a total could
 * come from, because the CSV is formatted from this and nothing else — a figure
 * on a spreadsheet and a figure on a screen cannot disagree when only one of
 * them was ever calculated.
 *
 * The dates are BUSINESS dates. A distribution's `period_start` was derived by
 * `app.business_day()` from the workplace's own timezone and its
 * `business_day_start_hour`, so "1 Sep" here means that workplace's 1 September
 * and not the browser's. Nothing in this module does date arithmetic.
 */

import type { Tables } from '@/types/database';

export type ReversalReasonKey =
  | 'recorded_by_mistake'
  | 'wrong_method'
  | 'wrong_distribution'
  | 'payment_not_completed'
  | 'duplicate_record'
  | 'other';

/** A recorded close. Immutable once written. */
export interface PeriodClose {
  id: string;
  workplaceId: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  closedAt: string;
  closedByName: string | null;
}

export function toPeriodClose(
  row: Tables<'financial_period_closes'> & { closed_by_name?: string | null },
): PeriodClose {
  return {
    id: row.id,
    workplaceId: row.workplace_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    note: row.note,
    closedAt: row.closed_at,
    closedByName: row.closed_by_name ?? null,
  };
}

/**
 * What stands in the way of closing, and what is merely worth knowing.
 *
 * The split is the product decision of this phase: work that leaves the
 * period's financial result undecided blocks; money that has not moved yet does
 * not, because closing the calculation before the payroll run is exactly what
 * a workplace does.
 */
export interface PeriodReadiness {
  periodStart: string;
  periodEnd: string;
  distributions: number;
  blocking: {
    draftDistributions: number;
    draftCorrections: number;
    openQuestions: number;
    agreedCorrectionsNotSent: number;
    overlappingClose: number;
  };
  warnings: {
    unpaidDistributions: number;
    unacknowledgedShares: number;
  };
  canClose: boolean;
}

export function toReadiness(raw: unknown): PeriodReadiness {
  const r = (raw ?? {}) as Record<string, never>;
  const b = (r.blocking ?? {}) as Record<string, number>;
  const w = (r.warnings ?? {}) as Record<string, number>;
  return {
    periodStart: String(r.period_start ?? ''),
    periodEnd: String(r.period_end ?? ''),
    distributions: Number(r.distributions ?? 0),
    blocking: {
      draftDistributions: Number(b.draft_distributions ?? 0),
      draftCorrections: Number(b.draft_corrections ?? 0),
      openQuestions: Number(b.open_questions ?? 0),
      agreedCorrectionsNotSent: Number(b.agreed_corrections_not_sent ?? 0),
      overlappingClose: Number(b.overlapping_close ?? 0),
    },
    warnings: {
      unpaidDistributions: Number(w.unpaid_distributions ?? 0),
      unacknowledgedShares: Number(w.unacknowledged_shares ?? 0),
    },
    canClose: Boolean(r.can_close),
  };
}

/* ── the export dataset ───────────────────────────────────────────────────── */

export interface ExportMember {
  memberName: string;
  areaName: string;
  roleName: string | null;
  workedMinutes: number;
  overlapMinutes: number;
  points: number;
  multiplier: number;
  units: number;
  amountCents: number;
  roundingAdjustmentCents: number;
  ackStatus: string;
  acknowledgedAt: string | null;
}

export interface ExportSettlementEvent {
  kind: 'payout' | 'reversal';
  payoutId: string;
  reversalId: string | null;
  eventAt: string;
  /** Negative on a reversal, so a column of these sums to what still counts. */
  amountCents: number;
  method: string | null;
  reason: string | null;
  note: string | null;
  actorName: string | null;
  stillCounts: boolean;
  /** Recorded after the manager closed this period. */
  afterClose: boolean;
}

export interface ExportDistribution {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  /** False once a correction replaced it. A replaced version owes nothing. */
  isCurrent: boolean;
  isCorrection: boolean;
  supersedesId: string | null;
  correctionSource: 'employee_query' | 'manager' | null;
  correctionReason: string | null;
  correctionNote: string | null;
  triggerQueryNote: string | null;
  ruleVersion: number;
  method: string;
  overlapBasis: string;
  minOverlapMinutes: number;
  peopleCount: number;
  poolCents: number;
  entitlementCents: number;
  createdAt: string;
  sentAt: string | null;
  afterClose: boolean;
  members: ExportMember[];
  settlement: ExportSettlementEvent[];
}

/**
 * Every number the export reports, each with exactly one definition in SQL.
 *
 * `currentEntitlementCents` counts only versions that are still current, so an
 * original and the correction that replaced it are never added together. That
 * one rule is what stops a corrected week reading as though the workplace owed
 * it twice.
 */
export interface ExportSummary {
  distributionsCurrent: number;
  distributionsReplaced: number;
  corrections: number;
  currentEntitlementCents: number;
  replacedEntitlementCents: number;
  payoutEvents: number;
  payoutTotalCents: number;
  reversalEvents: number;
  reversalTotalCents: number;
  effectiveSettledCents: number;
  outstandingCents: number;
  unresolvedQuestions: number;
  unacknowledgedShares: number;
  recordsAfterClose: number;
}

export interface ExportPeriod {
  workplaceId: string;
  workplaceName: string;
  city: string | null;
  currency: string;
  timezone: string;
  businessDayStartHour: number;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  /**
   * Always `current`. This is what TipCrew says NOW, not a reconstruction of
   * what it said at the moment of closing — see `recordsAfterClose`.
   */
  basis: 'current';
  close: {
    id: string;
    closedAt: string;
    closedByName: string | null;
    note: string | null;
  } | null;
}

export interface PeriodExport {
  period: ExportPeriod;
  summary: ExportSummary;
  distributions: ExportDistribution[];
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? '');
const nullable = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function toPeriodExport(raw: unknown): PeriodExport {
  const r = (raw ?? {}) as Record<string, never>;
  const p = (r.period ?? {}) as Record<string, never>;
  const s = (r.summary ?? {}) as Record<string, never>;
  const c = (p.close ?? null) as Record<string, never> | null;
  return {
    period: {
      workplaceId: str(p.workplace_id),
      workplaceName: str(p.workplace_name),
      city: nullable(p.city),
      currency: str(p.currency),
      timezone: str(p.timezone),
      businessDayStartHour: num(p.business_day_start_hour),
      periodStart: str(p.period_start),
      periodEnd: str(p.period_end),
      generatedAt: str(p.generated_at),
      basis: 'current',
      close: c
        ? {
            id: str(c.id),
            closedAt: str(c.closed_at),
            closedByName: nullable(c.closed_by_name),
            note: nullable(c.note),
          }
        : null,
    },
    summary: {
      distributionsCurrent: num(s.distributions_current),
      distributionsReplaced: num(s.distributions_replaced),
      corrections: num(s.corrections),
      currentEntitlementCents: num(s.current_entitlement_cents),
      replacedEntitlementCents: num(s.replaced_entitlement_cents),
      payoutEvents: num(s.payout_events),
      payoutTotalCents: num(s.payout_total_cents),
      reversalEvents: num(s.reversal_events),
      reversalTotalCents: num(s.reversal_total_cents),
      effectiveSettledCents: num(s.effective_settled_cents),
      outstandingCents: num(s.outstanding_cents),
      unresolvedQuestions: num(s.unresolved_questions),
      unacknowledgedShares: num(s.unacknowledged_shares),
      recordsAfterClose: num(s.records_after_close),
    },
    distributions: ((r.distributions ?? []) as Record<string, never>[]).map((d) => ({
      id: str(d.id),
      periodStart: str(d.period_start),
      periodEnd: str(d.period_end),
      status: str(d.status),
      isCurrent: Boolean(d.is_current),
      isCorrection: Boolean(d.is_correction),
      supersedesId: nullable(d.supersedes_id),
      correctionSource: (d.correction_source ?? null) as ExportDistribution['correctionSource'],
      correctionReason: nullable(d.correction_reason),
      correctionNote: nullable(d.correction_note),
      triggerQueryNote: nullable(d.trigger_query_note),
      ruleVersion: num(d.rule_version),
      method: str(d.method),
      overlapBasis: str(d.overlap_basis),
      minOverlapMinutes: num(d.min_overlap_minutes),
      peopleCount: num(d.people_count),
      poolCents: num(d.pool_cents),
      entitlementCents: num(d.entitlement_cents),
      createdAt: str(d.created_at),
      sentAt: nullable(d.sent_at),
      afterClose: Boolean(d.after_close),
      members: ((d.members ?? []) as Record<string, never>[]).map((m) => ({
        memberName: str(m.member_name),
        areaName: str(m.area_name),
        roleName: nullable(m.role_name),
        workedMinutes: num(m.worked_minutes),
        overlapMinutes: num(m.overlap_minutes),
        points: num(m.points),
        multiplier: num(m.multiplier),
        units: num(m.units),
        amountCents: num(m.amount_cents),
        roundingAdjustmentCents: num(m.rounding_adjustment_cents),
        ackStatus: str(m.ack_status),
        acknowledgedAt: nullable(m.acknowledged_at),
      })),
      settlement: ((d.settlement ?? []) as Record<string, never>[]).map((e) => ({
        kind: (e.kind ?? 'payout') as 'payout' | 'reversal',
        payoutId: str(e.payout_id),
        reversalId: nullable(e.reversal_id),
        eventAt: str(e.event_at),
        amountCents: num(e.amount_cents),
        method: nullable(e.method),
        reason: nullable(e.reason),
        note: nullable(e.note),
        actorName: nullable(e.actor_name),
        stillCounts: e.still_counts !== false,
        afterClose: Boolean(e.after_close),
      })),
    })),
  };
}
