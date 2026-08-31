import { useContext } from 'react';
import { AuthContext, type AuthValue } from '@/auth/authContext';
import { useAppState } from '@/hooks/useAppState';

/** The Supabase session, the profile, and the three auth actions. */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/**
 * True when Supabase is in charge of the session.
 *
 * The demo dataset keeps its own local sign-in, because its whole point is
 * being able to look at a full workplace without an account. Everything else
 * goes through Supabase whenever credentials are present.
 */
export function useRealAuth(): boolean {
  const auth = useAuth();
  const { dataMode } = useAppState();
  return auth.enabled && dataMode !== 'demo';
}
