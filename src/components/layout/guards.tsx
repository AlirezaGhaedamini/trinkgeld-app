import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthSplash } from '@/auth/AuthSplash';
import { useAppState } from '@/hooks/useAppState';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useActiveRole, useWorkplace } from '@/hooks/useWorkplace';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';

/**
 * Is there a usable session right now, and do we know yet?
 *
 * `pending` is the important one. While supabase-js is reading a persisted
 * session out of storage we must render neither the app nor the sign-in
 * screen — treating "not yet known" as "signed out" is what makes a refresh
 * bounce people to the login page and lose the screen they were on.
 */
type Gate = 'pending' | 'in' | 'out';

function useSessionGate(): Gate {
  const { session } = useAppState();
  const auth = useAuth();
  const real = useRealAuth();

  if (!real) return session.signedIn ? 'in' : 'out';
  if (auth.status === 'restoring') return 'pending';
  if (auth.status !== 'signedIn') return 'out';
  // Authenticated, but AuthBridge has not yet handed the identity to the local
  // state the screens read. One frame, and better than a flash of empty app.
  return session.signedIn ? 'in' : 'pending';
}

/** Everything past sign-in needs a session. */
export function RequireSession() {
  const gate = useSessionGate();
  const location = useLocation();

  if (gate === 'pending') return <AuthSplash />;
  if (gate === 'out') {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/**
 * The sign-in screen, which nobody who is already signed in should be looking
 * at. A refresh on `#/signin` with a live session lands in the app.
 */
export function RequireNoSession() {
  const gate = useSessionGate();

  if (gate === 'pending') return <AuthSplash />;
  if (gate === 'in') return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * The app proper needs a workplace behind it.
 *
 * Three outcomes, and the difference between the first two matters as much as
 * it does for the session:
 *
 *   still loading  → wait. Sending a manager to the onboarding screen on every
 *                    refresh because the membership fetch had not landed yet
 *                    would be worse than a moment of splash.
 *   fetch failed   → also wait rather than redirect. An empty list caused by a
 *                    dropped request must never look like "you have no
 *                    workplace"; the provider keeps the last good list and the
 *                    person sees the app they had.
 *   no membership  → onboarding: create one or ask to join.
 *   several, none chosen → pick one.
 */
export function RequireWorkplace() {
  const workplace = useWorkplace();

  if (!workplace.enabled) return <Outlet />;
  if (workplace.status === 'idle' || workplace.status === 'loading') return <AuthSplash />;
  if (workplace.status === 'error' && workplace.memberships.length === 0) return <AuthSplash />;
  if (workplace.memberships.length === 0) return <Navigate to="/join" replace />;
  if (!workplace.activeMembership) return <Navigate to="/workplaces" replace />;
  return <Outlet />;
}

/**
 * Manager-only area.
 *
 * The role comes from `useActiveRole()`, which in real mode reads the active
 * `workplace_members` row. Nothing a client can write — the reducer, the
 * sign-in toggle, local storage, a query string — reaches this decision. The
 * database enforces the same boundary again on every statement; this guard is
 * only here so an employee does not stare at a screen full of "denied".
 */
export function RequireManager() {
  const role = useActiveRole();
  const { show } = useToast();
  const { t } = useI18n();
  const denied = role !== 'manager';

  useEffect(() => {
    if (denied) show(t('managerOnly'));
  }, [denied, show, t]);

  if (denied) return <Navigate to="/home" replace />;
  return <Outlet />;
}

/** Send people to the right home for who they are. */
export function HomeRedirect() {
  const gate = useSessionGate();
  const workplace = useWorkplace();
  const role = useActiveRole();

  if (gate === 'pending') return <AuthSplash />;
  if (gate === 'out') return <Navigate to="/signin" replace />;

  if (workplace.enabled) {
    if (workplace.status === 'idle' || workplace.status === 'loading') return <AuthSplash />;
    if (workplace.memberships.length === 0) return <Navigate to="/join" replace />;
    if (!workplace.activeMembership) return <Navigate to="/workplaces" replace />;
  }

  return <Navigate to={role === 'manager' ? '/manager' : '/home'} replace />;
}
