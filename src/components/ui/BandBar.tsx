import { AREA_COLOR } from '@/data/areas';
import type { AreaId } from '@/types';
import styles from '@/components/ui/ui.module.css';

interface BandBarProps {
  /** Area -> weight. Zero-weight areas are dropped. */
  shares?: Partial<Record<AreaId, number>>;
  /**
   * The same ribbon for real workplace areas, which are rows in the database
   * rather than members of the prototype's fixed set.
   */
  bands?: Array<{ id: string; weight: number; color: string }>;
  height?: number;
  label?: string;
}

/** The ribbon that shows how a pool was split across areas. */
export function BandBar({ shares, bands, height = 8, label }: BandBarProps) {
  const entries: Array<{ id: string; weight: number; color: string }> = bands
    ? bands.filter((band) => band.weight > 0)
    : (Object.entries(shares ?? {}) as Array<[AreaId, number]>)
        .filter(([, weight]) => weight > 0)
        .map(([area, weight]) => ({ id: area, weight, color: AREA_COLOR[area] }));

  return (
    <div className={styles.bands} style={{ height }} role="img" aria-label={label}>
      {entries.map((band) => (
        <span
          key={band.id}
          className={styles.band}
          style={{ flex: band.weight, background: band.color }}
        />
      ))}
    </div>
  );
}
