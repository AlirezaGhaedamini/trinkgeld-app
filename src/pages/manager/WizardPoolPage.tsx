import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Card, CardButton } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { MoneyField, MoneyKeypad } from '@/components/ui/MoneyKeypad';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { centsToAmount } from '@/lib/money';
import { draftPoolAmount, reportsTotalCents } from '@/state/selectors';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import { useDistributionWizard } from '@/distribution/useDistribution';
import { useToast } from '@/hooks/useToast';
import type { PoolPeriod } from '@/types';
import { useState } from 'react';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** Wizard step 1 — how much came in. */
export function WizardPoolPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money } = useI18n();
  const shift = useShiftLabel();
  const navigate = useNavigate();
  const { show } = useToast();
  const [field, setField] = useState<'card' | 'cash'>('card');

  const wizard = useDistributionWizard();
  const real = wizard.enabled;

  /**
   * Where the number comes from.
   *
   * With reports in hand the database sums them — create_pool_from_reports()
   * adds up the rows and records which ones it consumed, so the browser never
   * asserts how much money there is and the same report cannot fund two pools.
   * The keypad is for the case there is nothing to derive from.
   */
  const derived = real && wizard.reportTotal.count > 0;
  const realCents = wizard.pool
    ? wizard.pool.totalCents
    : derived
      ? wizard.reportTotal.cardCents + wizard.reportTotal.cashCents
      : state.draft.cardCents + state.draft.cashCents;

  const pool = real ? centsToAmount(realCents) : draftPoolAmount(state);
  const poolLocked = Boolean(wizard.pool && wizard.pool.status !== 'open');

  const advance = async () => {
    if (!real) {
      navigate('/manager/new/areas');
      return;
    }
    if (wizard.pool) {
      navigate('/manager/new/areas');
      return;
    }
    const result = derived
      ? await wizard.openPoolFromReports()
      : await wizard.openManualPool(state.draft.cardCents, state.draft.cashCents);
    if (!result.ok) {
      show(t(DISTRIBUTION_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    navigate('/manager/new/areas');
  };

  return (
    <Screen
      title={t('tipPool')}
      kicker={`${t('step')} 1/4`}
      back="close"
      cta={{
        label: wizard.busy ? t('dPoolOpening') : t('nextAreas'),
        muted: wizard.busy || (real && !wizard.pool && realCents <= 0),
        onClick: () => {
          if (real && !wizard.pool && realCents <= 0) {
            show(t(derived ? 'dErrEmptyPool' : 'dNoReportsYet'));
            return;
          }
          void advance();
        },
      }}
    >
      <SegmentedControl<PoolPeriod>
        label={t('tipPool')}
        value={state.draft.period}
        options={[
          { value: 'segShift', label: t('segShift') },
          { value: 'segDay', label: t('segDay') },
          { value: 'segWeek', label: t('segWeek') },
        ]}
        onChange={(period) => dispatch({ type: 'setPeriod', period })}
      />

      <Card padding="padded">
        <span className={ui.inline}>
          <Icon name="calendar-blank" size={19} color="var(--color-text-muted)" />
          <span className={`${ui.rowMain} ${ui.rowTitle}`}>{shift.full}</span>
        </span>
      </Card>

      <div>
        <p className={styles.displayLabel}>{t('totalCollected')}</p>
        <p
          className={`${styles.displayAmount} tabular`}
          style={pool === 0 ? { color: 'var(--color-text-faint)' } : undefined}
        >
          {money(pool)}
        </p>
      </div>

      {(real ? wizard.reportTotal.count > 0 : state.reports.length > 0) ? (
      <CardButton padding="padded" onClick={() => navigate('/manager/reports')}>
        <span className={ui.inline}>
          <Icon name="notebook" size={17} color="var(--color-accent)" />
          <span
            className={ui.rowMain}
            style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}
          >
            {t('reportsHead')} ·{' '}
            {money(
              centsToAmount(
                real
                  ? wizard.reportTotal.cardCents + wizard.reportTotal.cashCents
                  : reportsTotalCents(state),
              ),
            )}
          </span>
          <Icon name="caret-right" size={13} color="var(--color-text-subtle)" />
        </span>
      </CardButton>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MoneyField
          icon="credit-card"
          label={t('srcCard')}
          value={money(
            centsToAmount(
              real
                ? (wizard.pool?.cardCents ?? (derived ? wizard.reportTotal.cardCents : state.draft.cardCents))
                : state.draft.cardCents,
            ),
          )}
          active={field === 'card'}
          onSelect={() => setField('card')}
        />
        <MoneyField
          icon="money"
          label={t('srcCash')}
          value={money(
            centsToAmount(
              real
                ? (wizard.pool?.cashCents ?? (derived ? wizard.reportTotal.cashCents : state.draft.cashCents))
                : state.draft.cashCents,
            ),
          )}
          active={field === 'cash'}
          onSelect={() => setField('cash')}
        />
      </div>

      {/* The keypad appears only when there is something for a person to type:
          a derived total is the database's to state, and a locked pool's
          amounts are frozen by app.guard_pool_amounts(). */}
      {real && (derived || poolLocked) ? (
        <p className={ui.note}>{poolLocked ? t('dPreviewBody') : t('dPoolFromReports')}</p>
      ) : (
        <MoneyKeypad
          label={t('totalCollected')}
          cents={field === 'card' ? state.draft.cardCents : state.draft.cashCents}
          onChange={(cents) => dispatch({ type: 'setPoolCents', field, cents })}
        />
      )}
    </Screen>
  );
}
