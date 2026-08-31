import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import styles from '@/components/ui/ui.module.css';

/** Small print under a section. */
export function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** Body copy that introduces a screen. */
export function Lede({ children }: { children: ReactNode }) {
  return <p className={styles.noteBody}>{children}</p>;
}

/** An explanatory line with a leading icon. */
export function InfoNote({ icon = 'info', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <p className={styles.infoNote}>
      <Icon name={icon} size={18} color="var(--color-accent)" />
      <span>{children}</span>
    </p>
  );
}
