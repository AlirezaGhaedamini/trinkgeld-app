/**
 * Notification failures, translated.
 *
 * Same contract as every other domain module: `queries.ts` throws, `useX.ts`
 * catches and calls `classifyNotificationError()`, and the resulting union is
 * mapped to an i18n key. A raw PostgREST message never reaches a screen.
 *
 * Rule order matters here as it does in `src/distribution/errors.ts`: the
 * specific messages come before the generic `42501`, which the RPCs also use
 * for "not yours" and would otherwise swallow everything.
 */

import type { StringKey } from '@/i18n/strings';

export type NotificationFailure =
  | 'notFound'
  | 'suspended'
  | 'network'
  | 'notConfigured'
  | 'unknown';

export const NOTIFICATION_FAILURE_KEY: Record<NotificationFailure, StringKey> = {
  notFound: 'nErrNotFound',
  suspended: 'ackErrSuspended',
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

export function classifyNotificationError(error: unknown): NotificationFailure {
  if (!error) return 'unknown';
  const e = error as PostgrestErrorish;
  const message = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();

  if (
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }

  if (message.includes('access to this workplace is paused')) return 'suspended';
  if (message.includes('notification not found')) return 'notFound';
  if ((e.code ?? '') === '42501') return 'notFound';

  return 'unknown';
}
