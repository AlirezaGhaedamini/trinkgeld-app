import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Lede } from '@/components/ui/Note';
import { MoneyField, MoneyKeypad } from '@/components/ui/MoneyKeypad';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { useToast } from '@/hooks/useToast';
import { centsToAmount } from '@/lib/money';
import { ownReport } from '@/state/selectors';
import styles from '@/pages/pages.module.css';

/**
 * An employee reports what came in on their shift. Managers see every report
 * and build the pool from them — the employee never sets the pool themselves.
 */
export function ReportTipsPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money } = useI18n();
  const shift = useShiftLabel();
  const { show } = useToast();
  const navigate = useNavigate();

  const existing = ownReport(state);
  const [cardCents, setCardCents] = useState(existing?.cardCents ?? 0);
  const [cashCents, setCashCents] = useState(existing?.cashCents ?? 0);
  const [field, setField] = useState<'card' | 'cash'>('card');

  const total = centsToAmount(cardCents + cashCents);
  const canSend = total > 0;

  return (
    <Screen
      title={t('reportTitle')}
      kicker={shift.full}
      cta={{
        label: t('reportSend'),
        muted: !canSend,
        onClick: () => {
          if (!canSend) {
            show(t('reportBody'));
            return;
          }
          dispatch({
            type: 'submitReport',
            employeeId: state.session.employeeId,
            cardCents,
            cashCents,
            at: '01:20',
          });
          show(t('reportSent'));
          navigate('/home');
        },
      }}
    >
      <Lede>{t('reportBody')}</Lede>

      <div>
        <p className={styles.displayLabel}>{t('reportedTotal')}</p>
        <p className={`${styles.displayAmount} tabular`}>{money(total)}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MoneyField
          icon="credit-card"
          label={t('srcCard')}
          value={money(centsToAmount(cardCents))}
          active={field === 'card'}
          onSelect={() => setField('card')}
        />
        <MoneyField
          icon="money"
          label={t('srcCash')}
          value={money(centsToAmount(cashCents))}
          active={field === 'cash'}
          onSelect={() => setField('cash')}
        />
      </div>

      <MoneyKeypad
        label={t('reportedTotal')}
        cents={field === 'card' ? cardCents : cashCents}
        onChange={(cents) => (field === 'card' ? setCardCents(cents) : setCashCents(cents))}
      />
    </Screen>
  );
}
