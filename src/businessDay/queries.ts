/**
 * The one Supabase call of this module: current_business_day() (migration 33).
 *
 * No timestamp is sent. The server reads its own clock, the workplace's
 * timezone and its cut-off hour, and answers with a date any active member of
 * that workplace may ask for.
 */

import type { TipCrewClient } from '@/lib/supabase';

export async function fetchCurrentBusinessDay(
  client: TipCrewClient,
  workplaceId: string,
): Promise<string> {
  const { data, error } = await client.rpc('current_business_day', {
    p_workplace_id: workplaceId,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error('current_business_day returned no date');
  }
  return data;
}
