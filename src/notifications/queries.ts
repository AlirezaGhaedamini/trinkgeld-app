/**
 * Every Supabase call the notification layer makes.
 *
 * The client has SELECT and nothing else. There is no insert, update or delete
 * privilege on `member_notifications` at all, so a direct PATCH of `read_at` is
 * refused at the privilege layer before RLS is even consulted. Read state moves
 * through the two definer RPCs below and through no other door.
 *
 * Rows are filtered by the `notifications_read_own` policy, which resolves the
 * recipient from `auth.uid()` through `app.member_id()`. The workplace filter
 * here is a narrowing for the active workplace's badge, never the boundary.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import { toNotification, type AppNotification } from '@/notifications/types';

/** One literal, not a concatenation: supabase-js can only type a select it can see. */
const COLUMNS =
  'id,workplace_id,member_id,type,distribution_id,query_id,payout_id,reversal_id,payload,created_at,read_at';

export async function fetchNotifications(
  client: TipCrewClient,
  workplaceId: string,
  limit = 30,
): Promise<AppNotification[]> {
  const { data, error } = await client
    .from('member_notifications')
    .select(COLUMNS)
    .eq('workplace_id', workplaceId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => toNotification(row as Tables<'member_notifications'>));
}

/**
 * The badge. A head request, so the count comes back without the rows.
 *
 * Scoped to one workplace: somebody who works in two places has two inboxes and
 * two badges, because the recipient is a membership rather than a user.
 */
export async function fetchUnreadCount(
  client: TipCrewClient,
  workplaceId: string,
): Promise<number> {
  const { count, error } = await client
    .from('member_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('workplace_id', workplaceId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Marks one row read. Idempotent server-side: read_at = coalesce(read_at, now()). */
export async function markRead(client: TipCrewClient, notificationId: string): Promise<void> {
  const { error } = await client.rpc('mark_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
}

/** Marks the caller's unread notifications in ONE workplace read. Returns how many. */
export async function markAllRead(
  client: TipCrewClient,
  workplaceId: string,
): Promise<number> {
  const { data, error } = await client.rpc('mark_all_notifications_read', {
    p_workplace_id: workplaceId,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
