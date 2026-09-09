/**
 * Which dataset the app boots with, decided once and in one place.
 *
 * Demo mode is the Phase 1 sample workplace, run entirely from local state.
 * It is a development and demonstration tool, and Phase 3R closes the door a
 * production user could have walked through by accident: with Supabase
 * configured, a production build ignores `?demo=1` and any demo mode a
 * browser remembered from an earlier visit, and always boots real.
 *
 * Demo stays available where it is meant to be:
 *   · a development build (Vite's DEV flag),
 *   · a build with no Supabase credentials at all, which has nothing else to
 *     show,
 *   · a build that says so explicitly with VITE_ALLOW_DEMO=true — a staging
 *     deployment, never production.
 *
 * Pure on purpose: the environment, the URL and the stored value come in as
 * arguments, so the decision can be tested without a browser.
 */

import type { DataMode } from '@/state/types';

export interface DataModeInputs {
  /** Both Supabase variables present. */
  configured: boolean;
  /** import.meta.env.DEV */
  dev: boolean;
  /** VITE_ALLOW_DEMO, raw. Only the exact string "true" counts. */
  allowFlag: string | undefined;
  /** The `demo` query parameter, raw, or null. */
  urlParam: string | null;
  /** Whatever localStorage holds under the data-mode key, or null. */
  stored: string | null;
}

export interface DataModeDecision {
  mode: DataMode;
  /** What to write back to storage: a mode, or null to clear a stale value. */
  persist: DataMode | null;
}

export function demoAllowed(inputs: Pick<DataModeInputs, 'configured' | 'dev' | 'allowFlag'>): boolean {
  return !inputs.configured || inputs.dev || inputs.allowFlag === 'true';
}

export function resolveDataMode(inputs: DataModeInputs): DataModeDecision {
  if (!demoAllowed(inputs)) {
    // Production: the URL and the stored value are ignored, and a stored
    // 'demo' is cleared so a later deployment cannot inherit it either.
    return { mode: 'empty', persist: inputs.stored === 'demo' ? 'empty' : null };
  }
  if (inputs.urlParam === '1' || inputs.urlParam === 'true') return { mode: 'demo', persist: 'demo' };
  if (inputs.urlParam === '0' || inputs.urlParam === 'false') return { mode: 'empty', persist: 'empty' };
  if (inputs.stored === 'demo') return { mode: 'demo', persist: null };
  // Anything else stored — 'empty', garbage, nothing — means real.
  return { mode: 'empty', persist: null };
}
