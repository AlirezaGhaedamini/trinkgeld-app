import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import type { Language, UserRole } from '@/types';
import styles from '@/components/layout/layout.module.css';

/**
 * The prototype's demo switcher, kept for large screens: it picks the language
 * and which account you are signed in as. It is presentation scaffolding, not
 * product — real accounts and permissions arrive with Supabase auth.
 */
export function DemoBar() {
  const { session, dataMode } = useAppState();
  const dispatch = useAppDispatch();
  const { t, language, setLanguage } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const languages: Language[] = ['English', 'Deutsch'];
  const roles: Array<[UserRole, string]> = [
    ['employee', t('empRole')],
    ['manager', t('mgrRole')],
  ];

  return (
    <div className={styles.demoBar}>
      <span className={styles.demoGroupLabel}>
        <Icon name="translate" size={15} color="var(--color-accent)" />
        {t('sLang')}
      </span>
      <div className={styles.demoOptions}>
        {languages.map((option) => (
          <button
            key={option}
            type="button"
            className={`${styles.demoOption} ${option === language ? styles.demoOptionActive : ''}`}
            onClick={() => setLanguage(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <span className={styles.demoDivider} aria-hidden />
      <div className={styles.demoOptions}>
        {roles.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${styles.demoOption} ${
              value === session.role ? styles.demoOptionActive : ''
            }`}
            onClick={() => {
              dispatch({ type: 'setRole', role: value });
              navigate(
                session.signedIn ? (value === 'manager' ? '/manager' : '/home') : '/signin',
                { replace: true },
              );
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <span className={styles.demoDivider} aria-hidden />
      <span className={styles.demoGroupLabel}>
        <Icon name="notebook" size={15} color="var(--color-accent)" />
        {t('demoData')}
      </span>
      <div className={styles.demoOptions}>
        {([
          ['demo', t('demoOn')],
          ['empty', t('demoOff')],
        ] as Array<['demo' | 'empty', string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${styles.demoOption} ${
              value === dataMode ? styles.demoOptionActive : ''
            }`}
            onClick={() => {
              if (value === dataMode) return;
              dispatch(value === 'demo' ? { type: 'loadDemoData' } : { type: 'resetToEmpty' });
              show(value === 'demo' ? t('demoLoaded') : t('demoCleared'));
              navigate('/signin', { replace: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className={styles.demoHint}>
        {language === 'Deutsch'
          ? 'Rolle wechseln — die App startet in der jeweiligen Ansicht.'
          : 'Switch role — the app restarts in that view.'}
      </p>
    </div>
  );
}
