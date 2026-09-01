/**
 * Every Supabase call the rules editor makes.
 *
 * Two things are deliberate and load-bearing here:
 *
 *  · Nothing writes to an active rule. Editing goes through
 *    create_rule_draft() → write the draft → activate_rule(). The database
 *    enforces that too (app.guard_rule_immutable), but the client should never
 *    be the thing that discovers it.
 *
 *  · Role points are written to `workplace_roles`, not to
 *    `distribution_rule_roles`. activate_rule() DELETEs the rule's role rows
 *    and re-reads them from `workplace_roles`, so a value written into the
 *    draft's role table would be silently overwritten at activation. The live
 *    definition is the input; the rule version's copy is the frozen output.
 *
 * Only a manager gets past RLS on any of these. The browser holds the anon key
 * and nothing else.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Membership } from '@/workplace/types';
import {
  toSettings,
  type AreaShare,
  type DraftPatch,
  type RolePoints,
  type RuleVersion,
  type RulesState,
  type WorkplaceSettings,
} from '@/rules/types';

interface AreaRow {
  id: string;
  key: string;
  name: string;
  is_pool_eligible: boolean;
  sort_order: number;
}

function shapeShares(
  areas: AreaRow[],
  shareByArea: Map<string, number>,
): AreaShare[] {
  return areas
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))
    .map((a) => ({
      areaId: a.id,
      areaKey: a.key,
      areaName: a.name,
      percentage: shareByArea.get(a.id) ?? 0,
      isPoolEligible: a.is_pool_eligible,
      sortOrder: a.sort_order,
    }));
}

/**
 * Everything the editor renders, in one pass.
 *
 * Five reads rather than one embed: the embed would depend on relationship
 * metadata in the generated types, and every one of these is filtered by RLS
 * regardless of what the client asks for.
 */
export async function fetchRulesState(
  client: TipCrewClient,
  membership: Membership,
): Promise<RulesState> {
  const workplaceId = membership.workplaceId;

  const [rulesRes, areasRes, rolesRes, workplaceRes, membersRes] = await Promise.all([
    client
      .from('distribution_rules')
      .select('*')
      .eq('workplace_id', workplaceId)
      .in('status', ['active', 'draft']),
    client
      .from('workplace_areas')
      .select('id, key, name, is_pool_eligible, sort_order')
      .eq('workplace_id', workplaceId)
      .is('archived_at', null),
    client
      .from('workplace_roles')
      .select('id, key, name, points, area_id, sort_order')
      .eq('workplace_id', workplaceId)
      .is('archived_at', null),
    client.from('workplaces').select('*').eq('id', workplaceId).single(),
    client
      .from('workplace_members')
      .select('id, area_id')
      .eq('workplace_id', workplaceId)
      .eq('status', 'active'),
  ]);

  if (rulesRes.error) throw rulesRes.error;
  if (areasRes.error) throw areasRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (workplaceRes.error) throw workplaceRes.error;
  if (membersRes.error) throw membersRes.error;

  const areaRows = (areasRes.data ?? []) as AreaRow[];
  const activeRow = (rulesRes.data ?? []).find((r) => r.status === 'active') ?? null;
  const draftRow = (rulesRes.data ?? []).find((r) => r.status === 'draft') ?? null;
  const ruleIds = [activeRow?.id, draftRow?.id].filter((id): id is string => Boolean(id));

  let shareRows: Array<{ rule_id: string; area_id: string; percentage: number }> = [];
  let frozenRoleRows: Array<{ rule_id: string; workplace_role_id: string; points: number }> = [];
  if (ruleIds.length > 0) {
    const [sharesRes, frozenRes] = await Promise.all([
      client
        .from('distribution_rule_areas')
        .select('rule_id, area_id, percentage')
        .in('rule_id', ruleIds),
      client
        .from('distribution_rule_roles')
        .select('rule_id, workplace_role_id, points')
        .in('rule_id', ruleIds),
    ]);
    if (sharesRes.error) throw sharesRes.error;
    if (frozenRes.error) throw frozenRes.error;
    shareRows = (sharesRes.data ?? []).map((r) => ({
      rule_id: r.rule_id,
      area_id: r.area_id,
      percentage: Number(r.percentage),
    }));
    frozenRoleRows = (frozenRes.data ?? []).map((r) => ({
      rule_id: r.rule_id,
      workplace_role_id: r.workplace_role_id,
      points: Number(r.points),
    }));
  }

  const sharesFor = (ruleId: string) =>
    new Map(shareRows.filter((r) => r.rule_id === ruleId).map((r) => [r.area_id, r.percentage]));

  const shape = (row: typeof activeRow): RuleVersion | null =>
    row
      ? {
          id: row.id,
          version: row.version,
          status: row.status,
          method: row.method,
          minOverlapMinutes: row.min_overlap_minutes,
          overlapBasis: row.overlap_basis,
          roundingAreaId: row.rounding_area_id,
          acknowledgementRequired: row.acknowledgement_required,
          effectiveFrom: row.effective_from,
          shares: shapeShares(areaRows, sharesFor(row.id)),
        }
      : null;

  const areaNameById = new Map(areaRows.map((a) => [a.id, a.name]));
  const frozenByRole = new Map(
    frozenRoleRows
      .filter((r) => activeRow && r.rule_id === activeRow.id)
      .map((r) => [r.workplace_role_id, r.points]),
  );

  const roles: RolePoints[] = (rolesRes.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        (areaNameById.get(a.area_id) ?? '').localeCompare(areaNameById.get(b.area_id) ?? '') ||
        a.sort_order - b.sort_order ||
        a.key.localeCompare(b.key),
    )
    .map((r) => ({
      roleId: r.id,
      roleKey: r.key,
      roleName: r.name,
      areaId: r.area_id,
      areaName: areaNameById.get(r.area_id) ?? r.area_id,
      points: Number(r.points),
      activePoints: frozenByRole.has(r.id) ? (frozenByRole.get(r.id) as number) : null,
    }));

  return {
    active: shape(activeRow),
    draft: shape(draftRow),
    roles,
    settings: toSettings(workplaceRes.data),
    members: (membersRes.data ?? []).map((m) => ({ memberId: m.id, areaId: m.area_id })),
    areas: shapeShares(areaRows, new Map()),
  };
}

/**
 * The workplace's draft, creating it from the active rule if there is none.
 *
 * create_rule_draft() returns the existing draft when one exists, so calling it
 * twice cannot produce two drafts — the editor relies on that rather than
 * tracking draft ids across mounts.
 */
export async function ensureDraft(
  client: TipCrewClient,
  membership: Membership,
): Promise<string> {
  const { data, error } = await client.rpc('create_rule_draft', {
    p_workplace_id: membership.workplaceId,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('create_rule_draft returned no id');
  return data;
}

/** Write the whole draft. Shares are replaced, never merged. */
export async function saveDraft(
  client: TipCrewClient,
  membership: Membership,
  draftId: string,
  patch: DraftPatch,
): Promise<void> {
  const { error: ruleError } = await client
    .from('distribution_rules')
    .update({
      method: patch.method,
      min_overlap_minutes: patch.minOverlapMinutes,
      overlap_basis: patch.overlapBasis,
      rounding_area_id: patch.roundingAreaId,
      acknowledgement_required: patch.acknowledgementRequired,
    })
    .eq('id', draftId)
    .eq('workplace_id', membership.workplaceId)
    .eq('status', 'draft');
  if (ruleError) throw ruleError;

  const { error: clearError } = await client
    .from('distribution_rule_areas')
    .delete()
    .eq('rule_id', draftId);
  if (clearError) throw clearError;

  if (patch.shares.length > 0) {
    const { error: insertError } = await client.from('distribution_rule_areas').insert(
      patch.shares.map((share) => ({
        rule_id: draftId,
        workplace_id: membership.workplaceId,
        area_id: share.areaId,
        area_key: share.areaKey,
        percentage: share.percentage,
      })),
    );
    if (insertError) throw insertError;
  }
}

/** Returns the new version number. */
export async function activateDraft(
  client: TipCrewClient,
  draftId: string,
): Promise<number> {
  const { data, error } = await client.rpc('activate_rule', { p_rule_id: draftId });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** Throw the draft away. The active rule is untouched either way. */
export async function discardDraft(
  client: TipCrewClient,
  membership: Membership,
  draftId: string,
): Promise<void> {
  const { error: childError } = await client
    .from('distribution_rule_areas')
    .delete()
    .eq('rule_id', draftId);
  if (childError) throw childError;
  const { error } = await client
    .from('distribution_rules')
    .delete()
    .eq('id', draftId)
    .eq('workplace_id', membership.workplaceId)
    .eq('status', 'draft');
  if (error) throw error;
}

/**
 * Role weights, on the role definitions.
 *
 * These take effect at the NEXT activation, because that is when
 * activate_rule() copies them onto the version. Distributions already
 * calculated keep the numbers they were calculated with.
 */
export async function saveRolePoints(
  client: TipCrewClient,
  membership: Membership,
  changes: Array<{ roleId: string; points: number }>,
): Promise<void> {
  for (const change of changes) {
    const { error } = await client
      .from('workplace_roles')
      .update({ points: change.points })
      .eq('id', change.roleId)
      .eq('workplace_id', membership.workplaceId);
    if (error) throw error;
  }
}

export async function saveWorkplaceSettings(
  client: TipCrewClient,
  membership: Membership,
  settings: WorkplaceSettings,
): Promise<void> {
  const { error } = await client
    .from('workplaces')
    .update({
      timezone: settings.timezone,
      business_day_start_hour: settings.businessDayStartHour,
      pool_amount_visible_to_members: settings.poolAmountVisibleToMembers,
      peer_entry_visibility: settings.peerEntryVisibility,
    })
    .eq('id', membership.workplaceId);
  if (error) throw error;
}
