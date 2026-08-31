import type { CSSProperties } from 'react';
import type { IconName } from '@/lib/icons';

/**
 * The icon set, drawn with the Phosphor webfont that ships in src/assets/fonts.
 *
 * Names are typed so a typo is a compile error. When you add one, add its rule
 * to src/styles/phosphor.css as well — only the used glyphs are declared.
 */
export type { IconName };

interface IconProps {
  name: IconName;
  /** Filled weight — used for the active bottom-nav tab and confirmations. */
  fill?: boolean;
  size?: number | string;
  color?: string;
  className?: string;
  style?: CSSProperties;
  /** Give the icon a label when it is the only content of a control. */
  label?: string;
}

export function Icon({ name, fill = false, size = 18, color, className, style, label }: IconProps) {
  const classes = [fill ? 'ph-fill' : 'ph', `ph-${name}`, className].filter(Boolean).join(' ');
  return (
    <i
      className={classes}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={{ fontSize: typeof size === 'number' ? `${size}px` : size, color, ...style }}
    />
  );
}
