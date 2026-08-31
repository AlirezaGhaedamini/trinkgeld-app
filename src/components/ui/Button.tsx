import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import styles from '@/components/ui/ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  /** Visually de-emphasised while still clickable — the wizard's blocked CTA. */
  muted?: boolean;
  /** Slightly shorter than the 52px primary control. */
  quiet?: boolean;
  icon?: IconName;
  iconFill?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  ghost: styles.buttonGhost,
};

export function Button({
  variant = 'primary',
  block = false,
  muted = false,
  quiet = false,
  icon,
  iconFill,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    VARIANT_CLASS[variant],
    block ? styles.buttonBlock : '',
    muted ? styles.buttonMuted : '',
    quiet ? styles.buttonQuiet : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {icon ? <Icon name={icon} fill={iconFill} size={19} /> : null}
      {children}
    </button>
  );
}
