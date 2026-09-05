/**
 * The notification inbox's data.
 *
 * Deliberately thin, like `usePeriod`: the list and the unread count are both
 * server answers and nothing here recomputes either. Polling on mount is the
 * whole delivery model for V1 — no realtime, no email, no push — because a
 * workplace produces roughly one distribution a night and every one of those
 * channels is infrastructure this product does not have.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useWorkplace } from '@/hooks/useWorkplace';
import { classifyNotificationError } from '@/notifications/errors';
import * as api from '@/notifications/queries';
import type { AppNotification } from '@/notifications/types';

function useClient(): TipCrewClient | null {
  return isSupabaseConfigured() ? getSupabase() : null;
}

export function useNotifications() {
  const client = useClient();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const workplaceId = membership?.workplaceId ?? null;

  /* The `enabled` gate every domain hook computes. False in demo mode or with
     no credentials, and then NO network call goes out at all — which is what
     keeps the demo dataset offline. Both roles have an inbox, so unlike the
     manager-only hooks this does not test the role. */
  const enabled = Boolean(client) && workplace.enabled && membership !== null;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !workplaceId) return;
    try {
      const [rows, count] = await Promise.all([
        api.fetchNotifications(client, workplaceId),
        api.fetchUnreadCount(client, workplaceId),
      ]);
      if (!alive.current) return;
      setNotifications(rows);
      setUnread(count);
    } catch {
      /* A dropped request must not look like an empty inbox: keep what we had. */
    }
  }, [client, workplaceId]);

  useEffect(() => {
    if (!enabled) {
      setNotifications([]);
      setUnread(0);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const markRead = useCallback(
    async (id: string) => {
      if (!client) return { ok: false as const, failure: 'notConfigured' as const };
      try {
        await api.markRead(client, id);
        await refresh();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, failure: classifyNotificationError(error) };
      }
    },
    [client, refresh],
  );

  const markAllRead = useCallback(async () => {
    if (!client || !workplaceId) return { ok: false as const, failure: 'notConfigured' as const };
    setBusy(true);
    try {
      await api.markAllRead(client, workplaceId);
      await refresh();
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, failure: classifyNotificationError(error) };
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [client, workplaceId, refresh]);

  return { enabled, notifications, unread, busy, refresh, markRead, markAllRead };
}
