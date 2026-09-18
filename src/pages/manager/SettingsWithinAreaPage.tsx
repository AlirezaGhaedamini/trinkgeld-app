import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { RadioDot } from '@/components/ui/RadioDot';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { RuleSectionScreen } from '@/rules/RuleSectionScreen';
import { METHOD_LABEL, METHOD_NOTE, METHODS as REAL_METHODS } from '@/rules/types';
import type { DistributionMethod } from '@/types';
import ui from '@/components/ui/ui.module.css';

const DEMO_METHODS: DistributionMethod[] = ['mPoints', 'mHours', 'mEqual'];

/**
 * Settings → Within an area: how an area's share is divided between the people
 * in it — hours × role points, hours only, or an equal split.
 *
 * The three methods calculate_distribution() branches on, with the Rules
 * screen's explanations. Read-only until a draft is open.
 */
export function SettingsWithinAreaPage() {
  const editor = useRuleEditor();
  return editor.rules.enabled ? <RealWithinArea /> : <DemoWithinArea />;
}

function RealWithinArea() {
  const { t } = useI18n();
  const { editing, method, setMethod, nudge } = useRuleEditor();

  return (
    <RuleSectionScreen title={t('withinArea')}>
      <Card padding="none" clip>
        {REAL_METHODS.map((option) => (
          <button
            key={option}
            type="button"
            className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
            onClick={() => (editing ? setMethod(option) : nudge())}
            aria-pressed={method === option}
            disabled={!editing && method !== option}
          >
            <RadioDot on={method === option} />
            <span className={ui.rowMain}>
              <span className={ui.rowTitle}>{t(METHOD_LABEL[option])}</span>
              <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                {t(METHOD_NOTE[option])}
              </span>
            </span>
          </button>
        ))}
      </Card>
    </RuleSectionScreen>
  );
}

/* ── demo mode — unchanged local state, no Supabase call ──────────────────── */

function DemoWithinArea() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t } = useI18n();

  return (
    <Screen title={t('withinArea')} kicker={state.workplace.name} backTo="/manager/settings">
      <div className={ui.stackTight}>
        <Card padding="none" clip>
          {DEMO_METHODS.map((method) => (
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
    </Screen>
  );
}
