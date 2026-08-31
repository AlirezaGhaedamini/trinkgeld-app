import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Lede } from '@/components/ui/Note';
import { Badge } from '@/components/ui/Badge';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { formatClock } from '@/lib/time';
import { liveOverlap } from '@/state/selectors';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * "Who worked together."
 *
 * Everyone is measured against the night's longest shift; the bar shows how
 * much time they shared with it and the label says whether that clears the
 * workplace's minimum.
 */
export function OverlapPage() {
  const state = useAppState();
  const { t, num, duration } = useI18n();
  const shift = useShiftLabel();

  const grouping = liveOverlap(state);
  const minimum = state.rule.minOverlapMinutes;
  const anchorSpan = Math.max(grouping.anchor?.workedMinutes ?? 1, 1);

  const rows = grouping.rows
    .filter((row) => !row.isAnchor)
    .sort((a, b) => b.overlapMinutes - a.overlapMinutes);

  return (
    <Screen title={t('overlapHead')} kicker={shift.full}>
      <Lede>
        {t('overlapBody').replace('{n}', `${minimum} ${t('minutesShort')}`)}
      </Lede>

      {grouping.anchor ? (
        <Card tone="warning" padding="padded">
          <div className={ui.inline}>
            <Icon name="anchor" size={18} color="var(--color-accent)" />
            <span className={ui.rowMain}>
              <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`} style={{ fontSize: 14 }}>
                {grouping.anchor.name}
              </span>
              <span className={ui.rowMeta} style={{ display: 'block' }}>
                {formatClock(grouping.anchor.times.startMinutes)} –{' '}
                {formatClock(grouping.anchor.times.endMinutes)} ·{' '}
                {num(grouping.anchor.workedMinutes / 60, 2)} {t('hSuffix')}
              </span>
            </span>
            <Badge>{t('anchorTag')}</Badge>
          </div>
        </Card>
      ) : null}

      {rows.map((row) => {
        const width = Math.max(
          Math.min((row.overlapMinutes / anchorSpan) * 100, 100),
          row.overlapMinutes > 0 ? 3 : 0,
        );
        const reason =
          row.overlapMinutes === 0
            ? t('noOverlap')
            : row.included
              ? `${duration(row.overlapMinutes)} ${t('sharedTime')}`
              : t('tooShort').replace('{n}', `${minimum} ${t('minutesShort')}`);

        return (
          <div key={row.employeeId} className={styles.overlapRow}>
            <div className={ui.inline}>
              <span className={ui.rowMain}>
                <span
                  className={`${ui.rowTitle} ${ui.truncate}`}
                  style={{
                    color: row.included ? 'var(--color-text)' : 'var(--color-text-subtle)',
                  }}
                >
                  {row.name}
                </span>
                <span className={ui.rowMeta} style={{ display: 'block' }}>
                  {formatClock(row.times.startMinutes)} – {formatClock(row.times.endMinutes)}
                </span>
              </span>
              <span className={ui.rowTrailing}>
                <span
                  className="tabular"
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: row.included ? 'var(--color-text)' : 'var(--color-text-subtle)',
                  }}
                >
                  {num(row.workedMinutes / 60, 2)} {t('hSuffix')}
                </span>
                <span
                  className={ui.rowStatus}
                  style={{
                    display: 'block',
                    color: row.included ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  }}
                >
                  {row.included ? t('included') : t('excluded')}
                </span>
              </span>
            </div>
            <div className={ui.inline} style={{ gap: 8 }}>
              <span className={styles.overlapMeter}>
                <span
                  className={styles.overlapFill}
                  style={{
                    width: `${width}%`,
                    background: row.included
                      ? 'var(--color-primary)'
                      : 'var(--color-text-faint)',
                  }}
                />
              </span>
              <span className={styles.overlapReason}>{reason}</span>
            </div>
          </div>
        );
      })}
    </Screen>
  );
}
