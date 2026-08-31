/**
 * Tip reports: what a member counted at the end of their shift.
 *
 * `tip_reports` is unique on (workplace_id, member_id, work_date), so
 * reporting twice for the same night is an update, not a second row. The
 * policies let a member write only rows carrying their own membership, and a
 * manager read the whole workplace — which is what the manager's reports screen
 * is for.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Membership } from '@/workplace/types';
import { toTipReport, type TipReport } from '@/tips/types';

/** The member's own report for one business day, if they have made one. */
export async function fetchOwnReport(
  client: TipCrewClient,
  membership: Membership,
  workDate: string,
): Promise<TipReport | null> {
  const { data, error } = await client
    .from('tip_reports')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .eq('member_id', membership.id)
    .eq('work_date', workDate)
    .maybeSingle();

  if (error) throw error;
  return data ? toTipReport(data) : null;
}

/** Every report in the workplace for a business day. Managers only, by policy. */
export async function fetchWorkplaceReports(
  client: TipCrewClient,
  membership: Membership,
  workDate: string,
): Promise<TipReport[]> {
  const { data, error } = await client
    .from('tip_reports')
    .select('*')
    .eq('workplace_id', membership.workplaceId)
    .eq('work_date', workDate)
    .order('reported_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const { data: memberRows } = await client
    .from('workplace_members')
    .select('id, display_name')
    .eq('workplace_id', membership.workplaceId);
  const nameById = new Map((memberRows ?? []).map((m) => [m.id, m.display_name]));

  return data.map((row) => ({ ...toTipReport(row), memberName: nameById.get(row.member_id) }));
}

/**
 * File or amend the member's own report for a night.
 *
 * `member_id` is the active membership's, never a value from the screen. The
 * upsert targets the natural key, so a second submission corrects the first
 * instead of colliding with the unique index.
 */
export async function saveOwnReport(
  client: TipCrewClient,
  membership: Membership,
  workDate: string,
  cardCents: number,
  cashCents: number,
  note?: string,
): Promise<TipReport> {
  const { data, error } = await client
    .from('tip_reports')
    .upsert(
      {
        workplace_id: membership.workplaceId,
        member_id: membership.id,
        work_date: workDate,
        card_cents: cardCents,
        cash_cents: cashCents,
        reported_at: new Date().toISOString(),
        ...(note !== undefined ? { note } : {}),
      },
      { onConflict: 'workplace_id,member_id,work_date' },
    )
    .select('*')
    .single();

  if (error) throw error;
  return toTipReport(data);
}
