import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, PointsBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { AREA_ORDER } from '@/data/areas';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { useConfig } from '@/config/useConfig';
import { TEAM_FAILURE_KEY } from '@/team/errors';
import { useTeam } from '@/team/useTeam';
import type { MemberStatus, TeamMember } from '@/team/types';
import type { StringKey } from '@/i18n/strings';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

export const STATUS_KEY: Record<MemberStatus, StringKey> = {
  active: 'tmStatusActive',
  invited: 'tmStatusInvited',
  suspended: 'tmStatusSuspended',
  left: 'tmStatusLeft',
};

/** The roster — manager only. Real memberships, grouped by their real areas. */
export function TeamPage() {
  const team = useTeam();
  return team.enabled ? <RealTeam /> : <DemoTeam />;
}

function RealTeam() {
  const team = useTeam();
  const config = useConfig();
  const { t, num, people } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const areas = useMemo(
    () => (config.state?.areas ?? []).filter((a) => !a.archived),
    [config.state],
  );
  const roles = useMemo(() => config.state?.roles ?? [], [config.state]);
  const members = team.state?.members ?? [];
  const requests = team.state?.requests ?? [];
  const invites = team.state?.invites ?? [];

  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? null;
  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? null;

  const onRoster = members.filter((m) => m.status !== 'left');
  const gone = members.filter((m) => m.status === 'left');

  const approve = async (invitationId: string) => {
    const result = await team.approveRequest(invitationId, null, null);
    show(result.ok ? t('tmApproved') : t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
  };
  const decline = async (invitationId: string) => {
    const result = await team.declineRequest(invitationId);
    show(result.ok ? t('tmDeclined') : t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
  };
  const revoke = async (invitationId: string) => {
    const result = await team.revokeInvite(invitationId);
    show(result.ok ? t('tmRevoked') : t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const row = (member: TeamMember) => (
    <ListRow
      key={member.id}
      leading={<Avatar name={member.displayName} />}
      title={member.displayName}
      meta={
        [
          roleName(member.workplaceRoleId),
          member.role === 'manager' ? t('mgrRole') : null,
          member.status === 'active' ? null : t(STATUS_KEY[member.status]),
          member.isSelf ? t('tmYou') : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('tmNoRole')
      }
      onClick={() => navigate(`/manager/team/${member.id}`)}
      chevron
      trailing={<PointsBadge>×{num(member.multiplier, 2)}</PointsBadge>}
    />
  );

  if (team.status === 'error') {
    return (
      <Screen title={t('tabTeam')} titleSize={26} back={false} aboveTabs>
        <EmptyState title={t('authNetwork')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('tabTeam')}
      titleSize={26}
      back={false}
      aboveTabs
      action={{ label: t('invite'), icon: 'user-plus', onClick: () => navigate('/manager/invite') }}
    >
      <div className={styles.searchBar} role="search">
        <Icon name="magnifying-glass" size={17} />
        {t('search')} · {people(onRoster.length)}
      </div>

      {/* ── people asking to come in ─────────────────────────────────────── */}
      {requests.length > 0 ? (
        <div className={ui.stackTight}>
          <SectionLabel>{t('tmRequests')}</SectionLabel>
          <Card padding="none" clip>
            {requests.map((request) => (
              <div key={request.invitationId} className={ui.insetRow}>
                <span className={ui.rowMain}>
                  <span className={ui.rowTitle}>{request.requesterName}</span>
                  {request.proposedAreaId ? (
                    <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                      {areaName(request.proposedAreaId)}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={ui.chip}
                  disabled={team.busy}
                  onClick={() => void decline(request.invitationId)}
                >
                  {t('tmDecline')}
                </button>
                <button
                  type="button"
                  className={`${ui.chip} ${ui.chipSelected}`}
                  disabled={team.busy}
                  onClick={() => void approve(request.invitationId)}
                >
                  {t('tmApprove')}
                </button>
              </div>
            ))}
          </Card>
          <Note>{t('tmNamePrivacy')}</Note>
        </div>
      ) : null}

      {/* ── invitations still out ────────────────────────────────────────── */}
      {invites.length > 0 ? (
        <div className={ui.stackTight}>
          <SectionLabel>{t('tmInvites')}</SectionLabel>
          <Card padding="none" clip>
            {invites.map((invite) => (
              <div key={invite.invitationId} className={ui.insetRow}>
                <span className={`${ui.rowMain} ${ui.rowTitle}`}>{invite.email}</span>
                <Badge tone="quiet">
                  {invite.role === 'manager' ? t('mgrRole') : t('empRole')}
                </Badge>
                <button
                  type="button"
                  className={ui.chip}
                  disabled={team.busy}
                  onClick={() => void revoke(invite.invitationId)}
                >
                  {t('tmRevoke')}
                </button>
              </div>
            ))}
          </Card>
        </div>
      ) : null}

      {onRoster.length === 0 ? (
        <EmptyState title={t('tmEmptyRoster')}>{t('emptyTeamBody')}</EmptyState>
      ) : null}

      {/* ── the roster, by area ──────────────────────────────────────────── */}
      {areas.map((area) => {
        const inArea = onRoster.filter((m) => m.areaId === area.id);
        if (inArea.length === 0) return null;
        return (
          <section key={area.id} className={ui.stackFlush}>
            <SectionLabel meta={people(inArea.length)}>{area.name}</SectionLabel>
            {inArea.map(row)}
          </section>
        );
      })}

      {onRoster.some((m) => m.areaId === null) ? (
        <section className={ui.stackFlush}>
          <SectionLabel>{t('tmNoRole')}</SectionLabel>
          {onRoster.filter((m) => m.areaId === null).map(row)}
        </section>
      ) : null}

      {gone.length > 0 ? (
        <section className={ui.stackFlush}>
          <SectionLabel meta={people(gone.length)}>{t('tmStatusLeft')}</SectionLabel>
          {gone.map(row)}
        </section>
      ) : null}
    </Screen>
  );
}

/* ── demo mode — the Phase 1 dataset, untouched ───────────────────────────── */

function DemoTeam() {
  const state = useAppState();
  const { t, num, people, percent, area } = useI18n();
  const navigate = useNavigate();
  const alone = state.employees.length <= 1;

  return (
    <Screen
      title={t('tabTeam')}
      titleSize={26}
      back={false}
      aboveTabs
      action={{ label: t('invite'), icon: 'user-plus', onClick: () => navigate('/manager/invite') }}
    >
      <div className={styles.searchBar} role="search">
        <Icon name="magnifying-glass" size={17} />
        {t('search')} · {people(state.employees.length)}
      </div>

      {alone ? <EmptyState title={t('emptyTeam')}>{t('emptyTeamBody')}</EmptyState> : null}

      {AREA_ORDER.map((areaId) => {
        const members = state.employees.filter((employee) => employee.area === areaId);
        if (members.length === 0) return null;
        return (
          <section key={areaId} className={ui.stackFlush}>
            <SectionLabel
              meta={`${people(members.length)} · ${percent(state.rule.areaShares[areaId] ?? 0)}`}
            >
              {area(areaId)}
            </SectionLabel>
            {members.map((employee) => (
              <ListRow
                key={employee.id}
                leading={<Avatar name={employee.name} />}
                title={employee.name}
                meta={t(employee.roleId)}
                onClick={() => navigate(`/manager/team/${employee.id}`)}
                chevron
                trailing={
                  <PointsBadge>×{num(employee.points * employee.multiplier, 1)}</PointsBadge>
                }
              />
            ))}
          </section>
        );
      })}
    </Screen>
  );
}
