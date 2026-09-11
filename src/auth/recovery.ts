/**
 * Was this page load opened by a password-recovery link?
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
 * The 3S-C human smoke found the reset flow landing on "this link is no longer
 * valid". It was, from the screen's point of view: no session had been
 * established. The cause was the shape of the redirect, not the link.
 *
 * TipCrew routes on the fragment (HashRouter). The recovery redirect used to be
 *
 *     https://tipcrew.de/#/reset/new
 *
 * and GoTrue appends the PKCE authorization code to whatever it is given, so the
 * browser arrived at
 *
 *     https://tipcrew.de/#/reset/new?code=<code>
 *
 * with the code INSIDE the fragment. supabase-js reads callback parameters with
 * parseParametersFromURL(), which parses `url.hash.substring(1)` as a query
 * string — for that URL it yields one key, "/reset/new?code", and `params.code`
 * is undefined. _isPKCECallback() returns false on its first line, no code is
 * exchanged, and no session ever exists. (Verified against the installed
 * auth-js 2.112.4, not assumed; scripts/client-logic-check.mjs pins it.)
 *
 * Signup confirmation was unaffected because signUp() passes no
 * emailRedirectTo, so Supabase uses the project Site URL, which has no fragment
 * and puts the code in the real query string where it parses.
 *
 * ── THE FIX, AND WHY IT IS THIS ONE ───────────────────────────────────────
 * The redirect now carries no fragment at all, so the code arrives in the query
 * string. Which screen to show is then TipCrew's business, marked with a query
 * parameter of its own: `?tc=recovery`.
 *
 * Read here, at module scope, on purpose. supabase-js strips the auth
 * parameters from the address bar with history.replaceState() once it has
 * exchanged them, and it emits PASSWORD_RECOVERY from a setTimeout — both
 * asynchronous, both racing the first render. Reading the URL synchronously
 * before any of that happens makes the answer deterministic instead of a matter
 * of who wins. The PASSWORD_RECOVERY event is still honoured in AuthProvider as
 * a second, independent signal; either one alone is enough.
 *
 * HashRouter is untouched. The conflict was never the router — it was putting a
 * fragment into a redirect that has query parameters appended to it.
 */

const MARKER = 'tc';
const VALUE = 'recovery';

/** Captured once, at import, before anything can rewrite the address bar. */
let opened = readMarker();

function readMarker(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(MARKER) === VALUE;
  } catch {
    return false;
  }
}

/**
 * Where Supabase should send somebody who follows a recovery link.
 *
 * Built from the page the app is actually served from, so it works from a
 * sub-path and from a Capacitor WebView. NO fragment: GoTrue appends `?code=…`
 * to this, and anything after a `#` would take the code down with it.
 *
 * The result must be covered by Authentication → URL Configuration → Redirect
 * URLs, or Supabase refuses to redirect at all.
 */
export function recoveryRedirectUrl(location: {
  origin: string;
  pathname: string;
}): string {
  return `${location.origin}${location.pathname}?${MARKER}=${VALUE}`;
}

/** True while this page load is a password recovery. */
export function isRecoveryCallback(): boolean {
  return opened;
}

/**
 * Called once the new password is saved, so the app stops routing back to the
 * recovery screen for the rest of this page load.
 */
export function clearRecoveryCallback(): void {
  opened = false;
}

/**
 * The second signal: supabase-js raises PASSWORD_RECOVERY once it has exchanged
 * a recovery code, which it knows from the '/recovery' suffix it stored beside
 * the PKCE verifier. Independent of the URL marker, and either alone is enough.
 */
export function markRecoveryCallback(): void {
  opened = true;
}

/** Test seam: re-read the address bar. Not used by the app at runtime. */
export function refreshRecoveryCallback(): void {
  opened = readMarker();
}
