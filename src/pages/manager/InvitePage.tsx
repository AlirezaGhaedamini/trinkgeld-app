import { useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { InfoNote, Lede, Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { useWorkplace } from '@/hooks/useWorkplace';
import { useConfig } from '@/config/useConfig';
import { TEAM_FAILURE_KEY } from '@/team/errors';
import { useTeam } from '@/team/useTeam';
import { joinLinkFor, roleFitsArea, type MemberRole } from '@/team/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * Two ways in: the workplace code anyone can use to ask, and a named
 * invitation a manager sends.
 *
 * create_invitation() returns the raw token exactly once — the database keeps
 * only its SHA-256 — so it is shown here, on the screen that made it, and never
 * in a list. It is shown as the link it travels in, `#/join?token=…`, because
 * 64 hex characters are something to open, not something to read out: the
 * six-character workplace code above is the thing a person types.
 */
export function InvitePage() {
  const team = useTeam();
  return team.enabled ? <RealInvite /> : <DemoInvite />;
}

function RealInvite() {
  const team = useTeam();
  const config = useConfig();
  const workplace = useWorkplace();
  const { t } = useI18n();
  const { show } = useToast();

  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('employee');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [invitedName, setInvitedName] = useState('');
  /* Delivery is a separate story from the invitation. `pending` holds what is
     needed to try again within this page session — the raw token is returned
     once and is never fetched back, so a refresh ends the possibility of a
     resend and the copy-link is what remains. */
  const [pending, setPending] = useState<{ id: string; token: string; email: string } | null>(null);
  const [mail, setMail] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const areas = useMemo(
    () => (config.state?.areas ?? []).filter((a) => !a.archived),
    [config.state],
  );
  const roles = useMemo(
    () => (config.state?.roles ?? []).filter((r) => !r.archived && r.areaId === areaId),
    [config.state, areaId],
  );

  const joinCode = workplace.activeMembership?.workplace.joinCode ?? '';
  const invites = team.state?.invites ?? [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinCode);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
    setCopied(true);
    show(t('copied'));
  };

  /* Both the email and the name are checked here first: the database refuses
     both anyway, but its refusal of an empty roster name is a bare check
     constraint that no classifier can turn into advice. */
  const ready = email.trim().length > 0 && name.trim().length > 0;

  const send = async () => {
    if (team.busy) return;
    if (email.trim().length === 0) {
      show(t('tmErrNoEmail'));
      return;
    }
    if (name.trim().length === 0) {
      show(t('tmErrNoName'));
      return;
    }
    const result = await team.createInvitation({
      email: email.trim(),
      displayName: name.trim(),
      role,
      areaId,
      workplaceRoleId: roleFitsArea(roleId, areaId, config.state?.roles ?? []) ? roleId : null,
    });
    if (!result.ok) {
      show(t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    setLink(result.value?.token ? joinLinkFor(window.location, result.value.token) : null);
    setLinkCopied(false);
    setInvitedName(name.trim());
    const sentTo = email.trim();
    setEmail('');
    setName('');
    show(t('tmInviteCreated'));

    // The invitation exists and the link is on screen. Everything from here is
    // delivery, and none of it can undo that.
    const invitationId = result.value?.invitationId ?? '';
    const token = result.value?.token ?? '';
    if (!invitationId || !token) return;
    setPending({ id: invitationId, token, email: sentTo });
    setMail('sending');
    setMail((await team.sendInvitationEmail(invitationId, token)) ? 'sent' : 'failed');
  };

  const retryEmail = async () => {
    if (!pending || mail === 'sending') return;
    setMail('sending');
    setMail((await team.sendInvitationEmail(pending.id, pending.token)) ? 'sent' : 'failed');
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* clipboard blocked — the link is on screen anyway */
    }
    setLinkCopied(true);
    show(t('copied'));
  };

  return (
    <Screen title={t('inviteTitle')}>
      <Lede>{t('inviteBody')}</Lede>

      <Card tone="primary" padding="none" className={styles.inviteCode}>
        <span className={ui.fieldLabel} style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t('workplaceCode')}
        </span>
        <strong className={styles.inviteCodeValue}>{joinCode}</strong>
      </Card>

      <Button variant="secondary" quiet block icon={copied ? 'check' : 'copy'} onClick={copy}>
        {copied ? t('copied') : t('copyCode')}
      </Button>

      {/* ── a named invitation ───────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('invite')}</SectionLabel>
        <label className={ui.fieldLabel} htmlFor="invite-email">
          {t('emailLabel')}
        </label>
        <input
          id="invite-email"
          className={ui.fieldInput}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder={t('emailLabel')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label className={ui.fieldLabel} htmlFor="invite-name">
          {t('nameLabel')}
        </label>
        <input
          id="invite-name"
          className={ui.fieldInput}
          type="text"
          maxLength={60}
          placeholder={t('nameLabel')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <SectionLabel>{t('tmInviteRole')}</SectionLabel>
        <ChipGroup<MemberRole>
          fill
          label={t('tmInviteRole')}
          value={role}
          options={[
            { value: 'employee', label: t('empRole') },
            { value: 'manager', label: t('mgrRole') },
          ]}
          onChange={setRole}
        />

        <SectionLabel>{t('areaHead')}</SectionLabel>
        <ChipGroup<string>
          label={t('areaHead')}
          value={areaId ?? ''}
          options={areas.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(next) => {
            setAreaId(next);
            setRoleId(null);
          }}
        />

        {roles.length > 0 ? (
          <>
            <SectionLabel>{t('roleHead')}</SectionLabel>
            <ChipGroup<string>
              label={t('roleHead')}
              value={roleId ?? ''}
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
              onChange={setRoleId}
            />
          </>
        ) : null}

        <Button block muted={!ready} disabled={team.busy} onClick={() => void send()}>
          {t('invite')}
        </Button>
      </div>

      {link ? (
        <Card tone="primary" padding="padded">
          <div className={ui.stackTight}>
            <p className={ui.fieldLabel}>{t('tmInviteLink')}</p>
            <p style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</p>
            <Button
              variant="secondary"
              quiet
              block
              icon={linkCopied ? 'check' : 'copy'}
              onClick={() => void copyLink()}
            >
              {linkCopied ? t('copied') : t('tmCopyLink')}
            </Button>
            <InfoNote icon="info">{t('tmInviteShare').replace('{name}', invitedName)}</InfoNote>

            {/* Delivery, reported separately from the invitation on purpose.
                The copy button above is always there, whatever this says. */}
            {mail === 'sending' ? <InfoNote icon="info">{t('tmEmailSending')}</InfoNote> : null}
            {mail === 'sent' ? (
              <InfoNote icon="check">
                {t('tmEmailSent').replace('{email}', pending?.email ?? '')}
              </InfoNote>
            ) : null}
            {mail === 'failed' ? (
              <>
                <InfoNote icon="info">{t('tmEmailFailed')}</InfoNote>
                <Button
                  variant="secondary"
                  quiet
                  block
                  disabled={team.busy}
                  onClick={() => void retryEmail()}
                >
                  {t('tmEmailRetry')}
                </Button>
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className={ui.stackFlush}>
        <SectionLabel>{t('pendingInvites')}</SectionLabel>
        {!team.state && team.status !== 'error' ? <EmptyState title={t('dLoading')} /> : null}
        {team.state && invites.length === 0 ? <EmptyState title={t('emptyInvites')} /> : null}
        {!team.state && team.status === 'error' ? <EmptyState title={t('loadFailed')} /> : null}
        {invites.map((invite) => (
          <ListRow
            key={invite.invitationId}
            title={invite.email ?? ''}
            meta={invite.role === 'manager' ? t('mgrRole') : t('empRole')}
            trailing={
              <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>{t('invited')}</span>
            }
          />
        ))}
        <Note>{t('tmNamePrivacy')}</Note>
      </div>
    </Screen>
  );
}

function DemoInvite() {
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
