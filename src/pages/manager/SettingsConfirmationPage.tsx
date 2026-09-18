import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { RuleSectionScreen } from '@/rules/RuleSectionScreen';
import ui from '@/components/ui/ui.module.css';

/** Required first, as the Rules screen's toggle read it. */
const OPTIONS = [true, false] as const;

/**
 * Settings → Employee confirmation: whether employees must confirm their
 * share.
 *
 * The Rules screen offered this as a row that flipped on each tap. The two
 * values are the same, laid out side by side so the manager picks one. As with
 * every rule section it is read-only until a draft is open.
 *
 * What each choice does, as the code does it: the value is frozen into every
 * distribution when it is calculated (rules_snapshot). Required — once sent,
 * the person's share asks "Looks right" or "I have a question". Optional — the
 * share reads "No confirmation needed" and offers neither (ACK_VIEW.notRequired
 * in distribution/ack.ts: no confirm button, no question button).
 */
export function SettingsConfirmationPage() {
  const editor = useRuleEditor();
  return editor.rules.enabled ? <RealConfirmation /> : <DemoConfirmation />;
}

function RealConfirmation() {
  const { t } = useI18n();
  const { editing, ack, setAck, nudge } = useRuleEditor();

  return (
    <RuleSectionScreen title={t('rr2')}>
      <Card padding="none" clip>
        {OPTIONS.map((option) => (
          <button
            key={String(option)}
            type="button"
            className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
            onClick={() => (editing ? setAck(option) : nudge())}
            aria-pressed={ack === option}
            disabled={!editing && ack !== option}
          >
            <RadioDot on={ack === option} />
            <span className={ui.rowMain}>
              <span className={ui.rowTitle}>{option ? t('rr2v') : t('rr2v2')}</span>
              <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                {option ? t('rr2vNote') : t('rr2v2Note')}
              </span>
            </span>
          </button>
        ))}
      </Card>
      <Note>{t('ruleFrozenNote')}</Note>
    </RuleSectionScreen>
  );
}

/* ── demo mode — unchanged local state, no Supabase call ──────────────────── */

function DemoConfirmation() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const current = state.rule.acknowledgementRequired;

  return (
    <Screen title={t('rr2')} kicker={state.workplace.name} backTo="/manager/settings">
      <div className={ui.stackTight}>
        <Card padding="none" clip>
          {OPTIONS.map((option) => (
            <button
              key={String(option)}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
              onClick={() => {
                if (option !== current) dispatch({ type: 'toggleAcknowledgementRequired' });
              }}
              aria-pressed={current === option}
            >
              <RadioDot on={current === option} />
              <span className={ui.rowMain}>
                <span className={ui.rowTitle}>{option ? t('rr2v') : t('rr2v2')}</span>
                <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                  {option ? t('rr2vNote') : t('rr2v2Note')}
                </span>
              </span>
            </button>
          ))}
        </Card>
        <Note>{t('ruleFrozenNote')}</Note>
      </div>
    </Screen>
  );
}
