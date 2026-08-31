import { Card } from '@/components/ui/Card';
import { colorForAreaKey } from '@/data/areas';
import { useI18n } from '@/hooks/useI18n';
import type { DistributionArea, DistributionEntry, RuleMethod } from '@/distribution/types';
import styles from '@/pages/pages.module.css';

interface RealAreaResultBlockProps {
  area: DistributionArea;
  entries: DistributionEntry[];
  method: RuleMethod;
  onOpenEntry?: (memberId: string) => void;
}

/**
 * One real area's pot and the people who shared it.
 *
 * A sibling of AreaResultBlock with the same markup and the same classes — the
 * only difference is where the numbers come from. The prototype's version is
 * typed against the fixed AreaId set of the demo dataset; this one takes rows
 * the database calculated, which carry their own names and keys.
 *
 * Every amount here is read, never computed: the cents came out of
 * tip_distribution_entries exactly as the engine wrote them.
 */
export function RealAreaResultBlock({ area, entries, method, onOpenEntry }: RealAreaResultBlockProps) {
  const { t, money, num, percent, hours, language } = useI18n();

  const mathFor = (entry: DistributionEntry) => {
    if (method === 'equal') return language === 'Deutsch' ? 'gleicher Anteil' : 'equal share';
    if (method === 'hours') return hours(entry.workedMinutes / 60);
    return `${hours(entry.workedMinutes / 60)} × ${num(entry.points * entry.multiplier, 1)} = ${num(
      entry.units,
      1,
    )} ${t('units')}`;
  };

  return (
    <Card padding="none" clip>
      <div className={styles.blockHead}>
        <span className={styles.blockDot} style={{ background: colorForAreaKey(area.areaKey) }} />
        <span className={styles.blockName}>{area.areaName}</span>
        <span className={styles.blockMeta}>
          {percent(area.percentage)} · {num(area.units, 1)} {t('units')}
        </span>
        <span className={`${styles.blockTotal} tabular`}>{money(area.totalCents / 100)}</span>
      </div>

      {entries.map((entry) => {
        const body = (
          <>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.entryName}>{entry.memberName}</span>
              <span className={`${styles.entryMath} tabular`} style={{ display: 'block' }}>
                {mathFor(entry)}
              </span>
            </span>
            <span className={`${styles.entryAmount} tabular`}>{money(entry.amountCents / 100)}</span>
          </>
        );
        return onOpenEntry ? (
          <button
            key={entry.id}
            type="button"
            className={`${styles.entryRow} ${styles.entryRowInteractive}`}
            onClick={() => onOpenEntry(entry.memberId)}
          >
            {body}
          </button>
        ) : (
          <div key={entry.id} className={styles.entryRow}>
            {body}
          </div>
        );
      })}
    </Card>
  );
}
