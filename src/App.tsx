import { HashRouter } from 'react-router-dom';
import { AppRoutes } from '@/router';
import { AppStateProvider } from '@/state/AppStateProvider';
import { ToastProvider } from '@/state/ToastProvider';
import { I18nProvider } from '@/i18n/I18nProvider';

/**
 * HashRouter on purpose: it needs no server rewrites and works unchanged from a
 * static host, a sub-path, and a Capacitor WebView. Swap it for BrowserRouter
 * if the app is ever served from its own domain with a catch-all rewrite.
 */
export default function App() {
  return (
    <I18nProvider>
      <AppStateProvider>
        <ToastProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </ToastProvider>
      </AppStateProvider>
    </I18nProvider>
  );
}
