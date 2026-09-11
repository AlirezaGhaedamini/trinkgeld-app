import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthSplash } from '@/auth/AuthSplash';
import { clearReturnTo, peekReturnTo } from '@/auth/returnTo';
import { isRecoveryCallback } from '@/auth/recovery';
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

/**
 * Everything past sign-in needs a session.
 *
 * The place the person was heading is kept WITH its query string: an
 * invitation is `#/join?token=…`, and a pathname alone would drop the token.
 * It travels as router state and nothing else — state dies with the tab, so
 * a link opened on a shared device is never waiting for whoever signs in
 * next. The only persisted return path is the one sign-up stores for an
 * email confirmation, bound to that account.
 */
export function RequireSession() {
  const gate = useSessionGate();
  const location = useLocation();
  const from = `${location.pathname}${location.search}`;

  if (gate === 'pending') return <AuthSplash />;
  if (gate === 'out') {
    return <Navigate to="/signin" replace state={{ from }} />;
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

/**
 * Send people to the right home for who they are.
 *
 * With one exception: an account that signed up on an invitation link and had
 * to confirm by email comes back to that link first, because the confirmation
 * reopens the app at its root. The remembered path is read only once routing
 * can actually be decided — memberships loaded, or their load failed — and
 * only for the account that stored it. Reading it on a splash render and
 * clearing it in an effect would throw it away before anyone was sent
 * anywhere. Whatever is in the slot once this screen has settled, used or
 * not meant for this account, is cleared: it has no future on this device.
 */
export function HomeRedirect() {
  const gate = useSessionGate();
  const auth = useAuth();
  const workplace = useWorkplace();
  const role = useActiveRole();

  const settled =
    workplace.enabled && (workplace.status === 'ready' || workplace.status === 'error');
  const back = gate === 'in' && settled ? peekReturnTo(auth.email) : null;
  useEffect(() => {
    if (gate === 'in' && settled) clearReturnTo();
  }, [gate, settled]);

  if (gate === 'pending') return <AuthSplash />;

  /* A recovery link lands here, not on a hash route: the redirect must carry no
     fragment or the PKCE code is swallowed by it (src/auth/recovery.ts). So the
     one thing this redirector does before anything else is send a recovery
     callback to the screen it came for — ahead of the signed-out check too,
     because the session may still be being exchanged. */
  if (isRecoveryCallback()) return <Navigate to="/reset/new" replace />;

  if (gate === 'out') return <Navigate to="/signin" replace />;

  if (workplace.enabled) {
    if (workplace.status === 'idle' || workplace.status === 'loading') return <AuthSplash />;
    if (back) return <Navigate to={back} replace />;
    if (workplace.memberships.length === 0) return <Navigate to="/join" replace />;
    if (!workplace.activeMembership) return <Navigate to="/workplaces" replace />;
  }

  return <Navigate to={role === 'manager' ? '/manager' : '/home'} replace />;
}
