/**
 * Acknowledgement, in one place.
 *
 * Three backend values — pending, acknowledged, queried — plus a fourth state
 * the database does not have a word for: a distribution sent under a rule that
 * did not ask for confirmation. Every screen asks this module what to say, what
 * to offer and whether the answer is final, so a raw enum never reaches a page
 * and the three screens can never drift apart.
 *
 * `acknowledgementRequired` is the value frozen into the distribution when it
 * was calculated, not today's rule. A distribution sent when confirmation was
 * required keeps asking for it after the rule changes, and one sent when it was
 * not never starts.
 */

import type { StringKey } from '@/i18n/strings';
import type { PayoutMethod, PayoutStatus, ReversalReason } from '@/distribution/types';
import type { AckStatus, DistributionEntry } from '@/distribution/types';

/**
 * What a screen shows. Not the same set as the database's three values.
 *
 * `queried` splits in two once the manager has answered: `awaitingReconfirm`
 * is an entry put back to pending after "no correction needed", and
 * `correctionPending` is one the manager agreed is wrong and is redoing. The
 * database distinguishes them by entry state plus the query's outcome; the
 * screens should never work that out for themselves.
 */
export type AckView =
  | 'notRequired'
  | 'pending'
  | 'acknowledged'
  | 'queried'
  | 'awaitingReconfirm'
  | 'correctionPending';

interface AckPresentation {
  /** The employee's own wording — "you confirmed this". */
  label: StringKey;
  /** The manager's wording for one person's row. */
  managerLabel: StringKey;
  /** Whether the employee is still being asked to confirm. */
  showCta: boolean;
  /** Whether the employee may still raise a question from here. */
  showQuery: boolean;
  /**
   * Whether this counts as settled. A question is NOT settled: it is an open
   * problem the manager has to look at, and counting it as answered was the
   * defect Phase 3I was opened to fix.
   */
  answered: boolean;
  tone: 'accent' | 'subtle' | 'warning';
}

export const ACK_VIEW: Record<AckView, AckPresentation> = {
  notRequired: {
    label: 'ackNotRequired',
    managerLabel: 'ackNotRequired',
    showCta: false,
    showQuery: false,
    answered: true,
    tone: 'subtle',
  },
  pending: {
    label: 'needsOK',
    managerLabel: 'ackRowPending',
    showCta: true,
    showQuery: true,
    answered: false,
    tone: 'accent',
  },
  acknowledged: {
    label: 'acknowledged',
    managerLabel: 'ackRowConfirmed',
    showCta: false,
    showQuery: false,
    answered: true,
    tone: 'subtle',
  },
  queried: {
    label: 'ackQueried',
    managerLabel: 'ackRowQueried',
    showCta: false,
    showQuery: false,
    answered: false,
    tone: 'warning',
  },
  awaitingReconfirm: {
    label: 'ackResolvedLabel',
    managerLabel: 'ackRowResolved',
    showCta: true,
    showQuery: true,
    answered: false,
    tone: 'accent',
  },
  correctionPending: {
    label: 'ackCorrectionLabel',
    managerLabel: 'ackRowCorrection',
    showCta: false,
    showQuery: false,
    answered: false,
    tone: 'warning',
  },
};

/**
 * One person's state for one distribution, from every entry they hold in it.
 *
 * A member who worked two areas has two entries. They are answered together by
 * `acknowledge_distribution()`, so the only honest summary is the weakest of
 * them: still pending if any entry is, queried if any entry is, confirmed only
 * when every one of them is.
 */
export function ackViewFor(
  entries: DistributionEntry[],
  acknowledgementRequired: boolean,
  query?: MyQuery | null,
): AckView {
  if (!acknowledgementRequired) return 'notRequired';
  if (entries.length === 0) return 'notRequired';

  if (entries.some((e) => e.ackStatus === 'queried')) {
    // Still queried after the manager answered means they agreed something is
    // wrong: the correction is coming, and there is nothing to confirm.
    return query?.status === 'resolved' && query.outcome === 'correction_required'
      ? 'correctionPending'
      : 'queried';
  }
  if (entries.some((e) => e.ackStatus === 'pending')) {
    // Back to pending with an answered question behind it is a different thing
    // to say than plain "needs your OK".
    return query?.status === 'resolved' ? 'awaitingReconfirm' : 'pending';
  }
  return 'acknowledged';
}

/** The earliest moment any of the entries was confirmed, or null. */
export function acknowledgedAtFor(entries: DistributionEntry[]): string | null {
  const stamps = entries
    .map((e) => e.acknowledgedAt)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort();
  return stamps[0] ?? null;
}

/**
 * The employee's own question about one distribution, as they can read it back
 * from `distribution_queries` — their words, and the manager's answer if one
 * has been given.
 */
export interface MyQuery {
  id: string;
  distributionId: string;
  memberId: string;
  memberName: string;
  note: string;
  raisedAt: string;
  status: 'open' | 'resolved';
  outcome: 'no_correction' | 'correction_required' | null;
  managerResponse: string | null;
  resolvedAt: string | null;
}

/** One question as the manager reads it, from `distribution_query_list`. */
export interface QueryRow extends MyQuery {
  /** What this person was paid across every area, so the manager sees the stake. */
  amountCents: number;
}

/** The longest a question or an answer may be, matching the column checks. */
export const QUERY_NOTE_MAX = 500;

/** A row of the manager's per-entry state, as `distribution_ack_state` returns it. */
export interface AckStateRow {
  entryId: string;
  memberId: string;
  memberName: string;
  areaName: string;
  ackStatus: AckStatus;
  acknowledgedAt: string | null;
  queriedAt: string | null;
  /** False for a roster placeholder with no account: nobody can answer for them. */
  canAcknowledge: boolean;
}

export interface AckTally {
  /** Everyone the distribution paid, placeholders included. */
  participants: number;
  /** How many of them could answer at all. */
  answerable: number;
  confirmed: number;
  queried: number;
  pending: number;
  /**
   * Everyone who still owes an answer or has asked a question — the number the
   * manager has to act on. Confirmed is NOT its complement when somebody has
   * queried, which is exactly the arithmetic Phase 3I had to correct.
   */
  outstanding: number;
}

/**
 * The manager's counts, per person rather than per entry.
 *
 * Counting entries would make "9 of 8 confirmed" whenever somebody worked two
 * areas, and counting everyone would leave a roster placeholder outstanding for
 * ever. Both are fixed by grouping on member and only counting those who have
 * an account — which is exactly the set the engine uses to decide when a
 * distribution is fully confirmed.
 */
export function tally(rows: AckStateRow[]): AckTally {
  const byMember = new Map<string, AckStateRow[]>();
  for (const row of rows) {
    const list = byMember.get(row.memberId);
    if (list) list.push(row);
    else byMember.set(row.memberId, [row]);
  }

  let answerable = 0, confirmed = 0, queried = 0, pending = 0;
  for (const list of byMember.values()) {
    if (!list.every((r) => r.canAcknowledge)) continue;
    answerable += 1;
    if (list.some((r) => r.ackStatus === 'pending')) pending += 1;
    else if (list.some((r) => r.ackStatus === 'queried')) queried += 1;
    else confirmed += 1;
  }
  return {
    participants: byMember.size, answerable, confirmed, queried, pending,
    outstanding: pending + queried,
  };
}

/* ── corrections ─────────────────────────────────────────────────────────── */

/**
 * How a distribution stands in its correction chain.
 *
 * `replaced` is derived from lineage, not from a status: the row is `cancelled`
 * like any other cancellation, and what makes it a replacement rather than an
 * abandonment is that something supersedes it. Reading it from `supersededBy`
 * keeps one truth instead of a status that could disagree with the chain.
 */
export type LineageView = 'original' | 'replaced' | 'correction' | 'cancelled';

export function lineageOf(d: {
  status: string;
  supersedesId: string | null;
  supersededBy: string | null;
}): LineageView {
  if (d.supersededBy) return 'replaced';
  if (d.status === 'cancelled') return 'cancelled';
  return d.supersedesId ? 'correction' : 'original';
}

/**
 * The version of a night that is current, starting from any version of it.
 *
 * A notification names the distribution the event happened on, which is the
 * honest historical record and cannot be rewritten later. But by the time
 * somebody taps it, that version may have been replaced — and a cancelled
 * distribution is not actionable, so landing them there would be a dead end.
 * This walks `supersededBy` forward over the rows the member can already read
 * and returns the head.
 *
 * It relies on migration 31: before that fix `superseded_by` asked whether the
 * successor was still LIVE, so it went null down a chain A <- B <- C and the
 * walk stopped at A. Since 31 it is durable publication evidence, so each link
 * survives being retired and the chain stays traversable.
 *
 * The step limit matches the database's own guard on lineage depth. Falls back
 * to the id it was given when there is no successor, which is the common case.
 */
export function lineageHeadId(
  rows: Array<{ id: string; supersededBy: string | null }>,
  startId: string,
): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let at = startId;
  for (let step = 0; step < 64; step += 1) {
    const next = byId.get(at)?.supersededBy;
    if (!next || next === at) return at;
    at = next;
  }
  return at;
}

export const LINEAGE_LABEL: Record<LineageView, StringKey | null> = {
  original: null,
  replaced: 'corrReplaced',
  correction: 'corrCorrected',
  cancelled: 'dCancelledLabel',
};

/** One person's total across however many areas they hold in a distribution. */
export function totalFor(
  entries: Array<{ memberId: string; amountCents: number }>,
  memberId: string,
): number {
  return entries
    .filter((e) => e.memberId === memberId)
    .reduce((sum, e) => sum + e.amountCents, 0);
}

export interface CorrectionDelta {
  memberId: string;
  memberName: string;
  beforeCents: number;
  afterCents: number;
  deltaCents: number;
}

/**
 * What the correction changed, per person.
 *
 * Compared by member and not by entry, because a correction may move somebody
 * between areas: the entry ids and even the area set need not match between the
 * two versions. Derived for display only — nothing is stored, and both sides
 * are read from immutable rows.
 */
export function correctionDeltas(
  before: Array<{ memberId: string; memberName: string; amountCents: number }>,
  after: Array<{ memberId: string; memberName: string; amountCents: number }>,
): CorrectionDelta[] {
  const names = new Map<string, string>();
  for (const e of [...before, ...after]) names.set(e.memberId, e.memberName);

  const out: CorrectionDelta[] = [];
  for (const [memberId, memberName] of names) {
    const beforeCents = totalFor(before, memberId);
    const afterCents = totalFor(after, memberId);
    out.push({ memberId, memberName, beforeCents, afterCents, deltaCents: afterCents - beforeCents });
  }
  return out.sort((a, b) => a.memberName.localeCompare(b.memberName));
}

/* ── manager-initiated corrections ───────────────────────────────────────── */

/**
 * Why a manager corrected a distribution themselves.
 *
 * Mirrors the `correction_reason` enum. A correction raised by an employee's
 * question has none of these — the question is the reason — so the two are
 * mutually exclusive, in the database and here.
 */
export type CorrectionReason =
  | 'hours' | 'area' | 'role' | 'multiplier' | 'tip_amount' | 'rule' | 'other';

export const CORRECTION_REASONS: CorrectionReason[] = [
  'hours', 'area', 'role', 'multiplier', 'tip_amount', 'rule', 'other',
];

export const CORRECTION_REASON_LABEL: Record<CorrectionReason, StringKey> = {
  hours: 'corrReasonHours',
  area: 'corrReasonArea',
  role: 'corrReasonRole',
  multiplier: 'corrReasonMultiplier',
  tip_amount: 'corrReasonTipAmount',
  rule: 'corrReasonRule',
  other: 'corrReasonOther',
};

/** The longest a correction note may be, matching the column check. */
export const CORRECTION_NOTE_MAX = 500;

/**
 * What the database means by a blank correction note.
 *
 * The same explicit character set `app.trimmed_note()` uses in migration 25 —
 * ASCII whitespace plus the four invisible characters a paste out of a word
 * processor actually produces. JavaScript's own `.trim()` is close but not the
 * same: it leaves a zero-width space standing, which the screen would then
 * accept and the backend would refuse. Keeping the two definitions identical is
 * what stops the button from offering a correction the server will reject.
 */
const NOTE_BLANK =
  /^[ \t\n\r\f\v\u00a0\u202f\u200b\u3000\ufeff]+|[ \t\n\r\f\v\u00a0\u202f\u200b\u3000\ufeff]+$/g;

export function trimmedNote(value: string): string {
  return value.replace(NOTE_BLANK, '');
}

/**
 * Which door a correction came through.
 *
 * Derived, never stored: a replacement either names the question that prompted
 * it or carries the manager's own reason, and a stored third copy could
 * disagree with both.
 */
export type CorrectionSource = 'employeeQuery' | 'manager' | null;

export function correctionSourceOf(d: {
  supersedesId: string | null;
  triggerQueryId: string | null;
  correctionReason: CorrectionReason | null;
}): CorrectionSource {
  if (!d.supersedesId) return null;
  if (d.triggerQueryId) return 'employeeQuery';
  return d.correctionReason ? 'manager' : null;
}

/* ── payout ──────────────────────────────────────────────────────────────── */

/**
 * How the money was handed over. Only what a restaurant can answer without
 * thinking; `other` keeps the list short instead of growing it per workplace.
 */
export const PAYOUT_METHODS: PayoutMethod[] = ['cash', 'payroll', 'bank_transfer', 'other'];

export const PAYOUT_METHOD_LABEL: Record<PayoutMethod, StringKey> = {
  cash: 'poMethodCash',
  payroll: 'poMethodPayroll',
  bank_transfer: 'poMethodBank',
  other: 'poMethodOther',
};

export const PAYOUT_NOTE_MAX = 500;

/**
 * One person's correction difference, from the two records they can already
 * read: their share on this version, and their share on the version the
 * workplace actually settled.
 *
 * Returns null when there is nothing to compare — either the lineage was never
 * settled, or this is not a correction at all — so the screen can say nothing
 * rather than say zero.
 */
export function ownDifference(
  currentCents: number,
  settledCents: number | null,
): { current: number; previous: number; difference: number } | null {
  if (settledCents === null) return null;
  return {
    current: currentCents,
    previous: settledCents,
    difference: currentCents - settledCents,
  };
}

/* ── reversal ────────────────────────────────────────────────────────────── */

/**
 * Why a payout record is being taken back.
 *
 * Every one of these is a statement about TipCrew's RECORD, not about money:
 * "payment not completed" means the transfer never went out, not that it was
 * clawed back.
 */
export const REVERSAL_REASONS: ReversalReason[] = [
  'recorded_by_mistake',
  'payment_not_completed',
  'wrong_method',
  'wrong_distribution',
  'duplicate_record',
  'other',
];

export const REVERSAL_REASON_LABEL: Record<ReversalReason, StringKey> = {
  recorded_by_mistake: 'revReasonMistake',
  payment_not_completed: 'revReasonNotCompleted',
  wrong_method: 'revReasonMethod',
  wrong_distribution: 'revReasonDistribution',
  duplicate_record: 'revReasonDuplicate',
  other: 'revReasonOther',
};

export const REVERSAL_NOTE_MAX = 500;

/** What a payout state should say on screen, for either side. */
export const PAYOUT_STATE_LABEL: Record<PayoutStatus, StringKey> = {
  unpaid: 'poUnpaid',
  paid: 'poPaid',
  reversed: 'revState',
};
