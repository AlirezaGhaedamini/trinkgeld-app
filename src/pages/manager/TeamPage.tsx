import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, PointsBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { InfoNote, Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Sheet } from '@/components/ui/Sheet';
import { AREA_ORDER } from '@/data/areas';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { useConfig } from '@/config/useConfig';
import { TEAM_FAILURE_KEY } from '@/team/errors';
import { useTeam } from '@/team/useTeam';
import { roleFitsArea, type MemberStatus, type PendingRequest, type TeamMember } from '@/team/types';
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

  /* ── letting somebody in ─────────────────────────────────────────────────
     approve_join_request() takes an area and a role. Sending neither, as this
     screen used to, made a member the engine leaves out of every distribution
     and told the manager nothing. The area is asked for and required; the
     role stays optional, exactly as the backend allows, and the request's own
     proposed area is offered first when there is one. */
  const [approving, setApproving] = useState<PendingRequest | null>(null);
  const [approveAreaId, setApproveAreaId] = useState<string | null>(null);
  const [approveRoleId, setApproveRoleId] = useState<string | null>(null);
  const liveRoles = useMemo(() => roles.filter((r) => !r.archived), [roles]);
  const rolesForApprove = liveRoles.filter((r) => r.areaId === approveAreaId);

  const openApprove = (request: PendingRequest) => {
    setApproving(request);
    setApproveAreaId(request.proposedAreaId);
    setApproveRoleId(null);
  };
  const confirmApprove = async () => {
    if (!approving || !approveAreaId || team.busy) return;
    const roleId = roleFitsArea(approveRoleId, approveAreaId, liveRoles) ? approveRoleId : null;
    const result = await team.approveRequest(approving.invitationId, approveAreaId, roleId);
    /* A refusal keeps the sheet and the choices on screen: the message says
       what to change, and the button is there to try again. */
    if (!result.ok) {
      show(t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    setApproving(null);
    show(t('tmApproved'));
  };
  const decline = async (invitationId: string) => {
    const result = await team.declineRequest(invitationId);
    show(result.ok ? t('tmDeclined') : t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
  };
  const revoke = async (invitationId: string) => {
    const result = await team.revokeInvite(invitationId);
    show(result.ok ? t('tmRevoked') : t(TEAM_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const row = (member: TeamMember) => {
    const details =
      [
        roleName(member.workplaceRoleId),
        member.role === 'manager' ? t('mgrRole') : null,
        member.status === 'active' ? null : t(STATUS_KEY[member.status]),
        member.isSelf ? t('tmYou') : null,
      ]
        .filter(Boolean)
        .join(' · ') || t('tmNoRole');
    return (
    <ListRow
      key={member.id}
      leading={<Avatar name={member.displayName} />}
      title={member.displayName}
      meta={
        /* The address on a line of its own, in the same meta type, so the
           details above it read exactly as they did. Truncated rather than
           wrapped: an email has no spaces to break at, and a long one would
           otherwise push the row wider than a 320 px screen. The full address
           is on the member's own screen. Members without one keep their row
           exactly as it was. */
        member.email ? (
          <>
            {details}
            <span className={ui.truncate} style={{ display: 'block' }}>
              {member.email}
            </span>
          </>
        ) : (
          details
        )
      }
      onClick={() => navigate(`/manager/team/${member.id}`)}
      chevron
      trailing={<PointsBadge>×{num(member.multiplier, 2)}</PointsBadge>}
    />
    );
  };

  /* Nothing is shown as "nobody here" until the roster has actually arrived:
     a slow or failed fetch is said out loud instead. */
  if (!team.state) {
    return (
      <Screen
        title={t('tabTeam')}
        titleSize={26}
        back={false}
        aboveTabs
        action={{ label: t('invite'), icon: 'user-plus', onClick: () => navigate('/manager/invite') }}
      >
        {team.status === 'error' ? (
          <>
            <EmptyState title={t('loadFailed')} />
            <Button variant="secondary" block onClick={() => void team.refresh()}>
              {t('retry')}
            </Button>
          </>
        ) : (
          <EmptyState title={t('dLoading')} />
        )}
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
                  onClick={() => openApprove(request)}
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
          <SectionLabel>{t('tmNoArea')}</SectionLabel>
          {onRoster.filter((m) => m.areaId === null).map(row)}
          <Note>{t('tmNoAreaNote')}</Note>
        </section>
      ) : null}

      {gone.length > 0 ? (
        <section className={ui.stackFlush}>
          <SectionLabel meta={people(gone.length)}>{t('tmStatusLeft')}</SectionLabel>
          {gone.map(row)}
        </section>
      ) : null}

      <Sheet
        open={approving !== null}
        title={t('tmApproveTitle').replace('{name}', approving?.requesterName ?? '')}
        onClose={() => setApproving(null)}
      >
        <div className={ui.stackTight}>
          <InfoNote icon="info">{t('tmApproveBody')}</InfoNote>

          <SectionLabel>{t('areaHead')}</SectionLabel>
          {areas.length === 0 && config.status !== 'ready' ? (
            <EmptyState title={t('dLoading')} />
          ) : (
            <ChipGroup<string>
              label={t('areaHead')}
              value={approveAreaId ?? ''}
              options={areas.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(next) => {
                setApproveAreaId(next);
                if (!roleFitsArea(approveRoleId, next, liveRoles)) setApproveRoleId(null);
              }}
            />
          )}

          {rolesForApprove.length > 0 ? (
            <>
              <SectionLabel>{t('tmRoleOptional')}</SectionLabel>
              <ChipGroup<string>
                label={t('tmRoleOptional')}
                value={approveRoleId ?? ''}
                options={[
                  { value: '', label: t('tmNoRole') },
                  ...rolesForApprove.map((r) => ({ value: r.id, label: r.name })),
                ]}
                onChange={(next) => setApproveRoleId(next || null)}
              />
            </>
          ) : null}

          <Button disabled={team.busy || !approveAreaId} onClick={() => void confirmApprove()}>
            {t('tmApprove')}
          </Button>
          <Button variant="ghost" onClick={() => setApproving(null)}>
            {t('back')}
          </Button>
        </div>
      </Sheet>
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
