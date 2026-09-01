/**
 * The shapes the rules editor works in.
 *
 * A rule is not a settings row. It is an append-only sequence of versions:
 * exactly one `active` and at most one `draft` per workplace, with everything
 * past draft frozen by a trigger. The editor therefore always has two objects
 * in hand — what the workplace is being paid under now, and what it would be
 * paid under next — and never one mutable "current rule".
 */

import type { Enums, Tables } from '@/types/database';

export type RuleMethod = Enums<'rule_method'>;
export type OverlapBasis = Enums<'overlap_basis'>;
export type PeerVisibility = Enums<'peer_visibility'>;
export type RuleStatus = Enums<'rule_status'>;

/**
 * The models `app.engine_supports_basis()` accepts. `service_window` is an enum
 * value with no engine behind it: activate_rule() refuses it, so the editor
 * must not offer it. Keep this list in step with migration 16 if that changes.
 */
export const SUPPORTED_BASES: OverlapBasis[] = ['longest_shift', 'pairwise'];

/** The methods `calculate_distribution()` actually branches on. */
export const METHODS: RuleMethod[] = ['hours_points', 'hours', 'equal'];

/** distribution_rule_areas, joined to the workplace's own area list. */
export interface AreaShare {
  areaId: string;
  areaKey: string;
  areaName: string;
  percentage: number;
  isPoolEligible: boolean;
  sortOrder: number;
}

/**
 * A workplace role and its weight.
 *
 * `points` is the live definition on `workplace_roles`. `activePoints` is the
 * copy `activate_rule()` froze onto the currently active version. They differ
 * exactly when someone has edited the definition since the last activation —
 * which is the moment the manager needs to be told that the change is not live
 * yet.
 */
export interface RolePoints {
  roleId: string;
  roleKey: string;
  roleName: string;
  areaId: string;
  areaName: string;
  points: number;
  activePoints: number | null;
}

export interface RuleVersion {
  id: string;
  version: number | null;
  status: RuleStatus;
  method: RuleMethod;
  minOverlapMinutes: number;
  overlapBasis: OverlapBasis;
  roundingAreaId: string | null;
  acknowledgementRequired: boolean;
  effectiveFrom: string | null;
  shares: AreaShare[];
}

/** The workplace columns this phase configures. Nothing else is touched. */
export interface WorkplaceSettings {
  timezone: string;
  businessDayStartHour: number;
  poolAmountVisibleToMembers: boolean;
  peerEntryVisibility: PeerVisibility;
}

/** One active member's default area, for the 0%-share warning. */
export interface MemberArea {
  memberId: string;
  areaId: string | null;
}

export interface RulesState {
  active: RuleVersion | null;
  draft: RuleVersion | null;
  roles: RolePoints[];
  settings: WorkplaceSettings;
  members: MemberArea[];
  /** Every non-archived area of the workplace, in display order. */
  areas: AreaShare[];
}

/** What the editor writes back to a draft. */
export interface DraftPatch {
  method: RuleMethod;
  minOverlapMinutes: number;
  overlapBasis: OverlapBasis;
  roundingAreaId: string | null;
  acknowledgementRequired: boolean;
  shares: Array<{ areaId: string; areaKey: string; percentage: number }>;
}

export function toSettings(row: Tables<'workplaces'>): WorkplaceSettings {
  return {
    timezone: row.timezone,
    businessDayStartHour: row.business_day_start_hour,
    poolAmountVisibleToMembers: row.pool_amount_visible_to_members,
    peerEntryVisibility: row.peer_entry_visibility,
  };
}

/** Whole percents, summed the way activate_rule() sums them. */
export function allocated(shares: Array<{ percentage: number }>): number {
  return shares.reduce((sum, s) => sum + s.percentage, 0);
}

/**
 * Members standing in an area the rule gives nothing to.
 *
 * The engine drops them before the overlap model is even consulted
 * (`area_not_in_pool`), so they are paid nothing and do not appear in the
 * result at all. Counting them here is the only warning a manager gets before
 * the money is already divided.
 *
 * This uses the member's DEFAULT area. A shift-level override can move someone
 * on the night, which is why the copy says "assigned to" rather than promising
 * what will happen.
 */
export function strandedMembers(
  members: MemberArea[],
  shares: AreaShare[],
): { count: number; areaNames: string[] } {
  const zero = new Map<string, string>();
  for (const share of shares) {
    if (share.percentage <= 0) zero.set(share.areaId, share.areaName);
  }
  const names = new Set<string>();
  let count = 0;
  for (const member of members) {
    if (!member.areaId) continue;
    const name = zero.get(member.areaId);
    if (name === undefined) continue;
    count += 1;
    names.add(name);
  }
  return { count, areaNames: [...names].sort((a, b) => a.localeCompare(b)) };
}
