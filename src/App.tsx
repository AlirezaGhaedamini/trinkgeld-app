import { HashRouter } from 'react-router-dom';
import { AppRoutes } from '@/router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AuthBridge } from '@/auth/AuthBridge';
import { AppStateProvider } from '@/state/AppStateProvider';
import { ToastProvider } from '@/state/ToastProvider';
import { I18nProvider } from '@/i18n/I18nProvider';

/**
 * Provider order matters.
 *
 * I18n is outermost because the auth layer needs the chosen language to store
 * a locale on the profile. AuthProvider sits above AppStateProvider and knows
 * nothing about it; AuthBridge sits inside both and is the only thing that
 * couples them, so Phase 3B can delete it without touching either provider.
 *
 * HashRouter on purpose: it needs no server rewrites and works unchanged from a
 * static host, a sub-path, and a Capacitor WebView. Swap it for BrowserRouter
 * if the app is ever served from its own domain with a catch-all rewrite.
 */
export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppStateProvider>
          <ToastProvider>
            <AuthBridge />
            <HashRouter>
              <AppRoutes />
            </HashRouter>
          </ToastProvider>
        </AppStateProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
