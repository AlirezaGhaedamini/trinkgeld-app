import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { fetchInvitationPreview } from '@/workplace/queries';
import type { InvitationPreview } from '@/workplace/types';

/**
 * What an invitation link says, read before anything is done with it.
 *
 * `invitation_preview()` (migration 41) is the one read in the schema that
 * works without a session, because the person it serves has no account yet.
 * The hook does not care whether there is a session: the sign-up screen uses
 * it to show the invitation and prefill the form, and the join screen uses it
 * to show the same card and check the address before accepting.
 *
 * Five outcomes, and the difference between the last three matters:
 *   idle     no token, or nothing to ask
 *   loading  asked, waiting
 *   ready    a row came back — `preview.status` says whether it is still open
 *   missing  the server answered and knows no such token
 *   error    the request itself failed; the token may well be fine
 */
export type InvitationLookup = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export interface InvitationPreviewState {
  status: InvitationLookup;
  preview: InvitationPreview | null;
  reload: () => void;
}

function useClient(): TipCrewClient | null {
  const [client] = useState<TipCrewClient | null>(() => {
    if (!isSupabaseConfigured()) return null;
    try {
      return getSupabase();
    } catch {
      return null;
    }
  });
  return client;
}

export function useInvitationPreview(token: string | null, enabled: boolean): InvitationPreviewState {
  const client = useClient();
  const [status, setStatus] = useState<InvitationLookup>('idle');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [generation, setGeneration] = useState(0);

  // The usual pair: no state after unmount, and a token that changed while a
  // request was in flight discards the older answer.
  const alive = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !token || !client) {
      setStatus('idle');
      setPreview(null);
      return;
    }
    const mine = (sequence.current += 1);
    setStatus('loading');
    void fetchInvitationPreview(client, token)
      .then((row) => {
        if (!alive.current || mine !== sequence.current) return;
        setPreview(row);
        setStatus(row ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!alive.current || mine !== sequence.current) return;
        setPreview(null);
        setStatus('error');
      });
  }, [client, enabled, token, generation]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return { status, preview, reload };
}
