import type { CSSProperties, ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';

type Tone = 'tint' | 'quiet' | 'plain';

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  style?: CSSProperties;
}

const TONE_CLASS: Record<Tone, string> = {
  tint: styles.badgeTint,
  quiet: styles.badgeQuiet,
  plain: '',
};

export function Badge({ tone = 'tint', children, style }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone]}`} style={style}>
      {children}
    </span>
  );
}

/** The ×1.2 role-points pill in the team list. */
export function PointsBadge({ children }: { children: ReactNode }) {
  return <span className={`${styles.badge} ${styles.badgePoints}`}>{children}</span>;
}
