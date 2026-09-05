/**
 * The one call the dashboard makes.
 *
 * `manager_dashboard()` is SECURITY DEFINER and checks `app.is_manager()` before
 * it answers, so the workplace id sent here names which workplace is meant and
 * nothing more. An employee, a suspended manager, a manager of somewhere else
 * and an anonymous caller are all refused with the same error.
 */

import type { TipCrewClient } from '@/lib/supabase';
import { toDashboard, type ManagerDashboard } from '@/dashboard/types';

export async function fetchDashboard(
  client: TipCrewClient,
  workplaceId: string,
): Promise<ManagerDashboard> {
  const { data, error } = await client.rpc('manager_dashboard', { p_workplace_id: workplaceId });
  if (error) throw error;
  return toDashboard(data);
}
