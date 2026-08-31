import styles from '@/components/ui/ui.module.css';

/** The selected/unselected marker used by the rules and role pickers. */
export function RadioDot({ on }: { on: boolean }) {
  return <span className={`${styles.radioDot} ${on ? styles.radioDotOn : ''}`} aria-hidden />;
}
