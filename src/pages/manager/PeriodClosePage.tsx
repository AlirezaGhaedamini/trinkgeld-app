import { useEffect, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Sheet } from '@/components/ui/Sheet';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { usePeriodClose } from '@/period/usePeriod';
import { buildCsv, csvFilename } from '@/period/csv';
import { trimmedNote } from '@/distribution/ack';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import type { PeriodExport, PeriodReadiness } from '@/period/types';
import ui from '@/components/ui/ui.module.css';

/** `2023-09-01` — the shape both the date input and the database use. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Closing a period, and taking the figures away.
 *
 * The dates on this screen are BUSINESS dates — the ones a distribution already
 * carries, derived by the database from the workplace's timezone and its
 * business-day start hour. Nothing here converts, shifts or guesses a date; the
 * two inputs are passed through untouched, because the moment a browser starts
 * doing date arithmetic on a financial period it will eventually disagree with
 * the server about which night a Saturday was.
 */
export function PeriodClosePage() {
  const { t, money, day } = useI18n();
  const { show } = useToast();
  const period = usePeriodClose();

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 24 * 3600 * 1000);
  const [from, setFrom] = useState(isoDate(weekAgo));
  const [to, setTo] = useState(isoDate(today));
  const [ready, setReady] = useState<PeriodReadiness | null>(null);
  const [data, setData] = useState<PeriodExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');

  /* A changed date means the answer on screen is about a period nobody asked
     about any more. Clearing is the honest state, not the stale one. */
  useEffect(() => {
    setReady(null);
    setData(null);
  }, [from, to]);

  if (!period.enabled) {
    return (
      <Screen title={t('pcTitle')}>
        <EmptyState title={t('pcTitle')}>{t('pcIntro')}</EmptyState>
      </Screen>
    );
  }

  const check = async () => {
    setBusy(true);
    const [r, d] = await Promise.all([period.readiness(from, to), period.load(from, to)]);
    setBusy(false);
    if (!r) {
      show(t('pcErrDates'));
      return;
    }
    setReady(r);
    setData(d);
  };

  const confirmClose = async () => {
    const trimmed = trimmedNote(note);
    const result = await period.close(from, to, trimmed.length > 0 ? trimmed : undefined);
    if (!result.ok) {
      show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    setConfirming(false);
    setNote('');
    show(t('pcClosed'));
    void check();
  };

  /**
   * The download.
   *
   * Built from the export dataset in the browser, from a Blob — no request to
   * anywhere, no library, and nothing that could reach a third party with a
   * workplace's payroll figures in it.
   */
  const download = () => {
    if (!data) return;
    const blob = new Blob([buildCsv(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename(data);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    show(t('pcExported'));
  };

  const blocking = ready
    ? ([
        [ready.blocking.draftDistributions, 'pcBlockDrafts'],
        [ready.blocking.draftCorrections, 'pcBlockCorrDrafts'],
        [ready.blocking.openQuestions, 'pcBlockQuestions'],
        [ready.blocking.agreedCorrectionsNotSent, 'pcBlockAgreed'],
        [ready.blocking.overlappingClose, 'pcBlockOverlap'],
      ] as const).filter(([n]) => n > 0)
    : [];
  const warnings = ready
    ? ([
        [ready.warnings.unpaidDistributions, 'pcWarnUnpaid'],
        [ready.warnings.unacknowledgedShares, 'pcWarnUnack'],
      ] as const).filter(([n]) => n > 0)
    : [];

  return (
    <Screen title={t('pcTitle')}>
      <Note>{t('pcIntro')}</Note>

      <Card padding="padded">
        <div className={ui.stackTight}>
          <label className={ui.fieldLabel} htmlFor="period-from">
            {t('pcFrom')}
          </label>
          <input
            id="period-from"
            type="date"
            className={ui.fieldInput}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <label className={ui.fieldLabel} htmlFor="period-to">
            {t('pcTo')}
          </label>
          <input
            id="period-to"
            type="date"
            className={ui.fieldInput}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button variant="secondary" onClick={() => void check()} disabled={busy}>
            {busy ? t('pcChecking') : t('pcCheck')}
          </Button>
        </div>
      </Card>

      {ready ? (
        <Card padding="padded">
          <div className={ui.stackTight}>
            <Badge tone={ready.canClose ? 'quiet' : undefined}>
              {ready.canClose ? t('pcReady') : t('pcNotReady')}
            </Badge>

            {blocking.length > 0 ? (
              <>
                <SectionLabel>{t('pcBlockHead')}</SectionLabel>
                {blocking.map(([n, key]) => (
                  <p key={key} className={ui.rowMeta}>
                    {t(key).replace('{n}', String(n))}
                  </p>
                ))}
              </>
            ) : null}

            {warnings.length > 0 ? (
              <>
                <SectionLabel>{t('pcWarnHead')}</SectionLabel>
                {warnings.map(([n, key]) => (
                  <p key={key} className={ui.rowMeta}>
                    {t(key).replace('{n}', String(n))}
                  </p>
                ))}
              </>
            ) : null}

            {ready.distributions === 0 ? <Note>{t('pcNothingHere')}</Note> : null}

            {ready.canClose && ready.distributions > 0 ? (
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                {t('pcClose')}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* The figures, straight from the export dataset — the same numbers the
          spreadsheet will contain, because they come from the same place. */}
      {/* Only when there is something to report. A period holding nothing —
          or holding only a draft, which the export rightly excludes — gets the
          readiness card's plain sentence instead of a summary of zeroes and a
          download that would hand over a header with no rows under it. */}
      {data && data.distributions.length > 0 ? (
        <section className={ui.stackFlush}>
          <SectionLabel>{t('pcSummary')}</SectionLabel>
          <ListRow
            title={t('pcEntitlement')}
            meta=""
            trailing={
              <span className="tabular">
                {money(data.summary.currentEntitlementCents / 100)}
              </span>
            }
          />
          {data.summary.replacedEntitlementCents !== 0 ? (
            <ListRow
              title={t('pcReplaced')}
              meta=""
              trailing={
                <span className="tabular" style={{ color: 'var(--color-text-subtle)' }}>
                  {money(data.summary.replacedEntitlementCents / 100)}
                </span>
              }
            />
          ) : null}
          <ListRow
            title={t('pcSettled')}
            meta={`${t('pcPayoutEvents')} ${data.summary.payoutEvents} · ${t('pcReversalEvents')} ${data.summary.reversalEvents}`}
            trailing={
              <span className="tabular">
                {money(data.summary.effectiveSettledCents / 100)}
              </span>
            }
          />
          <ListRow
            title={t('pcOutstanding')}
            meta={`${t('pcDistCount')} ${data.summary.distributionsCurrent}`}
            trailing={
              <span
                className="tabular"
                style={{
                  fontWeight: 600,
                  color:
                    data.summary.outstandingCents === 0
                      ? 'var(--color-text-subtle)'
                      : 'var(--color-warning)',
                }}
              >
                {money(data.summary.outstandingCents / 100)}
              </span>
            }
          />

          {data.period.close ? (
            <Note>
              {t('pcClosedOn').replace('{when}', day(new Date(data.period.close.closedAt)))}
              {data.period.close.closedByName
                ? ` ${t('pcClosedBy').replace('{who}', data.period.close.closedByName)}`
                : ''}
            </Note>
          ) : null}
          {data.summary.recordsAfterClose > 0 ? (
            <Note>
              {t('pcAfterCloseNote').replace('{n}', String(data.summary.recordsAfterClose))}
            </Note>
          ) : null}
          <Note>{t('pcBasisNote')}</Note>

          <Button variant="secondary" onClick={download}>
            {t('pcExport')}
          </Button>
        </section>
      ) : null}

      <section className={ui.stackFlush}>
        <SectionLabel>{t('pcHistory')}</SectionLabel>
        {period.closes.length === 0 ? (
          <Note>{t('pcNoCloses')}</Note>
        ) : (
          period.closes.map((c) => (
            <ListRow
              key={c.id}
              title={`${c.periodStart} – ${c.periodEnd}`}
              meta={[
                t('pcClosedOn').replace('{when}', day(new Date(c.closedAt))),
                c.note ?? '',
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))
        )}
      </section>

      {/* Closing is meaningful, so it is confirmed — and the confirmation says
          what it does not do, because "close" is a word people expect to mean
          locked, deleted or filed, and here it means none of those. */}
      <Sheet
        open={confirming}
        title={t('pcCloseTitle').replace('{from}', from).replace('{to}', to)}
        onClose={() => setConfirming(false)}
      >
        <div className={ui.stackTight}>
          <Note>{t('pcCloseBody')}</Note>
          <Note>{t('pcCloseCorrections')}</Note>
          {warnings.map(([n, key]) => (
            <p key={key} className={ui.rowMeta}>
              {t(key).replace('{n}', String(n))}
            </p>
          ))}

          <label className={ui.fieldLabel} htmlFor="close-note">
            {t('pcNoteLabel')}
          </label>
          <textarea
            id="close-note"
            className={ui.fieldInput}
            rows={2}
            maxLength={500}
            placeholder={t('pcNotePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ resize: 'none', lineHeight: 1.5, paddingTop: 10, height: 'auto' }}
          />

          <Button onClick={() => void confirmClose()}>{t('pcConfirm')}</Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('pcCancel')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
