/**
 * Workplace and invitation failures, translated.
 *
 * The Phase 2 RPCs raise with deliberate SQLSTATEs — 42501 for "you may not",
 * 22023 for "that argument is wrong", 23505 for "already there" — and with
 * messages written for a developer reading a log, not for someone standing in a
 * kitchen. Nothing from PostgreSQL or PostgREST reaches the screen: the message
 * text is matched here only to pick which translated sentence to show.
 */

import type { StringKey } from '@/i18n/strings';

export type WorkplaceFailure =
  | 'nameRequired'
  | 'createFailed'
  | 'invalidCode'
  | 'invalidInvite'
  | 'inviteExpired'
  | 'inviteUsed'
  | 'alreadyMember'
  | 'notAllowed'
  | 'network'
  | 'notConfigured'
  | 'unknown';

export const WORKPLACE_FAILURE_KEY: Record<WorkplaceFailure, StringKey> = {
  nameRequired: 'wpNeedName',
  createFailed: 'wpCreateFailed',
  invalidCode: 'wpInvalidCode',
  invalidInvite: 'wpInvalidInvite',
  inviteExpired: 'wpInviteExpired',
  inviteUsed: 'wpInviteUsed',
  alreadyMember: 'wpAlreadyMember',
  notAllowed: 'wpNotAllowed',
  network: 'authNetwork',
  notConfigured: 'authNotConfigured',
  unknown: 'authUnknown',
};

interface PostgrestErrorish {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  name?: string;
}

function isNetwork(e: PostgrestErrorish): boolean {
  const message = (e.message ?? '').toLowerCase();
  return (
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  );
}

/**
 * Classify a failure from one of the workplace RPCs.
 *
 * `context` disambiguates the shared codes: 42501 from accept_invitation means
 * the token was wrong, while 42501 from create_workplace means the session is
 * not usable.
 */
export function classifyWorkplaceError(
  error: unknown,
  context: 'create' | 'join' | 'invite' | 'load',
): WorkplaceFailure {
  if (!error) return 'unknown';
  const e = error as PostgrestErrorish;
  if (isNetwork(e)) return 'network';

  const message = (e.message ?? '').toLowerCase();
  const code = e.code ?? '';

  if (message.includes('already in this workplace') || code === '23505') return 'alreadyMember';
  if (message.includes('has expired')) return 'inviteExpired';
  if (message.includes('already been used') || message.includes('withdrawn')) return 'inviteUsed';
  if (message.includes('did not match an open workplace')) return 'invalidCode';
  if (message.includes('invitation not found')) return 'invalidInvite';
  if (message.includes('needs a name')) return 'nameRequired';

  if (code === '42501') {
    if (context === 'invite') return 'invalidInvite';
    if (context === 'join') return 'invalidCode';
    return 'notAllowed';
  }
  if (code === '22023') return context === 'create' ? 'nameRequired' : 'invalidCode';

  return context === 'create' ? 'createFailed' : 'unknown';
}
