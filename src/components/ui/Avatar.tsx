import { initialsOf } from '@/data/employees';
import styles from '@/components/ui/ui.module.css';

interface AvatarProps {
  name: string;
  size?: number;
  /** Teal wash instead of the hairline ring — used for "you". */
  tinted?: boolean;
  /** Greyed out: the person did not work this shift. */
  muted?: boolean;
}

export function Avatar({ name, size = 38, tinted = false, muted = false }: AvatarProps) {
  const classes = [styles.avatar, tinted ? styles.avatarTinted : '', muted ? styles.avatarMuted : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}
