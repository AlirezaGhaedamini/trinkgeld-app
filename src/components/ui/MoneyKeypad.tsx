import { Icon } from '@/components/ui/Icon';
import { popDigit, pushDigit } from '@/lib/money';
import { useI18n } from '@/hooks/useI18n';
import styles from '@/components/ui/ui.module.css';

interface MoneyKeypadProps {
  /** Current value of the focused field, in cents. */
  cents: number;
  onChange: (cents: number) => void;
  label: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'delete'] as const;

/**
 * Ten-key money entry. Digits shift into the cents value, so typing 2 4 8 0 0 0
 * reads €2,480.00 — the same behaviour as a till.
 */
export function MoneyKeypad({ cents, onChange, label }: MoneyKeypadProps) {
  const { language } = useI18n();
  const german = language === 'Deutsch';

  return (
    <div className={styles.keypad} role="group" aria-label={label}>
      {KEYS.map((key) => {
        if (key === 'clear') {
          return (
            <button
              key={key}
              type="button"
              className={`${styles.key} ${styles.keyUtility}`}
              onClick={() => onChange(0)}
              aria-label={german ? 'Zurücksetzen' : 'Clear'}
            >
              <Icon name="arrow-counter-clockwise" size={20} />
            </button>
          );
        }
        if (key === 'delete') {
          return (
            <button
              key={key}
              type="button"
              className={`${styles.key} ${styles.keyUtility}`}
              onClick={() => onChange(popDigit(cents))}
              aria-label={german ? 'Löschen' : 'Delete'}
            >
              <Icon name="backspace" size={20} />
            </button>
          );
        }
        return (
          <button
            key={key}
            type="button"
            className={styles.key}
            onClick={() => onChange(pushDigit(cents, Number(key)))}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}

export interface MoneyFieldProps {
  icon: 'credit-card' | 'money';
  label: string;
  value: string;
  active: boolean;
  onSelect: () => void;
}

/** The card / cash rows the keypad types into. */
export function MoneyField({ icon, label, value, active, onSelect }: MoneyFieldProps) {
  return (
    <button
      type="button"
      className={`${styles.moneyField} ${active ? styles.moneyFieldActive : ''}`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <Icon
        name={icon}
        size={18}
        color={active ? 'var(--color-accent)' : 'var(--color-text-muted)'}
      />
      <span className={styles.rowMain} style={{ fontSize: 'var(--text-md)' }}>
        {label}
      </span>
      <span
        className={`${styles.moneyFieldValue} tabular`}
        style={{ color: active ? 'var(--color-accent)' : 'var(--color-text)' }}
      >
        {value}
      </span>
    </button>
  );
}
