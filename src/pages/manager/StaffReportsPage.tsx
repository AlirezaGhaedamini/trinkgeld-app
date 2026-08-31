import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { useToast } from '@/hooks/useToast';
import { centsToAmount } from '@/lib/money';
import { reportsTotalCents } from '@/state/selectors';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * What the team counted tonight. A manager can take one person's numbers or the
 * combined total straight into the pool.
 */
export function StaffReportsPage() {
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
