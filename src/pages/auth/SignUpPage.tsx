import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { Note } from '@/components/ui/Note';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import type { UserRole } from '@/types';
import ui from '@/components/ui/ui.module.css';

/** Create an account. Every field starts empty and is typed by the user. */
export function SignUpPage() {
  const { session } = useAppState();
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(session.accountName);
  const [email, setEmail] = useState(session.accountEmail);
  const [password, setPassword] = useState('');

  const ready = name.trim().length > 0 && email.trim().length > 0;

  return (
    <Screen
      title={t('signUp')}
      cta={{
        label: t('continue'),
        muted: !ready,
        onClick: () => {
          if (!ready) {
            show(t('needName'));
            return;
          }
          dispatch({ type: 'signIn', role: session.role, name: name.trim(), email: email.trim() });
          navigate('/join');
        },
      }}
    >
      <div className={ui.stackTight}>
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
