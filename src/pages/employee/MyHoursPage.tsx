import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Lede } from '@/components/ui/Note';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ListRow } from '@/components/ui/ListRow';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { usePreviousShiftLabel, useShiftLabel } from '@/hooks/useShiftLabel';
import { useToast } from '@/hooks/useToast';
import { formatClock, parseClock, workedMinutes } from '@/lib/time';
import { SHIFT_FAILURE_KEY } from '@/shifts/errors';
import { addDays } from '@/shifts/time';
import {
  MAX_BREAK_MINUTES as MAX_BREAK_TOTAL,
  SHIFT_STATUS_LABEL,
  endMinutesFor,
  validateDraft,
  type Shift,
  type ShiftValidation,
} from '@/shifts/types';
import { useOwnShifts } from '@/shifts/useShifts';
import type { ShiftTimes } from '@/types';
import type { StringKey } from '@/i18n/strings';
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
/** How far the + button steps a break; a typed break may go up to the rule's ceiling. */
const MAX_BREAK_MINUTES = 180;

/** Why a draft cannot be sent, in the person's words. */
function reasonKey(verdict: ShiftValidation): StringKey {
  if (verdict.ok) return 'myHoursBody';
  return verdict.reason === 'breakTooLong' || verdict.reason === 'badBreak'
    ? 'shErrBreak'
    : verdict.reason === 'tooLong'
      ? 'shErrTooLong'
      : verdict.reason === 'tooShort'
        ? 'shErrRange'
        : 'myHoursBody';
}

/**
 * Where a field starts stepping from the first time it is touched. These are
 * not defaults on the form — the field reads "--:--" until then; they are just
 * a sensible place to begin counting, so nobody taps + eighty times.
 */
const FIRST_TOUCH = { start: 18 * 60, end: 22 * 60, break: 0 };

/**
 * The employee enters their own working time here: start, end, break. The app
 * derives the effective hours; the manager reviews and locks.
 *
 * Two ways in. `/hours` is the night entry — tonight or the one before. With
 * `?shift=<id>` it opens ONE exact shift, pinned to its own night: the one a
 * notification named, or a row in the log below. That is how a shift sent
 * back on a night the picker can no longer reach gets corrected and sent
 * again; before it existed, the release test found such a shift visible in
 * the log and reachable from nowhere.
 */
/** Clock time of the submission, so the manager sees when it came in. */
function submittedAtNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function MyHoursPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, num, dateFor, day, language } = useI18n();
  const shift = useShiftLabel();
  const previousShift = usePreviousShiftLabel();
  const { show } = useToast();
  const navigate = useNavigate();

  // The shift a notification or a log row asked for, if any. Demo mode has no
  // ids to open and ignores it; the hook only reads it when it is enabled.
  const [params] = useSearchParams();
  /* An absent parameter and a present-but-empty one are the same request:
     open the night form. URLSearchParams returns '' for `?shift=`, which is
     not null, and would otherwise pin the screen to a shift that can never
     arrive — a loading state with no shift, no picker and no button. */
  const focusId = params.get('shift')?.trim() || null;

  // Real mode reads and writes Supabase; demo mode keeps the Phase 1 reducer.
  const api = useOwnShifts({ focusId });
  const real = api.enabled;
  const pinned = real && focusId !== null;
  const focus = api.focused;

  const employeeId = state.session.employeeId;
  const submission = state.submissions[employeeId];

  /**
   * Which night is being entered. Real mode offers tonight or the one before;
   * a pinned shift brings its own night, exactly as the database derived it.
   */
  const [dayOffset, setDayOffset] = useState<0 | -1>(0);
  const businessDate = pinned
    ? (focus.shift?.workDate ?? null)
    : api.businessDate
      ? addDays(api.businessDate, dayOffset)
      : null;

  /** The shift already filed for that night, if any — or the pinned one. */
  const existing: Shift | null = useMemo(() => {
    if (!real) return null;
    if (pinned) return focus.shift;
    if (!businessDate) return null;
    return api.shifts.find((s) => s.workDate === businessDate) ?? null;
  }, [real, pinned, focus.shift, businessDate, api.shifts]);

  const locked = real ? Boolean(existing?.locked) : Boolean(submission?.locked);
  const reviewed = real && existing?.status === 'approved';

  /**
   * A submitted shift that still carries a review was sent back once and then
   * corrected: the employee may not clear the review columns, so their
   * presence on a submitted row IS the resubmission. The status is current;
   * the review is history and is labelled as such below.
   */
  const resubmitted =
    real && existing?.status === 'submitted' && existing.reviewedAt !== null;

  // Real mode starts empty and is seeded from the filed shift by the effect
  // below; the reducer's submission is demo state and must not paint even for
  // one frame under a real account.
  const [draft, setDraft] = useState<HoursDraft>(() =>
    !real && submission
      ? {
          startMinutes: submission.startMinutes,
          endMinutes: submission.endMinutes,
          breakMinutes: submission.breakMinutes,
        }
      : { startMinutes: null, endMinutes: null, breakMinutes: null },
  );
  const [field, setField] = useState<Field>('start');

  // Seed the form from the filed shift when one arrives or the night changes.
  useEffect(() => {
    if (!real) return;
    setDraft(
      existing
        ? {
            startMinutes: existing.startMinutes,
            endMinutes: existing.endMinutes,
            breakMinutes: existing.breakMinutes,
          }
        : { startMinutes: null, endMinutes: null, breakMinutes: null },
    );
    // businessDate is a dependency on purpose: switching nights with nothing
    // filed for either must clear the form. Without it, hours typed for
    // tonight stay on screen under last night's heading and would be sent
    // for the wrong night.
  }, [
    real,
    businessDate,
    existing?.id,
    existing?.startMinutes,
    existing?.endMinutes,
    existing?.breakMinutes,
  ]);

  const complete = draft.startMinutes !== null && draft.endMinutes !== null;
  const times: ShiftTimes | null = complete
    ? {
        startMinutes: draft.startMinutes as number,
        endMinutes: draft.endMinutes as number,
        breakMinutes: draft.breakMinutes ?? 0,
      }
    : null;
  /* The same checks the database makes, run on every keystroke: the effective
     time shows only while the entry is valid, so a break longer than the shift
     reads "—" instead of a made-up figure, and the button explains why. */
  const verdict: ShiftValidation | null = times ? validateDraft(draft) : null;
  const effective = verdict?.ok ? verdict.workedMinutes : null;

  /**
   * Direct entry. Start and end are typed as wall-clock times; the end is
   * placed on the right side of midnight by endMinutesFor(), and re-placed
   * when the start moves, so "18:00 → 02:00" is one overnight shift and never
   * a negative one. The break is minutes, clamped to what the rule allows.
   */
  const setStart = (value: string) => {
    if (locked || reviewed) return;
    const wall = value === '' ? null : parseClock(value);
    if (value !== '' && wall === null) return;
    setDraft((current) => ({
      ...current,
      startMinutes: wall,
      endMinutes:
        current.endMinutes === null || wall === null
          ? current.endMinutes
          : endMinutesFor(wall, current.endMinutes),
    }));
  };
  const setEnd = (value: string) => {
    if (locked || reviewed) return;
    const wall = value === '' ? null : parseClock(value);
    if (value !== '' && wall === null) return;
    setDraft((current) => ({
      ...current,
      endMinutes: wall === null ? null : endMinutesFor(current.startMinutes, wall),
    }));
  };
  const setBreak = (value: string) => {
    if (locked || reviewed) return;
    if (value === '') {
      setDraft((current) => ({ ...current, breakMinutes: null }));
      return;
    }
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return;
    setDraft((current) => ({
      ...current,
      breakMinutes: Math.min(MAX_BREAK_TOTAL, Math.max(0, Math.round(minutes))),
    }));
  };

  const bump = (direction: 1 | -1) => {
    if (locked || reviewed) {
      show(t(reviewed ? 'shErrReviewed' : 'hoursLockedBody'));
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

  /**
   * The three fields are real inputs wearing the value's own typography: a
   * time input for start and end (the phone opens its clock, a keyboard types
   * digits), a numeric input for the break. What each shows is the same text
   * the field showed before, and the − / + buttons still step whichever one
   * was touched last.
   */
  const fields: Array<{
    key: Field;
    label: string;
    kind: 'time' | 'minutes';
    value: string;
    empty: boolean;
    onChange: (value: string) => void;
  }> = [
    {
      key: 'start',
      label: t('startT'),
      kind: 'time',
      value: draft.startMinutes === null ? '' : formatClock(draft.startMinutes),
      empty: draft.startMinutes === null,
      onChange: setStart,
    },
    {
      key: 'end',
      label: t('endT'),
      kind: 'time',
      value: draft.endMinutes === null ? '' : formatClock(draft.endMinutes),
      empty: draft.endMinutes === null,
      onChange: setEnd,
    },
    {
      key: 'break',
      label: t('breakT'),
      kind: 'minutes',
      value: draft.breakMinutes === null ? '' : String(draft.breakMinutes),
      empty: draft.breakMinutes === null,
      onChange: setBreak,
    },
  ];

  /**
   * Recent shifts. In real mode these are the rows the database returned, with
   * the status it stores and the worked minutes it computed — the client never
   * recalculates either. A row the employee policy still lets them change —
   * not locked, not approved — opens in the form above, pinned to its night;
   * an approved or locked one is the manager's and stays inert.
   */
  const log = real
    ? api.shifts.slice(0, 6).map((entry) => ({
        id: entry.id,
        date: day(new Date(`${entry.workDate}T12:00:00`)),
        // The status the database stores, a lock if the manager set one, and
        // the manager's note when the shift was sent back — so a night older
        // than the two the picker can open still explains itself here.
        meta: `${formatClock(entry.startMinutes)} – ${formatClock(entry.endMinutes)} · ${t(
          'breakT',
        )} ${entry.breakMinutes} ${t('minutesShort')} · ${t(SHIFT_STATUS_LABEL[entry.status])}${
          entry.status === 'submitted' && entry.reviewedAt !== null ? ` · ${t('shResubmitted')}` : ''
        }${entry.locked ? ` · ${t('shLockedShort')}` : ''}${
          entry.status === 'rejected' && entry.reviewNote ? ` · ${entry.reviewNote}` : ''
        }`,
        hours: num(entry.workedMinutes / 60, 2),
        status: t(SHIFT_STATUS_LABEL[entry.status]),
        statusColor:
          entry.status === 'approved'
            ? 'var(--color-money)'
            : entry.status === 'rejected'
              ? 'var(--color-text-subtle)'
              : 'var(--color-accent)',
        open: !entry.locked && entry.status !== 'approved',
      }))
    : state.distributions.slice(1, 5).map((distribution) => {
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
          status: undefined as string | undefined,
          statusColor: undefined as string | undefined,
          open: false,
        };
      });

  /**
   * What the banner says about the selected night.
   *
   * Real mode reads the shift's stored status and, when the manager sent it
   * back, the note they wrote — the one piece of the review an employee is
   * meant to act on. The lock wins over everything else because it is the
   * state that decides whether the form above can be used at all. Once the
   * shift has been sent again, the note is no longer the status: it is shown
   * under its own label as the earlier note, and the status says "submitted".
   * Demo mode keeps its Phase 1 wording exactly.
   */
  const banner: {
    icon: IconName;
    color: string;
    title: string;
    body: string;
    note?: string | null;
    noteLabel?: string;
  } = real
    ? locked
      ? {
          // A locked shift that was sent back is both things at once, and
          // the note still explains what to fix once the manager unlocks it.
          icon: 'lock-simple',
          color: 'var(--color-text-secondary)',
          title: existing?.status === 'rejected' ? t('shRejectedLocked') : t('hoursLocked'),
          body: t('hoursLockedBody'),
          note: existing?.status === 'rejected' ? existing.reviewNote : null,
        }
      : !existing
        ? {
            icon: 'paper-plane-tilt',
            color: 'var(--color-accent)',
            title: t('notSubmitted'),
            body: t('myHoursBody'),
          }
        : existing.status === 'rejected'
          ? {
              icon: 'warning-circle',
              color: 'var(--color-accent)',
              title: t('shRejectedTitle'),
              body: t('shRejectedBody'),
              note: existing.reviewNote,
            }
          : existing.status === 'approved'
            ? {
                icon: 'check-circle',
                color: 'var(--color-money)',
                title: t('shStatusApproved'),
                body: t('shApprovedBody'),
              }
            : resubmitted
              ? {
                  icon: 'clock',
                  color: 'var(--color-accent)',
                  title: t('shResubmittedTitle'),
                  body: t('shResubmittedBody'),
                  note: existing.reviewNote,
                  noteLabel: t('shPrevNoteLabel'),
                }
              : existing.status === 'submitted'
                ? {
                    icon: 'clock',
                    color: 'var(--color-accent)',
                    title: t('shStatusSubmitted'),
                    body: t('shSubmittedBody'),
                  }
                : {
                    icon: 'paper-plane-tilt',
                    color: 'var(--color-accent)',
                    title: t('shStatusDraft'),
                    body: t('myHoursBody'),
                  }
    : locked
      ? {
          icon: 'lock-simple',
          color: 'var(--color-text-secondary)',
          title: t('hoursLocked'),
          body: t('hoursLockedBody'),
        }
      : {
          icon: submission ? 'lock-simple-open' : 'paper-plane-tilt',
          color: 'var(--color-accent)',
          title: submission ? t('hoursUnlocked') : t('notSubmitted'),
          body: t('myHoursBody'),
        };

  /** Send the shift. Validation first, so a round trip is not wasted on 24:00. */
  const sendShift = async () => {
    const check = validateDraft(draft);
    if (!check.ok) {
      show(t(reasonKey(check)));
      return;
    }
    if (!businessDate) {
      show(t('bdFailed'));
      return;
    }

    const result = await api.submit(
      {
        businessDate,
        startMinutes: draft.startMinutes as number,
        endMinutes: draft.endMinutes as number,
        breakMinutes: draft.breakMinutes ?? 0,
      },
      existing?.id,
    );

    if (!result.ok) {
      show(t(SHIFT_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    show(t('hoursSent'));
    // A pinned shift stays on screen, now reading "submitted again": that is
    // the confirmation the person came for. The night entry goes home as before.
    if (!pinned) navigate('/home');
  };

  /** The pinned shift's night, once it is known; the usual label otherwise. */
  const kicker = pinned
    ? existing
      ? day(new Date(`${existing.workDate}T12:00:00`))
      : undefined
    : shift.full;

  return (
    <Screen
      title={t('myHoursTitle')}
      kicker={kicker}
      back={pinned ? 'arrow' : false}
      aboveTabs
      cta={
        /* A locked or approved shift is the manager's to change. Real mode
           offers no button for it — there is no request-a-change workflow in
           the backend, and a toast pretending otherwise would be a lie. The
           banner below says who to talk to. A rejected shift keeps the button:
           correcting it and submitting again is the existing policy, and the
           label says so. Nothing is offered for a pinned shift that has not
           arrived, or that turned out not to be this person's. */
        pinned && focus.status !== 'ready'
          ? undefined
          : real && !businessDate
            ? /* Which night this is comes from the server (migration 33). Until
                 it has answered, nothing is filed; if it failed, the button is
                 the retry. */
              {
                label: api.businessDayStatus === 'error' ? t('retry') : t('bdLoading'),
                muted: api.businessDayStatus !== 'error',
                onClick: () => {
                  if (api.businessDayStatus === 'error') void api.refreshBusinessDay();
                },
              }
            : real && (locked || reviewed)
              ? undefined
              : locked || reviewed
                ? { label: t('requestChange'), onClick: () => show(t('changeRequested')) }
                : {
                    label: api.busy
                      ? t('shSaving')
                      : real && existing
                        ? existing.status === 'rejected'
                          ? t('shResubmit')
                          : t('hoursUpdate')
                        : !real && submission
                          ? t('hoursUpdate')
                          : t('hoursSubmit'),
                    muted: !verdict?.ok || api.busy,
                    onClick: () => {
                      if (!times) {
                        show(t('myHoursBody'));
                        return;
                      }
                      if (verdict && !verdict.ok) {
                        show(t(reasonKey(verdict)));
                        return;
                      }
                      if (real) {
                        void sendShift();
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

      {pinned && focus.status !== 'ready' ? (
        /* The shift was asked for by id. Until it is here there is no night
           to pin and nothing to seed; if it is not this person's in this
           workplace — or never was — the answer is "not available", the
           same for both, never a hint about somebody else's row. */
        focus.status === 'notFound' ? (
          <>
            <EmptyState title={t('shNotFoundTitle')}>{t('shNotFoundBody')}</EmptyState>
            <Button variant="secondary" block onClick={() => navigate('/hours', { replace: true })}>
              {t('shBackToHours')}
            </Button>
          </>
        ) : focus.status === 'error' ? (
          <>
            <EmptyState title={t('loadFailed')} />
            <Button variant="secondary" block onClick={() => void api.refreshFocused()}>
              {t('retry')}
            </Button>
          </>
        ) : (
          <EmptyState title={t('shLoading')} />
        )
      ) : (
        <>
          {/* Same control, real nights. Yesterday is selectable in real mode
              because submitting last night's hours in the morning is normal.
              A pinned shift has its own night and no picker. */}
          {pinned ? null : (
            <SegmentedControl
              label={t('pickShift')}
              value={real ? (dayOffset === 0 ? 'today' : 'yesterday') : 'sat22'}
              options={
                real
                  ? [
                      { value: 'today', label: t('shTonight') },
                      { value: 'yesterday', label: t('shYesterday') },
                    ]
                  : [
                      { value: 'sat22', label: shift.short },
                      {
                        value: 'fri21',
                        label: previousShift,
                        disabledReason:
                          language === 'Deutsch'
                            ? 'Ältere Schichten sind abgeschlossen'
                            : 'Earlier shifts are closed',
                      },
                    ]
              }
              onChange={(value, option) => {
                if (option.disabledReason) {
                  show(option.disabledReason);
                  return;
                }
                if (real) setDayOffset(value === 'today' ? 0 : -1);
              }}
            />
          )}

          <Card tone={locked ? 'default' : 'primary'} padding="roomy">
            <div className={ui.stack} style={{ gap: 14 }}>
              <div className={styles.draftFields} role="group" aria-label={t('effectiveTime')}>
                {fields.map((entry) => (
                  <label
                    key={entry.key}
                    className={`${styles.draftField} ${
                      field === entry.key ? styles.draftFieldActive : ''
                    }`}
                  >
                    <span className={styles.draftLabel}>{entry.label}</span>
                    <span className={styles.draftValueRow}>
                      {entry.kind === 'time' ? (
                        <input
                          type="time"
                          className={`${styles.draftValue} ${styles.draftInput} tabular`}
                          style={entry.empty ? { color: 'var(--color-text-faint)' } : undefined}
                          value={entry.value}
                          readOnly={locked || reviewed}
                          onFocus={() => setField(entry.key)}
                          onChange={(event) => entry.onChange(event.target.value)}
                          aria-label={entry.label}
                        />
                      ) : (
                        <>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={MAX_BREAK_TOTAL}
                            step={1}
                            placeholder="—"
                            className={`${styles.draftValue} ${styles.draftInput} tabular`}
                            value={entry.value}
                            readOnly={locked || reviewed}
                            onFocus={() => setField(entry.key)}
                            onChange={(event) => entry.onChange(event.target.value)}
                            aria-label={`${entry.label} (${t('minutesShort')})`}
                          />
                          <span className={styles.draftUnit}>{t('minutesShort')}</span>
                        </>
                      )}
                    </span>
                  </label>
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
              <Icon name={banner.icon} size={19} color={banner.color} />
              <div className={ui.rowMain}>
                <p style={{ fontSize: 14, fontWeight: 500, color: banner.color }}>{banner.title}</p>
                <p className={ui.note} style={{ marginTop: 2 }}>
                  {banner.body}
                </p>
                {banner.note ? (
                  <p className={ui.note} style={{ marginTop: 6, color: 'var(--color-text)' }}>
                    {`${banner.noteLabel ?? t('shNoteLabel')}: ${banner.note}`}
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        </>
      )}

      <div className={ui.stackFlush}>
        <SectionLabel>{t('recent')}</SectionLabel>
        {real && api.status === 'loading' ? <EmptyState title={t('shLoading')} /> : null}
        {real && api.status === 'error' ? (
          <>
            <EmptyState title={t('loadFailed')} />
            <Button variant="secondary" block onClick={() => void api.refresh()}>
              {t('retry')}
            </Button>
          </>
        ) : null}
        {log.length === 0 && !(real && (api.status === 'loading' || api.status === 'error')) ? (
          <EmptyState title={t('emptyShifts')} />
        ) : null}
        {log.map((entry) => (
          <ListRow
            key={entry.id}
            title={entry.date}
            meta={entry.meta}
            metaColor={entry.statusColor}
            strong={pinned && entry.id === focusId}
            chevron={entry.open}
            onClick={entry.open ? () => navigate(`/hours?shift=${entry.id}`) : undefined}
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
