/**
 * The invitation link, taken apart and put back together in one place.
 *
 * An invitation travels as `#/join?token=…` — `joinLinkFor()` in
 * src/team/types.ts and the send-invitation function build that same shape.
 * Four screens have to agree on how the token is read and where somebody who
 * holds it is sent: the session guard turns an unauthenticated visit to the
 * link into the invitation-aware sign-up; the sign-up and sign-in screens
 * carry the token in their OWN query string, so a refresh, a tab restore or
 * a bounce between the two does not lose it; and the join screen finally
 * accepts it. Router state dies with the tab and the URL does not — so the
 * token lives in the URL and nowhere else, and these helpers are the only
 * way it is read or written. Nothing here stores anything.
 *
 * Pure functions, no DOM: scripts/client-logic-check.mjs drives them offline.
 */

export const INVITATION_TOKEN_PARAM = 'token';

/* A real token is 64 hex characters (32 random bytes). The shape check is a
   little wider than that on purpose — it is not validation, the server does
   that by hash — but it stops junk from being carried around in URLs. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** The token in a query string, or null when there is none worth carrying. */
export function invitationTokenFrom(search: string | null | undefined): string | null {
  if (!search) return null;
  const raw = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get(
    INVITATION_TOKEN_PARAM,
  );
  if (!raw) return null;
  const trimmed = raw.trim();
  return TOKEN_SHAPE.test(trimmed) ? trimmed : null;
}

/** Where an invitation is accepted. The one path `safeReturnTo()` keeps. */
export function joinPathFor(token: string): string {
  return `/join?${INVITATION_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** The invitation-aware sign-up, for somebody with no account yet. */
export function signUpPathFor(token: string): string {
  return `/signup?${INVITATION_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** Sign-in that still knows the invitation, for somebody who has an account. */
export function signInPathFor(token: string): string {
  return `/signin?${INVITATION_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** True for a visit to the invitation link itself: `/join?token=…`. */
export function isInvitationVisit(pathname: string, search: string): boolean {
  return pathname === '/join' && invitationTokenFrom(search) !== null;
}
