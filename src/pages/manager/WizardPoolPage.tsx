import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card, CardButton } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { MoneyField, MoneyKeypad } from '@/components/ui/MoneyKeypad';
import { Note } from '@/components/ui/Note';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Sheet } from '@/components/ui/Sheet';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { centsToAmount } from '@/lib/money';
import { draftPoolAmount, reportsTotalCents } from '@/state/selectors';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import { useDistributionWizard } from '@/distribution/useDistribution';
import { useToast } from '@/hooks/useToast';
import type { PoolPeriod } from '@/types';
import { useEffect, useRef, useState } from 'react';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** Wizard step 1 — how much came in. */
export function WizardPoolPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money, day } = useI18n();
  const shift = useShiftLabel();
  const navigate = useNavigate();
  const { show } = useToast();
  const [field, setField] = useState<'card' | 'cash'>('card');
  const [voiding, setVoiding] = useState(false);

  const wizard = useDistributionWizard();
  const real = wizard.enabled;

  /**
   * WHICH NIGHT. In real mode the day is the server's answer (migration 33),
   * one business day per pool: the period control the prototype offered has
   * no meaning for a real pool and is not shown. Until the server has
   * answered, nothing can be opened; a failed check turns the button into
   * the retry. A pool the wizard has already found pins its own night, so
   * the cut-off passing mid-flow cannot swing the screen onto the next one.
   */
  const dayError = real && !wizard.businessDate && wizard.businessDayStatus === 'error';
  const dayPending = real && !wizard.businessDate && !dayError;
  const dateLabel = (iso: string) => day(new Date(`${iso}T12:00:00`));

  /**
   * Where the number comes from.
   *
   * With reports in hand the database sums them — create_pool_from_reports()
   * adds up the rows and records which ones it consumed, so the browser never
   * asserts how much money there is and the same report cannot fund two pools.
   * The keypad is for the case there is nothing to derive from.
   */
  const derived = real && wizard.reportTotal.count > 0;
  const poolLocked = Boolean(wizard.pool && wizard.pool.status !== 'open');

  /**
   * WHAT THE KEYPAD IS ALLOWED TO TOUCH.
   *
   * Three different amounts used to reach this screen and only one of them was
   * ever typed: a pool row the manager opened by hand, a pool the engine summed
   * from the team's reports, and the not-yet-opened draft in the Phase 1
   * reducer. The keypad was wired to the reducer in every one of those cases,
   * so once a pool row existed the digits went somewhere nothing on screen was
   * reading — backspace appeared to do nothing and the manager was stuck with
   * whatever the row said. The rule now follows the money:
   *
   *   open + manual   the manager typed it, so the manager may correct it, and
   *                   the correction is written to the row (open pool amounts
   *                   are the one thing app.guard_pool_amounts still permits).
   *   open + reports  the reports are the record. Not typed here; the way to
   *                   change it is to correct a report or set the pool aside.
   *   locked or later frozen by the database. Shown, never edited.
   *   no pool yet     nothing exists to write to; the reducer holds the draft
   *                   until Next opens the row, exactly as before.
   */
  const openManual = real && wizard.pool?.status === 'open' && wizard.pool.source === 'manual';
  const reportBacked = real && wizard.pool?.source === 'reports';

  /* The edited copy of an open manual pool, seeded from the row and written
     back to it. Null whenever the row is not the manager's to change. */
  const poolId = wizard.pool?.id ?? null;
  const [edit, setEdit] = useState<{ cardCents: number; cashCents: number } | null>(null);

  useEffect(() => {
    if (!openManual || !wizard.pool) {
      setEdit(null);
      return;
    }
    setEdit({ cardCents: wizard.pool.cardCents, cashCents: wizard.pool.cashCents });
    // Seeded when the ROW changes, not when its amounts do: re-seeding on the
    // server's echo of our own save would fight the person typing.
  }, [openManual, poolId]);

  const cardCents = !real
    ? state.draft.cardCents
    : openManual && edit
      ? edit.cardCents
      : wizard.pool
        ? wizard.pool.cardCents
        : derived
          ? wizard.reportTotal.cardCents
          : state.draft.cardCents;
  const cashCents = !real
    ? state.draft.cashCents
    : openManual && edit
      ? edit.cashCents
      : wizard.pool
        ? wizard.pool.cashCents
        : derived
          ? wizard.reportTotal.cashCents
          : state.draft.cashCents;

  const realCents =
    openManual && edit
      ? edit.cardCents + edit.cashCents
      : wizard.pool
        ? wizard.pool.totalCents
        : derived
          ? wizard.reportTotal.cardCents + wizard.reportTotal.cashCents
          : state.draft.cardCents + state.draft.cashCents;

  const pool = real ? centsToAmount(realCents) : draftPoolAmount(state);

  /* One pending write at a time, coalesced: a run of taps resets the timer, so
     twelve digits are one UPDATE, and a value already on the row is never
     written again. A failure says so and puts the row's own figure back. */
  const dirty =
    openManual && edit && wizard.pool
      ? edit.cardCents !== wizard.pool.cardCents || edit.cashCents !== wizard.pool.cashCents
      : false;
  const saveAmounts = useRef<() => Promise<void>>(async () => {});
  saveAmounts.current = async () => {
    if (!dirty || !edit || !wizard.pool) return;
    const row = wizard.pool;
    const result = await wizard.setPoolAmounts(edit.cardCents, edit.cashCents);
    if (result.ok) return;
    show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
    setEdit({ cardCents: row.cardCents, cashCents: row.cashCents });
  };

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void saveAmounts.current(), 700);
    return () => window.clearTimeout(timer);
  }, [dirty, cardCents, cashCents]);

  /**
   * THE WAY OUT OF A WRONG TOTAL. A locked pool's amounts are frozen. If
   * nothing stands on it — no draft, and no version that was ever sent — the
   * manager can set it aside (void_pool, migration 33): its reports become
   * free again and a fresh pool can be opened with the right total. With a
   * draft on it, the draft is discarded first; with a sent version behind
   * it, the pool is history and says so. The server decides all of this
   * again when asked; the screen only offers what it can see.
   */
  /* void_pool() refuses a distributed pool, one with a draft and one whose
     version was ever sent — and permits an open one, which is what gives a
     report-backed pool with a wrong total its way out: void it, the reports
     come free again (migration 15), correct the report, pool again. The server
     checks all of this a second time. */
  const canVoid = real && Boolean(wizard.pool) && !wizard.draft && !wizard.publishedId;
  /** An earlier night the manager started and did not finish. */
  const previous = real
    ? (wizard.unfinishedPools.find((p) => p.periodStart !== wizard.businessDate) ?? null)
    : null;

  const advance = async () => {
    if (!real) {
      navigate('/manager/new/areas');
      return;
    }
    if (wizard.pool) {
      // A tap on Next inside the debounce window must not lose the digits.
      await saveAmounts.current();
      navigate('/manager/new/areas');
      return;
    }
    const result = derived
      ? await wizard.openPoolFromReports()
      : await wizard.openManualPool(state.draft.cardCents, state.draft.cashCents);
    if (!result.ok) {
      show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    navigate('/manager/new/areas');
  };

  const voidNow = async () => {
    if (wizard.busy) return;
    const result = await wizard.voidPool();
    if (!result.ok) {
      show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    setVoiding(false);
    show(t('dPoolVoided'));
  };

  return (
    <Screen
      title={t('tipPool')}
      kicker={`${t('step')} 1/4`}
      back="close"
      cta={
        real && !wizard.businessDate
          ? {
              label: dayError ? t('retry') : t('bdLoading'),
              muted: !dayError,
              onClick: () => {
                if (dayError) void wizard.refreshBusinessDay();
              },
            }
          : {
              label: wizard.busy ? t('dPoolOpening') : t('nextAreas'),
              muted: wizard.busy || (real && !wizard.pool && realCents <= 0),
              onClick: () => {
                if (real && !wizard.pool && realCents <= 0) {
                  show(t(derived ? 'dErrEmptyPool' : 'dNoReportsYet'));
                  return;
                }
                void advance();
              },
            }
      }
    >
      {real ? null : (
        <SegmentedControl<PoolPeriod>
          label={t('tipPool')}
          value={state.draft.period}
          options={[
            { value: 'segShift', label: t('segShift') },
            { value: 'segDay', label: t('segDay') },
            { value: 'segWeek', label: t('segWeek') },
          ]}
          onChange={(period) => dispatch({ type: 'setPeriod', period })}
        />
      )}

      {dayPending ? <EmptyState title={t('bdLoading')} /> : null}
      {dayError ? <EmptyState title={t('bdFailed')} /> : null}

      {real && wizard.businessDate ? (
        <Card padding="padded">
          <span className={ui.inline}>
            <Icon name="calendar-blank" size={19} color="var(--color-text-muted)" />
            <span className={ui.rowMain}>
              <span className={ui.rowTitle}>
                {t('dPoolForDate').replace('{date}', dateLabel(wizard.businessDate))}
              </span>
              <span className={ui.rowMeta} style={{ display: 'block' }}>
                {t('dPoolOneDay')}
              </span>
            </span>
          </span>
        </Card>
      ) : null}
      {!real ? (
        <Card padding="padded">
          <span className={ui.inline}>
            <Icon name="calendar-blank" size={19} color="var(--color-text-muted)" />
            <span className={`${ui.rowMain} ${ui.rowTitle}`}>{shift.full}</span>
          </span>
        </Card>
      ) : null}

      {/* A night continued from before, or the offer to continue one. */}
      {real && wizard.chosenDate ? (
        <Button variant="ghost" block onClick={() => wizard.selectDate(null)}>
          {t('dPoolBackToTonight')}
        </Button>
      ) : null}
      {real && previous && !wizard.chosenDate ? (
        <Card tone="warning" padding="padded">
          <div className={ui.stackTight}>
            <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
              {t('dPoolPrevious')
                .replace('{date}', dateLabel(previous.periodStart))
                .replace('{amount}', money(centsToAmount(previous.totalCents)))}
            </p>
            <Button variant="secondary" onClick={() => wizard.selectDate(previous.periodStart)}>
              {t('dPoolContinue')}
            </Button>
          </div>
        </Card>
      ) : null}

      {real && !wizard.businessDate ? null : (
        <>
          <div>
            <p className={styles.displayLabel}>{t('totalCollected')}</p>
            <p
              className={`${styles.displayAmount} tabular`}
              style={pool === 0 ? { color: 'var(--color-text-faint)' } : undefined}
            >
              {money(pool)}
            </p>
          </div>

          {/* Still offered once the reports have been consumed into the pool:
              correcting a report is the way a report-backed total changes. */}
          {(real ? wizard.reportTotal.count > 0 || reportBacked : state.reports.length > 0) ? (
            <CardButton padding="padded" onClick={() => navigate('/manager/reports')}>
              <span className={ui.inline}>
                <Icon name="notebook" size={17} color="var(--color-accent)" />
                <span
                  className={ui.rowMain}
                  style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}
                >
                  {t('reportsHead')} ·{' '}
                  {money(
                    centsToAmount(
                      real
                        ? reportBacked
                          ? realCents
                          : wizard.reportTotal.cardCents + wizard.reportTotal.cashCents
                        : reportsTotalCents(state),
                    ),
                  )}
                </span>
                <Icon name="caret-right" size={13} color="var(--color-text-subtle)" />
              </span>
            </CardButton>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MoneyField
              icon="credit-card"
              label={t('srcCard')}
              value={money(centsToAmount(cardCents))}
              active={field === 'card'}
              onSelect={() => setField('card')}
            />
            <MoneyField
              icon="money"
              label={t('srcCash')}
              value={money(centsToAmount(cashCents))}
              active={field === 'cash'}
              onSelect={() => setField('cash')}
            />
          </div>

          {/* The keypad appears only where there is something the manager may
              actually type into: their own open pool, or a night with no pool
              and no reports. A report-backed total is the team's record and a
              locked pool's amounts are frozen by app.guard_pool_amounts(); in
              both cases the screen says so instead of offering a control that
              would do nothing. */}
          {real && !openManual && (derived || wizard.pool) ? (
            <p className={ui.note}>
              {poolLocked
                ? t('dPoolLockedNote').replace(
                    '{amount}',
                    money(centsToAmount(wizard.pool?.totalCents ?? 0)),
                  )
                : reportBacked
                  ? t('dPoolReportedNote').replace('{amount}', money(centsToAmount(realCents)))
                  : t('dPoolFromReports')}
            </p>
          ) : (
            <MoneyKeypad
              label={t('totalCollected')}
              cents={field === 'card' ? cardCents : cashCents}
              onChange={(cents) => {
                if (openManual) {
                  setEdit((current) => {
                    /* Seed from the row rather than dropping the press: between
                       the pool arriving and the effect below seeding, `current`
                       is still null, and swallowing the key there would be the
                       original bug in miniature. */
                    const base = current ?? {
                      cardCents: wizard.pool?.cardCents ?? 0,
                      cashCents: wizard.pool?.cashCents ?? 0,
                    };
                    return field === 'card'
                      ? { ...base, cardCents: cents }
                      : { ...base, cashCents: cents };
                  });
                  return;
                }
                dispatch({ type: 'setPoolCents', field, cents });
              }}
            />
          )}

          {/* What a locked pool can still do. */}
          {real && poolLocked && wizard.draft ? (
            <Card padding="padded">
              <div className={ui.stackTight}>
                <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {t('dPoolHasDraft')}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/manager/distributions/${wizard.draft?.id ?? ''}`)}
                >
                  {t('dPoolSeeDraft')}
                </Button>
              </div>
            </Card>
          ) : null}
          {real && poolLocked && !wizard.draft && wizard.publishedId ? (
            <Card padding="padded">
              <div className={ui.stackTight}>
                <p className={ui.noteBody} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {t('dPoolPublished')}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/manager/distributions/${wizard.publishedId ?? ''}`)}
                >
                  {t('viewDist')}
                </Button>
              </div>
            </Card>
          ) : null}
          {canVoid ? (
            <Button variant="secondary" block onClick={() => setVoiding(true)}>
              {t('dPoolVoidCta')}
            </Button>
          ) : null}
        </>
      )}

      {/* Setting the pool aside: one confirmation that says what happens and
          what cannot happen. The server refuses anything the screen got wrong. */}
      <Sheet
        open={voiding}
        title={t('dPoolVoidTitle')}
        onClose={() => {
          if (!wizard.busy) setVoiding(false);
        }}
      >
        <div className={ui.stackTight}>
          <Note>
            {t('dPoolVoidBody').replace(
              '{amount}',
              money(centsToAmount(wizard.pool?.totalCents ?? 0)),
            )}
          </Note>
          <Button disabled={wizard.busy} onClick={() => void voidNow()}>
            {wizard.busy ? t('dPoolVoiding') : t('dPoolVoidConfirm')}
          </Button>
          <Button variant="ghost" disabled={wizard.busy} onClick={() => setVoiding(false)}>
            {t('back')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
