/**
 * Was this page load opened by an auth redirect from Supabase?
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
 * A signed-out visit to the root shows the public marketing page. But the root
 * is also where Supabase sends people back to: an email confirmation arrives at
 * the Site URL as `/?code=…`, a recovery link as `/?tc=recovery&code=…`, and a
 * failed or expired link as `/?error=…&error_description=…` (or, for the
 * implicit flow, the same keys in a fragment such as `#error=…`).
 *
 * While the code is being exchanged the session gate is `pending`, so the splash
 * covers that moment. If the exchange FAILS — the link was opened in another
 * browser that holds no PKCE verifier, or it expired — the gate settles on
 * signed-out, and before the marketing page existed that meant the sign-in
 * screen. It must still mean that. Somebody who just clicked a link in an email
 * from TipCrew is trying to get into the app; dropping them on a sales page
 * with no word about their link would read as "the link did nothing".
 *
 * Read once, at import, for the same reason recovery.ts reads its marker there:
 * supabase-js rewrites the address bar with history.replaceState() once it has
 * handled the parameters, asynchronously and racing the first render. Reading
 * synchronously before any of that makes the answer deterministic.
 *
 * Nothing here is stored, and no parameter value is kept — only the yes/no.
 */

/* Keys GoTrue puts on a redirect, plus TipCrew's own recovery marker. */
const CALLBACK_KEYS = ['code', 'error', 'error_code', 'error_description', 'tc'];

/* The implicit-flow equivalents, which arrive in the fragment. */
const FRAGMENT_KEYS = ['access_token', 'refresh_token', 'error', 'error_description', 'type'];

const opened = readCallback();

function readCallback(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const query = new URLSearchParams(window.location.search);
    if (CALLBACK_KEYS.some((key) => query.has(key))) return true;

    /* A route fragment (`#/join?token=…`) is the app's own and never a
       callback: an invitation link must keep behaving exactly as before. */
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash || hash.startsWith('/')) return false;
    const fragment = new URLSearchParams(hash);
    return FRAGMENT_KEYS.some((key) => fragment.has(key));
  } catch {
    return false;
  }
}

/** True when this page load came back from a Supabase auth redirect. */
export function isAuthCallbackVisit(): boolean {
  return opened;
}

/**
 * True for a router path that is really an auth fragment.
 *
 * HashRouter reads the whole fragment as a path, so an implicit-flow or error
 * redirect such as `#error=…&error_description=…` arrives as the pathname
 * `/error=…&error_description=…`. No route matches it. The router's fallback
 * used to send every unmatched path to the root, which is what carried these
 * to sign-in; now that the fallback is a 404 page, it asks this first and
 * keeps sending auth fragments to the root as before.
 */
export function isAuthFragmentPath(pathname: string): boolean {
  const raw = pathname.replace(/^\//, '');
  if (!raw.includes('=')) return false;
  try {
    const fragment = new URLSearchParams(raw);
    return FRAGMENT_KEYS.some((key) => fragment.has(key));
  } catch {
    return false;
  }
}
