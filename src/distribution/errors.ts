/**
 * Distribution failures, translated.
 *
 * These are the messages a manager reads while money is on the screen, so they
 * have to say what to do next — "recalculate", not "23514".
 */

import type { StringKey } from '@/i18n/strings';

export type DistributionFailure =
  | 'notManager'
  | 'noPool'
  | 'emptyPool'
  | 'noRule'
  | 'sharesNot100'
  | 'nobodyEligible'
  | 'emptyArea'
  | 'disjointGroups'
  | 'stale'
  | 'alreadySent'
  | 'poolVoid'
  | 'reportsUsed'
  | 'noReports'
  | 'unsupportedBasis'
  | 'roundingError'
  | 'network'
  | 'notConfigured'
  | 'unknown';

export const DISTRIBUTION_FAILURE_KEY: Record<DistributionFailure, StringKey> = {
  notManager: 'dErrNotManager',
  noPool: 'dErrNoPool',
  emptyPool: 'dErrEmptyPool',
  noRule: 'dErrNoRule',
  sharesNot100: 'dErrShares',
  nobodyEligible: 'dErrNobody',
  emptyArea: 'dErrEmptyArea',
  disjointGroups: 'dErrDisjoint',
  stale: 'dErrStale',
  alreadySent: 'dErrAlreadySent',
  poolVoid: 'dErrPoolVoid',
  reportsUsed: 'dErrReportsUsed',
  noReports: 'dErrNoReports',
  unsupportedBasis: 'dErrBasis',
  roundingError: 'dErrRounding',
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

/**
 * The area names out of the empty-area refusal.
 *
 * The database names them so the manager knows which one to fix. Only the
 * captured group is ever shown — the surrounding message never reaches the
 * screen.
 */
export function areaNamesFromError(error: unknown): string | null {
  const message = (error as PostgrestErrorish | null)?.message ?? '';
  const match = /no eligible hours in (.+?), which the rule/.exec(message);
  return match?.[1] ?? null;
}

export function classifyDistributionError(error: unknown): DistributionFailure {
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

  if (message.includes('recalculate before sending')) return 'stale';
  if (message.includes('only a draft can be sent')) return 'alreadySent';
  if (message.includes('overlap model is not implemented')) return 'unsupportedBasis';
  if (message.includes('must total exactly 100')) return 'sharesNot100';
  if (message.includes('no eligible hours in')) return 'emptyArea';
  if (message.includes('who never worked together')) return 'disjointGroups';
  if (message.includes('nobody is eligible')) return 'nobodyEligible';
  if (message.includes('no approved hours')) return 'nobodyEligible';
  if (message.includes('pool is empty')) return 'emptyPool';
  if (message.includes('pool is void')) return 'poolVoid';
  if (message.includes('pool not found')) return 'noPool';
  if (message.includes('no active rule')) return 'noRule';
  if (message.includes('no unused tip reports')) return 'noReports';
  if (message.includes('rounding error')) return 'roundingError';
  if (message.includes('tip_pool_sources_report_key') || code === '23505') return 'reportsUsed';
  if (message.includes('only a manager')) return 'notManager';
  if (code === '42501') return 'notManager';
  if (code === '0A000') return 'unsupportedBasis';

  return 'unknown';
}
