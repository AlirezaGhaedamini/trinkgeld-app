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
import { ACK_VIEW, QUERY_NOTE_MAX, tally, type AckStateRow, type QueryRow } from '@/distribution/ack';
import { Sheet } from '@/components/ui/Sheet';
import { Note } from '@/components/ui/Note';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import type { DistributionDetail } from '@/distribution/types';
import { Badge } from '@/components/ui/Badge';
import { ListRow } from '@/components/ui/ListRow';
import { SectionLabel } from '@/components/ui/SectionLabel';
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
  const [ackRows, setAckRows] = useState<AckStateRow[]>([]);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [answering, setAnswering] = useState<QueryRow | null>(null);
  const [response, setResponse] = useState('');
  const [reload, setReload] = useState(0);

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
    void history.loadAckState(distributionId).then((rows) => {
      if (!cancelled) setAckRows(rows);
    });
    void history.loadQueries(distributionId).then((rows) => {
      if (!cancelled) setQueries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [real, distributionId, reload, history.loadDetail, history.loadAckState, history.loadQueries]);

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

    /* Counted per person and only among those who can answer at all — the same
       definition the engine uses to decide a distribution is fully confirmed.
       Counting entries would read "9 of 8" the moment somebody worked two
       areas; counting everybody would leave a roster placeholder, who has no
       account, outstanding for ever. */
    const counts = tally(ackRows);
    const required = dist.acknowledgementRequired;
    /* A question is an open problem, not an answer — so it counts towards what
       the manager still has to deal with, and never towards "confirmed". */
    const outstanding = required ? counts.outstanding : 0;
    const openQueries = queries.filter((q) => q.status === 'open');

    const answer = async (outcome: 'no_correction' | 'correction_required') => {
      if (!answering) return;
      const result = await history.resolveQuery(answering.id, outcome, response.trim() || undefined);
      if (!result.ok) {
        show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
        return;
      }
      setAnswering(null);
      setResponse('');
      setReload((n) => n + 1);
      show(t('qResolvedToast'));
    };
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
        ) : !required ? null : counts.answerable === 0 ? (
          <Card padding="padded">
            <div className={ui.inline}>
              <Icon name="info" size={19} color="var(--color-text-subtle)" />
              <p className={ui.rowMain} style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {t('ackNobodyToAsk')}
              </p>
            </div>
          </Card>
        ) : (
          <Card tone={outstanding > 0 ? 'warning' : undefined} padding="padded">
            <div className={ui.inline}>
              <Icon
                name={outstanding > 0 ? 'hourglass-medium' : 'shield-check'}
                size={19}
                color={outstanding > 0 ? 'var(--color-accent)' : 'var(--color-text-subtle)'}
              />
              <p className={ui.rowMain} style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {outstanding > 0
                  ? t('ackTallyLine')
                      .replace('{done}', String(counts.confirmed))
                      .replace('{total}', String(counts.answerable))
                  : t('ackAllIn')}
                {counts.queried > 0
                  ? ` · ${t('ackQueriedCount').replace('{n}', String(counts.queried))}`
                  : ''}
                {counts.pending > 0 && counts.queried > 0
                  ? ` · ${counts.pending} ${t('ackRowPending').toLowerCase()}`
                  : ''}
              </p>
            </div>
          </Card>
        )}

        {areas.map((entry) => (
          <RealAreaResultBlock
            key={entry.areaId}
            area={entry}
            entries={byArea.get(entry.areaId) ?? []}
            method={dist.method}
          />
        ))}

        {/* Questions first: they are the thing that needs a person, and burying
            them under the per-entry list would be the same dead end again. */}
        {queries.length > 0 ? (
          <section className={ui.stackTight}>
            <SectionLabel meta={openQueries.length > 0 ? t('qMgrOpen') : t('qMgrResolved')}>
              {t('qMgrTitle')}
            </SectionLabel>
            {queries.map((q) => (
              <Card key={q.id} padding="padded" tone={q.status === 'open' ? 'warning' : undefined}>
                <div className={ui.stackTight}>
                  <p className={ui.rowTitle}>
                    {q.memberName}
                    <span className={ui.rowMeta} style={{ marginLeft: 8 }}>
                      {money(q.amountCents / 100)}
                    </span>
                  </p>
                  <p className={ui.noteBody} style={{ fontSize: 14, color: 'var(--color-text)' }}>
                    {q.note}
                  </p>
                  <p className={ui.rowMeta}>
                    {t('qAskedOn').replace('{when}', day(new Date(q.raisedAt)))}
                  </p>
                  {q.status === 'resolved' ? (
                    <Note>
                      {t(q.outcome === 'correction_required' ? 'qMgrCorrection' : 'qMgrNoCorrection')}
                      {q.managerResponse ? ` — ${q.managerResponse}` : ''}
                    </Note>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAnswering(q);
                        setResponse('');
                      }}
                    >
                      {t('qMgrResolve')}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </section>
        ) : null}

        {/* Who has answered. Snapshot names, so a later rename does not
            rewrite an old record, and no profile data of any kind. */}
        {!isDraft && required && ackRows.length > 0 ? (
          <section className={ui.stackFlush}>
            <SectionLabel>{t('ackWhoTitle')}</SectionLabel>
            {ackRows.map((row) => (
              <ListRow
                key={row.entryId}
                title={row.memberName}
                meta={row.areaName}
                trailing={
                  <Badge tone={row.ackStatus === 'acknowledged' ? 'quiet' : undefined}>
                    {row.canAcknowledge
                      ? t(ACK_VIEW[row.ackStatus === 'pending' ? 'pending' : row.ackStatus].managerLabel)
                      : t('ackNoAccount')}
                  </Badge>
                }
              />
            ))}
          </section>
        ) : null}

        <p className={ui.note}>
          {t('dRuleVersion')} {dist.ruleVersion} · {t('dEngine')} {dist.engineVersion ?? '—'} ·{' '}
          {dist.minOverlapMinutes} {t('minutesShort')}
        </p>

        {/* Two outcomes, and the second one says plainly that the sent
            distribution is not going to be edited. */}
        <Sheet
          open={answering !== null}
          title={answering?.memberName ?? t('qMgrTitle')}
          onClose={() => setAnswering(null)}
        >
          <div className={ui.stackTight}>
            <Card padding="padded">
              <p className={ui.noteBody} style={{ fontSize: 14, color: 'var(--color-text)' }}>
                {answering?.note}
              </p>
            </Card>

            <label className={ui.fieldLabel} htmlFor="query-response">
              {t('qMgrResponseLabel')}
            </label>
            <textarea
              id="query-response"
              className={ui.fieldInput}
              rows={3}
              maxLength={QUERY_NOTE_MAX}
              placeholder={t('qMgrResponsePlaceholder')}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              style={{ resize: 'none', lineHeight: 1.5, paddingTop: 10, height: 'auto' }}
            />

            <Button onClick={() => void answer('no_correction')}>{t('qMgrNoCorrection')}</Button>
            <Note>{t('qMgrNoCorrectionHelp')}</Note>

            <Button variant="ghost" onClick={() => void answer('correction_required')}>
              {t('qMgrCorrection')}
            </Button>
            <Note>{t('qMgrCorrectionHelp')}</Note>
          </div>
        </Sheet>
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
