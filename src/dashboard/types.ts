/**
 * The manager dashboard, as the screen wants it.
 *
 * Every shape here mirrors exactly one thing: the JSON `manager_dashboard()`
 * returns. Nothing is recomputed on this side. The business day, the week, the
 * acknowledgement tally, what is owed and what is still to pay were all decided
 * by the database from definitions that already existed, and the mapper below
 * only renames snake_case to camelCase and coerces types.
 *
 * Amounts are integer cents throughout and are divided only for display.
 */

import type { DistributionStatus, PayoutStatus } from '@/distribution/types';

export type PoolState = 'open' | 'locked' | 'distributed';

export interface DashboardAttention {
  submittedShifts: number;
  openQuestions: number;
  /** The most recent distribution with an open question, for the deep link. */
  openQuestionDistributionId: string | null;
  agreedCorrectionsNotSent: number;
  agreedCorrectionDistributionId: string | null;
  draftDistributions: number;
  draftDistributionId: string | null;
  draftCorrections: number;
  draftCorrectionId: string | null;
  pendingJoinRequests: number;
}

export interface DashboardTonight {
  approvedPeople: number;
  approvedMinutes: number;
  submittedShifts: number;
  reportsCount: number;
  reportsTotalCents: number;
  pool: { id: string; status: PoolState; totalCents: number } | null;
  distribution: { id: string; status: DistributionStatus; isCorrection: boolean } | null;
}

/**
 * The most recent night that was sent. The acknowledgement figures are PEOPLE,
 * tallied by the database with the same precedence as `tally()` in
 * `src/distribution/ack.ts`: a person is pending if any of their entries is,
 * else queried if any is, else confirmed — and a roster placeholder with no
 * account is not answerable at all.
 */
export interface DashboardLatest {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: DistributionStatus;
  isCorrection: boolean;
  peopleCount: number;
  entitlementCents: number;
  acknowledgementRequired: boolean;
  participants: number;
  answerablePeople: number;
  confirmedPeople: number;
  pendingPeople: number;
  queriedPeople: number;
  openQuestions: number;
  payoutState: PayoutStatus;
  settlementDueCents: number;
}

export interface DashboardRecent {
  id: string;
  periodStart: string;
  status: DistributionStatus;
  isCorrection: boolean;
  peopleCount: number;
  entitlementCents: number;
  /** Null for a draft, which has no settlement yet. */
  payoutState: PayoutStatus | null;
}

export interface ManagerDashboard {
  /** Decided by app.business_day(now(), workplace) — never by this device. */
  businessDate: string;
  weekStart: string;
  weekEnd: string;
  attention: DashboardAttention;
  tonight: DashboardTonight;
  latest: DashboardLatest | null;
  week: { distributions: number; entitlementCents: number };
  settlement: { unpaidDistributions: number; outstandingCents: number };
  close: { id: string; periodStart: string; periodEnd: string; closedAt: string } | null;
  team: { activeMembers: number };
  recent: DashboardRecent[];
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? '');
const nullable = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function toDashboard(raw: unknown): ManagerDashboard {
  const r = (raw ?? {}) as Record<string, never>;
  const a = (r.attention ?? {}) as Record<string, never>;
  const t = (r.tonight ?? {}) as Record<string, never>;
  const l = (r.latest ?? null) as Record<string, never> | null;
  const w = (r.week ?? {}) as Record<string, never>;
  const s = (r.settlement ?? {}) as Record<string, never>;
  const c = (r.close ?? null) as Record<string, never> | null;
  const tm = (r.team ?? {}) as Record<string, never>;
  const pool = (t.pool ?? null) as Record<string, never> | null;
  const tonightDist = (t.distribution ?? null) as Record<string, never> | null;

  return {
    businessDate: str(r.business_date),
    weekStart: str(r.week_start),
    weekEnd: str(r.week_end),
    attention: {
      submittedShifts: num(a.submitted_shifts),
      openQuestions: num(a.open_questions),
      openQuestionDistributionId: nullable(a.open_question_distribution_id),
      agreedCorrectionsNotSent: num(a.agreed_corrections_not_sent),
      agreedCorrectionDistributionId: nullable(a.agreed_correction_distribution_id),
      draftDistributions: num(a.draft_distributions),
      draftDistributionId: nullable(a.draft_distribution_id),
      draftCorrections: num(a.draft_corrections),
      draftCorrectionId: nullable(a.draft_correction_id),
      pendingJoinRequests: num(a.pending_join_requests),
    },
    tonight: {
      approvedPeople: num(t.approved_people),
      approvedMinutes: num(t.approved_minutes),
      submittedShifts: num(t.submitted_shifts),
      reportsCount: num(t.reports_count),
      reportsTotalCents: num(t.reports_total_cents),
      pool: pool
        ? { id: str(pool.id), status: str(pool.status) as PoolState, totalCents: num(pool.total_cents) }
        : null,
      distribution: tonightDist
        ? {
            id: str(tonightDist.id),
            status: str(tonightDist.status) as DistributionStatus,
            isCorrection: Boolean(tonightDist.is_correction),
          }
        : null,
    },
    latest: l
      ? {
          id: str(l.id),
          periodStart: str(l.period_start),
          periodEnd: str(l.period_end),
          status: str(l.status) as DistributionStatus,
          isCorrection: Boolean(l.is_correction),
          peopleCount: num(l.people_count),
          entitlementCents: num(l.entitlement_cents),
          acknowledgementRequired: l.acknowledgement_required !== false,
          participants: num(l.participants),
          answerablePeople: num(l.answerable_people),
          confirmedPeople: num(l.confirmed_people),
          pendingPeople: num(l.pending_people),
          queriedPeople: num(l.queried_people),
          openQuestions: num(l.open_questions),
          payoutState: (str(l.payout_state) || 'unpaid') as PayoutStatus,
          settlementDueCents: num(l.settlement_due_cents),
        }
      : null,
    week: { distributions: num(w.distributions), entitlementCents: num(w.entitlement_cents) },
    settlement: {
      unpaidDistributions: num(s.unpaid_distributions),
      outstandingCents: num(s.outstanding_cents),
    },
    close: c
      ? {
          id: str(c.id),
          periodStart: str(c.period_start),
          periodEnd: str(c.period_end),
          closedAt: str(c.closed_at),
        }
      : null,
    team: { activeMembers: num(tm.active_members) },
    recent: ((r.recent ?? []) as Record<string, never>[]).map((d) => ({
      id: str(d.id),
      periodStart: str(d.period_start),
      status: str(d.status) as DistributionStatus,
      isCorrection: Boolean(d.is_correction),
      peopleCount: num(d.people_count),
      entitlementCents: num(d.entitlement_cents),
      payoutState: d.payout_state ? (str(d.payout_state) as PayoutStatus) : null,
    })),
  };
}

/** Whether the attention card has anything to say. */
export function attentionCount(a: DashboardAttention): number {
  return (
    a.submittedShifts +
    a.openQuestions +
    a.agreedCorrectionsNotSent +
    a.draftDistributions +
    a.draftCorrections +
    a.pendingJoinRequests
  );
}
