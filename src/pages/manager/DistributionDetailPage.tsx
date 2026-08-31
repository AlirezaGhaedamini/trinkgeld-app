import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { BandBar } from '@/components/ui/BandBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { AreaResultBlock } from '@/components/domain/AreaResultBlock';
import { RealAreaResultBlock } from '@/components/domain/RealAreaResultBlock';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { distributionById, resultForDistribution } from '@/state/selectors';
import { colorForAreaKey } from '@/data/areas';
import { useDistributionHistory } from '@/distribution/useDistribution';
import type { DistributionDetail } from '@/distribution/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** One distribution in full: the split, who confirmed, and every line. */
export function DistributionDetailPage() {
  const state = useAppState();
  const { t, money, people, dateFor, day } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const { distributionId } = useParams();

  const history = useDistributionHistory();
  const real = history.enabled;
  const [detail, setDetail] = useState<DistributionDetail | null>(null);

  /**
   * Read back, never recomputed.
   *
   * The entries, the area subtotals and the rule version all come from the row
   * the engine wrote on the night. Recalculating against today's rules is
   * exactly what this screen must not do.
   */
  useEffect(() => {
    if (!real || !distributionId) return;
    let cancelled = false;
    void history.loadDetail(distributionId).then((loaded) => {
      if (!cancelled) setDetail(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [real, distributionId, history.loadDetail]);

  if (real) {
    if (!detail) {
      return (
        <Screen title={t('distributions')}>
          <EmptyState title={history.status === 'loading' ? t('dLoading') : t('emptyDistributions')} />
        </Screen>
      );
    }

    const { distribution: dist, areas, entries } = detail;
    const isDraft = dist.status === 'draft';
    const awaiting = entries.filter((e) => e.ackStatus === 'pending').length;
    const byArea = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = byArea.get(entry.areaId);
      if (list) list.push(entry);
      else byArea.set(entry.areaId, [entry]);
    }

    return (
      <Screen
        title={t('distributions')}
        kicker={day(new Date(`${dist.periodStart}T12:00:00`))}
      >
        <div className={styles.resultHead}>
          <div>
            <p className={styles.displayLabel}>
              {isDraft ? t('dDraftLabel') : dist.status === 'cancelled' ? t('dCancelledLabel') : t('dSentLabel')}
            </p>
            <p className={`${styles.displayAmount} ${styles.displayAmountSmall} tabular`}>
              {money((dist.poolCents ?? 0) / 100)}
            </p>
          </div>
          <p className={styles.resultHeadMeta}>
            {people(dist.peopleCount)}
            <br />
            {money((dist.poolCents ?? 0) / 100 / Math.max(dist.peopleCount, 1))} {t('avg')}
          </p>
        </div>

        <BandBar
          bands={areas.map((a) => ({
            id: a.areaId,
            weight: a.percentage,
            color: colorForAreaKey(a.areaKey),
          }))}
          label={t('areaSplit')}
        />

        {isDraft ? (
          <Card tone="warning" padding="padded">
            <div className={ui.inline}>
              <Icon name="info" size={19} color="var(--color-accent)" />
              <p className={ui.rowMain} style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {t('dPreviewBody')}
              </p>
            </div>
          </Card>
        ) : awaiting > 0 ? (
          <Card tone="warning" padding="padded">
            <div className={ui.inline}>
              <Icon name="hourglass-medium" size={19} color="var(--color-accent)" />
              <p className={ui.rowMain} style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {dist.peopleCount - awaiting} {t('ackLineA')} {dist.peopleCount} {t('ackConfirmed')}
              </p>
            </div>
          </Card>
        ) : null}

        {areas.map((entry) => (
          <RealAreaResultBlock
            key={entry.areaId}
            area={entry}
            entries={byArea.get(entry.areaId) ?? []}
            method={dist.method}
          />
        ))}

        <p className={ui.note}>
          {t('dRuleVersion')} {dist.ruleVersion} · {t('dEngine')} {dist.engineVersion ?? '—'} ·{' '}
          {dist.minOverlapMinutes} {t('minutesShort')}
        </p>
      </Screen>
    );
  }

  const distribution =
    (distributionId ? distributionById(state, distributionId) : undefined) ??
    state.distributions[0];

  if (!distribution) {
    return (
      <Screen title={t('distributions')}>
        <EmptyState title={t('emptyDistributions')} />
      </Screen>
    );
  }

  const result = resultForDistribution(state, distribution);
  const pending = distribution.status === 'pending';

  return (
    <Screen
      title={t('distributions')}
      kicker={dateFor(distribution.dateKey, distribution.date)}
      cta={pending ? { label: t('chaseAcks'), onClick: () => show(t('reminded')) } : undefined}
    >
      <div className={styles.resultHead}>
        <div>
          <p className={styles.displayLabel}>{pending ? t('pending') : t('confirmed')}</p>
          <p className={`${styles.displayAmount} ${styles.displayAmountSmall} tabular`}>
            {money(distribution.poolAmount)}
          </p>
        </div>
        <p className={styles.resultHeadMeta}>
          {people(distribution.peopleCount)}
          <br />
          {money(distribution.poolAmount / Math.max(distribution.peopleCount, 1))} {t('avg')}
        </p>
      </div>

      <BandBar shares={distribution.areaShares} label={t('areaSplit')} />

      {pending ? (
        <Card tone="warning" padding="padded">
          <div className={ui.inline}>
            <Icon name="hourglass-medium" size={19} color="var(--color-accent)" />
            <p
              className={ui.rowMain}
              style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}
            >
              {distribution.acknowledgedCount} {t('ackLineA')} {distribution.peopleCount}{' '}
              {t('ackConfirmed')}
            </p>
            <Button
              variant="secondary"
              onClick={() => show(t('reminded'))}
              style={{ minHeight: 40, padding: '0 14px', fontSize: 13 }}
            >
              {t('remind')}
            </Button>
          </div>
        </Card>
      ) : null}

      {result.map((block) => (
        <AreaResultBlock
          key={block.area}
          block={block}
          method={distribution.method}
          onOpenEntry={(employeeId) => navigate(`/manager/team/${employeeId}`)}
        />
      ))}
    </Screen>
  );
}
