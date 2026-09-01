/**
 * Every Supabase call the area and role screens make.
 *
 * Creating, archiving, restoring and reordering all go through RPCs rather than
 * table writes, because each of them is a rule the database has to be the one
 * to apply:
 *
 *   create_workplace_area / _role   derive the stable `key` from the name, so a
 *                                   rename never moves it and a typo can never
 *                                   produce one the check constraint rejects.
 *   archive_workplace_area / _role  refuse while an active member, an
 *                                   unfinished shift, a live role or a funded
 *                                   share still depends on it, and say which.
 *   reorder_workplace_*             refuse a list holding an id from somewhere
 *                                   else, and renumber in one statement.
 *
 * Renaming and the two small flags are ordinary updates: RLS already restricts
 * them to a manager of the row's own workplace, and a trigger refuses a name
 * that another live row already carries.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Membership } from '@/workplace/types';
import {
  areaUsageFrom,
  roleUsageFrom,
  toArea,
  type AreaUsage,
  type ConfigArea,
  type ConfigRole,
  type RoleUsage,
} from '@/config/types';

export interface ConfigState {
  areas: ConfigArea[];
  roles: ConfigRole[];
}

/**
 * Areas and roles, live and archived, in display order.
 *
 * Archived rows are fetched deliberately: the screens have to show them so a
 * manager can bring one back, and every list that must NOT offer them filters
 * on `archived` itself.
 */
export async function fetchConfig(
  client: TipCrewClient,
  membership: Membership,
): Promise<ConfigState> {
  const workplaceId = membership.workplaceId;

  const [areasRes, rolesRes, activeRuleRes] = await Promise.all([
    client.from('workplace_areas').select('*').eq('workplace_id', workplaceId),
    client
      .from('workplace_roles')
      .select('id, key, name, area_id, points, sort_order, archived_at')
      .eq('workplace_id', workplaceId),
    client
      .from('distribution_rules')
      .select('id')
      .eq('workplace_id', workplaceId)
      .eq('status', 'active')
      .limit(1),
  ]);
  if (areasRes.error) throw areasRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (activeRuleRes.error) throw activeRuleRes.error;

  const activeRuleId = activeRuleRes.data?.[0]?.id ?? null;
  let frozen = new Map<string, number>();
  if (activeRuleId) {
    const { data, error } = await client
      .from('distribution_rule_roles')
      .select('workplace_role_id, points')
      .eq('rule_id', activeRuleId);
    if (error) throw error;
    frozen = new Map((data ?? []).map((r) => [r.workplace_role_id, Number(r.points)]));
  }

  const byOrder = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  return {
    areas: (areasRes.data ?? []).map(toArea).sort(byOrder),
    roles: (rolesRes.data ?? [])
      .map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        areaId: r.area_id,
        points: Number(r.points),
        sortOrder: r.sort_order,
        archived: r.archived_at !== null,
        activePoints: frozen.has(r.id) ? (frozen.get(r.id) as number) : null,
      }))
      .sort(byOrder),
  };
}

export async function fetchAreaUsage(
  client: TipCrewClient,
  areaId: string,
): Promise<AreaUsage> {
  const { data, error } = await client.rpc('area_usage', { p_area_id: areaId });
  if (error) throw error;
  return areaUsageFrom(data);
}

export async function fetchRoleUsage(
  client: TipCrewClient,
  roleId: string,
): Promise<RoleUsage> {
  const { data, error } = await client.rpc('role_usage', { p_role_id: roleId });
  if (error) throw error;
  return roleUsageFrom(data);
}

export async function createArea(
  client: TipCrewClient,
  membership: Membership,
  name: string,
  poolEligible: boolean,
): Promise<string> {
  const { data, error } = await client.rpc('create_workplace_area', {
    p_workplace_id: membership.workplaceId,
    p_name: name,
    p_pool_eligible: poolEligible,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

export async function updateArea(
  client: TipCrewClient,
  membership: Membership,
  areaId: string,
  patch: { name?: string; isPoolEligible?: boolean },
): Promise<void> {
  const { error } = await client
    .from('workplace_areas')
    .update({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.isPoolEligible !== undefined ? { is_pool_eligible: patch.isPoolEligible } : {}),
    })
    .eq('id', areaId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

export async function archiveArea(client: TipCrewClient, areaId: string): Promise<void> {
  const { error } = await client.rpc('archive_workplace_area', { p_area_id: areaId });
  if (error) throw error;
}

export async function restoreArea(client: TipCrewClient, areaId: string): Promise<void> {
  const { error } = await client.rpc('restore_workplace_area', { p_area_id: areaId });
  if (error) throw error;
}

/**
 * Hard delete, offered only when the usage report is empty in every column.
 * The real proof is the database's own `on delete restrict`, which refuses the
 * statement outright if anything at all points at the row.
 */
export async function deleteArea(
  client: TipCrewClient,
  membership: Membership,
  areaId: string,
): Promise<void> {
  const { error } = await client
    .from('workplace_areas')
    .delete()
    .eq('id', areaId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

export async function reorderAreas(
  client: TipCrewClient,
  membership: Membership,
  ids: string[],
): Promise<void> {
  const { error } = await client.rpc('reorder_workplace_areas', {
    p_workplace_id: membership.workplaceId,
    p_ids: ids,
  });
  if (error) throw error;
}

export async function createRole(
  client: TipCrewClient,
  membership: Membership,
  areaId: string,
  name: string,
  points: number,
): Promise<string> {
  const { data, error } = await client.rpc('create_workplace_role', {
    p_workplace_id: membership.workplaceId,
    p_area_id: areaId,
    p_name: name,
    p_points: points,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

export async function updateRole(
  client: TipCrewClient,
  membership: Membership,
  roleId: string,
  patch: { name?: string; points?: number },
): Promise<void> {
  const { error } = await client
    .from('workplace_roles')
    .update({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.points !== undefined ? { points: patch.points } : {}),
    })
    .eq('id', roleId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

export async function archiveRole(client: TipCrewClient, roleId: string): Promise<void> {
  const { error } = await client.rpc('archive_workplace_role', { p_role_id: roleId });
  if (error) throw error;
}

export async function restoreRole(client: TipCrewClient, roleId: string): Promise<void> {
  const { error } = await client.rpc('restore_workplace_role', { p_role_id: roleId });
  if (error) throw error;
}

export async function deleteRole(
  client: TipCrewClient,
  membership: Membership,
  roleId: string,
): Promise<void> {
  const { error } = await client
    .from('workplace_roles')
    .delete()
    .eq('id', roleId)
    .eq('workplace_id', membership.workplaceId);
  if (error) throw error;
}

export async function reorderRoles(
  client: TipCrewClient,
  areaId: string,
  ids: string[],
): Promise<void> {
  const { error } = await client.rpc('reorder_workplace_roles', {
    p_area_id: areaId,
    p_ids: ids,
  });
  if (error) throw error;
}
