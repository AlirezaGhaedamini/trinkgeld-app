/**
 * Every Supabase call the workplace layer makes. Four functions, one file.
 *
 * Screens do not query. They call the provider, the provider calls these, and
 * these are the only place that knows a table name — which is what makes the
 * Phase 3C surface (`user`, `activeWorkplace`, `activeMembership`, `role`)
 * possible without queries leaking into components.
 *
 * All four writes go through the Phase 2 RPCs rather than table inserts:
 *
 *   create_workplace()   creates the workplace, seeds its areas and roles, and
 *                        writes the manager membership in ONE transaction, so a
 *                        workplace without a manager cannot exist.
 *   request_join()       turns a join code into a pending request for a manager
 *                        to approve. It cannot create a membership by itself.
 *   accept_invitation()  takes the token and nothing else. The role comes from
 *                        the invitation row, never from the caller.
 *
 * There is deliberately no path here that writes `workplace_members.role`.
 */

import type { TipCrewClient } from '@/lib/supabase';
import {
  toMembership,
  toWorkplaceSummary,
  type Membership,
  type WorkplaceSummary,
} from '@/workplace/types';

/**
 * Every active membership the signed-in user has, with its workplace.
 *
 * Two round trips instead of a PostgREST embed: the embed would depend on
 * relationship metadata in the generated types, and this keeps both halves
 * fully typed. RLS does the filtering either way — `members_select_same_workplace`
 * and `workplaces_select_member` — so the `user_id` filter here is a narrowing,
 * not the security boundary.
 */
export async function fetchMemberships(
  client: TipCrewClient,
  userId: string,
): Promise<Membership[]> {
  const { data: memberRows, error: memberError } = await client
    .from('workplace_members')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (memberError) throw memberError;
  if (!memberRows || memberRows.length === 0) return [];

  const workplaceIds = [...new Set(memberRows.map((row) => row.workplace_id))];

  const { data: workplaceRows, error: workplaceError } = await client
    .from('workplaces')
    .select('*')
    .in('id', workplaceIds)
    .is('archived_at', null);

  if (workplaceError) throw workplaceError;

  const byId = new Map<string, WorkplaceSummary>();
  for (const row of workplaceRows ?? []) byId.set(row.id, toWorkplaceSummary(row));

  return memberRows
    .map((row) => {
      const workplace = byId.get(row.workplace_id);
      return workplace ? toMembership(row, workplace) : null;
    })
    .filter((m): m is Membership => m !== null)
    .sort((a, b) => a.workplace.name.localeCompare(b.workplace.name));
}

/** Create a workplace and its manager membership atomically. Returns the id. */
export async function createWorkplaceRpc(
  client: TipCrewClient,
  name: string,
  displayName?: string,
): Promise<string> {
  const { data, error } = await client.rpc('create_workplace', {
    p_name: name,
    ...(displayName ? { p_display_name: displayName } : {}),
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('create_workplace returned no id');
  return data;
}

/**
 * Ask to join with a workplace code. This creates a *pending request*, not a
 * membership — a manager still has to approve it. That asymmetry is the point:
 * knowing a six-character code must never be enough to get into a workplace.
 */
export async function requestJoinRpc(client: TipCrewClient, joinCode: string): Promise<string> {
  const { data, error } = await client.rpc('request_join', { p_join_code: joinCode });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

/**
 * Accept an invitation token. The membership's role is whatever the manager put
 * on the invitation; there is no argument for it and the browser cannot influence it.
 */
export async function acceptInvitationRpc(client: TipCrewClient, token: string): Promise<string> {
  const { data, error } = await client.rpc('accept_invitation', { p_token: token });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}
