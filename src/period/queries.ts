/**
 * Period close and export, over the wire.
 *
 * Three RPCs and one table read. The browser sends a workplace id because it
 * has to name which workplace it means — and every one of these checks it with
 * `app.is_manager()` before answering, so naming a workplace is not the same as
 * being allowed into it. It sends no actor and no timestamp: the close derives
 * both.
 */

import type { TipCrewClient } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import {
  toPeriodClose,
  toPeriodExport,
  toReadiness,
  type PeriodClose,
  type PeriodExport,
  type PeriodReadiness,
} from '@/period/types';

/** What stands in the way of closing this period, and what merely needs saying. */
export async function fetchReadiness(
  client: TipCrewClient,
  workplaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodReadiness> {
  const { data, error } = await client.rpc('financial_period_readiness', {
    p_workplace_id: workplaceId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw error;
  return toReadiness(data);
}

/** Records the close. Returns its id. */
export async function closePeriod(
  client: TipCrewClient,
  workplaceId: string,
  periodStart: string,
  periodEnd: string,
  note?: string,
): Promise<string> {
  const { data, error } = await client.rpc('close_financial_period', {
    p_workplace_id: workplaceId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw error;
  return typeof data === 'string' ? data : '';
}

/** The one authoritative dataset. CSV is formatted from this and nothing else. */
export async function fetchExport(
  client: TipCrewClient,
  workplaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodExport> {
  const { data, error } = await client.rpc('financial_period_export', {
    p_workplace_id: workplaceId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw error;
  return toPeriodExport(data);
}

/** Closes already recorded, newest first. */
export async function fetchCloses(
  client: TipCrewClient,
  workplaceId: string,
): Promise<PeriodClose[]> {
  const { data, error } = await client
    .from('financial_period_closes')
    .select('id,workplace_id,period_start,period_end,note,closed_at,closed_by,created_at')
    .eq('workplace_id', workplaceId)
    .order('period_start', { ascending: false })
    .limit(24);
  if (error) throw error;
  return (data ?? []).map((row) => toPeriodClose(row as Tables<'financial_period_closes'>));
}
