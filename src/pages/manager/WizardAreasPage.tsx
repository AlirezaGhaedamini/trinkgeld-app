import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Note } from '@/components/ui/Note';
import { AREA_ICON, POOLABLE_AREAS, iconForAreaKey } from '@/data/areas';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { allocatedPercentage } from '@/lib/distribution';
import { draftPoolAmount } from '@/state/selectors';
import { centsToAmount } from '@/lib/money';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import { useDistributionWizard } from '@/distribution/useDistribution';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * Wizard step 2 — what share each area takes. The step will not advance until
 * the shares total exactly 100%, and says by how much they are out.
 */
export function WizardAreasPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money, percent, people, area } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const wizard = useDistributionWizard();
  const real = wizard.enabled;

  /**
   * The workplace's own areas and the shares of the active rule.
   *
   * Held as whole percents in local state while the manager drags the sliders,
   * then written as a NEW rule version: editing the live rule would rewrite the
   * terms under distributions already calculated, and activate_rule() is what
   * validates the total and freezes the role points.
   */
  const [shares, setShares] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!real || !wizard.rule) return;
    const next: Record<string, number> = {};
    for (const share of wizard.rule.shares) next[share.areaId] = share.percentage;
    setShares(next);
  }, [real, wizard.rule]);

  const realAreas = useMemo(
    () => (wizard.rule?.shares ?? []).filter((s) => s.isPoolEligible),
    [wizard.rule],
  );

  const pool = real ? centsToAmount(wizard.pool?.totalCents ?? 0) : draftPoolAmount(state);
  const allocated = real
    ? realAreas.reduce((sum, s) => sum + (shares[s.areaId] ?? 0), 0)
    : allocatedPercentage(state.draft.areaShares);
  const balanced = allocated === 100;

  const advance = async () => {
    if (!real) {
      navigate('/manager/new/hours');
      return;
    }
    const payload = (wizard.rule?.shares ?? []).map((s) => ({
      areaId: s.areaId,
      areaKey: s.areaKey,
      percentage: s.isPoolEligible ? (shares[s.areaId] ?? 0) : 0,
    }));
    const unchanged = (wizard.rule?.shares ?? []).every(
      (s) => s.percentage === (s.isPoolEligible ? (shares[s.areaId] ?? 0) : 0),
    );
    if (!unchanged) {
      const result = await wizard.saveShares(payload);
      if (!result.ok) {
        show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
        return;
      }
    }
    navigate('/manager/new/hours');
  };
  const note = balanced
    ? t('hintOK')
    : allocated < 100
      ? `${percent(100 - allocated)} ${t('hintUnder')}`
      : `${percent(allocated - 100)} ${t('hintOver')}`;

  return (
    <Screen
      title={t('areaSplit')}
      kicker={`${t('step')} 2/4`}
      cta={{
        label: t('nextHours'),
        muted: !balanced || wizard.busy,
        note,
        noteColor: balanced ? 'var(--color-accent)' : 'var(--color-text)',
        onClick: () => (balanced ? void advance() : show(note)),
      }}
    >
      <Card padding="padded">
        <div className={ui.spread}>
          <div>
            <p className={styles.displayLabel}>{t('poolToDivide')}</p>
            <p className="tabular" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.4px' }}>
              {money(pool)}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className={styles.displayLabel}>{t('allocated')}</p>
            <p
              className="tabular"
              style={{
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: '-0.4px',
                color: balanced ? 'var(--color-accent)' : 'var(--color-text)',
              }}
            >
              {percent(allocated)}
            </p>
          </div>
        </div>
      </Card>

      {real
        ? realAreas.map((entry) => {
            const share = shares[entry.areaId] ?? 0;
            const on = share > 0;
            const sliderId = `share-${entry.areaId}`;
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
                  <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className={`${styles.areaPercent} tabular`}>{percent(share)}</span>
                    <span className={`${styles.areaAmount} tabular`} style={{ display: 'block' }}>
                      {money((pool * share) / 100)}
                    </span>
                  </span>
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
        : null}

      {real ? null : (
        <>
        {POOLABLE_AREAS.map((areaId) => {
          const share = state.draft.areaShares[areaId] ?? 0;
          const on = share > 0;
          const headcount = state.employees.filter((e) => e.area === areaId).length;
          const sliderId = `share-${areaId}`;
          return (
            <Card
              key={areaId}
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
                  onClick={() => dispatch({ type: 'toggleArea', area: areaId })}
                  aria-label={`${area(areaId)} — ${on ? t('excluded') : t('included')}`}
                  aria-pressed={on}
                >
                  <Icon name={AREA_ICON[areaId]} size={17} />
                </button>
                <span className={ui.rowMain}>
                  <label
                    htmlFor={sliderId}
                    className={`${ui.rowTitle} ${ui.rowTitleStrong}`}
                    style={{ color: on ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
                  >
                    {area(areaId)}
                  </label>
                  <span className={ui.rowMeta} style={{ display: 'block' }}>
                    {people(headcount)}
                  </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span className={`${styles.areaPercent} tabular`}>{percent(share)}</span>
                  <span className={`${styles.areaAmount} tabular`} style={{ display: 'block' }}>
                    {money((pool * share) / 100)}
                  </span>
                </span>
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
                  dispatch({
                    type: 'setAreaShare',
                    area: areaId,
                    percentage: Number(event.target.value),
                  })
                }
              />
            </Card>
          );
        })}
        </>
      )}

      {allocated === 0 ? (
        <EmptyState title={t('emptyAreas')}>{t('emptyAreasBody')}</EmptyState>
      ) : null}

      <Note>{t('tapIconOff')}</Note>
    </Screen>
  );
}
