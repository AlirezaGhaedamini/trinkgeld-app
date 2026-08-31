import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { Lede } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** Share the workplace code; approve the people who ask to join. */
export function InvitePage() {
  const state = useAppState();
  const { t, area } = useI18n();
  const { show } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.workplace.joinCode);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
    setCopied(true);
    show(t('copied'));
  };

  return (
    <Screen title={t('inviteTitle')}>
      <Lede>{t('inviteBody')}</Lede>

      <Card tone="primary" padding="none" className={styles.inviteCode}>
        <span className={ui.fieldLabel} style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t('workplaceCode')}
        </span>
        <strong className={styles.inviteCodeValue}>{state.workplace.joinCode}</strong>
      </Card>

      <Button
        variant="secondary"
        quiet
        block
        icon={copied ? 'check' : 'copy'}
        onClick={copy}
      >
        {copied ? t('copied') : t('copyCode')}
      </Button>

      <div className={ui.stackFlush}>
        <SectionLabel>{t('pendingInvites')}</SectionLabel>
        {state.invites.length === 0 ? <EmptyState title={t('emptyInvites')} /> : null}
        {state.invites.map((invite) => (
          <ListRow
            key={invite.id}
            title={invite.name}
            meta={`${area(invite.area)} · ${t(invite.roleId)}`}
            trailing={
              <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>
                {invite.status === 'invited' ? t('invited') : t('requested')}
              </span>
            }
          />
        ))}
      </div>
    </Screen>
  );
}
