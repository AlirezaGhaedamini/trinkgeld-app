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
  const [field, setField] = useState<'card' | 'cash'>('card');

  const pool = draftPoolAmount(state);

  return (
    <Screen
      title={t('tipPool')}
      kicker={`${t('step')} 1/4`}
      back="close"
      cta={{ label: t('nextAreas'), onClick: () => navigate('/manager/new/areas') }}
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

      {state.reports.length > 0 ? (
      <CardButton padding="padded" onClick={() => navigate('/manager/reports')}>
        <span className={ui.inline}>
          <Icon name="notebook" size={17} color="var(--color-accent)" />
          <span
            className={ui.rowMain}
            style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}
          >
            {t('reportsHead')} · {money(centsToAmount(reportsTotalCents(state)))}
          </span>
          <Icon name="caret-right" size={13} color="var(--color-text-subtle)" />
        </span>
      </CardButton>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MoneyField
          icon="credit-card"
          label={t('srcCard')}
          value={money(centsToAmount(state.draft.cardCents))}
          active={field === 'card'}
          onSelect={() => setField('card')}
        />
        <MoneyField
          icon="money"
          label={t('srcCash')}
          value={money(centsToAmount(state.draft.cashCents))}
          active={field === 'cash'}
          onSelect={() => setField('cash')}
        />
      </div>

      <MoneyKeypad
        label={t('totalCollected')}
        cents={field === 'card' ? state.draft.cardCents : state.draft.cashCents}
        onChange={(cents) => dispatch({ type: 'setPoolCents', field, cents })}
      />
    </Screen>
  );
}
