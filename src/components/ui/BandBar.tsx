import { AREA_COLOR } from '@/data/areas';
import type { AreaId } from '@/types';
import styles from '@/components/ui/ui.module.css';

interface BandBarProps {
  /** Area -> weight. Zero-weight areas are dropped. */
  shares: Partial<Record<AreaId, number>>;
  height?: number;
  label?: string;
}

/** The ribbon that shows how a pool was split across areas. */
export function BandBar({ shares, height = 8, label }: BandBarProps) {
  const entries = (Object.entries(shares) as Array<[AreaId, number]>).filter(
    ([, weight]) => weight > 0,
  );
  return (
    <div className={styles.bands} style={{ height }} role="img" aria-label={label}>
      {entries.map(([area, weight]) => (
        <span
          key={area}
          className={styles.band}
          style={{ flex: weight, background: AREA_COLOR[area] }}
        />
      ))}
    </div>
  );
}
