import { useEffect, useRef } from 'react';

import { displayNameFor } from '@/auth/profile';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';

/**
 * Keeps the Phase 1 local state in step with the real session.
 *
 * The screens still read the roster, hours and distributions out of the
 * reducer; Phase 3B replaces those with queries. Until then this is the one
 * place where the two halves meet — the Supabase session decides *whether*
 * someone is signed in, and this component tells the reducer *who* that is, so
 * a page refresh restores a working app rather than an empty one.
 *
 * Deliberately not merged into AuthProvider: the provider stays free of any
 * knowledge of the local reducer, which is what makes it removable in 3B.
 */
export function AuthBridge() {
  const auth = useAuth();
  const real = useRealAuth();
  const { session } = useAppState();
  const dispatch = useAppDispatch();

  // The role the person picked on the sign-in screen. Roles genuinely live in
  // workplace_members, which Phase 3B reads; until then the local choice
  // stands, exactly as it did before this change.
  const roleRef = useRef(session.role);
  roleRef.current = session.role;

  const signedIn = session.signedIn;

  useEffect(() => {
    if (!real) return;

    if (auth.status === 'signedIn' && auth.session) {
      const email = auth.email;
      const name = displayNameFor(auth.profile, email);
      if (!signedIn) {
        dispatch({ type: 'signIn', role: roleRef.current, name, email });
      }
      return;
    }

    if (auth.status === 'signedOut' && signedIn) {
      dispatch({ type: 'signOut' });
    }
  }, [real, auth.status, auth.session, auth.profile, auth.email, signedIn, dispatch]);

  return null;
}
