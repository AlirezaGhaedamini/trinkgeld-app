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
  notificationBodyKey,
  notificationIcon,
  notificationTarget,
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
   * Where a notification takes you. The rule lives in the domain module, so
   * the chevron below and the tap below cannot disagree, and the offline check
   * drives the very same function.
   */
  const targetOf = (n: AppNotification): string | null =>
    notificationTarget(n, { role, distributions: mine.distributions, lineageHeadId });

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
            const date = n.payload.work_date
              ? day(new Date(`${n.payload.work_date}T12:00:00`))
              : period;
            const title = t(notificationTitleKey(n))
              .replace('{who}', n.payload.member_name ?? '')
              .replace('{when}', period);
            const body = t(notificationBodyKey(n)).replace('{when}', period).replace('{date}', date);
            return (
              <ListRow
                key={n.id}
                leading={
                  <Icon
                    name={notificationIcon(n)}
                    size={18}
                    color={n.readAt ? 'var(--color-text-muted)' : 'var(--color-accent)'}
                  />
                }
                title={title}
                meta={body}
                strong={!n.readAt}
                trailing={n.readAt ? null : <Badge tone="tint">{t('nNew')}</Badge>}
                chevron={targetOf(n) !== null}
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
