import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { AUTH_FAILURE_KEY } from '@/auth/errors';
import { safeReturnTo, takeReturnTo } from '@/auth/returnTo';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import type { UserRole } from '@/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * Sign in.
 *
 * The screen is unchanged from the approved design; only the submit handler
 * does real work now. With credentials configured it goes to Supabase Auth —
 * the app never checks a password itself and never stores one. With the demo
 * dataset loaded, or on a machine with no `.env.local`, it falls back to the
 * local sign-in so the prototype still runs.
 *
 * On failure the person sees one of a fixed set of translated messages. The
 * wording never distinguishes "no such account" from "wrong password", because
 * that difference is an account-enumeration oracle.
 */
export function SignInPage() {
  const { session, dataMode } = useAppState();
  const dispatch = useAppDispatch();
  const auth = useAuth();
  const real = useRealAuth();
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const demo = dataMode === 'demo';
  const [email, setEmail] = useState(session.accountEmail);
  const [password, setPassword] = useState('');

  // With the sample workplace loaded there is nothing to type: you sign in as
  // one of the two demo accounts.
  const ready = demo || (email.trim().length > 0 && password.length > 0);

  /* Where RequireSession sent us from, query string included, so an
     invitation link keeps its token across the sign-in. */
  const from = safeReturnTo((location.state as { from?: unknown } | null)?.from);

  /* The demo's landing, chosen by the local role toggle. */
  const goHome = () => {
    navigate(session.role === 'manager' ? '/manager' : '/home', { replace: true });
  };

  /* Real mode never routes on the local role. `/` asks the membership who this
     is. The same-tab destination arrives as router state; the stored one is
     the email-confirmation return, and it answers only for the account that
     just signed in — which is the address typed into this form. */
  const continueSignedIn = () => {
    navigate(from ?? takeReturnTo(email) ?? '/', { replace: true });
  };

  const submit = async () => {
    if (auth.busy) return;
    if (!ready) {
      show(t('needEmail'));
      return;
    }

    if (!real) {
      dispatch({ type: 'signIn', role: session.role, email: email.trim() });
      goHome();
      return;
    }

    const result = await auth.signIn(email.trim(), password);
    if (!result.ok) {
      show(t(AUTH_FAILURE_KEY[result.failure ?? 'unknown']));
      setPassword('');
      return;
    }
    // AuthBridge hands the identity to the local state; the guard holds the
    // route for the frame that takes.
    continueSignedIn();
  };

  const label = auth.busy
    ? t('authSigningIn')
    : demo
      ? session.role === 'manager'
        ? t('signInMgr')
        : t('signInEmp')
      : t('continue');

  return (
    <Screen back={false} center>
      <div className={styles.signIn}>
        <div className={ui.stackTight}>
          <BrandMark />
          <h1 className={styles.wordmark}>TipCrew</h1>
          <p className={styles.tagline}>{t('tagline')}</p>
        </div>

        <form
          className={ui.stackTight}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <label className={ui.fieldLabel} htmlFor="signin-email">
              {t('emailLabel')}
            </label>
            <input
              id="signin-email"
              className={ui.fieldInput}
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder={t('emailLabel')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label className={ui.fieldLabel} htmlFor="signin-password">
              {t('pwLabel')}
            </label>
            <div className={`${ui.field} ${password ? ui.fieldFocus : ''}`}>
              <input
                id="signin-password"
                className={ui.fieldBare}
                type="password"
                autoComplete="current-password"
                placeholder={t('pwLabel')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Icon name="eye" size={19} color="var(--color-text-muted)" />
            </div>
          </div>
          <Button type="submit" block muted={!ready} disabled={auth.busy} aria-busy={auth.busy}>
            {label}
          </Button>
          <Button
            variant="secondary"
            block
            disabled={auth.busy}
            onClick={() => navigate('/signup', { state: location.state })}
          >
            {t('createAcc')}
          </Button>
        </form>

        {/* The role toggle belongs to the demo, where it picks which sample
            account you are. A real account's role is a property of its
            membership, so the control is not shown there. */}
        {real ? null : (
          <div className={styles.mobileOnly}>
            <SegmentedControl<UserRole>
              label={t('iAm')}
              value={session.role}
              options={[
                { value: 'employee', label: t('empRole') },
                { value: 'manager', label: t('mgrRole') },
              ]}
              onChange={(role) => dispatch({ type: 'setRole', role })}
            />
          </div>
        )}

        {demo ? <p className={ui.note}>{t('demoNote')}</p> : null}
      </div>
    </Screen>
  );
}
