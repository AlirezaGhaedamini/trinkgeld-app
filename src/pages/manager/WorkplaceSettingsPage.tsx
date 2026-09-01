import { useEffect, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoNote, Lede, Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Toggle } from '@/components/ui/Toggle';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { RULE_FAILURE_KEY } from '@/rules/errors';
import { useRules } from '@/rules/useRules';
import type { PeerVisibility, WorkplaceSettings } from '@/rules/types';
import type { StringKey } from '@/i18n/strings';
import ui from '@/components/ui/ui.module.css';

/**
 * The zones a German hospitality business realistically runs in, plus the two
 * that neighbour it. A free-text IANA field would let a manager brick every
 * future business-day calculation with a typo; the database's own check would
 * catch it, but only after the mistake.
 */
const TIMEZONES = [
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Warsaw',
  'Europe/London',
  'UTC',
];

/** business_day_start_hour is a smallint the database restricts to 0–12. */
const DAY_START_HOURS = [0, 3, 4, 5, 6, 7, 8];

const PEER_KEY: Record<PeerVisibility, StringKey> = {
  none: 'peerNone',
  area: 'peerArea',
  workplace: 'peerWorkplace',
};
const PEER_ORDER: PeerVisibility[] = ['none', 'area', 'workplace'];

/**
 * Workplace settings — manager only.
 *
 * Four columns on `workplaces`, all of them things the engine or the read layer
 * actually consults: the time zone and the business-day cut-off decide which
 * day a shift belongs to, and the two visibility settings are read by the
 * entries policy and the member view. Nothing here is cosmetic.
 */
export function WorkplaceSettingsPage() {
  const rules = useRules();
  const { t } = useI18n();
  const { show } = useToast();

  const saved = rules.state?.settings ?? null;
  const [draft, setDraft] = useState<WorkplaceSettings | null>(null);

  useEffect(() => {
    if (saved) setDraft({ ...saved });
  }, [saved]);

  if (!rules.enabled) {
    return (
      <Screen title={t('wsTitle')} back="arrow">
        <EmptyState title={t('ruleReadOnly')} />
      </Screen>
    );
  }

  if (!draft || !saved) {
    return (
      <Screen title={t('wsTitle')} back="arrow">
        <EmptyState title={t('dLoading')} />
      </Screen>
    );
  }

  const dirty =
    draft.timezone !== saved.timezone ||
    draft.businessDayStartHour !== saved.businessDayStartHour ||
    draft.poolAmountVisibleToMembers !== saved.poolAmountVisibleToMembers ||
    draft.peerEntryVisibility !== saved.peerEntryVisibility;

  const save = async () => {
    if (!dirty) {
      show(t('ruleUnchanged'));
      return;
    }
    const result = await rules.saveSettings(draft);
    show(result.ok ? t('wsSaved') : t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const zones = TIMEZONES.includes(draft.timezone)
    ? TIMEZONES
    : [draft.timezone, ...TIMEZONES];

  return (
    <Screen
      title={t('wsTitle')}
      back="arrow"
      cta={{ label: t('save'), muted: rules.busy || !dirty, onClick: () => void save() }}
    >
      <Lede>{t('wsPeerNote')}</Lede>

      {/* ── who sees whose amounts ──────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('wsPeer')}</SectionLabel>
        <Card padding="none" clip>
          {PEER_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              onClick={() => setDraft({ ...draft, peerEntryVisibility: option })}
              aria-pressed={draft.peerEntryVisibility === option}
            >
              <RadioDot on={draft.peerEntryVisibility === option} />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t(PEER_KEY[option])}</span>
            </button>
          ))}
        </Card>
      </div>

      {/* ── the pool total ──────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('wsPoolVisible')}</SectionLabel>
        <Card padding="none" clip>
          <div className={ui.insetRow}>
            <span className={`${ui.rowMain} ${ui.rowTitle}`}>
              {draft.poolAmountVisibleToMembers ? t('wsPoolVisibleOn') : t('wsPoolVisibleOff')}
            </span>
            <Toggle
              on={draft.poolAmountVisibleToMembers}
              label={t('wsPoolVisible')}
              onChange={() =>
                setDraft({
                  ...draft,
                  poolAmountVisibleToMembers: !draft.poolAmountVisibleToMembers,
                })
              }
            />
          </div>
        </Card>
        <Note>{t('wsPoolVisibleNote')}</Note>
      </div>

      {/* ── the business day ────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('wsDayStart')}</SectionLabel>
        <ChipGroup
          fill
          label={t('wsDayStart')}
          value={String(draft.businessDayStartHour)}
          options={DAY_START_HOURS.map((hour) => ({
            value: String(hour),
            label: `${String(hour).padStart(2, '0')}:00`,
          }))}
          onChange={(value) => setDraft({ ...draft, businessDayStartHour: Number(value) })}
        />
        <Note>{t('wsDayStartNote')}</Note>
      </div>

      {/* ── the time zone ───────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('wsTimezone')}</SectionLabel>
        <Card padding="none" clip>
          {zones.map((zone) => (
            <button
              key={zone}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              onClick={() => setDraft({ ...draft, timezone: zone })}
              aria-pressed={draft.timezone === zone}
            >
              <RadioDot on={draft.timezone === zone} />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{zone.replace('_', ' ')}</span>
            </button>
          ))}
        </Card>
        <InfoNote icon="info">{t('wsTimezoneNote')}</InfoNote>
      </div>
    </Screen>
  );
}
