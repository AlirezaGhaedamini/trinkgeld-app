/**
 * Why the business day could not be read. Two answers matter to a screen: the
 * network dropped, or the caller is not (or no longer) a member — which the
 * RPC reports with 42501 and a sentence naming the workplace.
 */

import type { StringKey } from '@/i18n/strings';

export type BusinessDayFailure = 'notMember' | 'network' | 'unknown';

export const BUSINESS_DAY_FAILURE_KEY: Record<BusinessDayFailure, StringKey> = {
  notMember: 'bdNotMember',
  network: 'authNetwork',
  unknown: 'bdFailed',
};

interface PostgrestErrorish {
  code?: string;
  message?: string;
  name?: string;
}

export function classifyBusinessDayError(error: unknown): BusinessDayFailure {
  if (!error) return 'unknown';
  const e = error as PostgrestErrorish;
  const message = (e.message ?? '').toLowerCase();
  if (
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }
  if (message.includes('only a member of this workplace') || e.code === '42501') return 'notMember';
  return 'unknown';
}
