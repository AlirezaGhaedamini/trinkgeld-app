/**
 * Typed Supabase browser client.
 *
 * SECURITY CONTRACT — read before changing anything in this file
 * ---------------------------------------------------------------
 * 1. This client authenticates with the **anon key** only. The anon key is a
 *    public credential: it identifies the project and nothing else. Every row
 *    it can reach is still filtered by the Row Level Security policies in
 *    `supabase/migrations/`.
 * 2. The **service-role key bypasses RLS completely**. It must never appear in
 *    this file, in any `VITE_`-prefixed variable, in `.env.example`, or in any
 *    committed file. It belongs only in server-side contexts (Edge Functions,
 *    CI secrets), which this project does not have yet.
 * 3. Employees must never read manager-only base tables directly. Member-facing
 *    reads go through the two views in migration 1200:
 *      - `member_distributions`       (masks the workplace tip pool total)
 *      - `member_distribution_entries`
 *    Writes go through the `SECURITY DEFINER` RPCs, not through table inserts.
 *
 * Phase 2 scope: this module only *creates* the client. The application still
 * runs on the local mock state from Phase 1. Wiring screens to live queries is
 * Phase 3.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { hasSupabaseEnv, readSupabaseEnv } from '@/lib/env';

export type TipCrewClient = SupabaseClient<Database>;

let client: TipCrewClient | null = null;

/**
 * Returns the shared browser client, creating it on first use.
 *
 * Throws a descriptive error when the environment is not configured, so a
 * missing `.env.local` surfaces as a clear message rather than a network
 * failure against `undefined`.
 */
export function getSupabase(): TipCrewClient {
  if (client) return client;

  const { url, anonKey } = readSupabaseEnv();

  client = createClient<Database>(url, anonKey, {
    auth: {
      // Keep the session in localStorage and refresh it in the background.
      // Capacitor's WebView provides localStorage, so this also works once the
      // app is wrapped natively.
      persistSession: true,
      autoRefreshToken: true,
      // The app uses HashRouter; magic-link and OAuth callbacks arrive in the
      // URL fragment, which supabase-js parses on load.
      detectSessionInUrl: true,
      storageKey: 'tipcrew.auth',
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-info': 'tipcrew-web' },
    },
    db: { schema: 'public' },
  });

  return client;
}

/**
 * True when the app has Supabase credentials available. Screens can use this to
 * decide between live data and the Phase 1 local state during the Phase 3
 * migration, without throwing on a machine that has no `.env.local`.
 */
export const isSupabaseConfigured = hasSupabaseEnv;

/** Test seam: forget the memoised client (used by future integration tests). */
export function resetSupabaseClient(): void {
  client = null;
}
