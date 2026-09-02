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
import {
  ACK_VIEW, CORRECTION_NOTE_MAX, CORRECTION_REASONS, CORRECTION_REASON_LABEL,
  QUERY_NOTE_MAX, correctionDeltas, correctionSourceOf, lineageOf, tally, trimmedNote,
  type AckStateRow, type CorrectionDelta, type CorrectionReason, type QueryRow,
} from '@/distribution/ack';
import { ChipGroup } from '@/components/ui/ChipGroup';
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
  const [supersededBy, setSupersededBy] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [corrReason, setCorrReason] = useState<CorrectionReason>('hours');
  const [corrNote, setCorrNote] = useState('');
  const [deltas, setDeltas] = useState<CorrectionDelta[] | null>(null);

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
    void history.loadSupersededBy(distributionId).then((id) => {
      if (!cancelled) setSupersededBy(id);
    });
    return () => {
      cancelled = true;
    };
  }, [real, distributionId, reload, history.loadDetail, history.loadAckState,
      history.loadQueries, history.loadSupersededBy]);

  /* What the correction changed, per person. Both sides are immutable rows, so
     this is read twice and compared — never stored, never recalculated. */
  useEffect(() => {
    if (!real || !detail?.distribution.supersedesId) {
      setDeltas(null);
      return;
    }
    let cancelled = false;
    void history.loadDetail(detail.distribution.supersedesId).then((prev) => {
      if (cancelled || !prev) return;
      setDeltas(correctionDeltas(prev.entries, detail.entries));
    });
    return () => {
      cancelled = true;
    };
  }, [real, detail, history.loadDetail]);

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
    const lineage = lineageOf({
      status: dist.status,
      supersedesId: dist.supersedesId,
      supersededBy,
    });
    /* Two doors into one engine. A live distribution can always be corrected by
       the manager, with a reason; when a question has been answered with "a
       correction is needed", the question IS the reason and no note is asked
       for. Neither is offered once something has replaced this one. */
    const live = (dist.status === 'sent' || dist.status === 'confirmed') && !supersededBy;
    const answeredQuery =
      queries.some((q) => q.status === 'resolved' && q.outcome === 'correction_required');
    const correctable = live && answeredQuery;
    const managerCorrectable = live && !answeredQuery;
    const corrSource = correctionSourceOf({
      supersedesId: dist.supersedesId,
      triggerQueryId: dist.triggerQueryId,
      correctionReason: dist.correctionReason,
    });

    const startCorrection = async (
      correction?: { reason: CorrectionReason; note: string },
    ) => {
      const result = await history.createReplacement(dist.id, correction);
      if (!result.ok) {
        show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
        return;
      }
      setCorrecting(false);
      setCorrNote('');
      if (result.value) navigate(`/manager/distributions/${result.value}`);
    };

    const correctionNote = trimmedNote(corrNote);
    const submitManagerCorrection = () => {
      if (correctionNote.length === 0) {
        show(t('corrErrNeedsReason'));
        return;
      }
      void startCorrection({ reason: corrReason, note: correctionNote });
    };

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

        {/* Where this sits in its chain, and the way forward from here. */}
        {lineage === 'replaced' ? (
          <Card padding="padded">
            <div className={ui.stackTight}>
              <Badge tone="quiet">{t('corrReplaced')}</Badge>
              <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                {t('corrReplacedNote')}
              </p>
              <Button
                variant="secondary"
                onClick={() => navigate(`/manager/distributions/${supersededBy}`)}
              >
                {t('corrSeeReplacement')}
              </Button>
            </div>
          </Card>
        ) : null}

        {dist.supersedesId ? (
          <Card padding="padded">
            <div className={ui.stackTight}>
              <Badge tone="quiet">{t('corrCorrected')}</Badge>
              {/* Which door this correction came through, read off the record
                  itself: a trigger query means an employee asked, a reason
                  means the manager found it. The two are mutually exclusive
                  in the database, so this never has to guess. */}
              {corrSource ? (
                <p className={ui.rowMeta}>
                  {t(corrSource === 'manager' ? 'corrByManager' : 'corrByQuestion')}
                </p>
              ) : null}
              {corrSource === 'manager' && dist.correctionReason ? (
                <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {t('corrReasonGiven')}: {t(CORRECTION_REASON_LABEL[dist.correctionReason])}
                  {dist.correctionNote ? ` — ${dist.correctionNote}` : ''}
                </p>
              ) : null}
              <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                {isDraft ? t('corrDraftNote') : t('corrOfNote')}
              </p>
              <Button
                variant="secondary"
                onClick={() => navigate(`/manager/distributions/${dist.supersedesId}`)}
              >
                {t('corrSeeOriginal')}
              </Button>
            </div>
          </Card>
        ) : null}

        {/* What the correction changed, per person — a comparison of two
            immutable records, never a recalculation of the old one. */}
        {deltas && deltas.length > 0 ? (
          <section className={ui.stackFlush}>
            <SectionLabel>{t('corrWhatChanged')}</SectionLabel>
            {deltas.map((d) => (
              <ListRow
                key={d.memberId}
                title={d.memberName}
                meta={`${t('corrOriginalAmount')} ${money(d.beforeCents / 100)} · ${t('corrNewAmount')} ${money(d.afterCents / 100)}`}
                trailing={
                  <span
                    className="tabular"
                    style={{
                      color:
                        d.deltaCents === 0
                          ? 'var(--color-text-subtle)'
                          : d.deltaCents > 0
                            ? 'var(--color-money)'
                            : 'var(--color-warning)',
                    }}
                  >
                    {d.deltaCents === 0
                      ? t('corrNoChange')
                      : `${d.deltaCents > 0 ? '+' : '−'}${money(Math.abs(d.deltaCents) / 100)}`}
                  </span>
                }
              />
            ))}
          </section>
        ) : null}

        {correctable ? (
          <Button variant="secondary" onClick={() => void startCorrection()}>
            {t('corrStart')}
          </Button>
        ) : null}

        {/* The second door: the manager found it themselves. */}
        {managerCorrectable ? (
          <Button variant="secondary" onClick={() => setCorrecting(true)}>
            {t('corrMgrStart')}
          </Button>
        ) : null}

        {/* A draft correction has to be sendable from here, or the flow dead-ends
            on the screen that shows it. Recalculate is beside it, because the
            stale-input refusal is the one thing likely to send a manager back. */}
        {isDraft && dist.supersedesId ? (
          <div className={ui.stackTight}>
            <Button
              onClick={() => {
                void history.send(dist.id).then((r) => {
                  if (!r.ok) {
                    show(t(DISTRIBUTION_FAILURE_KEY[r.failure ?? 'unknown']));
                    return;
                  }
                  show(t('dSentLabel'));
                  setReload((n) => n + 1);
                });
              }}
            >
              {t('corrSend')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void history.createReplacement(dist.supersedesId as string).then((r) => {
                  if (!r.ok) {
                    show(t(DISTRIBUTION_FAILURE_KEY[r.failure ?? 'unknown']));
                    return;
                  }
                  if (r.value) navigate(`/manager/distributions/${r.value}`);
                });
              }}
            >
              {t('corrRecalculate')}
            </Button>
          </div>
        ) : null}

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

        {/* The manager's own door into the same engine. Same replacement, same
            lineage, same audit — the only difference is where the reason comes
            from, so this sheet asks for it and nothing else. */}
        <Sheet
          open={correcting}
          title={t('corrMgrTitle')}
          onClose={() => setCorrecting(false)}
        >
          <div className={ui.stackTight}>
            <Note>{t('corrMgrIntro')}</Note>

            <SectionLabel>{t('corrMgrReasonLabel')}</SectionLabel>
            <ChipGroup<CorrectionReason>
              label={t('corrMgrReasonLabel')}
              options={CORRECTION_REASONS.map((reason) => ({
                value: reason,
                label: t(CORRECTION_REASON_LABEL[reason]),
              }))}
              value={corrReason}
              onChange={setCorrReason}
            />

            <label className={ui.fieldLabel} htmlFor="correction-note">
              {t('corrMgrNoteLabel')}
            </label>
            <textarea
              id="correction-note"
              className={ui.fieldInput}
              rows={3}
              maxLength={CORRECTION_NOTE_MAX}
              placeholder={t('corrMgrNotePlaceholder')}
              value={corrNote}
              onChange={(event) => setCorrNote(event.target.value)}
              style={{ resize: 'none', lineHeight: 1.5, paddingTop: 10, height: 'auto' }}
            />

            <Button disabled={correctionNote.length === 0} onClick={submitManagerCorrection}>
              {t('corrMgrCreate')}
            </Button>
            <Button variant="ghost" onClick={() => setCorrecting(false)}>
              {t('corrMgrCancel')}
            </Button>
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
