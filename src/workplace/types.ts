/**
 * The four things every screen from Phase 3C onwards will ask for: who is
 * signed in, which workplace they are looking at, which membership that is,
 * and what role it carries.
 */

import type { Enums, Tables } from '@/types/database';

export type MemberRole = Enums<'member_role'>;
export type MemberStatus = Enums<'member_status'>;

/** Only the workplace columns the app actually needs right now. */
export interface WorkplaceSummary {
  id: string;
  name: string;
  city: string | null;
  timezone: string;
  currency: string;
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
