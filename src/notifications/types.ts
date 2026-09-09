/**
 * Notifications, as the screens want them.
 *
 * A notification carries no money. The database deliberately stores a typed
 * event plus a couple of neutral rendering facts, and the amount a person was
 * paid is read live from `member_distributions` when they open the payout
 * screen. That keeps `pool_amount_visible_to_members` and `peer_entry_visibility`
 * enforced in exactly one place, so the inbox can never become a second, weaker
 * route to something the privacy rules hide.
 *
 * The sentence is built here rather than stored: `strings.ts` owns the wording
 * in both languages, so a copy change is not a data migration.
 */

import type { Tables } from '@/types/database';
import type { StringKey } from '@/i18n/strings';
import type { IconName } from '@/lib/icons';

export type NotificationType =
  | 'distribution_sent'
  | 'distribution_corrected'
  | 'query_resolved'
  | 'payout_recorded'
  | 'payout_reversed'
  | 'query_raised'
  | 'shift_rejected';

/** The neutral facts the backend allows itself to store for rendering. */
export interface NotificationPayload {
  period_start?: string;
  period_end?: string;
  /** Manager-facing only: who asked. An employee never receives a peer's name. */
  member_name?: string;
  /** `query_resolved` only. Decides which sentence the employee reads. */
  outcome?: 'no_correction' | 'correction_required' | null;
  /** `payout_recorded` only. How it was handed over, never how much. */
  method?: string | null;
  /** `shift_rejected` only. The business day of the shift; the note stays on the shift. */
  work_date?: string;
}

export interface AppNotification {
  id: string;
  workplaceId: string;
  memberId: string;
  type: NotificationType;
  /** The night this is about. The link target is resolved from it, not to it. */
  distributionId: string | null;
  queryId: string | null;
  payoutId: string | null;
  reversalId: string | null;
  /** `shift_rejected` only: the shift to open, by id — the screen resolves it under the member's own row policy. */
  shiftId: string | null;
  payload: NotificationPayload;
  createdAt: string;
  readAt: string | null;
}

export function toNotification(row: Tables<'member_notifications'>): AppNotification {
  const payload = (row.payload ?? {}) as NotificationPayload;
  return {
    id: row.id,
    workplaceId: row.workplace_id,
    memberId: row.member_id,
    type: row.type as NotificationType,
    distributionId: row.distribution_id,
    queryId: row.query_id,
    payoutId: row.payout_id,
    reversalId: row.reversal_id,
    shiftId: row.shift_id,
    payload: payload && typeof payload === 'object' ? payload : {},
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/**
 * The headline for each event.
 *
 * `query_resolved` is the one that splits: the manager either handed the
 * confirmation back or agreed a correction is coming, and those are different
 * things to tell somebody. `notificationTitleKey()` picks between them.
 */
/** The types THIS build understands. A newer server may know more. */
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'distribution_sent',
  'distribution_corrected',
  'query_resolved',
  'payout_recorded',
  'payout_reversed',
  'query_raised',
  'shift_rejected',
];

/**
 * toNotification() casts whatever string the database sent, because the
 * database may legitimately know a type this build does not: `shift_rejected`
 * was exactly that for every tab open while it shipped. An unmapped type used
 * to hand `undefined` to t(), whose caller then threw on `.replace()` inside
 * render and unmounted the whole app.
 */
export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export const NOTIFICATION_TITLE: Record<NotificationType, StringKey> = {
  distribution_sent: 'nTitleSent',
  distribution_corrected: 'nTitleCorrected',
  query_resolved: 'nTitleAnswered',
  payout_recorded: 'nTitlePaid',
  payout_reversed: 'nTitleReversed',
  query_raised: 'nTitleAsked',
  shift_rejected: 'nTitleShiftRejected',
};

export const NOTIFICATION_BODY: Record<NotificationType, StringKey> = {
  distribution_sent: 'nBodySent',
  distribution_corrected: 'nBodyCorrected',
  query_resolved: 'nBodyAnswered',
  payout_recorded: 'nBodyPaid',
  // Neutral on purpose. A reversal corrects TipCrew's RECORD of a payment. It
  // is not a clawback, not a reversed transfer, and never a debt.
  payout_reversed: 'nBodyReversed',
  query_raised: 'nBodyAsked',
  // The date comes from the payload; the manager's note is read from the
  // shift itself when the link opens it, never from here.
  shift_rejected: 'nBodyShiftRejected',
};

export const NOTIFICATION_ICON: Record<NotificationType, IconName> = {
  distribution_sent: 'paper-plane-tilt',
  distribution_corrected: 'arrow-counter-clockwise',
  query_resolved: 'check-circle',
  payout_recorded: 'money',
  payout_reversed: 'arrow-counter-clockwise',
  query_raised: 'info',
  shift_rejected: 'warning-circle',
};

/**
 * The three lookups the inbox renders from, made TOTAL. An event this build
 * cannot describe is shown as exactly that, which is the truth, and a reload
 * onto a newer build resolves it.
 */
/** `query_resolved` says two different things depending on the outcome. */
export function notificationTitleKey(n: AppNotification): StringKey {
  if (!isNotificationType(n.type)) return 'nTitleUnknown';
  if (n.type === 'query_resolved' && n.payload.outcome === 'correction_required') {
    return 'nTitleAnsweredCorrection';
  }
  return NOTIFICATION_TITLE[n.type];
}

export function notificationBodyKey(n: AppNotification): StringKey {
  if (!isNotificationType(n.type)) return 'nBodyUnknown';
  if (n.type === 'query_resolved' && n.payload.outcome === 'correction_required') {
    return 'nBodyAnsweredCorrection';
  }
  return NOTIFICATION_BODY[n.type];
}

export function notificationIcon(n: AppNotification): IconName {
  return isNotificationType(n.type) ? NOTIFICATION_ICON[n.type] : 'info';
}

/**
 * Where a notification takes you, as a route, or null when it takes you
 * nowhere.
 *
 * Pure, and the ONE definition: the screen draws its chevron from this and
 * navigates with this, so a row can never offer a tap that goes somewhere
 * else, and scripts/client-logic-check.mjs drives the same function the UI
 * does rather than a copy of its rules.
 *
 * A manager goes to the manager view of the night, which handles every
 * version including a replaced one. An employee goes to their own share, and
 * to the version that is CURRENT, resolved forward through the lineage, so
 * nobody is dropped onto a cancelled distribution they can no longer act on
 * when a live replacement exists.
 */
export interface NotificationTargetContext {
  role: 'manager' | 'employee' | null;
  /** The distributions this person may actually read. */
  distributions: ReadonlyArray<{ id: string; supersededBy: string | null }>;
  /** Injected, so this module needs no import from the distribution layer. */
  lineageHeadId: (
    rows: ReadonlyArray<{ id: string; supersededBy: string | null }>,
    startId: string,
  ) => string;
}

export function notificationTarget(
  n: AppNotification,
  ctx: NotificationTargetContext,
): string | null {
  /* An event this build does not understand leads nowhere: no chevron, no
     tap, no guess at a route that may not exist in this build yet. */
  if (!isNotificationType(n.type)) return null;

  /* A shift sent back opens that exact shift, pinned, on the hours screen.
     The id is resolved there under the member's own row policy, so a stale
     or foreign id lands on "not available", never on somebody else's row. */
  if (n.type === 'shift_rejected') {
    return n.shiftId ? `/hours?shift=${encodeURIComponent(n.shiftId)}` : null;
  }

  if (!n.distributionId) return null;
  if (isManagerNotification(n) || ctx.role === 'manager') {
    return `/manager/distributions/${n.distributionId}`;
  }

  const head = ctx.lineageHeadId(ctx.distributions, n.distributionId);
  if (ctx.distributions.some((d) => d.id === head)) return `/payout/${head}`;

  /* A member can be dropped from a correction: their hours rejected, their
     area moved to a zero share, and then they hold no entry on the version
     the notification names, so member_distributions will not show it to them.
     They still hold an entry on the version it replaced, which is exactly the
     row whose superseded_by (migration 31) points at what they cannot see.
     Land them there, where the "Replaced" badge tells the story. Never on a
     route the database would answer with nothing. */
  const predecessor = ctx.distributions.find(
    (d) => d.supersededBy === head || d.supersededBy === n.distributionId,
  );
  return predecessor ? `/payout/${predecessor.id}` : null;
}

/** Managers land on the manager view of a night; employees on their own share. */
export function isManagerNotification(n: AppNotification): boolean {
  return n.type === 'query_raised';
}
