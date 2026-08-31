import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { BandBar } from '@/components/ui/BandBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { AreaResultBlock } from '@/components/domain/AreaResultBlock';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { distributionById, resultForDistribution } from '@/state/selectors';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** One distribution in full: the split, who confirmed, and every line. */
export function DistributionDetailPage() {
  const state = useAppState();
  const { t, money, people, dateFor } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const { distributionId } = useParams();

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
