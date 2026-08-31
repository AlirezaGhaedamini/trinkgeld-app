import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Lede } from '@/components/ui/Note';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ListRow } from '@/components/ui/ListRow';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { usePreviousShiftLabel, useShiftLabel } from '@/hooks/useShiftLabel';
import { useToast } from '@/hooks/useToast';
import { formatClock, workedMinutes } from '@/lib/time';
import type { ShiftTimes } from '@/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

type Field = 'start' | 'end' | 'break';

/** Nothing is filled in until the person touches a field. */
interface HoursDraft {
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number | null;
}

const STEP_MINUTES = 15;
const BREAK_STEP_MINUTES = 5;
const MIN_SHIFT_MINUTES = 15;
const MAX_BREAK_MINUTES = 180;

/**
 * Where a field starts stepping from the first time it is touched. These are
 * not defaults on the form — the field reads "--:--" until then; they are just
 * a sensible place to begin counting, so nobody taps + eighty times.
 */
const FIRST_TOUCH = { start: 18 * 60, end: 22 * 60, break: 0 };

/**
 * The employee enters their own working time here: start, end, break. The app
 * derives the effective hours; the manager reviews and locks.
 */
/** Clock time of the submission, so the manager sees when it came in. */
function submittedAtNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function MyHoursPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, num, dateFor, language } = useI18n();
  const shift = useShiftLabel();
  const previousShift = usePreviousShiftLabel();
  const { show } = useToast();
  const navigate = useNavigate();

  const employeeId = state.session.employeeId;
  const submission = state.submissions[employeeId];
  const locked = Boolean(submission?.locked);

  const [draft, setDraft] = useState<HoursDraft>(
    submission
      ? {
          startMinutes: submission.startMinutes,
          endMinutes: submission.endMinutes,
          breakMinutes: submission.breakMinutes,
        }
      : { startMinutes: null, endMinutes: null, breakMinutes: null },
  );
  const [field, setField] = useState<Field>('start');

  const complete = draft.startMinutes !== null && draft.endMinutes !== null;
  const times: ShiftTimes | null = complete
    ? {
        startMinutes: draft.startMinutes as number,
        endMinutes: draft.endMinutes as number,
        breakMinutes: draft.breakMinutes ?? 0,
      }
    : null;
  const effective = times ? workedMinutes(times) : null;

  const bump = (direction: 1 | -1) => {
    if (locked) {
      show(t('hoursLockedBody'));
      return;
    }
    setDraft((current) => {
      const next = { ...current };

      if (field === 'break') {
        next.breakMinutes =
          next.breakMinutes === null
            ? FIRST_TOUCH.break
            : Math.min(
                MAX_BREAK_MINUTES,
                Math.max(0, next.breakMinutes + direction * BREAK_STEP_MINUTES),
              );
        return next;
      }

      if (field === 'start') {
        next.startMinutes =
          next.startMinutes === null
            ? FIRST_TOUCH.start
            : next.startMinutes + direction * STEP_MINUTES;
      } else {
        next.endMinutes =
          next.endMinutes === null
            ? Math.max(FIRST_TOUCH.end, (next.startMinutes ?? FIRST_TOUCH.start) + 60)
            : next.endMinutes + direction * STEP_MINUTES;
      }

      // Keep the pair sane once both ends exist.
      if (
        next.startMinutes !== null &&
        next.endMinutes !== null &&
        next.endMinutes - next.startMinutes < MIN_SHIFT_MINUTES
      ) {
        if (field === 'start') next.startMinutes = next.endMinutes - MIN_SHIFT_MINUTES;
        else next.endMinutes = next.startMinutes + MIN_SHIFT_MINUTES;
      }
      return next;
    });
  };

  const fields: Array<{ key: Field; label: string; value: string; empty: boolean }> = [
    {
      key: 'start',
      label: t('startT'),
      value: draft.startMinutes === null ? '--:--' : formatClock(draft.startMinutes),
      empty: draft.startMinutes === null,
    },
    {
      key: 'end',
      label: t('endT'),
      value: draft.endMinutes === null ? '--:--' : formatClock(draft.endMinutes),
      empty: draft.endMinutes === null,
    },
    {
      key: 'break',
      label: t('breakT'),
      value:
        draft.breakMinutes === null ? `— ${t('minutesShort')}` : `${draft.breakMinutes} ${t('minutesShort')}`,
      empty: draft.breakMinutes === null,
    },
  ];

  const log = state.distributions.slice(1, 5).map((distribution) => {
    const times = distribution.hours[employeeId];
    return {
      id: distribution.id,
      date: dateFor(distribution.dateKey, distribution.date).split(' · ')[0],
      meta: times
        ? `${formatClock(times.startMinutes)} – ${formatClock(times.endMinutes)} · ${t(
            'breakT',
          )} ${times.breakMinutes} ${t('minutesShort')}`
        : t('missing'),
      hours: times ? num(workedMinutes(times) / 60, 2) : '—',
    };
  });

  return (
    <Screen
      title={t('myHoursTitle')}
      kicker={shift.full}
      back={false}
      aboveTabs
      cta={
        locked
          ? { label: t('requestChange'), onClick: () => show(t('changeRequested')) }
          : {
              label: submission ? t('hoursUpdate') : t('hoursSubmit'),
              muted: !times,
              onClick: () => {
                if (!times) {
                  show(t('myHoursBody'));
                  return;
                }
                dispatch({ type: 'submitOwnHours', employeeId, times, at: submittedAtNow() });
                show(t('hoursSent'));
                navigate('/home');
              },
            }
      }
    >
      <Lede>{t('myHoursBody')}</Lede>

      <SegmentedControl
        label={t('pickShift')}
        value="sat22"
        options={[
          { value: 'sat22', label: shift.short },
          {
            value: 'fri21',
            label: previousShift,
            disabledReason:
              language === 'Deutsch' ? 'Ältere Schichten sind abgeschlossen' : 'Earlier shifts are closed',
          },
        ]}
        onChange={(_value, option) => {
          if (option.disabledReason) show(option.disabledReason);
        }}
      />

      <Card tone={locked ? 'default' : 'primary'} padding="roomy">
        <div className={ui.stack} style={{ gap: 14 }}>
          <div className={styles.draftFields} role="radiogroup" aria-label={t('effectiveTime')}>
            {fields.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={field === entry.key}
                className={`${styles.draftField} ${
                  field === entry.key ? styles.draftFieldActive : ''
                }`}
                onClick={() => setField(entry.key)}
              >
                <span className={styles.draftLabel}>{entry.label}</span>
                <span
                  className={`${styles.draftValue} tabular`}
                  style={entry.empty ? { color: 'var(--color-text-faint)' } : undefined}
                >
                  {entry.value}
                </span>
              </button>
            ))}
          </div>

          <div className={ui.inline} style={{ gap: 14, opacity: locked ? 0.4 : 1 }}>
            <button
              type="button"
              className={`${ui.stepButton} ${ui.stepButtonWide}`}
              onClick={() => bump(-1)}
              aria-label={`${t('effectiveTime')} −`}
            >
              −
            </button>
            <span
              style={{ fontSize: 12, color: 'var(--color-text-subtle)', minWidth: 52, textAlign: 'center' }}
            >
              {field === 'break'
                ? `${BREAK_STEP_MINUTES} ${t('minutesShort')}`
                : `${STEP_MINUTES} ${t('minutesShort')}`}
            </span>
            <button
              type="button"
              className={`${ui.stepButton} ${ui.stepButtonWide} ${ui.stepButtonUp}`}
              onClick={() => bump(1)}
              aria-label={`${t('effectiveTime')} +`}
            >
              +
            </button>
          </div>

          <div className={styles.draftTotal}>
            <span className={ui.noteBody} style={{ fontSize: 13 }}>
              {t('effectiveTime')}
            </span>
            <span
              className={`${styles.draftTotalValue} tabular`}
              style={effective === null ? { color: 'var(--color-text-faint)' } : undefined}
            >
              {effective === null ? '—' : `${num(effective / 60, 2)} ${t('hSuffix')}`}
            </span>
          </div>
        </div>
      </Card>

      <Card padding="padded">
        <div className={styles.lockedBanner}>
          <Icon
            name={locked ? 'lock-simple' : submission ? 'lock-simple-open' : 'paper-plane-tilt'}
            size={19}
            color={locked ? 'var(--color-text-secondary)' : 'var(--color-accent)'}
          />
          <div className={ui.rowMain}>
            <p
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: locked ? 'var(--color-text-secondary)' : 'var(--color-accent)',
              }}
            >
              {locked ? t('hoursLocked') : submission ? t('hoursUnlocked') : t('notSubmitted')}
            </p>
            <p className={ui.note} style={{ marginTop: 2 }}>
              {locked ? t('hoursLockedBody') : t('myHoursBody')}
            </p>
          </div>
        </div>
      </Card>

      <div className={ui.stackFlush}>
        <SectionLabel>{t('recent')}</SectionLabel>
        {log.length === 0 ? <EmptyState title={t('emptyShifts')} /> : null}
        {log.map((entry) => (
          <ListRow
            key={entry.id}
            title={entry.date}
            meta={entry.meta}
            trailing={
              <span className="tabular" style={{ fontSize: 16, fontWeight: 500 }}>
                {entry.hours}
              </span>
            }
          />
        ))}
      </div>
    </Screen>
  );
}
