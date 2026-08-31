import styles from '@/components/ui/ui.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Selecting this option does nothing but explain why. */
  disabledReason?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T, option: SegmentOption<T>) => void;
  /** Chip-sized rather than full-width — used by the distribution filters. */
  compact?: boolean;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  compact = false,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div className={styles.segmented} role="tablist" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        const classes = [
          styles.segment,
          compact ? styles.segmentCompact : '',
          active ? styles.segmentActive : '',
          option.disabledReason && !active ? styles.segmentQuiet : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={classes}
            onClick={() => onChange(option.value, option)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
