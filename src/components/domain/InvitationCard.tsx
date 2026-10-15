import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useI18n } from '@/hooks/useI18n';
import type { InvitationPreview } from '@/workplace/types';
import ui from '@/components/ui/ui.module.css';

/**
 * "You've been invited to Cafe Test" — the facts a manager entered, shown to
 * the person they entered them for.
 *
 * Built from the existing card and row classes only: the sign-up screen and
 * the join screen show the same card, so the person recognises the invitation
 * they are acting on from one screen to the next. The workplace role is the
 * one the manager picked; when they picked none, the membership role stands
 * in, because "employee" or "manager" is still what the invitation says.
 *
 * Only an open invitation has anything to show — the server nulls the details
 * of a closed one — so the card renders nothing for any other status.
 */
export function InvitationCard({ preview }: { preview: InvitationPreview }) {
  const { t } = useI18n();
  if (preview.status !== 'pending') return null;
  const roleLabel =
    preview.roleName ?? (preview.proposedRole === 'manager' ? t('mgrRole') : t('empRole'));

  return (
    <Card tone="primary" padding="padded">
      <div className={ui.stackTight}>
        <div>
          <span className={ui.fieldLabel}>{t('invitedTo')}</span>
          <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`} style={{ display: 'block' }}>
            {preview.workplaceName}
          </span>
        </div>

        <div className={ui.inline}>
          <Icon name="user" size={21} color="var(--color-accent)" />
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>
              {preview.invitedName ?? preview.email ?? ''}
            </span>
            {preview.email ? <span className={ui.rowMeta}>{preview.email}</span> : null}
          </span>
        </div>

        <div className={ui.inline}>
          <Icon name="briefcase" size={21} color="var(--color-accent)" />
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>
              {preview.areaName ?? t('inviteNoArea')}
            </span>
            <span className={ui.rowMeta}>{roleLabel}</span>
          </span>
        </div>
      </div>
    </Card>
  );
}
