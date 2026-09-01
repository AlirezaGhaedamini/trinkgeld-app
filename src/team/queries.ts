/**
 * Every Supabase call the roster screens make.
 *
 * Three things are deliberate:
 *
 *  · Nothing here writes `user_id`. A guard trigger refuses it outright — an
 *    account is attached only inside accept_invitation() or
 *    approve_join_request(), so a manager cannot pull somebody's account into
 *    their workplace by editing a row.
 *
 *  · Removal is `status = 'left'`, never a DELETE. Shifts and distribution
 *    entries reference the membership id with `on delete restrict`, and the
 *    financial trail has to keep pointing at somebody.
 *
 *  · Area and role are always written together, because migration 20 requires
 *    the role to belong to the area. Sending only one of them would either be
 *    refused or silently leave an incoherent pair.
 *
 * Profiles stay closed: `profiles_select_own` means a manager cannot read a
 * colleague's profile row at all, so names come from
 * `workplace_members.display_name` and the requester's name from the
 * `pending_join_requests()` RPC. No email is fetched for the roster.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Membership } from '@/workplace/types';
import {
  toTeamMember,
  type MemberPatch,
  type MemberRole,
  type PendingInvite,
  type PendingRequest,
  type TeamState,
} from '@/team/types';

export async function fetchTeam(
  client: TipCrewClient,
  membership: Membership,
): Promise<TeamState> {
  const workplaceId = membership.workplaceId;

  const [membersRes, invitesRes, requestsRes] = await Promise.all([
    client.from('workplace_members').select('*').eq('workplace_id', workplaceId),
    client
      .from('invitations')
      .select('id, email, proposed_role, status, expires_at, member_id, kind')
      .eq('workplace_id', workplaceId)
      .eq('kind', 'invite')
      .eq('status', 'pending'),
    client.rpc('pending_join_requests', { p_workplace_id: workplaceId }),
  ]);
  if (membersRes.error) throw membersRes.error;
  if (invitesRes.error) throw invitesRes.error;
  if (requestsRes.error) throw requestsRes.error;

  const members = (membersRes.data ?? [])
    .map((row) => toTeamMember(row, membership.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const requests: PendingRequest[] = (
    (requestsRes.data ?? []) as unknown as Array<{
      invitation_id: string;
      requested_at: string;
      requester_name: string;
      proposed_area_id: string | null;
    }>
  ).map((r) => ({
    invitationId: r.invitation_id,
    requestedAt: r.requested_at,
    requesterName: r.requester_name,
    proposedAreaId: r.proposed_area_id,
  }));

  const invites: PendingInvite[] = (invitesRes.data ?? []).map((i) => ({
    invitationId: i.id,
    email: i.email,
    role: i.proposed_role,
    status: i.status,
    expiresAt: i.expires_at,
    memberId: i.member_id,
  }));

  return {
    members,
    requests,
    invites,
    activeManagers: members.filter((m) => m.role === 'manager' && m.status === 'active').length,
  };
}

/**
 * One save for the whole editor.
 *
 * Area, role, weighting, manager/employee and status go in a single UPDATE, so
 * a change that the database refuses leaves nothing half-applied — and so
 * moving a member to another area with a role from that area is one statement,
 * which is the only way the coherence guard accepts it.
 */
export async function saveMember(
  client: TipCrewClient,
  membership: Membership,
  memberId: string,
  patch: MemberPatch,
): Promise<void> {
  const { error } = await client
    .from('workplace_members')
    .update({
      area_id: patch.areaId,
      workplace_role_id: patch.workplaceRoleId,
      multiplier: patch.multiplier,
      role: patch.role,
      status: patch.status,
      ...(patch.status === 'left' ? { left_at: new Date().toISOString() } : { left_at: null }),
    })
    .eq('id', memberId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

/** Status on its own, for the suspend / reactivate / remove buttons. */
export async function setMemberStatus(
  client: TipCrewClient,
  membership: Membership,
  memberId: string,
  status: 'active' | 'suspended' | 'left',
): Promise<void> {
  const { error } = await client
    .from('workplace_members')
    .update({
      status,
      ...(status === 'left' ? { left_at: new Date().toISOString() } : { left_at: null }),
    })
    .eq('id', memberId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

export async function approveRequest(
  client: TipCrewClient,
  invitationId: string,
  areaId: string | null,
  workplaceRoleId: string | null,
): Promise<string> {
  const { data, error } = await client.rpc('approve_join_request', {
    p_invitation_id: invitationId,
    p_area_id: areaId ?? undefined,
    p_workplace_role_id: workplaceRoleId ?? undefined,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

/** Declining is an ordinary manager update — the RPC exists only for approval. */
export async function declineRequest(
  client: TipCrewClient,
  membership: Membership,
  invitationId: string,
): Promise<void> {
  const { error } = await client
    .from('invitations')
    .update({ status: 'declined' })
    .eq('id', invitationId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

export async function revokeInvite(
  client: TipCrewClient,
  membership: Membership,
  invitationId: string,
): Promise<void> {
  const { error } = await client
    .from('invitations')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

/**
 * Returns the raw token once, and only to the manager who made it — the
 * database stores nothing but its SHA-256. It is shown on the invite screen
 * that created it and never in a list.
 */
export async function createInvitation(
  client: TipCrewClient,
  membership: Membership,
  input: {
    email: string;
    displayName: string;
    role: MemberRole;
    areaId: string | null;
    workplaceRoleId: string | null;
  },
): Promise<{ invitationId: string; token: string }> {
  const { data, error } = await client.rpc('create_invitation', {
    p_workplace_id: membership.workplaceId,
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role,
    p_area_id: input.areaId ?? undefined,
    p_workplace_role_id: input.workplaceRoleId ?? undefined,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    invitationId: (row as { invitation_id: string })?.invitation_id ?? '',
    token: (row as { token: string })?.token ?? '',
  };
}
