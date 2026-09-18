import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { InfoNote, Note } from '@/components/ui/Note';
import { Toggle } from '@/components/ui/Toggle';
import { AREA_ORDER, iconForAreaKey } from '@/data/areas';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { useToast } from '@/hooks/useToast';
import { RuleSectionScreen } from '@/rules/RuleSectionScreen';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * Settings → Areas in the pool: how the pool is shared between the areas.
 *
 * The section the Rules screen carried, unchanged: sliders in steps of 5 while a
 * draft is open, a read-only list otherwise, and the shares must total exactly
 * 100 before the draft can be activated. The running total is the note above
 * the bottom button, as it was.
 */
export function SettingsPoolPage() {
  const editor = useRuleEditor();
  return editor.rules.enabled ? <RealPool /> : <DemoPool />;
}

function RealPool() {
  const editor = useRuleEditor();
  const { t, percent } = useI18n();
  const { editing, poolAreas, shares, setShares, stranded } = editor;

  return (
    <RuleSectionScreen title={t('areasInPool')} sharesInView>
      <div className={ui.stackTight}>
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
    </RuleSectionScreen>
  );
}

/* ── demo mode — unchanged local state, no Supabase call ──────────────────── */

function DemoPool() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, percent, area } = useI18n();
  const { show } = useToast();

  return (
    <Screen title={t('areasInPool')} kicker={state.workplace.name} backTo="/manager/settings">
      <div className={ui.stackTight}>
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
    </Screen>
  );
}
