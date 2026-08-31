import type { ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';

interface EmptyStateProps {
  /** Short statement of what is not here yet. */
  title?: string;
  /** One line on how it gets filled. Optional. */
  children?: ReactNode;
}

/**
 * What a screen shows before there is anything on it. Deliberately quiet: the
 * same muted type the rest of the app uses, no illustration, no box.
 */
export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      {title ? <p className={styles.emptyStateTitle}>{title}</p> : null}
      {children ? <p>{children}</p> : null}
    </div>
  );
}
