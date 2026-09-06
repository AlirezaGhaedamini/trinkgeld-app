/**
 * The join request this device has sent and is still waiting on.
 *
 * request_join() files a request; a manager approves it later, and the app
 * does not poll. Without a note of that, a refresh in the meantime puts the
 * person back in front of an empty code field looking as if nothing happened,
 * and the natural reaction is to send the request again. This remembers the
 * code so the join screen can keep saying "sent, waiting for approval" until a
 * membership appears, the person chooses another code, or they sign out.
 *
 * A code, nothing more: no name, no workplace id, no token.
 */

const KEY = 'tipcrew.pendingJoin';

export interface PendingJoin {
  code: string;
  at: string;
}

export function readPendingJoin(): PendingJoin | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof parsed.code !== 'string' || parsed.code.length === 0) return null;
    return { code: parsed.code, at: typeof parsed.at === 'string' ? parsed.at : '' };
  } catch {
    return null;
  }
}

export function writePendingJoin(code: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ code, at: new Date().toISOString() }));
  } catch {
    /* blocked storage: the note just will not survive a reload */
  }
}

export function clearPendingJoin(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
