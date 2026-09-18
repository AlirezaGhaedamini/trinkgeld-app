import { Screen } from '@/components/layout/Screen';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { Note } from '@/components/ui/Note';
import { MIN_OVERLAP_CHOICES } from '@/data/workplace';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { useToast } from '@/hooks/useToast';
import { RuleSectionScreen } from '@/rules/RuleSectionScreen';
import ui from '@/components/ui/ui.module.css';

/**
 * Settings → Minimum shared time: how long two shifts must overlap before the
 * two people share tips.
 *
 * The Rules screen's chips and both of its notes, including the boundary the
 * engine keeps — exactly the chosen number of minutes counts, one minute less
 * does not. A version already carrying a value outside the standard choices
 * keeps it as a chip of its own, so opening a draft never changes it silently.
 */
export function SettingsMinOverlapPage() {
  const editor = useRuleEditor();
  return editor.rules.enabled ? <RealMinOverlap /> : <DemoMinOverlap />;
}

function RealMinOverlap() {
  const { t } = useI18n();
  const { editing, minOverlap, setMinOverlap, nudge } = useRuleEditor();

  return (
    <RuleSectionScreen title={t('minOverlapRule')}>
      <div className={ui.stackTight}>
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
              nudge();
              return;
            }
            setMinOverlap(Number(value));
          }}
        />
        <Note>{t('minOverlapNote')}</Note>
        <Note>{t('minOverlapExact')}</Note>
      </div>
    </RuleSectionScreen>
  );
}

/* ── demo mode — unchanged local state, no Supabase call ──────────────────── */

function DemoMinOverlap() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const { show } = useToast();

  return (
    <Screen title={t('minOverlapRule')} kicker={state.workplace.name} backTo="/manager/settings">
      <div className={ui.stackTight}>
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
    </Screen>
  );
}
