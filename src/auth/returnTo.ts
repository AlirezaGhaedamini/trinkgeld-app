/**
 * Where to send somebody once they have signed in.
 *
 * An invitation arrives as `#/join?token=…`. A person who is not signed in is
 * bounced to sign-in, and RequireSession hands the sign-in screen the whole
 * path, query string included, as router state. That covers the ordinary
 * same-tab case and is deliberately all it covers: router state dies with the
 * tab, so nothing left on a shared device can outlive the moment.
 *
 * One case needs more. Sign-up may end in an email confirmation, and the
 * confirmation reopens the app at its root with no router state left. For
 * that case, and only that case, the sign-up screen stores the path together
 * with the email it was signing up, and the slot is honoured only for that
 * account. Whoever signs in next on the same device gets nothing from it; a
 * mismatch clears it. It also clears on first use, on sign-out, and after a
 * day: a link that was never used should not outlive the invitation it
 * belongs to, which expires server-side anyway.
 *
 * The slot holds a path, an email and a timestamp, nothing else. Nothing here
 * logs, and the token is never split out of the path.
 */

const KEY = 'tipcrew.returnTo';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The one spelling an address is compared in, wherever it was typed. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Only a path inside this app, never one of the auth screens themselves, and
 * never the bare onboarding screens: `/join?token=…` is an invitation worth
 * coming back to, `/join` on its own is where the router sends people who
 * have no workplace, and somebody who does have one must not be parked there.
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.startsWith('/signin') || value.startsWith('/signup')) return null;
  if (value === '/join' || value === '/workplaces' || value === '/') return null;
  return value;
}

/** Store a path for one account. Anything unsafe or unaddressed is dropped. */
export function rememberReturnTo(path: string, email: string): void {
  const safe = safeReturnTo(path);
  const who = normalizeEmail(email);
  if (!safe || !who) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ path: safe, email: who, at: Date.now() }));
  } catch {
    /* blocked storage: the confirmation return just will not survive */
  }
}

/**
 * Read-only. The stored path, if it is still valid, not older than a day, and
 * meant for exactly this account. Never writes, so it is safe in a render.
 */
export function peekReturnTo(email: string | null | undefined): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; email?: unknown; at?: unknown };
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) return null;
    const who = normalizeEmail(email);
    if (!who || typeof parsed.email !== 'string' || parsed.email !== who) return null;
    return safeReturnTo(parsed.path);
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * For event handlers: read it once for this account and forget it either way.
 * A slot that was expired, malformed or written for somebody else is cleared
 * too, because it has no future on this device.
 */
export function takeReturnTo(email: string | null | undefined): string | null {
  const path = peekReturnTo(email);
  clearReturnTo();
  return path;
}
