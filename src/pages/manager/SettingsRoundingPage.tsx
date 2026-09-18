import { Navigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { RuleSectionScreen } from '@/rules/RuleSectionScreen';
import ui from '@/components/ui/ui.module.css';

/**
 * Settings → Rounding leftover: the tie-break for the last cents of the
 * pool → area split.
 *
 * What the engine does (calculate_distribution, migration 23, "level 1"): each
 * area first gets its share rounded DOWN to the cent; the cents left over go
 * out one each, largest rounding loss first. The rounding area only decides
 * between areas that lost exactly the same — it does not receive the leftover
 * as such. The split inside an area does not consult it. The note on screen
 * says exactly this and no more.
 *
 * The Rules screen offered this as a row that stepped to the next pool area on
 * each tap. The choices are the same — the areas the pool can pay — laid out
 * so the manager picks one instead of cycling to it. As with every rule
 * section it is read-only until a draft is open.
 *
 * The version's current value is always on screen, even when it is not one of
 * the choices: an area can be taken out of the pool after the rule was
 * activated, and the version keeps pointing at it. The overview names it, so
 * this screen does too — shown as the selected value, never offered as a
 * choice, and replaced by whichever pool area the manager picks in a draft.
 *
 * The demo has no rounding to choose (its Settings row answers with a note, as
 * it always did), so a direct link goes back to Settings.
 */
export function SettingsRoundingPage() {
  const editor = useRuleEditor();
  if (!editor.rules.enabled) return <Navigate to="/manager/settings" replace />;
  return <RealRounding />;
}

function RealRounding() {
  const { t } = useI18n();
  const { editing, poolAreas, roundingAreaId, setRoundingAreaId, nudge, areaName } =
    useRuleEditor();

  const listed = poolAreas.some((entry) => entry.areaId === roundingAreaId);
  const unlisted = roundingAreaId !== null && !listed;

  return (
    <RuleSectionScreen title={t('rr1')}>
      {unlisted || poolAreas.length > 0 ? (
        <Card padding="none" clip>
          {unlisted ? (
            <button
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              onClick={() => (editing ? undefined : nudge())}
              aria-pressed
            >
              <RadioDot on />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{areaName(roundingAreaId)}</span>
            </button>
          ) : null}
          {poolAreas.map((entry) => (
            <button
              key={entry.areaId}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              onClick={() => (editing ? setRoundingAreaId(entry.areaId) : nudge())}
              aria-pressed={roundingAreaId === entry.areaId}
              /* As in every section: with no draft open, the selected value
                 answers a tap with "Edit the rules" and the rest are inert.
                 When nothing is selected, every row answers instead, so the
                 screen never goes silent under a finger. */
              disabled={!editing && roundingAreaId !== entry.areaId && roundingAreaId !== null}
            >
              <RadioDot on={roundingAreaId === entry.areaId} />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{entry.areaName}</span>
            </button>
          ))}
        </Card>
      ) : null}
      <Note>{t('rr1Note')}</Note>
      <Note>{t('ruleFrozenNote')}</Note>
    </RuleSectionScreen>
  );
}
