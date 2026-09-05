/**
 * Dashboard failures, translated.
 *
 * There is only one RPC and only one thing it refuses, so this is the smallest
 * classifier in the app. It exists because the domain-module contract says a
 * raw PostgREST message never reaches a screen, and this module is no exception.
 */

import type { StringKey } from '@/i18n/strings';

export type DashboardFailure = 'notAllowed' | 'network' | 'notConfigured' | 'unknown';

export const DASHBOARD_FAILURE_KEY: Record<DashboardFailure, StringKey> = {
  notAllowed: 'managerOnly',
  network: 'authNetwork',
  notConfigured: 'authNotConfigured',
  unknown: 'authUnknown',
};

interface PostgrestErrorish {
  code?: string;
  message?: string;
  name?: string;
}

export function classifyDashboardError(error: unknown): DashboardFailure {
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
  if ((e.code ?? '') === '42501') return 'notAllowed';
  return 'unknown';
}
