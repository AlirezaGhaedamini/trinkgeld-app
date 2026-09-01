/**
 * Workplace configuration: the areas a venue divides tips between, and the
 * roles inside them.
 *
 * Both tables are edited rather than replaced, because everything financial
 * points at their ids with `on delete restrict` and every distribution keeps a
 * snapshot of the names it was paid under. So the vocabulary here is
 * live / archived, never present / deleted.
 */

import type { Tables } from '@/types/database';

export interface ConfigArea {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  isPoolEligible: boolean;
  archived: boolean;
}

export interface ConfigRole {
  id: string;
  key: string;
  name: string;
  areaId: string;
  points: number;
  sortOrder: number;
  archived: boolean;
  /** The points the ACTIVE rule version froze, when it differs from `points`. */
  activePoints: number | null;
}

/**
 * What still depends on an area or a role.
 *
 * Counts only — no name, no amount. The manager needs to know how much moves
 * before they archive something; they do not need anybody's money to know it.
 */
export interface AreaUsage {
  members: number;
  openShifts: number;
  roles: number;
  fundedRules: number;
  distributions: number;
  /** Rows across every key that RESTRICTS a delete. Zero means the row can go. */
  references: number;
}

export interface RoleUsage {
  members: number;
  openShifts: number;
  ruleVersions: number;
  references: number;
}

export function toArea(row: Tables<'workplace_areas'>): ConfigArea {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    isPoolEligible: row.is_pool_eligible,
    archived: row.archived_at !== null,
  };
}

export function areaUsageFrom(value: unknown): AreaUsage {
  const v = (value ?? {}) as Record<string, unknown>;
  const n = (key: string) => Number(v[key] ?? 0) || 0;
  return {
    members: n('members'),
    openShifts: n('open_shifts'),
    roles: n('roles'),
    fundedRules: n('funded_rules'),
    distributions: n('distributions'),
    references: n('references'),
  };
}

export function roleUsageFrom(value: unknown): RoleUsage {
  const v = (value ?? {}) as Record<string, unknown>;
  const n = (key: string) => Number(v[key] ?? 0) || 0;
  return {
    members: n('members'),
    openShifts: n('open_shifts'),
    ruleVersions: n('rule_versions'),
    references: n('references'),
  };
}

/**
 * Nothing at all points at it, so the database would let it be deleted outright.
 *
 * This is deliberately stricter than "nothing live depends on it": a rule row
 * holding it at 0%, or an old distribution line, restricts the delete just as
 * firmly as an active member does. Offering Delete on anything else would
 * produce a foreign-key error the manager cannot act on.
 */
export function areaIsUnused(usage: AreaUsage | null): boolean {
  return usage ? usage.references === 0 : false;
}

export function roleIsUnused(usage: RoleUsage | null): boolean {
  return usage ? usage.references === 0 : false;
}

/** Move one id up or down in a list, returning the new order. */
export function moved(ids: string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = ids.slice();
  next.splice(target, 0, next.splice(index, 1)[0]);
  return next;
}
