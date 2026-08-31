import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { InfoNote } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { AREA_ORDER } from '@/data/areas';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { useToast } from '@/hooks/useToast';
import { formatClock, toHours, workedMinutes } from '@/lib/time';
import { liveOverlap, submissionCount } from '@/state/selectors';
import { SHIFT_FAILURE_KEY } from '@/shifts/errors';
import type { Shift } from '@/shifts/types';
import { useReviewQueue } from '@/shifts/useShifts';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

interface HoursReviewPageProps {
  /** Step 3 of the wizard, or the standalone review reached from the overview. */
  mode: 'wizard' | 'review';
}

/**
 * Hours worked, by area.
 *
 * Managers correct anything that looks wrong and lock or unlock a shift for the
 * person. Each row also carries its overlap verdict, so it is obvious who is in
 * the pool and why.
 */
export function HoursReviewPage({ mode }: HoursReviewPageProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, num, hours, duration, area, language } = useI18n();
  const shift = useShiftLabel();
  const { show } = useToast();
  const navigate = useNavigate();

  /**
   * Real review, but only on the standalone screen. The wizard is step 3 of
   * the distribution flow, which is Phase 3D — it stays on the local dataset so
   * the two are never half-connected.
   */
  // Step 3 of the wizard shows the hours that will take part, so it asks for
  // approved shifts only — a submitted shift is not eligible for a payout.
  const queue = useReviewQueue(
    mode === 'wizard' ? ['approved'] : ['submitted', 'approved', 'rejected'],
  );
  const realReview = queue.enabled;

  const grouping = liveOverlap(state);
  const overlapFor = (employeeId: string) =>
    grouping.rows.find((row) => row.employeeId === employeeId);

  const wizard = mode === 'wizard';
  const submitted = submissionCount(state);

  const nobodyHasHours = grouping.rows.length === 0;

  const areasShown = AREA_ORDER.filter(
    (areaId) => !wizard || (state.draft.areaShares[areaId] ?? 0) > 0,
  );

  /** Real shifts, grouped by their effective area exactly as Phase 2 resolves it. */
  const realGroups = useMemo(() => {
    if (!realReview) return [];
    const byArea = new Map<string, Shift[]>();
    for (const entry of queue.shifts) {
      const key = entry.areaName ?? t('notSet');
      const list = byArea.get(key);
      if (list) list.push(entry);
      else byArea.set(key, [entry]);
    }
    return [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [realReview, queue.shifts, t]);

  const pending =
    realReview && mode === 'review'
      ? queue.shifts.filter((entry) => entry.status === 'submitted')
      : [];

  /**
   * "Save hours" is the review being signed off: every shift still marked
   * submitted becomes approved, after any corrections the manager just made.
   * Each one is a separate guarded UPDATE, and each writes its own audit row.
   */
  const approveAll = async () => {
    if (pending.length === 0) {
      show(t('shApprovedNone'));
      return;
    }
    for (const entry of pending) {
      const result = await queue.approve(entry.id);
      if (!result.ok) {
        show(t(SHIFT_FAILURE_KEY[result.failure ?? 'unknown']));
        return;
      }
    }
    show(t('shApproved'));
    navigate(-1);
  };

  const runAction = async (action: Promise<{ ok: boolean; failure?: keyof typeof SHIFT_FAILURE_KEY }>) => {
    const result = await action;
    if (!result.ok) show(t(SHIFT_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  return (
    <Screen
      title={wizard ? t('hoursWorked') : t('hoursReviewTitle')}
      kicker={wizard ? `${t('step')} 3/4` : shift.full}
      action={
        wizard
          ? undefined
          : { icon: 'users-four', onClick: () => navigate('/manager/overlap') }
      }
      cta={
        wizard
          ? { label: t('calculate'), onClick: () => navigate('/manager/new/result') }
          : {
              label: queue.busy ? t('shApproving') : t('saveHours'),
              muted: queue.busy,
              onClick: () => {
                if (realReview) {
                  void approveAll();
                  return;
                }
                show(language === 'Deutsch' ? 'Stunden gespeichert' : 'Hours saved');
                navigate(-1);
              },
            }
      }
    >
      <InfoNote icon="check-circle">
        {wizard
          ? `${submitted}/${state.employees.length} ${t('hoursNoteA')}`
          : t('hoursReviewBody')}
      </InfoNote>

      {realReview ? (
        <>
          {queue.status === 'loading' ? <EmptyState title={t('shLoading')} /> : null}
          {queue.status !== 'loading' && realGroups.length === 0 ? (
            <EmptyState title={t('shNoQueue')}>{t('shNoQueueBody')}</EmptyState>
          ) : null}

          {realGroups.map(([areaName, rows]) => {
            const areaHours = rows.reduce((sum, entry) => sum + entry.workedMinutes / 60, 0);
            return (
              <section key={areaName} className={ui.stackFlush}>
                <SectionLabel meta={hours(areaHours)}>{areaName}</SectionLabel>

                {rows.map((entry) => {
                  const status =
                    entry.status === 'approved'
                      ? { label: t('shStatusApproved'), color: 'var(--color-money)', tone: 'tint' as const }
                      : entry.status === 'rejected'
                        ? { label: t('shStatusRejected'), color: 'var(--color-text-subtle)', tone: 'quiet' as const }
                        : { label: t('shStatusSubmitted'), color: 'var(--color-accent)', tone: 'tint' as const };

                  return (
                    <div key={entry.id} className={styles.hoursRow}>
                      <div className={ui.inline}>
                        <Avatar name={entry.memberName ?? ''} size={34} />
                        <span className={ui.rowMain}>
                          <span className={`${ui.rowTitle} ${ui.truncate}`}>{entry.memberName}</span>
                          {/* The effective area on every row, and marked when
                              it came from the shift rather than the member —
                              it is what the distribution will weight. */}
                          <span
                            className={ui.rowMeta}
                            style={{ display: 'block', color: 'var(--color-text-subtle)' }}
                          >
                            {`${formatClock(entry.startMinutes)} – ${formatClock(entry.endMinutes)} · ${
                              entry.areaName ?? t('notSet')
                            }${entry.areaFromShift ? ` (${t('dAreaFromShift')})` : ''}`}
                          </span>
                        </span>
                        <Badge tone={status.tone} style={{ color: status.color }}>
                          {status.label}
                        </Badge>
                      </div>

                      <div className={styles.hoursControls}>
                        <span className={`${styles.breakLine} ${ui.truncate}`}>
                          {`${t('breakT')} ${entry.breakMinutes} ${t('minutesShort')}`}
                        </span>
                        <button
                          type="button"
                          className={`${ui.stepButton} ${ui.stepButtonBare}`}
                          style={{
                            color: entry.locked ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                          }}
                          onClick={() => void runAction(queue.setLocked(entry.id, !entry.locked))}
                          aria-label={`${entry.locked ? t('unlock') : t('lock')} — ${entry.memberName}`}
                        >
                          <Icon name={entry.locked ? 'lock-simple' : 'lock-simple-open'} size={17} />
                        </button>
                        <button
                          type="button"
                          className={ui.stepButton}
                          onClick={() => void runAction(queue.correctEnd(entry, -15))}
                          aria-label={`${entry.memberName} −15 ${t('minutesShort')}`}
                        >
                          −
                        </button>
                        <span className={`${styles.hoursValue} tabular`}>
                          {num(entry.workedMinutes / 60, 2)}
                        </span>
                        <button
                          type="button"
                          className={`${ui.stepButton} ${ui.stepButtonUp}`}
                          onClick={() => void runAction(queue.correctEnd(entry, 15))}
                          aria-label={`${entry.memberName} +15 ${t('minutesShort')}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </>
      ) : (
        <>
        {nobodyHasHours ? <EmptyState title={t('emptyHours')}>{t('emptyTeamBody')}</EmptyState> : null}

        {areasShown.map((areaId) => {
          const members = state.employees.filter((employee) => employee.area === areaId);
          if (members.length === 0) return null;
          const areaHours = members.reduce((sum, employee) => {
            const overlap = overlapFor(employee.id);
            return sum + (overlap?.included ? toHours(overlap.workedMinutes) : 0);
          }, 0);

          return (
            <section key={areaId} className={ui.stackFlush}>
              <SectionLabel meta={hours(areaHours)}>{area(areaId)}</SectionLabel>

              {members.map((employee) => {
                const times = state.currentHours[employee.id];
                const worked = workedMinutes(times);
                const overlap = overlapFor(employee.id);
                const submission = state.submissions[employee.id];
                const locked = Boolean(submission?.locked);
                const inPool = Boolean(overlap?.included);

                const status = !worked
                  ? { label: t('missing'), color: 'var(--color-text-subtle)', tone: 'plain' as const }
                  : overlap?.isAnchor
                    ? { label: t('anchorTag'), color: 'var(--color-accent)', tone: 'tint' as const }
                    : inPool
                      ? {
                          label: `${t('included')} · ${duration(overlap?.overlapMinutes ?? 0)}`,
                          color: 'var(--color-accent)',
                          tone: 'tint' as const,
                        }
                      : { label: t('excluded'), color: 'var(--color-text)', tone: 'quiet' as const };

                return (
                  <div key={employee.id} className={styles.hoursRow}>
                    <div className={ui.inline}>
                      <Avatar name={employee.name} size={34} muted={!worked} />
                      <span className={ui.rowMain}>
                        <span
                          className={`${ui.rowTitle} ${ui.truncate}`}
                          style={{ color: worked ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
                        >
                          {employee.name}
                        </span>
                        <span
                          className={ui.rowMeta}
                          style={{
                            display: 'block',
                            color: submission
                              ? 'var(--color-text-subtle)'
                              : worked
                                ? 'var(--color-text-subtle)'
                                : 'var(--color-accent)',
                          }}
                        >
                          {times && worked
                            ? `${formatClock(times.startMinutes)} – ${formatClock(times.endMinutes)}`
                            : t('missing')}
                        </span>
                      </span>
                      <Badge tone={status.tone} style={{ color: status.color }}>
                        {status.label}
                      </Badge>
                    </div>

                    <div className={styles.hoursControls}>
                      <span className={`${styles.breakLine} ${ui.truncate}`}>
                        {times && worked
                          ? `${t('breakT')} ${times.breakMinutes} ${t('minutesShort')}`
                          : ''}
                      </span>
                      <button
                        type="button"
                        className={`${ui.stepButton} ${ui.stepButtonBare}`}
                        style={{ color: locked ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}
                        onClick={() => {
                          dispatch({ type: 'toggleLock', employeeId: employee.id });
                          show(locked ? t('unlockedToast') : t('lockedToast'));
                        }}
                        aria-label={`${locked ? t('unlock') : t('lock')} — ${employee.name}`}
                      >
                        <Icon name={locked ? 'lock-simple' : 'lock-simple-open'} size={17} />
                      </button>
                      <button
                        type="button"
                        className={ui.stepButton}
                        onClick={() =>
                          dispatch({ type: 'adjustEnd', employeeId: employee.id, deltaMinutes: -15 })
                        }
                        aria-label={`${employee.name} −15 ${t('minutesShort')}`}
                      >
                        −
                      </button>
                      <span
                        className={`${styles.hoursValue} tabular`}
                        style={{
                          color: inPool ? 'var(--color-text)' : 'var(--color-text-subtle)',
                        }}
                      >
                        {worked ? num(worked / 60, 2) : '—'}
                      </span>
                      <button
                        type="button"
                        className={`${ui.stepButton} ${ui.stepButtonUp}`}
                        onClick={() =>
                          dispatch({ type: 'adjustEnd', employeeId: employee.id, deltaMinutes: 1 * 15 })
                        }
                        aria-label={`${employee.name} +15 ${t('minutesShort')}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        </>
      )}

    </Screen>
  );
}
