import styles from '@/components/ui/ui.module.css';

interface ToggleProps {
  on: boolean;
  label: string;
  onChange: () => void;
}

/**
 * Switch built on a real checkbox so it is keyboard reachable and announced
 * with its state; the visual track and knob are decoration on top.
 */
export function Toggle({ on, label, onChange }: ToggleProps) {
  return (
    <label className={styles.toggleWrap}>
      <input
        type="checkbox"
        className="sr-only"
        checked={on}
        aria-label={label}
        onChange={onChange}
      />
      <span className={`${styles.toggleTrack} ${on ? styles.toggleTrackOn : ''}`} aria-hidden>
        <span className={`${styles.toggleKnob} ${on ? styles.toggleKnobOn : ''}`} />
      </span>
    </label>
  );
}
