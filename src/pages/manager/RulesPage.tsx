import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { InfoNote, Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Toggle } from '@/components/ui/Toggle';
import { AREA_ORDER, iconForAreaKey } from '@/data/areas';
import { MIN_OVERLAP_CHOICES } from '@/data/workplace';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { RULE_FAILURE_KEY } from '@/rules/errors';
import { useRules } from '@/rules/useRules';
import {
  METHODS as REAL_METHODS,
  SUPPORTED_BASES,
  allocated as sumShares,
  strandedMembers,
  type AreaShare,
  type DraftPatch,
  type OverlapBasis,
  type RuleMethod,
} from '@/rules/types';
import type { DistributionMethod } from '@/types';
import type { StringKey } from '@/i18n/strings';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

const METHODS: DistributionMethod[] = ['mPoints', 'mHours', 'mEqual'];

/** The real enum → the copy keys the prototype already ships. */
const METHOD_KEY: Record<RuleMethod, StringKey> = {
  hours_points: 'mPoints',
  hours: 'mHours',
  equal: 'mEqual',
};
const METHOD_NOTE_KEY: Record<RuleMethod, StringKey> = {
  hours_points: 'mPointsD',
  hours: 'mHoursD',
  equal: 'mEqualD',
};
const BASIS_KEY: Record<string, StringKey> = {
  pairwise: 'basisPairwise',
  longest_shift: 'basisLongest',
};
const BASIS_NOTE_KEY: Record<string, StringKey> = {
  pairwise: 'basisPairwiseD',
  longest_shift: 'basisLongestD',
};

/**
 * The workplace's distribution rules — manager only.
 *
 * In real mode this is a version editor, not a settings screen. The active
 * version is read-only by construction (the database freezes everything past
 * draft); pressing "Edit the rules" opens the workplace's draft through
 * create_rule_draft(), and nothing the manager changes reaches a distribution
 * until activate_rule() succeeds.
 */
export function RulesPage() {
  const rules = useRules();
  return rules.enabled ? <RealRules /> : <DemoRules />;
}

/* ── real mode ────────────────────────────────────────────────────────────── */

function RealRules() {
  const rules = useRules();
  const { t, num, percent, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const state = rules.state;
  const active = state?.active ?? null;
  const draft = state?.draft ?? null;

  /** The version on screen: the draft while one is open, otherwise the active one. */
  const shown = draft ?? active;
  const editing = Boolean(draft);

  const [shares, setShares] = useState<Record<string, number>>({});
  const [basis, setBasis] = useState<OverlapBasis>('longest_shift');
  const [method, setMethod] = useState<RuleMethod>('hours_points');
  const [minOverlap, setMinOverlap] = useState(15);
  const [roundingAreaId, setRoundingAreaId] = useState<string | null>(null);
  const [ack, setAck] = useState(true);

  /* Local edits are seeded from whichever version is shown, and re-seeded
     whenever the draft is opened, saved or discarded. */
  useEffect(() => {
    if (!shown) return;
    const next: Record<string, number> = {};
    for (const share of shown.shares) next[share.areaId] = share.percentage;
    setShares(next);
    setBasis(shown.overlapBasis);
    setMethod(shown.method);
    setMinOverlap(shown.minOverlapMinutes);
    setRoundingAreaId(shown.roundingAreaId);
    setAck(shown.acknowledgementRequired);
  }, [shown]);

  const poolAreas = useMemo(
    () => (shown?.shares ?? []).filter((s) => s.isPoolEligible),
    [shown],
  );

  const liveShares: AreaShare[] = useMemo(
    () =>
      (shown?.shares ?? []).map((s) => ({
        ...s,
        percentage: s.isPoolEligible ? (shares[s.areaId] ?? 0) : 0,
      })),
    [shown, shares],
  );

  const total = sumShares(liveShares);
  const balanced = total === 100;
  const stranded = strandedMembers(state?.members ?? [], liveShares);

  const patch = (): DraftPatch => ({
    method,
    minOverlapMinutes: minOverlap,
    overlapBasis: basis,
    roundingAreaId,
    acknowledgementRequired: ack,
    shares: liveShares.map((s) => ({
      areaId: s.areaId,
      areaKey: s.areaKey,
      percentage: s.percentage,
    })),
  });

  const openDraft = async () => {
    const result = await rules.openDraft();
    if (!result.ok) show(t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const activate = async () => {
    if (!draft) return;
    if (!balanced) {
      show(t('dErrShares'));
      return;
    }
    const result = await rules.saveAndActivate(draft.id, patch());
    if (!result.ok) {
      show(t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    show(`${t('ruleActivated')} · ${t('ruleVersion')} ${result.value ?? ''}`.trim());
  };

  const discard = async () => {
    if (!draft) return;
    const result = await rules.discardDraft(draft.id);
    show(result.ok ? t('ruleDiscarded') : t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const hint = balanced
    ? t('hintOK')
    : total < 100
      ? `${percent(100 - total)} ${t('hintUnder')}`
      : `${percent(total - 100)} ${t('hintOver')}`;

  const cta = editing
    ? {
        label: t('ruleActivateCta'),
        muted: !balanced || rules.busy,
        note: hint,
        noteColor: balanced ? 'var(--color-accent)' : 'var(--color-text)',
        onClick: () => (balanced ? void activate() : show(hint)),
        secondary: { label: t('ruleDiscard'), onClick: () => void discard() },
      }
    : {
        label: t('ruleEdit'),
        muted: rules.busy,
        onClick: () => void openDraft(),
      };

  const areaName = (areaId: string | null) =>
    (shown?.shares ?? []).find((s) => s.areaId === areaId)?.areaName ?? '—';

  if (rules.status === 'error') {
    return (
      <Screen title={t('rules')} titleSize={26} back={false} aboveTabs>
        <EmptyState title={t('authNetwork')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('rules')}
      kicker={shown ? undefined : t('workplace')}
      titleSize={26}
      back={false}
      aboveTabs
      cta={rules.status === 'ready' ? cta : undefined}
    >
      {/* ── which version is in force ───────────────────────────────────── */}
      <Card padding="padded">
        <div className={ui.spread}>
          <span className={ui.rowTitle}>{t('ruleActive')}</span>
          {active ? (
            <Badge tone="quiet">
              {t('ruleVersion')} {active.version}
            </Badge>
          ) : null}
        </div>
        {active ? (
          <p className={ui.rowMeta} style={{ marginTop: 4 }}>
            {t('ruleActivatedOn')}{' '}
            {active.effectiveFrom
              ? new Intl.DateTimeFormat(language === 'Deutsch' ? 'de-DE' : 'en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }).format(new Date(active.effectiveFrom))
              : '—'}
            {' · '}
            {t(BASIS_KEY[active.overlapBasis] ?? 'basisLongest')}
            {' · '}
            {active.minOverlapMinutes} {t('minutesShort')}
            {' · '}
            {t(METHOD_KEY[active.method])}
          </p>
        ) : (
          <p className={ui.rowMeta} style={{ marginTop: 4 }}>
            {t('ruleNoActive')}
          </p>
        )}
      </Card>

      {editing ? (
        <Card padding="padded" tone="warning">
          <div className={ui.spread}>
            <span className={ui.rowTitle}>{t('ruleDraftTitle')}</span>
            <Badge>{t('ruleVersion')} {(active?.version ?? 0) + 1}</Badge>
          </div>
          <p className={ui.rowMeta} style={{ marginTop: 4 }}>
            {t('ruleDraftBody')}
          </p>
        </Card>
      ) : null}

      {/* ── areas in the pool ───────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('areasInPool')}</SectionLabel>
        {editing
          ? poolAreas.map((entry) => {
              const share = shares[entry.areaId] ?? 0;
              const on = share > 0;
              const sliderId = `rule-share-${entry.areaId}`;
              return (
                <Card
                  key={entry.areaId}
                  padding="none"
                  className={styles.areaCard}
                  tone={on ? 'default' : 'faint'}
                >
                  <div className={ui.inline}>
                    <button
                      type="button"
                      className={styles.areaIcon}
                      style={{
                        background: on ? 'var(--color-tint)' : 'var(--color-card)',
                        color: on ? 'var(--color-accent)' : 'var(--color-text-faint)',
                      }}
                      onClick={() =>
                        setShares((current) => ({
                          ...current,
                          [entry.areaId]: (current[entry.areaId] ?? 0) > 0 ? 0 : 10,
                        }))
                      }
                      aria-label={`${entry.areaName} — ${on ? t('excluded') : t('included')}`}
                      aria-pressed={on}
                    >
                      <Icon name={iconForAreaKey(entry.areaKey)} size={17} />
                    </button>
                    <span className={ui.rowMain}>
                      <label
                        htmlFor={sliderId}
                        className={`${ui.rowTitle} ${ui.rowTitleStrong}`}
                        style={{ color: on ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
                      >
                        {entry.areaName}
                      </label>
                    </span>
                    <span className={`${styles.areaPercent} tabular`}>{percent(share)}</span>
                  </div>
                  <input
                    id={sliderId}
                    className={ui.range}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={share}
                    onChange={(event) =>
                      setShares((current) => ({
                        ...current,
                        [entry.areaId]: Number(event.target.value),
                      }))
                    }
                  />
                </Card>
              );
            })
          : (
              <Card padding="none" clip>
                {poolAreas.map((entry) => {
                  const on = entry.percentage > 0;
                  return (
                    <div key={entry.areaId} className={ui.insetRow}>
                      <span
                        className={`${ui.rowMain} ${ui.rowTitle}`}
                        style={{ color: on ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
                      >
                        {entry.areaName}
                      </span>
                      <span className={`${ui.rowValue} tabular`}>
                        {on ? percent(entry.percentage) : '—'}
                      </span>
                    </div>
                  );
                })}
              </Card>
            )}
        <Note>{t('mustTotal')}</Note>
        {stranded.count > 0 ? (
          <InfoNote icon="warning-circle">
            {stranded.count}{' '}
            {stranded.count === 1 ? t('zeroShareWarn1') : t('zeroShareWarnN')}
            {stranded.areaNames.length > 0 ? ` (${stranded.areaNames.join(', ')})` : ''}
          </InfoNote>
        ) : null}
        <Note>{t('emptyAreaExplain')}</Note>
      </div>

      {/* ── how overlap is measured ─────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('ruleBasis')}</SectionLabel>
        <Card padding="none" clip>
          {SUPPORTED_BASES.map((option) => (
            <button
              key={option}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
              onClick={() => (editing ? setBasis(option) : show(t('ruleEdit')))}
              aria-pressed={basis === option}
              disabled={!editing && basis !== option}
            >
              <RadioDot on={basis === option} />
              <span className={ui.rowMain}>
                <span className={ui.rowTitle}>{t(BASIS_KEY[option])}</span>
                <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                  {t(BASIS_NOTE_KEY[option])}
                </span>
              </span>
            </button>
          ))}
        </Card>
      </div>

      {/* ── within an area ──────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('withinArea')}</SectionLabel>
        <Card padding="none" clip>
          {REAL_METHODS.map((option) => (
            <button
              key={option}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
              onClick={() => (editing ? setMethod(option) : show(t('ruleEdit')))}
              aria-pressed={method === option}
              disabled={!editing && method !== option}
            >
              <RadioDot on={method === option} />
              <span className={ui.rowMain}>
                <span className={ui.rowTitle}>{t(METHOD_KEY[option])}</span>
                <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                  {t(METHOD_NOTE_KEY[option])}
                </span>
              </span>
            </button>
          ))}
        </Card>
      </div>

      {/* ── minimum overlap ─────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('minOverlapRule')}</SectionLabel>
        <ChipGroup
          fill
          label={t('minOverlapRule')}
          value={String(minOverlap)}
          options={(MIN_OVERLAP_CHOICES.includes(minOverlap)
            ? MIN_OVERLAP_CHOICES
            : [...MIN_OVERLAP_CHOICES, minOverlap].sort((a, b) => a - b)
          ).map((minutes) => ({
            value: String(minutes),
            label: `${minutes} ${t('minutesShort')}`,
          }))}
          onChange={(value) => {
            if (!editing) {
              show(t('ruleEdit'));
              return;
            }
            setMinOverlap(Number(value));
          }}
        />
        <Note>{t('minOverlapNote')}</Note>
        <Note>{t('minOverlapExact')}</Note>
      </div>

      {/* ── the remaining rule settings, and the two pushed screens ─────── */}
      <Card padding="none" clip>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() => {
            if (!editing) {
              show(t('ruleEdit'));
              return;
            }
            const eligible = poolAreas;
            if (eligible.length === 0) return;
            const index = eligible.findIndex((a) => a.areaId === roundingAreaId);
            const next = eligible[(index + 1) % eligible.length];
            setRoundingAreaId(next.areaId);
          }}
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('rr1')}</span>
          <span className={ui.rowValue}>{areaName(roundingAreaId)}</span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() => (editing ? setAck((value) => !value) : show(t('ruleEdit')))}
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('rr2')}</span>
          <span className={ui.rowValue}>{ack ? t('rr2v') : t('rr2v2')}</span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() => navigate('/manager/rules/roles')}
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('rolePointsTitle')}</span>
          <span className={ui.rowValue}>
            {state?.roles.length ? `×${num(state.roles[0].points, 1)}…` : '—'}
          </span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() => navigate('/manager/rules/workplace')}
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('wsTitle')}</span>
          <span className={ui.rowValue}>{state?.settings.timezone ?? '—'}</span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
      </Card>
    </Screen>
  );
}

/* ── demo mode — unchanged local state, no Supabase call ──────────────────── */

function DemoRules() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, num, percent, area, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const german = language === 'Deutsch';

  return (
    <Screen
      title={t('rules')}
      kicker={state.workplace.name}
      titleSize={26}
      back={false}
      aboveTabs
    >
      <div className={ui.stackTight}>
        <SectionLabel>{t('areasInPool')}</SectionLabel>
        <Card padding="none" clip>
          {AREA_ORDER.map((areaId) => {
            const share = state.rule.areaShares[areaId] ?? 0;
            const on = share > 0;
            return (
              <div key={areaId} className={ui.insetRow}>
                <span
                  className={`${ui.rowMain} ${ui.rowTitle}`}
                  style={{ color: on ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
                >
                  {area(areaId)}
                </span>
                <span className={ui.rowValue}>{on ? percent(share) : '—'}</span>
                <Toggle
                  on={on}
                  label={area(areaId)}
                  onChange={() => dispatch({ type: 'toggleRuleArea', area: areaId })}
                />
              </div>
            );
          })}
        </Card>
        <button
          type="button"
          className={ui.insetRow}
          style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--ring)', minHeight: 48 }}
          onClick={() => show(t('addAreaToast'))}
        >
          <Icon name="plus" size={16} color="var(--color-accent)" />
          <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{t('addArea')}</span>
        </button>
        <Note>{t('mustTotal')}</Note>
      </div>

      <div className={ui.stackTight}>
        <SectionLabel>{t('withinArea')}</SectionLabel>
        <Card padding="none" clip>
          {METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
              onClick={() => dispatch({ type: 'setMethod', method })}
              aria-pressed={state.draft.method === method}
            >
              <RadioDot on={state.draft.method === method} />
              <span className={ui.rowMain}>
                <span className={ui.rowTitle}>{t(method)}</span>
                <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                  {t(`${method}D`)}
                </span>
              </span>
            </button>
          ))}
        </Card>
      </div>

      <div className={ui.stackTight}>
        <SectionLabel>{t('minOverlapRule')}</SectionLabel>
        <ChipGroup
          fill
          label={t('minOverlapRule')}
          value={String(state.rule.minOverlapMinutes)}
          options={MIN_OVERLAP_CHOICES.map((minutes) => ({
            value: String(minutes),
            label: `${minutes} ${t('minutesShort')}`,
          }))}
          onChange={(value) => {
            dispatch({ type: 'setMinOverlap', minutes: Number(value) });
            show(`${t('minOverlapRule')} · ${value} ${t('minutesShort')}`);
          }}
        />
        <Note>{t('minOverlapNote')}</Note>
      </div>

      <Card padding="none" clip>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() =>
            show(
              german ? 'Rundungsrest geht an Service' : 'Rounding leftover goes to Service',
            )
          }
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('rr1')}</span>
          <span className={ui.rowValue}>{area(state.rule.roundingArea)}</span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() => dispatch({ type: 'toggleAcknowledgementRequired' })}
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('rr2')}</span>
          <span className={ui.rowValue}>
            {state.rule.acknowledgementRequired ? t('rr2v') : t('rr2v2')}
          </span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
        <button
          type="button"
          className={`${ui.insetRow} ${ui.insetRowInteractive}`}
          onClick={() => navigate('/manager/team')}
        >
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('rr3')}</span>
          <span className={ui.rowValue}>×{num(0.5, 1)}</span>
          <Icon name="caret-right" size={13} className={ui.chevron} />
        </button>
      </Card>
    </Screen>
  );
}
