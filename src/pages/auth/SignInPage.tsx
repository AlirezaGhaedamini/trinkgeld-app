import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import type { UserRole } from '@/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * Sign in.
 *
 * The fields start empty and are really typed into — nothing is pre-filled. No
 * credentials are checked yet: signing in creates the local account and, on an
 * empty install, the first roster entry. Supabase auth replaces the submit
 * handler and nothing else on this screen.
 */
export function SignInPage() {
  const { session, dataMode } = useAppState();
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const demo = dataMode === 'demo';
  const [email, setEmail] = useState(session.accountEmail);
  const [password, setPassword] = useState('');

  // With the sample workplace loaded there is nothing to type: you sign in as
  // one of the two demo accounts.
  const ready = demo || (email.trim().length > 0 && password.length > 0);

  const submit = () => {
    if (!ready) {
      show(t('needEmail'));
      return;
    }
    dispatch({ type: 'signIn', role: session.role, email: email.trim() });
    navigate(session.role === 'manager' ? '/manager' : '/home', { replace: true });
  };

  const label = demo
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
            submit();
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
          <Button type="submit" block muted={!ready}>
            {label}
          </Button>
          <Button variant="secondary" block onClick={() => navigate('/signup')}>
            {t('createAcc')}
          </Button>
        </form>

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

        {demo ? <p className={ui.note}>{t('demoNote')}</p> : null}
      </div>
    </Screen>
  );
}
