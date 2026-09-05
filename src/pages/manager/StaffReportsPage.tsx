import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { useToast } from '@/hooks/useToast';
import { useWorkplace } from '@/hooks/useWorkplace';
import { centsToAmount } from '@/lib/money';
import { formatClock } from '@/lib/time';
import { instantToWallMinutes } from '@/shifts/time';
import { reportsTotalCents } from '@/state/selectors';
import { useTipReports } from '@/tips/useTips';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * What the team counted tonight.
 *
 * With real credentials the list is the workplace's `tip_reports` for the
 * business day, read through `useTipReports()` — the same hook the employee's
 * own report screen uses, so both sides agree on which night it is. The pool
 * is then built by the database from these very rows, so the button here only
 * opens the wizard; nothing is copied into a draft by hand.
 *
 * Without credentials the prototype's sample reports are rendered from the
 * local dataset, unchanged.
 */
export function StaffReportsPage() {
  const tips = useTipReports();
  return tips.enabled ? <RealStaffReports tips={tips} /> : <DemoStaffReports />;
}

/* ── real ─────────────────────────────────────────────────────────────────── */

function RealStaffReports({ tips }: { tips: ReturnType<typeof useTipReports> }) {
  const { t, money, day } = useI18n();
  const navigate = useNavigate();
  const workplace = useWorkplace();
  const timeZone = workplace.activeMembership?.workplace.timezone ?? 'Europe/Berlin';

  const reports = tips.workplaceReports;
  const totalCents = reports.reduce((sum, r) => sum + r.totalCents, 0);
  const nightLabel = tips.businessDate ? day(new Date(`${tips.businessDate}T12:00:00`)) : '';

  return (
    <Screen
      title={t('reportsTitle')}
      kicker={nightLabel}
      cta={
        reports.length > 0
          ? { label: t('useReport'), onClick: () => navigate('/manager/new/pool') }
          : undefined
      }
    >
      <div>
        <p className={styles.displayLabel}>{t('reportedTotal')}</p>
        <p
          className={`${styles.displayAmount} ${styles.displayAmountSmall} tabular`}
          style={totalCents === 0 ? { color: 'var(--color-text-faint)' } : undefined}
        >
          {money(centsToAmount(totalCents))}
        </p>
        <p className={ui.note} style={{ marginTop: 4 }}>
          {t('reportsBody')}
        </p>
      </div>

      <div className={ui.stackFlush}>
        {reports.map((report) => (
          <div
            key={report.id}
            className={ui.row}
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '13px 0' }}
          >
            <span className={ui.inline}>
              <Avatar name={report.memberName ?? ''} />
              <span className={ui.rowMain}>
                <span className={`${ui.rowTitle} ${ui.truncate}`}>{report.memberName ?? ''}</span>
                <span className={ui.rowMeta} style={{ display: 'block' }}>
                  {formatClock(instantToWallMinutes(report.reportedAt, timeZone))}
                </span>
              </span>
              <span
                className="tabular"
                style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-money-row)' }}
              >
                {money(centsToAmount(report.totalCents))}
              </span>
            </span>
            <span className={`${styles.reportBreakdown} tabular`}>
              {t('srcCard')} {money(centsToAmount(report.cardCents))} · {t('srcCash')}{' '}
              {money(centsToAmount(report.cashCents))}
            </span>
          </div>
        ))}
      </div>

      {reports.length === 0 && tips.status !== 'loading' ? (
        <EmptyState title={t('noReports')} />
      ) : null}
    </Screen>
  );
}

/* ── demo ─────────────────────────────────────────────────────────────────── */

/** The prototype's reports screen, from the sample dataset. Unchanged. */
function DemoStaffReports() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money, area } = useI18n();
  const shift = useShiftLabel();
  const { show } = useToast();
  const navigate = useNavigate();

  const total = centsToAmount(reportsTotalCents(state));

  const useAmounts = (cardCents: number, cashCents: number) => {
    dispatch({ type: 'usePoolAmounts', cardCents, cashCents });
    show(t('reportUsed'));
    navigate('/manager/new/pool');
  };

  return (
    <Screen
      title={t('reportsTitle')}
      kicker={shift.full}
      cta={
        state.reports.length
          ? {
              label: t('useReport'),
              onClick: () =>
                useAmounts(
                  state.reports.reduce((sum, report) => sum + report.cardCents, 0),
                  state.reports.reduce((sum, report) => sum + report.cashCents, 0),
                ),
            }
          : undefined
      }
    >
      <div>
        <p className={styles.displayLabel}>{t('reportedTotal')}</p>
        <p
          className={`${styles.displayAmount} ${styles.displayAmountSmall} tabular`}
          style={total === 0 ? { color: 'var(--color-text-faint)' } : undefined}
        >
          {money(total)}
        </p>
        <p className={ui.note} style={{ marginTop: 4 }}>
          {t('reportsBody')}
        </p>
      </div>

      <div className={ui.stackFlush}>
        {state.reports.map((report) => {
          const person = state.employees.find((e) => e.id === report.employeeId);
          return (
            <button
              key={report.id}
              type="button"
              className={ui.row}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '13px 0' }}
              onClick={() => useAmounts(report.cardCents, report.cashCents)}
            >
              <span className={ui.inline}>
                <Avatar name={person?.name ?? ''} />
                <span className={ui.rowMain}>
                  <span className={`${ui.rowTitle} ${ui.truncate}`}>{person?.name}</span>
                  <span className={ui.rowMeta} style={{ display: 'block' }}>
                    {person ? area(person.area) : ''} · {report.reportedAt}
                  </span>
                </span>
                <span
                  className="tabular"
                  style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-money-row)' }}
                >
                  {money(centsToAmount(report.cardCents + report.cashCents))}
                </span>
                <Icon name="caret-right" size={13} className={ui.chevron} />
              </span>
              <span className={`${styles.reportBreakdown} tabular`}>
                {t('srcCard')} {money(centsToAmount(report.cardCents))} · {t('srcCash')}{' '}
                {money(centsToAmount(report.cashCents))}
              </span>
            </button>
          );
        })}
      </div>

      {state.reports.length === 0 ? <EmptyState title={t('noReports')} /> : null}
    </Screen>
  );
}
