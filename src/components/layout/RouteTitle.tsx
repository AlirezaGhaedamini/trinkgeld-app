import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '@/hooks/useI18n';
import type { StringKey } from '@/i18n/strings';
import { invitationTokenFrom } from '@/workplace/invitationLink';

/**
 * The browser tab's title, per route.
 *
 * index.html carries the public homepage's full SEO title, because the root is
 * the only URL a crawler ever fetches — every app screen lives behind a hash
 * route. Without this, that long marketing title would sit in the tab on every
 * authenticated screen too. So: one short, contextual title per route, set
 * from the router's location in ONE place rather than by every screen.
 *
 * Two kinds of page own their title instead and are skipped here:
 *   - the root, where MarketingPage sets the SEO title (signed out) and
 *     HomeRedirect immediately moves a signed-in person to /home or /manager;
 *   - a page that only exists as the router's fallback (the 404), which cannot
 *     be recognised from the path alone. It calls useDocumentTitle(), whose
 *     effect runs after this one on every location change — this component is
 *     rendered BEFORE <Routes>, and React runs passive effects in tree order —
 *     so the page's own title is the one that stays.
 *
 * An invitation keeps one title across the three screens it passes through
 * (the invitation-aware sign-up, sign-in and the join screen), because to the
 * person holding the link it is one task: joining.
 */
export function titleKeyFor(pathname: string, search: string): StringKey | null {
  if (pathname === '/') return null;
  const invited = invitationTokenFrom(search) !== null;
  if (pathname === '/signin') return invited ? 'titleJoin' : 'titleSignIn';
  if (pathname === '/signup') return invited ? 'titleJoin' : 'titleSignUp';
  if (pathname === '/join' && invited) return 'titleJoin';
  if (pathname === '/reset' || pathname.startsWith('/reset/')) return 'titleReset';
  if (pathname === '/privacy') return 'titlePrivacy';
  if (pathname === '/imprint') return 'titleImprint';
  return 'titleApp';
}

export function RouteTitle() {
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const key = titleKeyFor(pathname, search);

  useEffect(() => {
    if (key) document.title = t(key);
  }, [key, t]);

  return null;
}

/**
 * For a page that owns its title. Re-applied on every location change, so it
 * wins over RouteTitle even when the page stays mounted across two URLs.
 */
export function useDocumentTitle(title: string): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    document.title = title;
  }, [title, pathname, search]);
}
