import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { HistoryRow } from '@/components/domain/HistoryRow';
import { useAppState } from '@/hooks/useAppState';
import { useDistributionRows } from '@/hooks/useDistributionRows';
import { useI18n } from '@/hooks/useI18n';
import { employeeTotals } from '@/state/selectors';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** Everything the signed-in employee has been paid, month to date. */
export function HistoryPage() {
  const state = useAppState();
  const { t, money } = useI18n();
  const rows = useDistributionRows({ chips: true });
  const totals = employeeTotals(state, state.session.employeeId);

  const bars = state.monthlyBars;
  const peak = Math.max(...bars, 1);
  const hasHistory = rows.length > 0;

  return (
    <Screen title={t('history')} titleSize={26} back={false} aboveTabs>
      <Card padding="roomy">
        <p className={styles.displayLabel}>{t('paidInAug')}</p>
        <p
          className={`${styles.displayAmount} ${styles.displayAmountSmall} tabular`}
          style={{ marginBottom: 14 }}
        >
          {money(totals.amount)}
        </p>
        <div className={styles.bars} role="img" aria-label={t('paidInAug')}>
          {bars.map((value, index) => (
            <span
              key={index}
              className={styles.bar}
              style={{
                height: Math.max((value / peak) * 64, 3),
                background:
                  value > 320
                    ? 'var(--color-primary)'
                    : value > 0
                      ? 'var(--color-warning)'
                      : 'var(--color-border)',
              }}
            />
          ))}
        </div>
      </Card>

      {hasHistory ? (
        <div className={ui.stackFlush}>
          {rows.map((row) => (
            <HistoryRow key={row.id} row={row} chevron={false} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('emptyHistory')}>{t('emptyShiftsBody')}</EmptyState>
      )}
    </Screen>
  );
}
