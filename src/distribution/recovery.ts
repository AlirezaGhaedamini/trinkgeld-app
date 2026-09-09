/**
 * Retry after a lost response.
 *
 * A phone on a bad connection sends a mutation, the server does the work, and
 * the answer never arrives. The person taps again. The server now refuses,
 * correctly — "only a draft can be sent", zero rows deleted, "this invitation
 * has already been used" — and the screen would report a failure for a state
 * that is exactly what was wanted.
 *
 * The rule, applied narrowly: a refusal that CAN mean "already done" triggers
 * one authoritative reload of the exact record, and only if that record is
 * already in the desired final state does the operation count as a success.
 * Any other refusal, and any reload showing a different state, stays an
 * error. Nothing here swallows a failure it cannot prove.
 *
 * Pure functions, so the decision table can be tested without a browser.
 */

import type { DistributionFailure } from '@/distribution/errors';
import type { DistributionStatus } from '@/distribution/types';

/** send_distribution() refused because the row is no longer a draft. */
export function sendMayHaveSucceeded(failure: DistributionFailure | undefined): boolean {
  return failure === 'alreadySent';
}

/**
 * A reload after a refused send proves success only for sent or confirmed.
 * A cancelled or replaced row is not "sent by me just now": it was retired by
 * something else, and the person needs to see that rather than a green tick.
 */
export function sendRecovered(status: DistributionStatus | null | undefined): boolean {
  return status === 'sent' || status === 'confirmed';
}

/** DELETE matched nothing — the draft may already be gone. */
export function discardMayHaveSucceeded(failure: DistributionFailure | undefined): boolean {
  return failure === 'draftGone';
}

/**
 * A reload after a refused discard proves success only when the row is gone.
 * distributions_delete_draft cannot remove a published row, so absence means
 * the draft was deleted — by this retry's first attempt or by a recalculation.
 * A row that still exists, draft or not, is a real failure.
 */
export function discardRecovered(exists: boolean): boolean {
  return !exists;
}

/** accept_invitation() said the token was already used. */
export function acceptMayHaveSucceeded(failure: string | undefined): boolean {
  return failure === 'inviteUsed';
}

/**
 * The invitation row itself decides: it was accepted, and by this account.
 * Used by somebody else, expired, withdrawn — the original error stands.
 */
export function acceptRecovered(
  outcome: { status: string; acceptedBy: string | null } | null,
  userId: string | null,
): boolean {
  return Boolean(outcome && userId && outcome.status === 'accepted' && outcome.acceptedBy === userId);
}
