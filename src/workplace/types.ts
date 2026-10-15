/**
 * The four things every screen from Phase 3C onwards will ask for: who is
 * signed in, which workplace they are looking at, which membership that is,
 * and what role it carries.
 */

import type { Database, Enums, Tables } from '@/types/database';

export type MemberRole = Enums<'member_role'>;
export type MemberStatus = Enums<'member_status'>;

/** Only the workplace columns the app actually needs right now. */
export interface WorkplaceSummary {
  id: string;
  name: string;
  city: string | null;
  timezone: string;
  currency: string;
  /** Local hour a business day starts. A 01:00 shift belongs to the night before. */
  businessDayStartHour: number;
  /** Null for members: only a manager's own workplace row exposes it usefully. */
  joinCode: string | null;
}

/** One membership, with the workplace it belongs to attached. */
export interface Membership {
  id: string;
  workplaceId: string;
  role: MemberRole;
  status: MemberStatus;
  displayName: string;
  areaId: string | null;
  workplaceRoleId: string | null;
  workplace: WorkplaceSummary;
}

export function toWorkplaceSummary(row: Tables<'workplaces'>): WorkplaceSummary {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    timezone: row.timezone,
    currency: row.currency,
    businessDayStartHour: row.business_day_start_hour,
    joinCode: row.join_code,
  };
}

export function toMembership(
  row: Tables<'workplace_members'>,
  workplace: WorkplaceSummary,
): Membership {
  return {
    id: row.id,
    workplaceId: row.workplace_id,
    role: row.role,
    status: row.status,
    displayName: row.display_name,
    areaId: row.area_id,
    workplaceRoleId: row.workplace_role_id,
    workplace,
  };
}

/**
 * What an invitation link says before it is accepted — the facts a manager
 * entered, read back by the token through `invitation_preview()` (migration
 * 41). `status` is the server's truthful word: `expired` is computed there
 * from the expiry, so a link that has run out says so without being accepted
 * first. Anything the server might one day say that this client does not know
 * is treated as closed, never as open.
 *
 * Only an OPEN invitation carries its details. For a used, withdrawn or
 * expired one the server returns the status and null everywhere else, so a
 * link left in somebody's browser history stops naming the person; the
 * screens show nothing but the reason for a closed one.
 */
export type InvitationPreviewStatus = Enums<'invitation_status'>;

export interface InvitationPreview {
  workplaceName: string | null;
  /** The roster name the manager typed; null only if that roster row is gone. */
  invitedName: string | null;
  email: string | null;
  areaName: string | null;
  /** The workplace role's name, when the manager picked one. */
  roleName: string | null;
  proposedRole: MemberRole | null;
  status: InvitationPreviewStatus;
  expiresAt: string | null;
}

type InvitationPreviewRow =
  Database['public']['Functions']['invitation_preview']['Returns'][number];

const PREVIEW_STATUSES: readonly InvitationPreviewStatus[] = [
  'pending', 'accepted', 'declined', 'revoked', 'expired',
];

function toPreviewStatus(value: string): InvitationPreviewStatus {
  return (PREVIEW_STATUSES as readonly string[]).includes(value)
    ? (value as InvitationPreviewStatus)
    : 'revoked';
}

export function toInvitationPreview(row: InvitationPreviewRow): InvitationPreview {
  return {
    workplaceName: row.workplace_name,
    invitedName: row.invited_name,
    email: row.email,
    areaName: row.area_name,
    roleName: row.role_name,
    proposedRole: row.proposed_role,
    status: toPreviewStatus(row.status),
    expiresAt: row.expires_at,
  };
}
