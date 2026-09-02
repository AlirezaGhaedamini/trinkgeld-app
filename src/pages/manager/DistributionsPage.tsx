import { useSearchParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { BandBar } from '@/components/ui/BandBar';
import { CardButton } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAppState } from '@/hooks/useAppState';
import { useDistributionRows } from '@/hooks/useDistributionRows';
import { useI18n } from '@/hooks/useI18n';
import { useDistributionHistory } from '@/distribution/useDistribution';
import { PAYOUT_METHOD_LABEL } from '@/distribution/ack';
import { colorForAreaKey } from '@/data/areas';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

type Filter = 'all' | 'pending' | 'confirmed';

/** Every distribution the workplace has sent, filterable by state. */
export function DistributionsPage() {
  const state = useAppState();
  const { t, money } = useI18n();
  const rows = useDistributionRows();
  const [params, setParams] = useSearchParams();

  const filter = (params.get('filter') as Filter | null) ?? 'all';

  /**
   * In real mode the list is the stored distributions themselves. The demo
   * branch below zips the local dataset with its rows; there is nothing to zip
   * against here, because the rows ARE the records.
   */
  const history = useDistributionHistory();
  if (history.enabled) {
    const realRows = history.distributions
      .map((distribution, index) => ({ distribution, row: rows[index] }))
      .filter(({ distribution }) =>
        filter === 'all'
          ? true
          : filter === 'pending'
            ? distribution.status === 'draft' || distribution.status === 'sent'
            : distribution.status === 'confirmed',
      );

    /**
     * The payout line for one row. A first payout reads "Paid €300.00 cash"; a
     * correction reads "Correction settled: +€0.00" against the version the
     * lineage already paid, never its own full total.
     */
    const settlementLine = (id: string) => {
      const s = history.settlements[id];
      if (!s) return null;
      if (s.payoutStatus === 'reversed') return t('revState');
      if (s.payoutStatus !== 'paid') return t('poHistoryUnpaid');
      const amount = money((s.payoutAmountCents ?? 0) / 100);
      const how = s.payoutMethod ? ` ${t(PAYOUT_METHOD_LABEL[s.payoutMethod])}` : '';
      return s.settledEntitlementCents !== 0
        ? `${t('poHistoryCorrection').replace('{amount}', amount)}${how}`
        : `${t('poHistoryPaid').replace('{amount}', amount)}${how}`;
    };

    return (
      <Screen title={t('distributions')} titleSize={26} back={false} aboveTabs>
        <SegmentedControl<Filter>
          label={t('distributions')}
          compact
          value={filter}
          options={[
            { value: 'all', label: t('all') },
            { value: 'pending', label: t('pending') },
            { value: 'confirmed', label: t('confirmed') },
          ]}
          onChange={(next) => setParams(next === 'all' ? {} : { filter: next })}
        />

        {realRows.map(({ distribution, row }) =>
          row ? (
            <CardButton
              key={distribution.id}
              tone={distribution.status === 'draft' ? 'warning' : 'default'}
              padding="padded"
              onClick={row.onOpen}
            >
              <div className={styles.distCard}>
                <div className={styles.distHead}>
                  <span className={ui.rowMain}>
                    <span className={styles.distDate}>{row.date}</span>
                    <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                      {row.meta}
                    </span>
                  </span>
                  <span className={ui.rowTrailing}>
                    <span className={`${styles.distAmount} tabular`}>{row.amount}</span>
                    <span
                      className={ui.rowStatus}
                      style={{ display: 'block', marginTop: 2, color: row.statusColor }}
                    >
                      {row.status}
                    </span>
                    {/* What was calculated is above; what was handed over is
                        here. Kept apart on purpose: reading two versions of one
                        night as two payments is the mistake this line exists to
                        prevent, so a correction shows its settlement, not its
                        total. */}
                    {settlementLine(distribution.id) ? (
                      <span
                        className={ui.rowMeta}
                        style={{ display: 'block', marginTop: 2 }}
                      >
                        {settlementLine(distribution.id)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <BandBar
                  bands={[{ id: distribution.id, weight: 1, color: colorForAreaKey('service') }]}
                  height={6}
                />
              </div>
            </CardButton>
          ) : null,
        )}

        {realRows.length === 0 ? (
          <EmptyState title={t('dNoDistributions')}>{t('dNoDistributionsBody')}</EmptyState>
        ) : null}
      </Screen>
    );
  }

  const visible = state.distributions
    .map((distribution, index) => ({ distribution, row: rows[index] }))
    .filter(({ distribution }) =>
      filter === 'all'
        ? true
        : filter === 'pending'
          ? distribution.status === 'pending'
          : distribution.status !== 'pending',
    );

  return (
    <Screen title={t('distributions')} titleSize={26} back={false} aboveTabs>
      <SegmentedControl<Filter>
        label={t('distributions')}
        compact
        value={filter}
        options={[
          { value: 'all', label: t('all') },
          { value: 'pending', label: t('pending') },
          { value: 'confirmed', label: t('confirmed') },
        ]}
        onChange={(next) => setParams(next === 'all' ? {} : { filter: next })}
      />

      {visible.map(({ distribution, row }) => (
        <CardButton
          key={distribution.id}
          tone={distribution.status === 'pending' ? 'warning' : 'default'}
          padding="padded"
          onClick={row.onOpen}
        >
          <div className={styles.distCard}>
            <div className={styles.distHead}>
              <span className={ui.rowMain}>
                <span className={styles.distDate}>{row.date}</span>
                <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                  {row.meta}
                </span>
              </span>
              <span className={ui.rowTrailing}>
                <span className={`${styles.distAmount} tabular`}>{row.amount}</span>
                <span
                  className={ui.rowStatus}
                  style={{ display: 'block', marginTop: 2, color: row.statusColor }}
                >
                  {row.status}
                </span>
              </span>
            </div>
            <BandBar shares={distribution.areaShares} height={6} />
          </div>
        </CardButton>
      ))}

      {visible.length === 0 ? <EmptyState title={t('emptyDistributions')} /> : null}
    </Screen>
  );
}
