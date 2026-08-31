import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import styles from '@/components/ui/ui.module.css';

interface ListRowProps {
  title: ReactNode;
  meta?: ReactNode;
  metaColor?: string;
  /** Right-hand block: amount over status, or a plain value. */
  trailing?: ReactNode;
  leading?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  /** Row inside a card (hairline above, inset padding) vs free-standing. */
  inset?: boolean;
  strong?: boolean;
  className?: string;
}

/**
 * The workhorse row. Two variants, both from the prototype: a free-standing row
 * with a hairline underneath (scrolling lists) and an inset row inside a card.
 */
export function ListRow({
  title,
  meta,
  metaColor,
  trailing,
  leading,
  onClick,
  chevron = false,
  inset = false,
  strong = false,
  className,
}: ListRowProps) {
  const base = inset ? styles.insetRow : styles.row;
  const interactive = inset ? styles.insetRowInteractive : styles.rowInteractive;
  const classes = [base, onClick ? interactive : '', className].filter(Boolean).join(' ');

  const content = (
    <>
      {leading}
      <span className={styles.rowMain}>
        <span className={`${styles.rowTitle} ${strong ? styles.rowTitleStrong : ''} ${styles.truncate}`}>
          {title}
        </span>
        {meta ? (
          <span className={styles.rowMeta} style={metaColor ? { color: metaColor } : undefined}>
            {meta}
          </span>
        ) : null}
      </span>
      {trailing}
      {chevron ? <Icon name="caret-right" size={13} className={styles.chevron} /> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

/** Amount over status — the right-hand side of a history row. */
export function RowAmount({ amount, status, statusColor }: {
  amount: ReactNode;
  status?: ReactNode;
  statusColor?: string;
}) {
  return (
    <span className={styles.rowTrailing}>
      <span className={`${styles.rowAmount} tabular`}>{amount}</span>
      {status ? (
        <span className={styles.rowStatus} style={statusColor ? { color: statusColor } : undefined}>
          {status}
        </span>
      ) : null}
    </span>
  );
}
