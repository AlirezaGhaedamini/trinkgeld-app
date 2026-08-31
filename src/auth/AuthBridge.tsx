import { useEffect, useRef } from 'react';

import { displayNameFor } from '@/auth/profile';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useWorkplace } from '@/hooks/useWorkplace';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';

/**
 * Keeps the Phase 1 local state in step with the real session and membership.
 *
 * The screens still read the roster, hours and distributions out of the
 * reducer; Phase 3C replaces those with queries. Until then this is the one
 * place where the two halves meet — Supabase decides *whether* someone is
 * signed in and *what role they hold*, and this component tells the reducer, so
 * a refresh restores a working app rather than an empty one.
 *
 * The role written here is the real one from `workplace_members`. It is a
 * mirror for the screens' convenience, not the source: route guards read
 * `useActiveRole()` directly, so even if this mirror were stale or tampered
 * with, it could not grant anyone anything.
 */
export function AuthBridge() {
  const auth = useAuth();
  const real = useRealAuth();
  const workplace = useWorkplace();
  const { session } = useAppState();
  const dispatch = useAppDispatch();

  // Demo mode keeps its own local role switching, untouched.
  const localRole = useRef(session.role);
  localRole.current = session.role;

  const signedIn = session.signedIn;
  const realRole = workplace.enabled ? workplace.role : null;
  const activeName = workplace.activeMembership?.displayName ?? null;

  useEffect(() => {
    if (!real) return;

    if (auth.status === 'signedIn' && auth.session) {
      const email = auth.email;
      // The membership's display name is what colleagues see, so prefer it over
      // the profile's; fall back while memberships are still loading.
      const name = activeName ?? displayNameFor(auth.profile, email);
      const role = realRole ?? localRole.current;

      if (!signedIn) {
        dispatch({ type: 'signIn', role, name, email });
        return;
      }
      // Membership arrived (or changed) after sign-in: re-sync the mirror.
      if (realRole && session.role !== realRole) {
        dispatch({ type: 'setRole', role: realRole });
      }
      return;
    }

    if (auth.status === 'signedOut' && signedIn) {
      dispatch({ type: 'signOut' });
    }
  }, [
    real,
    auth.status,
    auth.session,
    auth.profile,
    auth.email,
    signedIn,
    session.role,
    realRole,
    activeName,
    dispatch,
  ]);

  return null;
}
