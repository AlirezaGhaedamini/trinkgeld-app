import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthSplash } from '@/auth/AuthSplash';
import { useAppState } from '@/hooks/useAppState';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
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
 * The sign-in and sign-up screens, which nobody who is already signed in should
 * be looking at. A refresh on `#/signin` with a live session lands in the app.
 */
export function RequireNoSession() {
  const gate = useSessionGate();

  if (gate === 'pending') return <AuthSplash />;
  if (gate === 'in') return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Manager-only area.
 *
 * Employees are bounced back to their own home with the same "Managers only"
 * message the prototype showed — the separation is part of the product, not
 * only of the future backend. Supabase row-level security enforces the same
 * boundary server-side; this is convenience, never the control.
 */
export function RequireManager() {
  const { session } = useAppState();
  const { show } = useToast();
  const { t } = useI18n();
  const denied = session.role !== 'manager';

  useEffect(() => {
    if (denied) show(t('managerOnly'));
  }, [denied, show, t]);

  if (denied) return <Navigate to="/home" replace />;
  return <Outlet />;
}

/** Send people to the right home for who they are. */
export function HomeRedirect() {
  const { session } = useAppState();
  const gate = useSessionGate();

  if (gate === 'pending') return <AuthSplash />;
  if (gate === 'out') return <Navigate to="/signin" replace />;
  return <Navigate to={session.role === 'manager' ? '/manager' : '/home'} replace />;
}
