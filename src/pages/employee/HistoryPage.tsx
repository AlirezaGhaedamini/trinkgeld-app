import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { HistoryRow } from '@/components/domain/HistoryRow';
import { useAppState } from '@/hooks/useAppState';
import { rowsForMyShare, useDistributionRows } from '@/hooks/useDistributionRows';
import { useI18n } from '@/hooks/useI18n';
import { useWorkplace } from '@/hooks/useWorkplace';
import { employeeTotals } from '@/state/selectors';
import { useMyShare } from '@/distribution/useDistribution';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** Everything the signed-in employee has been paid. */
export function HistoryPage() {
  const workplace = useWorkplace();
  const real = workplace.enabled && workplace.activeMembership !== null;
  return real ? <RealHistory /> : <DemoHistory />;
}

/**
 * The person's own rows from member_distributions, newest first.
 *
 * There is no total on top. Adding the rows up would count a replaced version
 * next to its replacement and a cancelled distribution next to its money — the
 * sum would be wrong on exactly the nights that matter most. Each row carries
 * its own amount and its own state, and that is the record. The count in the
 * section label is of nights, so it describes the list whatever happened to
 * the versions in it.
 */
function RealHistory() {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const mine = useMyShare();
  const rows = rowsForMyShare(mine, i18n, navigate);
  // Nights, not rows: a night that was corrected twice is still one night,
  // and a night whose only versions were replaced is still a night worked.
  const nightCount = new Set(mine.distributions.map((d) => d.periodStart)).size;

  return (
    <Screen title={t('history')} titleSize={26} back={false} aboveTabs>
      {mine.status === 'error' ? (
        <>
          <EmptyState title={t('loadFailed')} />
          <Button variant="secondary" block onClick={() => void mine.refresh()}>
            {t('retry')}
          </Button>
        </>
      ) : mine.status !== 'ready' ? (
        <EmptyState title={t('dLoading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('emptyHistory')}>{t('emptyShiftsBody')}</EmptyState>
      ) : (
        <div className={ui.stackFlush}>
          <SectionLabel meta={t('dbNightsN').replace('{n}', String(nightCount))}>
            {t('hsShares')}
          </SectionLabel>
          {rows.map((row) => (
            <HistoryRow key={row.id} row={row} chevron={false} />
          ))}
        </div>
      )}
    </Screen>
  );
}

/** The Phase 1 demo, unchanged: month to date from the reducer. */
function DemoHistory() {
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
