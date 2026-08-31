import { Card } from '@/components/ui/Card';
import { AREA_COLOR } from '@/data/areas';
import { useI18n } from '@/hooks/useI18n';
import type { AreaDistribution, DistributionMethod } from '@/types';
import styles from '@/pages/pages.module.css';

interface AreaResultBlockProps {
  block: AreaDistribution;
  method: DistributionMethod;
  /** Tapping a person opens their team-member screen (managers only). */
  onOpenEntry?: (employeeId: string) => void;
}

/** One area's pot and the people who share it. */
export function AreaResultBlock({ block, method, onOpenEntry }: AreaResultBlockProps) {
  const { t, money, num, percent, hours, area, language } = useI18n();

  const mathFor = (entryHours: number, points: number, multiplier: number, units: number) => {
    if (method === 'mEqual') return language === 'Deutsch' ? 'gleicher Anteil' : 'equal share';
    if (method === 'mHours') return hours(entryHours);
    return `${hours(entryHours)} × ${num(points * multiplier, 1)} = ${num(units, 1)} ${t('units')}`;
  };

  return (
    <Card padding="none" clip>
      <div className={styles.blockHead}>
        <span className={styles.blockDot} style={{ background: AREA_COLOR[block.area] }} />
        <span className={styles.blockName}>{area(block.area)}</span>
        <span className={styles.blockMeta}>
          {percent(block.percentage)} · {num(block.units, 1)} {t('units')}
        </span>
        <span className={`${styles.blockTotal} tabular`}>{money(block.total)}</span>
      </div>

      {block.entries.map((entry) => {
        const body = (
          <>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.entryName}>{entry.name}</span>
              <span className={`${styles.entryMath} tabular`} style={{ display: 'block' }}>
                {mathFor(entry.hours, entry.points, entry.multiplier, entry.units)}
              </span>
            </span>
            <span className={`${styles.entryAmount} tabular`}>{money(entry.amount)}</span>
          </>
        );
        return onOpenEntry ? (
          <button
            key={entry.employeeId}
            type="button"
            className={`${styles.entryRow} ${styles.entryRowInteractive}`}
            onClick={() => onOpenEntry(entry.employeeId)}
          >
            {body}
          </button>
        ) : (
          <div key={entry.employeeId} className={styles.entryRow}>
            {body}
          </div>
        );
      })}
    </Card>
  );
}
