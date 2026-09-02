import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Note } from '@/components/ui/Note';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { distributionById, latestDistribution, shareOf } from '@/state/selectors';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import {
  ACK_VIEW, CORRECTION_REASON_LABEL, QUERY_NOTE_MAX, ackViewFor, acknowledgedAtFor,
} from '@/distribution/ack';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { SectionLabel } from '@/components/ui/SectionLabel';
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
  /* The question sheet's own state. Declared here because hooks cannot live
     inside the real/demo branch below, which is a plain `if`. */
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
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
    /* Without an id this screen shows the current share, which is the newest
       distribution that has not been replaced — never a superseded one. With an
       id it shows exactly what was asked for, so an older version stays
       reachable from history. */
    const current = mine.distributions.find((d) => !d.supersededBy) ?? mine.distributions[0];
    const realDistribution =
      (distributionId ? mine.distributions.find((d) => d.id === distributionId) : undefined) ??
      current;

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
    // Every entry that is actually theirs. Somebody who worked Service and then
    // Bar has two, and both are answered by one action.
    const ownEntries = visible.filter((e) => e.isOwn !== false);
    const own = ownEntries[0] ?? null;
    const areaRow = (mine.areas[realDistribution.id] ?? []).find(
      (a) => a.areaId === own?.areaId,
    );
    const totalCents = ownEntries.reduce((sum, e) => sum + e.amountCents, 0);

    // The requirement is the one frozen into this distribution, not today's
    // rule — an old payout keeps asking, or not asking, exactly what it did.
    const myQuery = mine.queryFor(realDistribution.id);
    const ackView = ackViewFor(ownEntries, realDistribution.acknowledgementRequired, myQuery);
    const presentation = ACK_VIEW[ackView];
    const canAnswer = presentation.showCta && realDistribution.status !== 'cancelled';
    const answeredAt = acknowledgedAtFor(ownEntries);
    const answer = (next: 'acknowledged' | 'queried') =>
      mine.acknowledge(realDistribution.id, next).then((r) => {
        if (!r.ok) {
          show(t(DISTRIBUTION_FAILURE_KEY[r.failure ?? 'unknown']));
          return false;
        }
        return true;
      });

    const trimmed = note.trim();
    const sendQuestion = async () => {
      if (trimmed.length === 0) {
        show(t('qErrEmpty'));
        return;
      }
      const result = await mine.query(realDistribution.id, trimmed);
      if (!result.ok) {
        show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
        return;
      }
      setAsking(false);
      setNote('');
      show(t('qSent'));
    };

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
          canAnswer
            ? {
                label: t('looksRight'),
                onClick: () => {
                  void answer('acknowledged').then((ok) => {
                    if (!ok) return;
                    show(t('ackToast'));
                    navigate(-1);
                  });
                },
                secondary: presentation.showQuery
                  ? { label: t('qCta'), onClick: () => setAsking(true) }
                  : undefined,
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

        {/* What the confirmation is, and is not. Three states, never an enum. */}
        <div className={ui.stackTight}>
          <p className={ui.inline} style={{ fontSize: 13, color: 'var(--color-text-subtle)' }}>
            <Icon
              name={ackView === 'queried' ? 'hourglass-medium' : 'shield-check'}
              size={17}
              color={
                presentation.tone === 'subtle' ? 'var(--color-text-subtle)' : 'var(--color-accent)'
              }
            />
            {t(presentation.label)}
            {answeredAt && ackView === 'acknowledged'
              ? ` · ${t('ackConfirmedOn').replace('{when}', day(new Date(answeredAt)))}`
              : ''}
          </p>
          <Note>
            {ackView === 'notRequired'
              ? t('ackNotRequiredNote')
              : ownEntries.length > 1 && canAnswer
                ? t('ackBothAreas')
                : t('ackRequiredNote')}
          </Note>
        </div>

        {/* Where this sits if it was corrected, or is itself a correction. The
            original is never hidden — it is what they were told at the time. */}
        {realDistribution.supersededBy ? (
          <Card padding="padded" tone="warning">
            <div className={ui.stackTight}>
              <Badge tone="quiet">{t('corrReplaced')}</Badge>
              <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                {t('corrEmpReplaced')}
              </p>
              <Button
                variant="secondary"
                onClick={() => navigate(`/payout/${realDistribution.supersededBy}`)}
              >
                {t('corrSeeReplacement')}
              </Button>
            </div>
          </Card>
        ) : realDistribution.supersedesId ? (
          <Card padding="padded">
            <div className={ui.stackTight}>
              <Badge tone="quiet">{t('corrCorrected')}</Badge>
              <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                {t('corrEmpCurrent')}
              </p>
              {/* A correction nobody asked for needs saying out loud, with the
                  reason the manager gave. The view carries no actor and no
                  timestamp, so this says why and never who. */}
              {realDistribution.correctionReason ? (
                <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {t('corrEmpByManager')} {t('corrReasonGiven')}:{' '}
                  {t(CORRECTION_REASON_LABEL[realDistribution.correctionReason])}
                  {realDistribution.correctionNote
                    ? ` — ${realDistribution.correctionNote}`
                    : ''}
                </p>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => navigate(`/payout/${realDistribution.supersedesId}`)}
              >
                {t('corrSeeOriginal')}
              </Button>
            </div>
          </Card>
        ) : null}

        {/* The exchange, once there has been one: their words, then the
            manager's. Kept on the payout it is about, so it stays with the
            distribution rather than in an inbox somewhere. */}
        {myQuery ? (
          <div className={ui.stackTight}>
            <SectionLabel>{t('qYourQuestion')}</SectionLabel>
            <Card padding="padded">
              <div className={ui.stackTight}>
                <p className={ui.noteBody} style={{ fontSize: 14, color: 'var(--color-text)' }}>
                  {myQuery.note}
                </p>
                <p className={ui.rowMeta}>
                  {t('qAskedOn').replace('{when}', day(new Date(myQuery.raisedAt)))}
                </p>
              </div>
            </Card>
            {myQuery.status === 'resolved' ? (
              <>
                <SectionLabel>{t('qManagerAnswer')}</SectionLabel>
                <Card padding="padded">
                  <div className={ui.stackTight}>
                    <p className={ui.noteBody} style={{ fontSize: 14, color: 'var(--color-text)' }}>
                      {myQuery.managerResponse ??
                        t(myQuery.outcome === 'correction_required'
                          ? 'qMgrCorrection' : 'qMgrNoCorrection')}
                    </p>
                    {myQuery.resolvedAt ? (
                      <p className={ui.rowMeta}>{day(new Date(myQuery.resolvedAt))}</p>
                    ) : null}
                  </div>
                </Card>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Asking is a sentence, not a form. */}
        <Sheet open={asking} title={t('qTitle')} onClose={() => setAsking(false)}>
          <div className={ui.stackTight}>
            <label className={ui.fieldLabel} htmlFor="query-note">
              {t('qNoteLabel')}
            </label>
            <textarea
              id="query-note"
              className={ui.fieldInput}
              rows={4}
              maxLength={QUERY_NOTE_MAX}
              placeholder={t('qNotePlaceholder')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              style={{ resize: 'none', lineHeight: 1.5, paddingTop: 10, height: 'auto' }}
            />
            <Note>{t('qHint')}</Note>
            <Button muted={mine.busy || trimmed.length === 0} onClick={() => void sendQuestion()}>
              {t('qSend')}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t('qCancel')}
            </Button>
          </div>
        </Sheet>
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
