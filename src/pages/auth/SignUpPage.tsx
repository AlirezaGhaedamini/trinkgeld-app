import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { InfoNote, Note } from '@/components/ui/Note';
import { AUTH_FAILURE_KEY } from '@/auth/errors';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import type { UserRole } from '@/types';
import ui from '@/components/ui/ui.module.css';

/**
 * Create an account. Every field starts empty and is typed by the user.
 *
 * The name is handed to Supabase as user metadata, which is where
 * `app.handle_new_user()` reads it from when it creates the profile row. The
 * browser never inserts into `public.profiles` — it has no policy to do so, by
 * design.
 *
 * If the project has email confirmation switched on, sign-up returns a user but
 * no session; the screen then says so and waits, rather than pretending the
 * account is ready. Supabase deliberately returns the same shape for an address
 * that is already registered, so this path leaks nothing either way.
 */
export function SignUpPage() {
  const { session } = useAppState();
  const dispatch = useAppDispatch();
  const auth = useAuth();
  const real = useRealAuth();
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(session.accountName);
  const [email, setEmail] = useState(session.accountEmail);
  const [password, setPassword] = useState('');
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Sign-up finishes with a live session and then continues to the workplace
  // step, so this screen cannot be behind a blanket "already signed in" guard.
  // It turns away someone who arrived here with a session instead.
  const ownSession = useRef(false);
  const arrivedSignedIn = real && auth.status === 'signedIn' && !ownSession.current;

  const named = name.trim().length > 0 && email.trim().length > 0;
  const ready = real ? named && password.length > 0 : named;

  const submit = async () => {
    if (auth.busy) return;
    if (!named) {
      show(t('needName'));
      return;
    }
    if (real && password.length === 0) {
      show(t('authNeedPassword'));
      return;
    }

    if (!real) {
      dispatch({ type: 'signIn', role: session.role, name: name.trim(), email: email.trim() });
      navigate('/join');
      return;
    }

    ownSession.current = true;
    const result = await auth.signUp(name.trim(), email.trim(), password);
    if (!result.ok) {
      ownSession.current = false;
      show(t(AUTH_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }

    if (result.needsEmailConfirmation) {
      setPassword('');
      setAwaitingConfirmation(true);
      return;
    }

    // Signed in already: the workplace step is next, exactly as before.
    navigate('/join');
  };

  if (arrivedSignedIn) return <Navigate to="/" replace />;

  return (
    <Screen
      title={t('signUp')}
      cta={{
        label: auth.busy ? t('authCreating') : t('continue'),
        muted: !ready || auth.busy,
        onClick: () => {
          void submit();
        },
      }}
    >
      <div className={ui.stackTight}>
        {awaitingConfirmation ? <InfoNote icon="paper-plane-tilt">{t('authCheckInboxBody')}</InfoNote> : null}

        <div>
          <label className={ui.fieldLabel} htmlFor="signup-name">
            {t('nameLabel')}
          </label>
          <input
            id="signup-name"
            className={ui.fieldInput}
            autoComplete="name"
            placeholder={t('nameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className={ui.fieldLabel} htmlFor="signup-email">
            {t('emailLabel')}
          </label>
          <input
            id="signup-email"
            className={ui.fieldInput}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t('emailLabel')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label className={ui.fieldLabel} htmlFor="signup-password">
            {t('pwLabel')}
          </label>
          <input
            id="signup-password"
            className={ui.fieldInput}
            type="password"
            autoComplete="new-password"
            placeholder={t('pwLabel')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div style={{ marginTop: 4 }}>
          <span className={ui.fieldLabel}>{t('iAm')}</span>
          <ChipGroup<UserRole>
            label={t('iAm')}
            fill
            value={session.role}
            options={[
              { value: 'employee', label: t('empRole') },
              { value: 'manager', label: t('mgrRole') },
            ]}
            onChange={(role) => dispatch({ type: 'setRole', role })}
          />
        </div>

        <Note>{t('termsNote')}</Note>
      </div>
    </Screen>
  );
}
