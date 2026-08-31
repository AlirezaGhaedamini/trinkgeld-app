import type { ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';

interface SectionLabelProps {
  children: ReactNode;
  /** Right-aligned secondary text, e.g. "4 people · 45%". */
  meta?: ReactNode;
}

export function SectionLabel({ children, meta }: SectionLabelProps) {
  return (
    <div className={styles.sectionLabel}>
      <h2 className={styles.sectionLabelText}>{children}</h2>
      {meta ? <span className={styles.sectionLabelMeta}>{meta}</span> : null}
    </div>
  );
}
