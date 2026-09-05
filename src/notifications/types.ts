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
  | 'query_raised';

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
export const NOTIFICATION_TITLE: Record<NotificationType, StringKey> = {
  distribution_sent: 'nTitleSent',
  distribution_corrected: 'nTitleCorrected',
  query_resolved: 'nTitleAnswered',
  payout_recorded: 'nTitlePaid',
  payout_reversed: 'nTitleReversed',
  query_raised: 'nTitleAsked',
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
};

export const NOTIFICATION_ICON: Record<NotificationType, IconName> = {
  distribution_sent: 'paper-plane-tilt',
  distribution_corrected: 'arrow-counter-clockwise',
  query_resolved: 'check-circle',
  payout_recorded: 'money',
  payout_reversed: 'arrow-counter-clockwise',
  query_raised: 'info',
};

/** `query_resolved` says two different things depending on the outcome. */
export function notificationTitleKey(n: AppNotification): StringKey {
  if (n.type === 'query_resolved' && n.payload.outcome === 'correction_required') {
    return 'nTitleAnsweredCorrection';
  }
  return NOTIFICATION_TITLE[n.type];
}

export function notificationBodyKey(n: AppNotification): StringKey {
  if (n.type === 'query_resolved' && n.payload.outcome === 'correction_required') {
    return 'nBodyAnsweredCorrection';
  }
  return NOTIFICATION_BODY[n.type];
}

/** Managers land on the manager view of a night; employees on their own share. */
export function isManagerNotification(n: AppNotification): boolean {
  return n.type === 'query_raised';
}
