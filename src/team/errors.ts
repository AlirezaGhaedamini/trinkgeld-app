/**
 * Roster failures, translated.
 *
 * Every one of these is something the manager can fix on the screen they are
 * already looking at, so the message says which control to move.
 */

import type { StringKey } from '@/i18n/strings';

export type TeamFailure =
  | 'notManager'
  | 'lastManager'
  | 'foreignWorkplace'
  | 'roleNotInArea'
  | 'archivedTarget'
  | 'multiplierRange'
  | 'alreadyHandled'
  | 'alreadyMember'
  | 'noEmail'
  | 'stillReferenced'
  | 'network'
  | 'notConfigured'
  | 'unknown';

export const TEAM_FAILURE_KEY: Record<TeamFailure, StringKey> = {
  notManager: 'ruleErrNotManager',
  lastManager: 'tmErrLastManager',
  foreignWorkplace: 'ruleErrForeignArea',
  roleNotInArea: 'tmErrRoleArea',
  archivedTarget: 'cfgErrArchived',
  multiplierRange: 'tmErrMultiplier',
  alreadyHandled: 'tmErrHandled',
  alreadyMember: 'tmErrAlreadyMember',
  noEmail: 'tmErrNoEmail',
  stillReferenced: 'cfgErrReferenced',
  network: 'authNetwork',
  notConfigured: 'authNotConfigured',
  unknown: 'authUnknown',
};

interface PostgrestErrorish {
  code?: string;
  message?: string;
  details?: string;
  name?: string;
}

export function classifyTeamError(error: unknown): TeamFailure {
  if (!error) return 'unknown';
  const e = error as PostgrestErrorish;
  const message = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  const code = e.code ?? '';

  if (
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }

  if (message.includes('at least one active manager')) return 'lastManager';
  if (message.includes('belongs to another area')) return 'roleNotInArea';
  if (message.includes('belongs to a different workplace')) return 'foreignWorkplace';
  if (message.includes('has been archived')) return 'archivedTarget';
  if (message.includes('multiplier')) return 'multiplierRange';
  if (message.includes('already been handled')) return 'alreadyHandled';
  if (message.includes('already in this workplace')) return 'alreadyMember';
  if (message.includes('needs an email address')) return 'noEmail';
  if (code === '23503') return 'stillReferenced';
  if (message.includes('only a manager')) return 'notManager';
  if (code === '42501') return 'notManager';
  if (code === '23514' && message.includes('manager')) return 'lastManager';

  return 'unknown';
}
