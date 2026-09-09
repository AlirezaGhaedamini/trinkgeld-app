import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useWorkplace } from '@/hooks/useWorkplace';
import { useDistributionDetail } from '@/distribution/useDistribution';
import { METHOD_LABEL } from '@/rules/types';
import { distributionById } from '@/state/selectors';
import styles from '@/pages/pages.module.css';

/**
 * Confirmation after a distribution goes out to the team.
 *
 * In real mode the route names the night: `/manager/sent/:distributionId`.
 * The amount, the headcount and the rule are read from the record the engine
 * wrote, never carried here as navigation state, so the screen says what was
 * actually sent and says it again after a refresh. A bare `/manager/sent`
 * with real credentials has nothing authoritative to show and goes to the
 * list instead of to the demo dataset's figures.
 *
 * The demo confirmation, from the local dataset, is unchanged.
 */
export function SentPage() {
  const { distributionId } = useParams();
  const workplace = useWorkplace();
  const detail = useDistributionDetail(distributionId ?? null);

  if (workplace.enabled && !distributionId) {
    return <Navigate to="/manager/distributions" replace />;
  }
  return detail.enabled && distributionId ? (
    <RealSent id={distributionId} detail={detail} />
  ) : (
    <DemoSent />
  );
}

/* ── real ─────────────────────────────────────────────────────────────────── */

function RealSent({ id, detail }: { id: string; detail: ReturnType<typeof useDistributionDetail> }) {
  const { t, money, people } = useI18n();
  const navigate = useNavigate();
  const dist = detail.detail?.distribution ?? null;

  return (
    <Screen
      back={false}
      /* The workflow is over, so the primary action is the way out of it.
         Looking at what was just sent is the optional second step, not the
         one the manager has to take to escape the wizard they came through. */
      cta={{
        label: t('backToOverview'),
        onClick: () => navigate('/manager', { replace: true }),
        secondary: {
          label: t('viewDist'),
          onClick: () => navigate(`/manager/distributions/${id}`, { replace: true }),
        },
      }}
    >
      <div className={styles.sent}>
        <span className={styles.sentMark}>
          <Icon name="check" size={34} color="var(--color-accent)" />
        </span>
        <h1 className={styles.sentTitle}>{t('sentTitle')}</h1>
        {dist ? (
          <>
            <p className={styles.sentBody}>
              {t('sentBody')
                .replace('{amount}', money((dist.poolCents ?? 0) / 100))
                .replace('{people}', people(dist.peopleCount))}
            </p>
            <p className={styles.sentBody}>
              {t('methodPrefix')}: {t(METHOD_LABEL[dist.method])} · {t('dRuleVersion')}{' '}
              {dist.ruleVersion}
            </p>
          </>
        ) : detail.status === 'error' ? (
          <>
            <p className={styles.sentBody}>{t('loadFailed')}</p>
            <Button variant="secondary" onClick={() => void detail.refresh()}>
              {t('retry')}
            </Button>
          </>
        ) : detail.status === 'ready' ? (
          /* The id in the route is not one of this workplace's: say so, and
             do not dress it up as an empty history. */
          <p className={styles.sentBody}>{`${t('dNotFoundTitle')} ${t('dNotFoundBody')}`}</p>
        ) : (
          <p className={styles.sentBody}>{t('dLoading')}</p>
        )}
      </div>
    </Screen>
  );
}

/* ── demo ─────────────────────────────────────────────────────────────────── */

/** The prototype's confirmation, from the sample dataset. Unchanged. */
function DemoSent() {
  const state = useAppState();
  const { t, money, people, language } = useI18n();
  const navigate = useNavigate();

  const sent = state.lastSentId ? distributionById(state, state.lastSentId) : undefined;
  const amount = money(sent?.poolAmount ?? 0);
  const headcount = people(sent?.peopleCount ?? 0);

  const body =
    language === 'Deutsch'
      ? `${amount} an ${headcount}. Alle sehen jetzt ihre Aufschlüsselung und bestätigen sie.`
      : `${amount} to ${headcount}. Everyone can see their breakdown now and confirms it.`;

  return (
    <Screen
      back={false}
      cta={{
        label: t('backToOverview'),
        onClick: () => navigate('/manager', { replace: true }),
        secondary: {
          label: t('viewDist'),
          onClick: () => navigate(`/manager/distributions/${sent?.id ?? ''}`, { replace: true }),
        },
      }}
    >
      <div className={styles.sent}>
        <span className={styles.sentMark}>
          <Icon name="check" size={34} color="var(--color-accent)" />
        </span>
        <h1 className={styles.sentTitle}>{t('sentTitle')}</h1>
        <p className={styles.sentBody}>{body}</p>
      </div>
    </Screen>
  );
}
