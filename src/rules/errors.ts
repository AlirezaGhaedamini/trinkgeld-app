/**
 * Rules-editor failures, translated.
 *
 * The database refuses in its own words; the manager needs to be told which
 * field to fix. Nothing here ever puts a SQLSTATE or a PostgREST payload on the
 * screen.
 */

import type { StringKey } from '@/i18n/strings';

export type RuleFailure =
  | 'notManager'
  | 'frozen'
  | 'sharesNot100'
  | 'unsupportedBasis'
  | 'minOverlapRange'
  | 'pointsRange'
  | 'badTimezone'
  | 'businessHourRange'
  | 'foreignArea'
  | 'noDraft'
  | 'network'
  | 'notConfigured'
  | 'unknown';

export const RULE_FAILURE_KEY: Record<RuleFailure, StringKey> = {
  notManager: 'ruleErrNotManager',
  frozen: 'ruleErrFrozen',
  sharesNot100: 'dErrShares',
  unsupportedBasis: 'dErrBasis',
  minOverlapRange: 'ruleErrMinOverlap',
  pointsRange: 'ruleErrPoints',
  badTimezone: 'ruleErrTimezone',
  businessHourRange: 'ruleErrBusinessHour',
  foreignArea: 'ruleErrForeignArea',
  noDraft: 'ruleErrNoDraft',
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

export function classifyRuleError(error: unknown): RuleFailure {
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

  if (message.includes('must total exactly 100')) return 'sharesNot100';
  if (message.includes('overlap model is not implemented')) return 'unsupportedBasis';
  if (message.includes('cannot be edited') || message.includes('is frozen')) return 'frozen';
  if (message.includes('use activate_rule()')) return 'frozen';
  if (message.includes('belongs to a different workplace')) return 'foreignArea';
  if (message.includes('must be an area of this workplace')) return 'foreignArea';
  if (message.includes('workplace of its own rule')) return 'foreignArea';
  if (message.includes('min_overlap_minutes')) return 'minOverlapRange';
  if (message.includes('workplace_roles_points_check') || message.includes('points_check')) {
    return 'pointsRange';
  }
  if (message.includes('business_day_start_hour')) return 'businessHourRange';
  if (message.includes('timezone')) return 'badTimezone';
  if (message.includes('only a manager')) return 'notManager';
  if (code === '42501') return 'notManager';
  if (code === '0A000') return 'unsupportedBasis';
  if (code === '23514') return 'sharesNot100';

  return 'unknown';
}
