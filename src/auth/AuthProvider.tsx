import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { AuthContext, type AuthStatus, type AuthValue } from '@/auth/authContext';
import { classifyAuthError } from '@/auth/errors';
import { loadProfile, saveProfileLocale, type Profile } from '@/auth/profile';
import { getSupabase, isSupabaseConfigured, type TipCrewClient } from '@/lib/supabase';
import { useI18n } from '@/hooks/useI18n';

/**
 * Supabase Auth is the source of truth for who is signed in.
 *
 * This provider owns exactly three things: the session, the profile that goes
 * with it, and the three actions. It never stores a password, never reads a
 * service key, and never decides what anyone is allowed to do — permission is a
 * property of a workplace membership and lives in the database.
 *
 * When the app has no Supabase credentials (`enabled === false`) the provider
 * reports `signedOut` and does nothing else, so the Phase 1 local flow and the
 * demo dataset keep working on a machine with no `.env.local`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n();

  // Resolve the client once. A missing or malformed .env is a configuration
  // problem, not a crash: fall back to the local flow instead of a blank screen.
  const [client] = useState<TipCrewClient | null>(() => {
    if (!isSupabaseConfigured()) return null;
    try {
      return getSupabase();
    } catch {
      return null;
    }
  });

  const enabled = client !== null;

  const [status, setStatus] = useState<AuthStatus>(enabled ? 'restoring' : 'signedOut');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  // Guards against setting state after unmount, and against an older profile
  // fetch resolving after a newer sign-in has already replaced the user.
  const alive = useRef(true);
  const fetchToken = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const applySession = useCallback(
    async (next: Session | null, { retryProfile = false } = {}) => {
      const token = (fetchToken.current += 1);

      if (!next) {
        if (!alive.current) return;
        setSession(null);
        setProfile(null);
        setStatus('signedOut');
        return;
      }

      if (alive.current) setSession(next);

      // A session without a readable profile is still a session — the person
      // stays signed in and the app shows their email. It is not a reason to
      // throw them back to the sign-in screen.
      const { profile: row } = await loadProfile(client!, next.user.id, { retry: retryProfile });

      if (!alive.current || token !== fetchToken.current) return;
      setProfile(row);
      setStatus('signedIn');
    },
    [client],
  );

  // Restore a persisted session on boot, then follow every later change.
  useEffect(() => {
    if (!client) return;

    let cancelled = false;

    void client.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        void applySession(data.session ?? null);
      })
      .catch(() => {
        // Offline at boot: supabase-js keeps the stored session and will
        // recover on its own. Do not strand the user on a spinner.
        if (!cancelled && alive.current) setStatus('signedOut');
      });

    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      void applySession(next);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [client, applySession]);

  // Mirror the chosen language onto the profile so a new device opens in the
  // right one. Cosmetic, and failure is ignored.
  useEffect(() => {
    if (!client || !session) return;
    const locale = language === 'Deutsch' ? 'de' : 'en';
    if (profile && profile.locale === locale) return;
    void saveProfileLocale(client, session.user.id, locale);
  }, [client, session, profile, language]);

  const signIn = useCallback<AuthValue['signIn']>(
    async (email, password) => {
      if (!client) return { ok: false, failure: 'notConfigured' };
      setBusy(true);
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) return { ok: false, failure: classifyAuthError(error) };
        await applySession(data.session ?? null);
        return { ok: true };
      } catch (error) {
        return { ok: false, failure: classifyAuthError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, applySession],
  );

  const signUp = useCallback<AuthValue['signUp']>(
    async (name, email, password) => {
      if (!client) return { ok: false, failure: 'notConfigured' };
      setBusy(true);
      try {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          // Read by app.handle_new_user() to fill profiles.full_name.
          options: { data: { full_name: name.trim() } },
        });
        if (error) return { ok: false, failure: classifyAuthError(error) };

        // With email confirmation switched on, Supabase returns a user but no
        // session. It also returns an obfuscated user for an address that is
        // already registered, rather than admitting the account exists.
        if (!data.session) return { ok: true, needsEmailConfirmation: true };

        await applySession(data.session, { retryProfile: true });
        return { ok: true };
      } catch (error) {
        return { ok: false, failure: classifyAuthError(error) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [client, applySession],
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      await client.auth.signOut();
    } catch {
      /* already gone server-side; the local session is cleared either way */
    } finally {
      if (alive.current) {
        setSession(null);
        setProfile(null);
        setStatus('signedOut');
        setBusy(false);
      }
    }
  }, [client]);

  const value = useMemo<AuthValue>(
    () => ({
      enabled,
      status,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? '',
      profile,
      busy,
      signIn,
      signUp,
      signOut,
    }),
    [enabled, status, session, profile, busy, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
