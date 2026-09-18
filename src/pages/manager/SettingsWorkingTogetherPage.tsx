import { Navigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { RadioDot } from '@/components/ui/RadioDot';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { RuleSectionScreen } from '@/rules/RuleSectionScreen';
import { BASIS_LABEL, BASIS_NOTE, SUPPORTED_BASES } from '@/rules/types';
import ui from '@/components/ui/ui.module.css';

/**
 * Settings → Working together: how overlap between two people is measured.
 *
 * Only the models the engine runs are offered (SUPPORTED_BASES), with the
 * explanations the Rules screen gave them. Read-only until a draft is open;
 * pressing an option before that says "Edit the rules", as it always did.
 *
 * The demo has no overlap model, so there is nothing to show there: the demo
 * Settings screen has no row for it, and a direct link goes back to Settings.
 */
export function SettingsWorkingTogetherPage() {
  const editor = useRuleEditor();
  if (!editor.rules.enabled) return <Navigate to="/manager/settings" replace />;
  return <RealWorkingTogether />;
}

function RealWorkingTogether() {
  const { t } = useI18n();
  const { editing, basis, setBasis, nudge } = useRuleEditor();

  return (
    <RuleSectionScreen title={t('ruleBasis')}>
      <Card padding="none" clip>
        {SUPPORTED_BASES.map((option) => {
          const label = BASIS_LABEL[option];
          const note = BASIS_NOTE[option];
          if (!label) return null;
          return (
            <button
              key={option}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
              onClick={() => (editing ? setBasis(option) : nudge())}
              aria-pressed={basis === option}
              disabled={!editing && basis !== option}
            >
              <RadioDot on={basis === option} />
              <span className={ui.rowMain}>
                <span className={ui.rowTitle}>{t(label)}</span>
                {note ? (
                  <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                    {t(note)}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </Card>
    </RuleSectionScreen>
  );
}
