import type { ReactNode } from 'react';
import styles from '@/components/ui/ui.module.css';

interface HeroCardProps {
  kicker: ReactNode;
  amount: ReactNode;
  meta?: ReactNode;
  pill?: ReactNode;
  /** Slightly smaller display size, used on the manager overview. */
  compact?: boolean;
}

/** The mint block: "Your last shift" / "Tips this week". */
export function HeroCard({ kicker, amount, meta, pill, compact = false }: HeroCardProps) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroKicker}>{kicker}</div>
      <div className={`${styles.heroAmount} ${compact ? styles.heroAmountSmall : ''} tabular`}>
        {amount}
      </div>
      {meta ? <div className={styles.heroMeta}>{meta}</div> : null}
      {pill ? <div className={styles.heroPill}>{pill}</div> : null}
    </section>
  );
}
