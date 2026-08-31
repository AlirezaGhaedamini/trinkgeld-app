/**
 * Environment access for the browser bundle.
 *
 * Vite only exposes variables prefixed with `VITE_` to client code. That is a
 * deliberate part of the security model here: the anon key is a *public*
 * credential (it identifies the project, not the user — every row it can reach
 * is still gated by Row Level Security), whereas the service-role key bypasses
 * RLS entirely and must never be prefixed with `VITE_`, imported here, or
 * committed anywhere in this repository.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/** True when both Supabase variables are present and non-empty. */
export function hasSupabaseEnv(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/**
 * Reads the Supabase configuration, or throws a message that tells the
 * developer exactly what to do. Called lazily so that the mock-data app of
 * Phase 1 still boots with no `.env` file at all.
 */
export function readSupabaseEnv(): SupabaseEnv {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and set ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Use the anon (publishable) ' +
        'key only — never the service-role key.',
    );
  }

  if (/service_role/i.test(anonKey)) {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY looks like a service-role key. The service-role key ' +
        'bypasses Row Level Security and must never be shipped to a browser.',
    );
  }

  return { url, anonKey };
}
