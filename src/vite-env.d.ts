/// <reference types="vite/client" />

/**
 * Typed view of the environment variables this app is allowed to read.
 * Merges with Vite's own `ImportMetaEnv` declaration.
 *
 * Only `VITE_`-prefixed variables reach the browser bundle. The service-role
 * key is deliberately absent from this interface — it must never be exposed to
 * client code.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
