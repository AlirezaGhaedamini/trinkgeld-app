import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';

import type { AuthFailure } from '@/auth/errors';
import type { Profile } from '@/auth/profile';

/**
 * Three states, and the distinction between the first two matters:
 *
 *   restoring — supabase-js is reading the persisted session out of storage.
 *               Route guards must WAIT here. Treating it as signed-out is the
 *               classic refresh bug: the app bounces to sign-in for a moment
 *               and the person loses the page they were on.
 *   signedOut — no session, and we know it.
 *   signedIn  — a session, and the profile has been fetched (or found missing).
 */
export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

export interface AuthResult {
  ok: boolean;
  failure?: AuthFailure;
  /** Sign-up completed but the project requires the user to confirm by email. */
  needsEmailConfirmation?: boolean;
}

export interface AuthValue {
  /** False when the app has no Supabase credentials; the app then runs local. */
  enabled: boolean;
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  email: string;
  profile: Profile | null;
  /** True while a sign-in / sign-up / sign-out request is in flight. */
  busy: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);
