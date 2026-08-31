import type { ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  onClick?: () => void;
}

/** The small "Hours submitted 9/15" tiles. */
export function StatCard({ label, value, valueColor, onClick }: StatCardProps) {
  const classes = [styles.card, styles.statCard, onClick ? styles.cardInteractive : '']
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <div className={classes}>
      <div>{body}</div>
    </div>
  );
}
