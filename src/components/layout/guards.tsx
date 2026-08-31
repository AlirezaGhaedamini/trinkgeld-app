import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';

/** Everything past sign-in needs a session. */
export function RequireSession() {
  const { session } = useAppState();
  const location = useLocation();
  if (!session.signedIn) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/**
 * Manager-only area.
 *
 * Employees are bounced back to their own home with the same "Managers only"
 * message the prototype showed — the separation is part of the product, not
 * only of the future backend. Supabase row-level security will enforce the same
 * boundary server-side.
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
  if (!session.signedIn) return <Navigate to="/signin" replace />;
  return <Navigate to={session.role === 'manager' ? '/manager' : '/home'} replace />;
}
