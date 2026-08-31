import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Note } from '@/components/ui/Note';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useWorkplace } from '@/hooks/useWorkplace';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { workedMinutes } from '@/lib/time';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

interface SettingRow {
  icon: IconName;
  label: string;
  value: string;
  valueColor?: string;
  onClick: () => void;
}

/**
 * The employee's own settings. Manager-only controls are visible as a locked
 * note rather than hidden, so people know the rules exist and who owns them.
 */
export function ProfilePage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, num, language, area } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const auth = useAuth();
  const real = useRealAuth();
  const workplace = useWorkplace();

  /**
   * Sign out of Supabase first, then clear the local state.
   *
   * Order matters: ending the server session is the part that actually revokes
   * anything, and it has to happen even if the person closes the app straight
   * afterwards. The local reset and the redirect follow regardless of whether
   * the network call succeeded, so nobody is ever left looking at a signed-in
   * screen they cannot leave.
   */
  const signOut = async () => {
    if (real) await auth.signOut();
    dispatch({ type: 'signOut' });
    navigate('/signin', { replace: true });
  };

  const employee = state.employees.find((e) => e.id === state.session.employeeId);
  const submission = state.submissions[state.session.employeeId];

  const rows: SettingRow[] = [
    // Only when there is actually a choice to make. One workplace, no row.
    ...(workplace.enabled && workplace.memberships.length > 1
      ? [
          {
            icon: 'briefcase' as const,
            label: t('workplace'),
            value: workplace.activeMembership?.workplace.name ?? t('notSet'),
            valueColor: 'var(--color-accent)',
            onClick: () => navigate('/workplaces'),
          },
        ]
      : []),
    {
      icon: 'translate',
      label: t('sLang'),
      value: language,
      valueColor: 'var(--color-accent)',
      onClick: () => navigate('/profile/language'),
    },
    {
      icon: 'user-focus',
      label: t('yourAreaRole'),
      value: employee ? `${area(employee.area)} · ${t(employee.roleId)}` : t('notSet'),
      onClick: () => show(t('setByManager')),
    },
    {
      icon: 'clock',
      label: t('myHoursTitle'),
      value: submission
        ? `${num(workedMinutes(submission) / 60, 2)} ${t('hSuffix')}`
        : t('notSubmitted'),
      onClick: () => navigate('/hours'),
    },
    {
      icon: 'bank',
      label: t('sPayout'),
      value: t('sPayoutV'),
      onClick: () =>
        show(language === 'Deutsch' ? 'Auszahlung mit dem Lohn' : 'Paid out with salary'),
    },
    {
      icon: 'file-arrow-down',
      label: t('sExport'),
      value: 'CSV',
      onClick: () => show(t('exportToast')),
    },
  ];

  return (
    <Screen title={t('profile')} titleSize={26} back={false} aboveTabs>
      <div className={styles.identity}>
        <Avatar name={employee?.name ?? ''} size={58} tinted />
        <div style={{ minWidth: 0 }}>
          <p className={styles.identityName}>{employee?.name}</p>
          <p className={styles.identityMeta}>
            {employee ? `${t(employee.roleId)} · ${area(employee.area)}` : ''}
          </p>
        </div>
      </div>

      <Card padding="none" clip>
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            className={`${ui.insetRow} ${ui.insetRowInteractive}`}
            onClick={row.onClick}
          >
            <Icon name={row.icon} size={19} color="var(--color-text-muted)" />
            <span className={`${ui.rowMain} ${ui.rowTitle}`}>{row.label}</span>
            <span className={ui.rowValue} style={{ color: row.valueColor }}>
              {row.value}
            </span>
            <Icon name="caret-right" size={13} className={ui.chevron} />
          </button>
        ))}
      </Card>

      <Card tone="faint" padding="padded">
        <div className={styles.lockedBanner} style={{ opacity: 0.75 }}>
          <Icon name="lock-simple" size={18} color="var(--color-text-subtle)" />
          <div className={ui.rowMain}>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{t('adminArea')}</p>
            <p className={ui.note} style={{ marginTop: 2 }}>
              {t('adminBody')}
            </p>
          </div>
        </div>
      </Card>

      <Note>{t('privacyNote')}</Note>

      <Button
        variant="secondary"
        quiet
        block
        disabled={auth.busy}
        onClick={() => {
          void signOut();
        }}
      >
        {t('signOut')}
      </Button>
    </Screen>
  );
}
