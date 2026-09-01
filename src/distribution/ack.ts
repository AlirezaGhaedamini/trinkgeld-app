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
import type { AckStatus, DistributionEntry } from '@/distribution/types';

/** What a screen shows. Not the same set as the database's three values. */
export type AckView = 'notRequired' | 'pending' | 'acknowledged' | 'queried';

interface AckPresentation {
  /** The employee's own wording — "you confirmed this". */
  label: StringKey;
  /** The manager's wording for one person's row. */
  managerLabel: StringKey;
  /** Whether the employee is still being asked for something. */
  showCta: boolean;
  /** Whether this counts as answered for the manager's tally. */
  answered: boolean;
  tone: 'accent' | 'subtle' | 'warning';
}

export const ACK_VIEW: Record<AckView, AckPresentation> = {
  notRequired: {
    label: 'ackNotRequired',
    managerLabel: 'ackNotRequired',
    showCta: false,
    answered: true,
    tone: 'subtle',
  },
  pending: {
    label: 'needsOK',
    managerLabel: 'ackRowPending',
    showCta: true,
    answered: false,
    tone: 'accent',
  },
  acknowledged: {
    label: 'acknowledged',
    managerLabel: 'ackRowConfirmed',
    showCta: false,
    answered: true,
    tone: 'subtle',
  },
  queried: {
    label: 'ackQueried',
    managerLabel: 'ackRowQueried',
    showCta: false,
    answered: true,
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
): AckView {
  if (!acknowledgementRequired) return 'notRequired';
  if (entries.length === 0) return 'notRequired';
  if (entries.some((e) => e.ackStatus === 'pending')) return 'pending';
  if (entries.some((e) => e.ackStatus === 'queried')) return 'queried';
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
  return { participants: byMember.size, answerable, confirmed, queried, pending };
}
