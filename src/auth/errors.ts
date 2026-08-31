/**
 * Turning Supabase auth failures into copy a server can safely show a guest.
 *
 * Two rules:
 *   1. The user never sees a raw message, an HTTP status, a Postgres code or a
 *      stack. Everything is mapped onto a fixed set of translated strings.
 *   2. Sign-in never says *which* half was wrong. "No account with that email"
 *      would turn the login form into an account-enumeration oracle.
 */

import type { StringKey } from '@/i18n/strings';

/** The only failure shapes the UI knows about. */
export type AuthFailure =
  | 'invalidCredentials'
  | 'emailTaken'
  | 'weakPassword'
  | 'invalidEmail'
  | 'emailNotConfirmed'
  | 'rateLimited'
  | 'network'
  | 'notConfigured'
  | 'unknown';

/** Copy for each failure. Keys exist in both dictionaries. */
export const AUTH_FAILURE_KEY: Record<AuthFailure, StringKey> = {
  invalidCredentials: 'authInvalid',
  emailTaken: 'authEmailTaken',
  weakPassword: 'authWeakPassword',
  invalidEmail: 'authInvalidEmail',
  emailNotConfirmed: 'authNotConfirmed',
  rateLimited: 'authRateLimited',
  network: 'authNetwork',
  notConfigured: 'authNotConfigured',
  unknown: 'authUnknown',
};

/** Minimal structural view of what supabase-js throws or returns. */
interface AuthErrorish {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

/**
 * Classify an error from supabase-js.
 *
 * `code` is the stable field in recent versions; `message` is matched only as a
 * fallback for older ones, and never shown.
 */
export function classifyAuthError(error: unknown): AuthFailure {
  if (!error) return 'unknown';

  const e = error as AuthErrorish;
  const code = (e.code ?? '').toLowerCase();
  const message = (e.message ?? '').toLowerCase();
  const status = e.status ?? 0;

  // A fetch that never reached Supabase: offline, DNS, CORS, blocked host.
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.name === 'TypeError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }

  switch (code) {
    case 'invalid_credentials':
    case 'invalid_grant':
      return 'invalidCredentials';
    case 'user_already_exists':
    case 'email_exists':
    case 'phone_exists':
      return 'emailTaken';
    case 'weak_password':
      return 'weakPassword';
    case 'validation_failed':
    case 'email_address_invalid':
      return 'invalidEmail';
    case 'email_not_confirmed':
      return 'emailNotConfirmed';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rateLimited';
    default:
      break;
  }

  if (status === 429) return 'rateLimited';

  if (message.includes('invalid login credentials')) return 'invalidCredentials';
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'emailTaken';
  }
  if (message.includes('email not confirmed')) return 'emailNotConfirmed';
  if (message.includes('password should be') || message.includes('password is too weak')) {
    return 'weakPassword';
  }
  if (message.includes('unable to validate email') || message.includes('invalid email')) {
    return 'invalidEmail';
  }

  return 'unknown';
}
