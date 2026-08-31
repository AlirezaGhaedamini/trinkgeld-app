import { ListRow, RowAmount } from '@/components/ui/ListRow';
import styles from '@/pages/pages.module.css';

export interface HistoryRowData {
  id: string;
  date: string;
  meta: string;
  amount: string;
  status: string;
  statusColor: string;
  /** ["22", "AUG"] — shown as a calendar chip on the employee history list. */
  chip?: [string, string];
  onOpen: () => void;
}

/** One line in a list of past shifts / distributions. */
export function HistoryRow({ row, chevron = true }: { row: HistoryRowData; chevron?: boolean }) {
  return (
    <ListRow
      title={row.date}
      meta={row.meta}
      onClick={row.onOpen}
      chevron={chevron}
      leading={
        row.chip ? (
          <span className={styles.dayChip} aria-hidden>
            <span className={styles.dayChipNumber}>{row.chip[0]}</span>
            {row.chip[1]}
          </span>
        ) : undefined
      }
      trailing={<RowAmount amount={row.amount} status={row.status} statusColor={row.statusColor} />}
    />
  );
}
