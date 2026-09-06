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
import { useAssignment } from '@/workplace/useAssignment';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

interface SettingRow {
  icon: IconName;
  label: string;
  value: string;
  valueColor?: string;
  /** Rows without an action are plain facts — no chevron, nothing to tap. */
  onClick?: () => void;
}

/**
 * The employee's own settings. Manager-only controls are visible as a locked
 * note rather than hidden, so people know the rules exist and who owns them.
 */
export function ProfilePage() {
  const workplace = useWorkplace();
  const real = workplace.enabled && workplace.activeMembership !== null;
  return real ? <RealProfile /> : <DemoProfile />;
}

/**
 * The signed-in person, from their membership and their account.
 *
 * Everything here is something the database actually holds: the display name
 * on the membership, the area and role it points at, the workplace, the
 * account email. There is deliberately no payout method and no export row —
 * TipCrew does not know how a workplace hands money over, and it does not
 * email anything. Claiming either would be a lie dressed as a feature.
 */
function RealProfile() {
  const dispatch = useAppDispatch();
  const { t, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const auth = useAuth();
  const workplace = useWorkplace();
  const assignment = useAssignment();
  const membership = workplace.activeMembership;

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
    await auth.signOut();
    dispatch({ type: 'signOut' });
    navigate('/signin', { replace: true });
  };

  if (!membership) return null;

  const manager = membership.role === 'manager';
  const roleLabel = manager ? t('mgrRole') : t('empRole');
  const ready = assignment.status === 'ready';
  // "No area yet" is a true statement about the membership, not a default.
  // While the names are still loading, or the read failed, the meta line says
  // only what is certain — the role — instead of an error sentence.
  const identityMeta = !ready
    ? roleLabel
    : manager
      ? assignment.areaName
        ? `${roleLabel} · ${assignment.areaName}`
        : roleLabel
      : `${roleLabel} · ${assignment.areaName ?? t('tmNoArea')}`;
  const assignmentValue = ready
    ? [assignment.areaName ?? t('tmNoArea'), assignment.roleName]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : assignment.status === 'error'
      ? t('retry')
      : t('dLoading');
  const severalWorkplaces = workplace.memberships.length > 1;

  const rows: SettingRow[] = [
    {
      icon: 'briefcase',
      label: t('workplace'),
      value: membership.workplace.name,
      // Only a link when there is actually a choice to make.
      valueColor: severalWorkplaces ? 'var(--color-accent)' : undefined,
      onClick: severalWorkplaces ? () => navigate('/workplaces') : undefined,
    },
    {
      icon: 'translate',
      label: t('sLang'),
      value: language,
      valueColor: 'var(--color-accent)',
      onClick: () => navigate('/profile/language'),
    },
    // A manager's area is not an operational fact about them; the row is for
    // the people whose share depends on it.
    ...(manager
      ? []
      : [
          {
            icon: 'user-focus' as const,
            label: t('yourAreaRole'),
            value: assignmentValue,
            valueColor: assignment.status === 'error' ? 'var(--color-accent)' : undefined,
            onClick:
              assignment.status === 'error'
                ? () => void assignment.refresh()
                : () => show(t('setByManager')),
          },
        ]),
    {
      icon: 'user',
      label: t('pfAccount'),
      value: auth.email,
    },
  ];

  return (
    <Screen title={t('profile')} titleSize={26} back={manager ? 'arrow' : false} aboveTabs>
      <div className={styles.identity}>
        <Avatar name={membership.displayName} size={58} tinted />
        <div style={{ minWidth: 0 }}>
          <p className={styles.identityName}>{membership.displayName}</p>
          <p className={styles.identityMeta}>{identityMeta}</p>
        </div>
      </div>

      <Card padding="none" clip>
        {/* The value may be long — an email, "Restaurant floor · Senior
            waiter" — so it is allowed to shrink and truncate, with the full
            text on the title attribute. The shared row keeps its rule that
            short values never shrink. */}
        {rows.map((row) =>
          row.onClick ? (
            <button
              key={row.label}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              onClick={row.onClick}
            >
              <Icon name={row.icon} size={19} color="var(--color-text-muted)" />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{row.label}</span>
              <span
                className={`${ui.rowValue} ${ui.truncate}`}
                style={{ color: row.valueColor, flexShrink: 1, minWidth: 0 }}
                title={row.value}
              >
                {row.value}
              </span>
              <Icon name="caret-right" size={13} className={ui.chevron} />
            </button>
          ) : (
            <div key={row.label} className={ui.insetRow}>
              <Icon name={row.icon} size={19} color="var(--color-text-muted)" />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{row.label}</span>
              <span
                className={`${ui.rowValue} ${ui.truncate}`}
                style={{ color: row.valueColor, flexShrink: 1, minWidth: 0 }}
                title={row.value}
              >
                {row.value}
              </span>
            </div>
          ),
        )}
      </Card>

      {/* Employees are told the rules exist and who owns them. A manager owns
          them, and reaches them from the Rules tab. */}
      {manager ? null : (
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
      )}

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

/** The Phase 1 demo, unchanged: the reducer's employee and their submission. */
function DemoProfile() {
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
