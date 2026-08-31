import styles from '@/components/ui/ui.module.css';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipGroupProps<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Stretch chips to share the row equally (role choice, overlap minutes). */
  fill?: boolean;
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  fill = false,
}: ChipGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.chip} ${active ? styles.chipSelected : ''}`}
            style={fill ? { flex: 1, minHeight: 48, fontWeight: 500, fontSize: 15 } : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
