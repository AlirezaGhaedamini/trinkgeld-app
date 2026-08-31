import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { distributionById, latestDistribution, shareOf } from '@/state/selectors';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import { useMyShare } from '@/distribution/useDistribution';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * "Your share", explained.
 *
 * Four steps from the shift pool down to one person's amount, each showing the
 * arithmetic that produced it — the screen the whole product exists for.
 */
export function PayoutPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money, num, percent, hours, area, dateFor, day, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const { distributionId } = useParams();

  const mine = useMyShare();
  const real = mine.enabled;

  /* ── real mode ───────────────────────────────────────────────────────────
     Everything on this screen comes from the historical record: the entry the
     engine wrote, and the area subtotal if the workplace releases it. Nothing
     is recalculated against today's rules, which is why an old payout still
     explains itself after the rules change. */
  if (real) {
    const realDistribution =
      (distributionId ? mine.distributions.find((d) => d.id === distributionId) : undefined) ??
      mine.distributions[0];

    if (mine.status === 'loading') {
      return (
        <Screen title={t('yourShare')}>
          <EmptyState title={t('dLoading')} />
        </Screen>
      );
    }
    if (!realDistribution) {
      return (
        <Screen title={t('yourShare')}>
          <EmptyState title={t('emptyShifts')}>{t('emptyShiftsBody')}</EmptyState>
        </Screen>
      );
    }

    const visible = mine.entries.filter((e) => e.distributionId === realDistribution.id);
    const own = visible.find((e) => e.isOwn !== false) ?? visible[0] ?? null;
    const areaRow = (mine.areas[realDistribution.id] ?? []).find(
      (a) => a.areaId === own?.areaId,
    );
    const totalCents = visible
      .filter((e) => e.isOwn !== false)
      .reduce((sum, e) => sum + e.amountCents, 0);
    const needsAck = own !== null && own.ackStatus === 'pending' && realDistribution.status !== 'cancelled';

    const steps: Array<{
      step: string; label: string; value: string; math: string; dot: string; glow: string;
    }> = [];

    if (realDistribution.poolCents !== null) {
      steps.push({
        step: `${t('step')} ${steps.length + 1}`,
        label: t('cShiftPool'),
        value: money(realDistribution.poolCents / 100),
        math: language === 'Deutsch' ? 'Karte + Bar' : 'card + cash',
        dot: 'var(--color-warning)',
        glow: 'none',
      });
    }
    if (areaRow) {
      steps.push({
        step: `${t('step')} ${steps.length + 1}`,
        label: `${areaRow.areaName} · ${percent(areaRow.percentage)}`,
        value: money(areaRow.totalCents / 100),
        math: `${num(areaRow.units, 1)} ${t('units')}`,
        dot: 'var(--color-money)',
        glow: 'none',
      });
    }
    if (own) {
      steps.push({
        step: `${t('step')} ${steps.length + 1}`,
        label: t('cUnits'),
        value: num(own.units, 1),
        math: `${hours(own.workedMinutes / 60)} × ${num(own.points * own.multiplier, 1)}`,
        dot: 'var(--color-primary)',
        glow: 'none',
      });
      steps.push({
        step: `${t('step')} ${steps.length + 1}`,
        label: t('yourShare'),
        value: money(own.amountCents / 100),
        math: areaRow
          ? `${num(areaRow.totalCents / 100, 2)} ÷ ${num(areaRow.units, 1)} × ${num(own.units, 1)}`
          : `${num(own.units, 1)} ${t('units')}`,
        dot: 'var(--color-primary)',
        glow: '0 0 14px rgba(88, 201, 197, 0.14)',
      });
    }

    return (
      <Screen
        title={t('yourShare')}
        kicker={day(new Date(`${realDistribution.periodStart}T12:00:00`))}
        cta={
          needsAck
            ? {
                label: t('looksRight'),
                onClick: () => {
                  void mine.acknowledge(own.id, 'acknowledged').then((r) => {
                    if (!r.ok) {
                      show(t(DISTRIBUTION_FAILURE_KEY[r.failure ?? 'unknown']));
                      return;
                    }
                    show(t('ackToast'));
                    navigate(-1);
                  });
                },
                secondary: {
                  label: t('query'),
                  onClick: () => {
                    void mine.acknowledge(own.id, 'queried').then((r) => {
                      show(r.ok ? t('queryToast') : t(DISTRIBUTION_FAILURE_KEY[r.failure ?? 'unknown']));
                    });
                  },
                },
              }
            : undefined
        }
      >
        <p className={`${styles.displayAmount} ${styles.displayAmountLead} tabular`}>
          {money(totalCents / 100)}
        </p>

        <div className={ui.stackFlush}>
          {steps.map((step) => (
            <div key={step.step} className={styles.chainStep}>
              <div className={styles.chainRail} aria-hidden>
                <span className={styles.chainDot} style={{ background: step.dot, boxShadow: step.glow }} />
                <span className={styles.chainLine} />
              </div>
              <div className={styles.chainBody}>
                <p className={styles.chainKicker}>{step.step}</p>
                <p className={styles.chainRow}>
                  <span className={styles.chainLabel}>{step.label}</span>
                  <span className={`${styles.chainValue} tabular`}>{step.value}</span>
                </p>
                <p className={`${styles.chainMath} tabular`}>{step.math}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Colleagues appear here only if the workplace has turned peer
            visibility on. With it off, RLS returns one row and this is the
            person's own line. */}
        {visible.length > 0 ? (
          <Card padding="padded">
            <div className={ui.stackTight}>
              <p className={ui.noteBody} style={{ fontSize: 13 }}>
                {own?.areaName ?? t('othersService')}
              </p>
              {visible.map((peer) => (
                <div key={peer.id} className={styles.peerRow}>
                  <span
                    className={`${ui.rowMain} ${ui.truncate}`}
                    style={{
                      color: peer.isOwn !== false ? 'var(--color-accent)' : 'var(--color-text)',
                    }}
                  >
                    {peer.isOwn !== false ? t('you') : peer.memberName}
                  </span>
                  <span className={`${ui.rowMeta} tabular`}>
                    {hours(peer.workedMinutes / 60)} × {num(peer.points * peer.multiplier, 1)}
                  </span>
                  <span className={`${styles.peerAmount} tabular`}>
                    {money(peer.amountCents / 100)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <p className={ui.inline} style={{ fontSize: 13, color: 'var(--color-text-subtle)' }}>
          <Icon name="shield-check" size={17} color="var(--color-accent)" />
          {needsAck ? t('awaitingMgr') : t('confirmedByMgr')}
        </p>
      </Screen>
    );
  }

  const distribution =
    (distributionId ? distributionById(state, distributionId) : undefined) ??
    latestDistribution(state);

  if (!distribution) {
    return (
      <Screen title={t('yourShare')}>
        <EmptyState title={t('emptyShifts')}>{t('emptyShiftsBody')}</EmptyState>
      </Screen>
    );
  }

  const employeeId = state.session.employeeId;
  const { block, entry, amount } = shareOf(state, distribution, employeeId);
  const acknowledged = state.acknowledged.includes(distribution.id);
  const pending = distribution.status === 'pending';

  const chain =
    block && entry
      ? [
          {
            step: `${t('step')} 1`,
            label: t('cShiftPool'),
            value: money(distribution.poolAmount),
            math: language === 'Deutsch' ? 'Karte + Bar' : 'card + cash',
            dot: 'var(--color-warning)',
            glow: 'none',
          },
          {
            step: `${t('step')} 2`,
            label: `${area(block.area)} · ${percent(block.percentage)}`,
            value: money(block.total),
            math: `${num(distribution.poolAmount, 2)} × ${num(block.percentage / 100, 2)}`,
            dot: 'var(--color-money)',
            glow: 'none',
          },
          {
            step: `${t('step')} 3`,
            label: t('cUnits'),
            value: num(entry.units, 1),
            math: `${hours(entry.hours)} × ${num(entry.points * entry.multiplier, 1)}`,
            dot: 'var(--color-primary)',
            glow: 'none',
          },
          {
            step: `${t('step')} 4`,
            label: t('yourShare'),
            value: money(entry.amount),
            math: `${num(block.total, 2)} ÷ ${num(block.units, 1)} × ${num(entry.units, 1)}`,
            dot: 'var(--color-primary)',
            glow: '0 0 14px rgba(88, 201, 197, 0.14)',
          },
        ]
      : [];

  return (
    <Screen
      title={t('yourShare')}
      kicker={dateFor(distribution.dateKey, distribution.date)}
      cta={
        pending && !acknowledged
          ? {
              label: t('looksRight'),
              onClick: () => {
                dispatch({ type: 'acknowledge', distributionId: distribution.id });
                show(t('ackToast'));
                navigate(-1);
              },
              secondary: { label: t('query'), onClick: () => show(t('queryToast')) },
            }
          : undefined
      }
    >
      <p className={`${styles.displayAmount} ${styles.displayAmountLead} tabular`}>
        {money(amount)}
      </p>

      <div className={ui.stackFlush}>
        {chain.map((step) => (
          <div key={step.step} className={styles.chainStep}>
            <div className={styles.chainRail} aria-hidden>
              <span
                className={styles.chainDot}
                style={{ background: step.dot, boxShadow: step.glow }}
              />
              <span className={styles.chainLine} />
            </div>
            <div className={styles.chainBody}>
              <p className={styles.chainKicker}>{step.step}</p>
              <p className={styles.chainRow}>
                <span className={styles.chainLabel}>{step.label}</span>
                <span className={`${styles.chainValue} tabular`}>{step.value}</span>
              </p>
              <p className={`${styles.chainMath} tabular`}>{step.math}</p>
            </div>
          </div>
        ))}
      </div>

      {block && block.entries.length > 0 ? (
        <Card padding="padded">
          <div className={ui.stackTight}>
            <p className={ui.noteBody} style={{ fontSize: 13 }}>
              {t('othersService')}
            </p>
            {block.entries.map((peer) => (
              <div key={peer.employeeId} className={styles.peerRow}>
                <span
                  className={`${ui.rowMain} ${ui.truncate}`}
                  style={{
                    color:
                      peer.employeeId === employeeId ? 'var(--color-accent)' : 'var(--color-text)',
                  }}
                >
                  {peer.employeeId === employeeId ? t('you') : peer.name}
                </span>
                <span className={`${ui.rowMeta} tabular`}>
                  {hours(peer.hours)} × {num(peer.points * peer.multiplier, 1)}
                </span>
                <span className={`${styles.peerAmount} tabular`}>{money(peer.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <p className={ui.inline} style={{ fontSize: 13, color: 'var(--color-text-subtle)' }}>
        <Icon name="shield-check" size={17} color="var(--color-accent)" />
        {pending ? t('awaitingMgr') : t('confirmedByMgr')}
      </p>
    </Screen>
  );
}
