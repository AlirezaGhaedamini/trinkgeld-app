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

  const grouping = liveOverlap(state);
  const overlapFor = (employeeId: string) =>
    grouping.rows.find((row) => row.employeeId === employeeId);

  const wizard = mode === 'wizard';
  const submitted = submissionCount(state);

  const nobodyHasHours = grouping.rows.length === 0;

  const areasShown = AREA_ORDER.filter(
    (areaId) => !wizard || (state.draft.areaShares[areaId] ?? 0) > 0,
  );

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
              label: t('saveHours'),
              onClick: () => {
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
    </Screen>
  );
}
