/**
 * The roster, as the manager screens need it.
 *
 * A membership is never deleted and never re-pointed by hand: `user_id` is
 * filled in only by accept_invitation() / approve_join_request(), and removal is
 * a status, because shifts and distribution entries reference the id with
 * `on delete restrict`. So everything here is a change of state on a row that
 * stays where it is.
 */

import type { Enums, Tables } from '@/types/database';

export type MemberRole = Enums<'member_role'>;
export type MemberStatus = Enums<'member_status'>;
export type InvitationStatus = Enums<'invitation_status'>;

/** The statuses a manager can move a membership between. */
export const ASSIGNABLE_STATUSES: MemberStatus[] = ['active', 'suspended', 'left'];

/** The column's own range: `multiplier numeric(4,2) check (0.50 … 2.00)`. */
export const MULTIPLIER_MIN = 0.5;
export const MULTIPLIER_MAX = 2;

export interface TeamMember {
  id: string;
  displayName: string;
  role: MemberRole;
  status: MemberStatus;
  areaId: string | null;
  workplaceRoleId: string | null;
  multiplier: number;
  /** Null for a roster placeholder nobody has claimed yet. */
  hasAccount: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  /** True for the signed-in manager's own membership. */
  isSelf: boolean;
}

export interface PendingRequest {
  invitationId: string;
  requestedAt: string;
  requesterName: string;
  proposedAreaId: string | null;
}

export interface PendingInvite {
  invitationId: string;
  email: string | null;
  role: MemberRole;
  status: InvitationStatus;
  expiresAt: string;
  memberId: string | null;
}

export interface TeamState {
  members: TeamMember[];
  requests: PendingRequest[];
  invites: PendingInvite[];
  /** How many active managers the workplace has — the last one cannot go. */
  activeManagers: number;
}

/** What the member editor writes. Area and role always travel together. */
export interface MemberPatch {
  areaId: string | null;
  workplaceRoleId: string | null;
  multiplier: number;
  role: MemberRole;
  status: MemberStatus;
}

export function toTeamMember(
  row: Tables<'workplace_members'>,
  selfMembershipId: string | null,
): TeamMember {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    areaId: row.area_id,
    workplaceRoleId: row.workplace_role_id,
    multiplier: Number(row.multiplier),
    hasAccount: row.user_id !== null,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    isSelf: row.id === selfMembershipId,
  };
}

/**
 * Whether this membership is the workplace's last active manager.
 *
 * The database enforces the floor with a deferred constraint trigger, so the
 * refusal arrives at commit; knowing it here is only so the screen can say why
 * a control is unavailable instead of letting the manager discover it.
 */
export function isLastManager(member: TeamMember, activeManagers: number): boolean {
  return member.role === 'manager' && member.status === 'active' && activeManagers <= 1;
}

/**
 * A role belongs to exactly one area, and migration 20 refuses any other
 * pairing. So changing the area clears a role that no longer fits, and the
 * manager picks one from the new area — or leaves it unset, which is legal and
 * lets the engine fall back to the first role of the effective area.
 */
export function roleFitsArea(
  roleId: string | null,
  areaId: string | null,
  roles: Array<{ id: string; areaId: string }>,
): boolean {
  if (roleId === null) return true;
  const role = roles.find((r) => r.id === roleId);
  return Boolean(role) && role!.areaId === areaId;
}
