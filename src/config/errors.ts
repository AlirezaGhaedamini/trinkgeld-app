/**
 * Area and role failures, translated.
 *
 * Every refusal here is one the manager can act on — move these people, finish
 * that shift, take this area's share down to zero — so the message says which,
 * and the count the database reported comes with it.
 */

import type { StringKey } from '@/i18n/strings';

export type ConfigFailure =
  | 'notManager'
  | 'nameTaken'
  | 'nameEmpty'
  | 'inUseMembers'
  | 'inUseShifts'
  | 'inUseRoles'
  | 'inUseRules'
  | 'archivedTarget'
  | 'stillReferenced'
  | 'foreignWorkplace'
  | 'pointsRange'
  | 'network'
  | 'notConfigured'
  | 'unknown';

export const CONFIG_FAILURE_KEY: Record<ConfigFailure, StringKey> = {
  notManager: 'ruleErrNotManager',
  nameTaken: 'cfgErrNameTaken',
  nameEmpty: 'cfgErrNameEmpty',
  inUseMembers: 'cfgErrMembers',
  inUseShifts: 'cfgErrShifts',
  inUseRoles: 'cfgErrRoles',
  inUseRules: 'cfgErrRules',
  archivedTarget: 'cfgErrArchived',
  stillReferenced: 'cfgErrReferenced',
  foreignWorkplace: 'ruleErrForeignArea',
  pointsRange: 'ruleErrPoints',
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

/** The number the database counted, so the message can name it. */
export function countFromError(error: unknown): number | null {
  const message = (error as PostgrestErrorish | null)?.message ?? '';
  const match = /(\d+)\s+(?:team member|shift|role)/.exec(message);
  return match ? Number(match[1]) : null;
}

export function classifyConfigError(error: unknown): ConfigFailure {
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

  if (message.includes('already has an area called')) return 'nameTaken';
  if (message.includes('already has a role called')) return 'nameTaken';
  if (message.includes('needs a name') || message.includes('no letters or digits')) return 'nameEmpty';
  if (message.includes('default for') && message.includes('team member')) return 'inUseMembers';
  if (message.includes('shift(s) that are not finished')) return 'inUseShifts';
  if (message.includes('role(s) in it')) return 'inUseRoles';
  if (message.includes('share of the pool in the rules')) return 'inUseRules';
  if (message.includes('has been archived')) return 'archivedTarget';
  if (message.includes('restore it before putting a role in it')) return 'archivedTarget';
  if (message.includes('from another workplace') || message.includes('from another area')) {
    return 'foreignWorkplace';
  }
  if (message.includes('points_check')) return 'pointsRange';
  // on delete restrict, reported by PostgreSQL as a foreign-key violation.
  if (code === '23503' || message.includes('still referenced')) return 'stillReferenced';
  if (message.includes('only a manager')) return 'notManager';
  if (code === '42501') return 'notManager';

  return 'unknown';
}
