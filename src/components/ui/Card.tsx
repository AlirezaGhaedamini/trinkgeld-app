import type { ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';

type Tone = 'default' | 'primary' | 'warning' | 'faint';
type Padding = 'none' | 'padded' | 'roomy';

interface CardProps {
  tone?: Tone;
  padding?: Padding;
  /** Clip children so inner rows stop at the rounded corner. */
  clip?: boolean;
  className?: string;
  children: ReactNode;
}

const TONE_CLASS: Record<Tone, string> = {
  default: '',
  primary: styles.cardPrimary,
  warning: styles.cardWarning,
  faint: styles.cardFaint,
};

const PADDING_CLASS: Record<Padding, string> = {
  none: '',
  padded: styles.cardPadded,
  roomy: styles.cardRoomy,
};

export function Card({
  tone = 'default',
  padding = 'padded',
  clip = false,
  className,
  children,
}: CardProps) {
  const classes = [
    styles.card,
    TONE_CLASS[tone],
    PADDING_CLASS[padding],
    clip ? styles.cardList : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}

interface CardButtonProps extends CardProps {
  onClick: () => void;
  ariaLabel?: string;
}

/** A card that is itself the tap target. */
export function CardButton({
  tone = 'default',
  padding = 'padded',
  className,
  onClick,
  ariaLabel,
  children,
}: CardButtonProps) {
  const classes = [
    styles.card,
    styles.cardInteractive,
    TONE_CLASS[tone],
    PADDING_CLASS[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  );
}
