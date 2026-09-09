import { HashRouter } from 'react-router-dom';
import { AppRoutes } from '@/router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AuthBridge } from '@/auth/AuthBridge';
import { WorkplaceProvider } from '@/workplace/WorkplaceProvider';
import { BusinessDayProvider } from '@/businessDay/BusinessDayProvider';
import { AppStateProvider } from '@/state/AppStateProvider';
import { ToastProvider } from '@/state/ToastProvider';
import { I18nProvider } from '@/i18n/I18nProvider';

/**
 * Provider order matters.
 *
 * I18n is outermost because the auth layer needs the chosen language to store a
 * locale on the profile. AuthProvider knows nothing about the app state.
 * WorkplaceProvider sits inside AppStateProvider because it has to see
 * `dataMode` — demo mode must never reach the database — and AuthBridge sits
 * inside everything, as the one component that couples the real session and
 * membership to the Phase 1 local state. Phase 3C deletes the bridge; the
 * providers stay. BusinessDayProvider sits inside WorkplaceProvider because
 * the day belongs to the active workplace — its timezone and cut-off — and
 * it asks the server only when that layer is enabled.
 *
 * HashRouter on purpose: it needs no server rewrites and works unchanged from a
 * static host, a sub-path, and a Capacitor WebView.
 */
export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppStateProvider>
          <WorkplaceProvider>
            <BusinessDayProvider>
              <ToastProvider>
                <AuthBridge />
                <HashRouter>
                  <AppRoutes />
                </HashRouter>
              </ToastProvider>
            </BusinessDayProvider>
          </WorkplaceProvider>
        </AppStateProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
