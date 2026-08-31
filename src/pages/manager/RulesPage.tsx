import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { Icon } from '@/components/ui/Icon';
import { Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Toggle } from '@/components/ui/Toggle';
import { AREA_ORDER } from '@/data/areas';
import { MIN_OVERLAP_CHOICES } from '@/data/workplace';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import type { DistributionMethod } from '@/types';
import ui from '@/components/ui/ui.module.css';

const METHODS: DistributionMethod[] = ['mPoints', 'mHours', 'mEqual'];

/**
 * The workplace's distribution rules — manager only.
 *
 * Areas in the pool and their shares, how each area divides internally, and the
 * minimum shared time two people need before they count as having worked
 * together.
 */
export function RulesPage() {
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
