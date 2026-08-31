import { Icon } from '@/components/ui/Icon';
import styles from '@/components/ui/ui.module.css';

/** Transient confirmation. Announced politely so it is not missed. */
export function Toast({ message }: { message: string }) {
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <Icon name="check-circle" fill size={19} color="var(--color-accent)" />
      <span>{message}</span>
    </div>
  );
}
