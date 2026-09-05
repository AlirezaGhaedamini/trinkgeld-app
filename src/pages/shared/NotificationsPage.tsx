import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useI18n } from '@/hooks/useI18n';
import { useActiveRole } from '@/hooks/useWorkplace';
import { useNotifications } from '@/notifications/useNotifications';
import {
  NOTIFICATION_ICON,
  isManagerNotification,
  notificationBodyKey,
  notificationTitleKey,
  type AppNotification,
} from '@/notifications/types';
import { lineageHeadId } from '@/distribution/ack';
import { useMyShare } from '@/distribution/useDistribution';
import ui from '@/components/ui/ui.module.css';

/**
 * The inbox.
 *
 * One screen for both roles, because the difference is which events arrive and
 * that is decided in the database, not here. Built only from primitives that
 * already exist — Screen, SectionLabel, ListRow, Badge, EmptyState — so the
 * design freeze holds and no new visual vocabulary is introduced.
 */
export function NotificationsPage() {
  const { t, day } = useI18n();
  const navigate = useNavigate();
  const role = useActiveRole();
  const inbox = useNotifications();
  const mine = useMyShare();

  /**
   * Where a notification takes you.
   *
   * A manager goes to the manager view of the night, which handles every
   * version including a replaced one. An employee goes to their own share — and
   * to the version that is CURRENT, resolved forward through the lineage, so
   * nobody is dropped onto a cancelled distribution they can no longer act on
   * when a live replacement exists.
   */
  const targetOf = (n: AppNotification): string | null => {
    if (!n.distributionId) return null;
    if (isManagerNotification(n) || role === 'manager') {
      return `/manager/distributions/${n.distributionId}`;
    }
    const visible = (id: string) => mine.distributions.some((d) => d.id === id);
    const head = lineageHeadId(mine.distributions, n.distributionId);
    if (visible(head)) return `/payout/${head}`;

    /* A member can be dropped from a correction — their hours rejected, their
       area moved to a zero share — and then they hold no entry on the version
       the notification names, so member_distributions will not show it to them.
       They still hold an entry on the version it replaced, which is exactly the
       row whose superseded_by (migration 31) points at what they cannot see.
       Land them there, where the "Replaced" badge tells the story. Never on a
       route the database would answer with nothing. */
    const predecessor = mine.distributions.find(
      (d) => d.supersededBy === head || d.supersededBy === n.distributionId,
    );
    return predecessor ? `/payout/${predecessor.id}` : null;
  };

  const open = async (n: AppNotification) => {
    const to = targetOf(n);
    if (!n.readAt) await inbox.markRead(n.id);
    if (to) navigate(to);
  };

  if (!inbox.enabled) {
    return (
      <Screen title={t('nTitle')}>
        <EmptyState title={t('nEmpty')}>{t('nEmptyBody')}</EmptyState>
      </Screen>
    );
  }

  return (
    <Screen title={t('nTitle')}>
      {inbox.notifications.length === 0 ? (
        <EmptyState title={t('nEmpty')}>{t('nEmptyBody')}</EmptyState>
      ) : (
        <>
          <SectionLabel>{t('nRecent')}</SectionLabel>
          {inbox.notifications.map((n) => {
            const period = n.payload.period_start
              ? day(new Date(`${n.payload.period_start}T12:00:00`))
              : '';
            const title = t(notificationTitleKey(n))
              .replace('{who}', n.payload.member_name ?? '')
              .replace('{when}', period);
            const body = t(notificationBodyKey(n)).replace('{when}', period);
            return (
              <ListRow
                key={n.id}
                leading={
                  <Icon
                    name={NOTIFICATION_ICON[n.type]}
                    size={18}
                    color={n.readAt ? 'var(--color-text-muted)' : 'var(--color-accent)'}
                  />
                }
                title={title}
                meta={body}
                strong={!n.readAt}
                trailing={n.readAt ? null : <Badge tone="tint">{t('nNew')}</Badge>}
                chevron={Boolean(n.distributionId)}
                onClick={() => void open(n)}
              />
            );
          })}

          {inbox.unread > 0 ? (
            <Button
              variant="secondary"
              onClick={() => void inbox.markAllRead()}
              disabled={inbox.busy}
            >
              {t('nMarkAll')}
            </Button>
          ) : null}
        </>
      )}

      <p className={ui.rowMeta}>{t('nFootnote')}</p>
    </Screen>
  );
}
