/**
 * Reading the signed-in user's profile.
 *
 * The profile row is NOT created by this client. Migration 02 puts an
 * `after insert on auth.users` trigger (`app.handle_new_user`) in front of it,
 * running as the definer so a brand-new user — who owns no rows and passes no
 * policy yet — still gets a profile. `public.profiles` deliberately has no
 * INSERT policy, so the browser could not create one even if it tried.
 *
 * What the client does is read it back, under `profiles_select_own`
 * (`using (id = auth.uid())`). That policy is also why one user can never fetch
 * another's row: the request is not rejected, it simply returns nothing.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Tables } from '@/types/database';
import type { TipCrewClient } from '@/lib/supabase';

export type Profile = Tables<'profiles'>;

/** How long to keep looking for a row the signup trigger is still writing. */
const RETRY_DELAYS_MS = [120, 300, 700];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ProfileResult {
  profile: Profile | null;
  /** True when the query itself failed, as opposed to returning no row. */
  failed: boolean;
}

/**
 * Fetch the signed-in user's profile.
 *
 * Immediately after `signUp()` the auth row and its trigger may land a moment
 * before the follow-up select is served, so a missing row is retried a few
 * times before being reported as absent. A genuine query error is reported
 * separately, because "no row yet" and "the request failed" call for different
 * handling upstream.
 */
export async function loadProfile(
  client: TipCrewClient,
  userId: string,
  { retry = false }: { retry?: boolean } = {},
): Promise<ProfileResult> {
  const attempts = retry ? RETRY_DELAYS_MS.length + 1 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      // PGRST116 is "no rows" from .single(); maybeSingle() should not raise it,
      // but treat it as absence rather than failure if it ever does.
      if ((error as PostgrestError).code === 'PGRST116') return { profile: null, failed: false };
      return { profile: null, failed: true };
    }

    if (data) return { profile: data, failed: false };

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }

  return { profile: null, failed: false };
}

/**
 * Keep the profile's stored locale in step with the language the person is
 * actually using. Allowed by `profiles_update_own`; failure is not worth
 * interrupting a sign-in for, so it is swallowed.
 */
export async function saveProfileLocale(
  client: TipCrewClient,
  userId: string,
  locale: 'de' | 'en',
): Promise<void> {
  try {
    await client.from('profiles').update({ locale }).eq('id', userId);
  } catch {
    /* cosmetic; the next sign-in will try again */
  }
}

/** The name to show for a signed-in user, with sensible fallbacks. */
export function displayNameFor(profile: Profile | null, email: string): string {
  const fromProfile = profile?.full_name?.trim();
  if (fromProfile) return fromProfile;
  return email;
}
