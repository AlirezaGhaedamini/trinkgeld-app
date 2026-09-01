import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoNote, Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Sheet } from '@/components/ui/Sheet';
import { AREA_ORDER } from '@/data/areas';
import { ROLES_BY_AREA, ROLE_POINTS } from '@/data/roles';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { shareOf } from '@/state/selectors';
import { useConfig } from '@/config/useConfig';
import { TEAM_FAILURE_KEY, type TeamFailure } from '@/team/errors';
import { useTeam } from '@/team/useTeam';
import {
  MULTIPLIER_MAX,
  MULTIPLIER_MIN,
  isLastManager,
  roleFitsArea,
  type MemberRole,
  type MemberStatus,
} from '@/team/types';
import { STATUS_KEY } from '@/pages/manager/TeamPage';
import type { AreaId, RoleId } from '@/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * One membership — the manager-only levers that decide how somebody's hours
 * count, and whether they can reach this workplace at all.
 *
 * Area and role always save together, because the database requires the role to
 * belong to the area (migration 20). Changing the area therefore clears a role
 * from the old one and asks for a new one — leaving it unset is legal, and the
 * engine falls back to the first role of the effective area.
 *
 * Nothing here deletes: removal is `status = 'left'`, so every shift and every
 * payout keeps pointing at a membership that still exists.
 */
export function MemberPage() {
  const team = useTeam();
  return team.enabled ? <RealMember /> : <DemoMember />;
}

function RealMember() {
  const team = useTeam();
  const config = useConfig();
  const { t, num, day } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const { employeeId } = useParams();

  const member = (team.state?.members ?? []).find((m) => m.id === employeeId) ?? null;
  const areas = useMemo(
    () => (config.state?.areas ?? []).filter((a) => !a.archived),
    [config.state],
  );
  const roles = useMemo(
    () => (config.state?.roles ?? []).filter((r) => !r.archived),
    [config.state],
  );

  const [areaId, setAreaId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [role, setRole] = useState<MemberRole>('employee');
  /** Suspending and removing are asked twice: the sheet says what will happen. */
  const [confirming, setConfirming] = useState<'suspended' | 'left' | null>(null);

  useEffect(() => {
    if (!member) return;
    setAreaId(member.areaId);
    setRoleId(member.workplaceRoleId);
    setMultiplier(member.multiplier);
    setRole(member.role);
  }, [member]);

  if (team.status === 'loading' && !member) {
    return (
      <Screen title={t('teamMember')}>
        <EmptyState title={t('dLoading')} />
      </Screen>
    );
  }
  if (!member) {
    return (
      <Screen title={t('teamMember')}>
        <EmptyState title={t('tmEmptyRoster')} />
      </Screen>
    );
  }

  const fail = (failure: TeamFailure | undefined) =>
    show(t(TEAM_FAILURE_KEY[failure ?? 'unknown']));

  const rolesHere = roles.filter((r) => r.areaId === areaId);
  const roleStale = !roleFitsArea(roleId, areaId, roles);
  const lastManager = isLastManager(member, team.state?.activeManagers ?? 0);

  const dirty =
    areaId !== member.areaId ||
    roleId !== member.workplaceRoleId ||
    multiplier !== member.multiplier ||
    role !== member.role;

  const save = async () => {
    const result = await team.saveMember(member.id, {
      areaId,
      workplaceRoleId: roleStale ? null : roleId,
      multiplier,
      role,
      status: member.status,
    });
    if (!result.ok) {
      fail(result.failure);
      return;
    }
    show(t('tmSaved'));
    navigate(-1);
  };

  const setStatus = async (next: MemberStatus) => {
    if (next === 'invited') return;
    const result = await team.setStatus(member.id, next);
    setConfirming(null);
    if (!result.ok) {
      fail(result.failure);
      return;
    }
    show(t('tmSaved'));
  };

  const step = (delta: number) =>
    setMultiplier((current) =>
      Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, Math.round((current + delta) * 100) / 100)),
    );

  const areaLabel = areas.find((a) => a.id === areaId)?.name ?? t('tmNoRole');
  const roleLabel = roles.find((r) => r.id === roleId)?.name ?? t('tmNoRole');

  return (
    <Screen
      title={t('teamMember')}
      cta={{
        label: t('save'),
        muted: team.busy || !dirty,
        onClick: () => void save(),
      }}
    >
      <div className={styles.identity}>
        <Avatar name={member.displayName} size={54} tinted />
        <div style={{ minWidth: 0 }}>
          <p className={styles.identityName} style={{ fontSize: 20 }}>
            {member.displayName}
          </p>
          <p className={styles.identityMeta}>
            {roleLabel} · {areaLabel}
          </p>
        </div>
      </div>

      {/* ── membership ───────────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('tmMembership')}</SectionLabel>
        <Card padding="none" clip>
          <div className={ui.insetRow}>
            <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('tmAccess')}</span>
            <Badge tone={member.status === 'active' ? 'tint' : 'quiet'}>
              {t(STATUS_KEY[member.status])}
            </Badge>
          </div>
          {member.joinedAt ? (
            <div className={ui.insetRow}>
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('tmJoined')}</span>
              <span className={ui.rowValue}>{day(new Date(member.joinedAt))}</span>
            </div>
          ) : null}
          {member.hasAccount ? null : (
            <div className={ui.insetRow}>
              <span className={`${ui.rowMain} ${ui.rowMeta}`}>{t('tmNoAccount')}</span>
            </div>
          )}
        </Card>
        <Note>{t('tmNamePrivacy')}</Note>
      </div>

      {/* ── manager or employee ──────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('iAm')}</SectionLabel>
        <ChipGroup<MemberRole>
          fill
          label={t('iAm')}
          value={role}
          options={[
            { value: 'employee', label: t('empRole') },
            { value: 'manager', label: t('mgrRole') },
          ]}
          onChange={(next) => (lastManager ? show(t('tmLastManager')) : setRole(next))}
        />
        {lastManager ? <InfoNote icon="shield-check">{t('tmLastManager')}</InfoNote> : null}
      </div>

      {/* ── area ─────────────────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('areaHead')}</SectionLabel>
        <ChipGroup<string>
          label={t('areaHead')}
          value={areaId ?? ''}
          options={areas.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(next) => {
            setAreaId(next);
            if (!roleFitsArea(roleId, next, roles)) setRoleId(null);
          }}
        />
      </div>

      {/* ── role ─────────────────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('roleHead')}</SectionLabel>
        <Card padding="none" clip>
          <button
            type="button"
            className={`${ui.insetRow} ${ui.insetRowInteractive}`}
            style={{ minHeight: 54 }}
            onClick={() => setRoleId(null)}
            aria-pressed={roleId === null}
          >
            <RadioDot on={roleId === null} />
            <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('tmNoRole')}</span>
          </button>
          {rolesHere.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              style={{ minHeight: 54 }}
              onClick={() => setRoleId(r.id)}
              aria-pressed={roleId === r.id}
            >
              <RadioDot on={roleId === r.id} />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{r.name}</span>
              <span className={ui.rowValue} style={{ fontSize: 14 }}>
                ×{num(r.points, 2)}
              </span>
            </button>
          ))}
        </Card>
        <Note>
          {areaId !== member.areaId && roleId === null ? t('tmAreaChanged') : t('tmNoRoleNote')}
        </Note>
      </div>

      {/* ── multiplier ───────────────────────────────────────────────────── */}
      <Card padding="padded">
        <div className={ui.inline}>
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{t('personalMult')}</span>
            <span className={ui.rowMeta} style={{ display: 'block' }}>
              {t('multNote')}
            </span>
          </span>
          <button
            type="button"
            className={ui.stepButton}
            style={{ width: 44, height: 44 }}
            onClick={() => step(-0.05)}
            aria-label={`${t('personalMult')} −`}
          >
            −
          </button>
          <span
            className="tabular"
            style={{ minWidth: 56, textAlign: 'center', fontSize: 16, fontWeight: 500 }}
          >
            ×{num(multiplier, 2)}
          </span>
          <button
            type="button"
            className={`${ui.stepButton} ${ui.stepButtonUp}`}
            style={{ width: 44, height: 44 }}
            onClick={() => step(0.05)}
            aria-label={`${t('personalMult')} +`}
          >
            +
          </button>
        </div>
      </Card>

      {/* ── access ───────────────────────────────────────────────────────── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('tmAccess')}</SectionLabel>
        {member.status === 'active' ? (
          <Button
            variant="ghost"
            muted={team.busy || lastManager}
            onClick={() => (lastManager ? show(t('tmLastManager')) : setConfirming('suspended'))}
          >
            {t('tmSuspend')}
          </Button>
        ) : (
          <Button variant="ghost" muted={team.busy} onClick={() => void setStatus('active')}>
            {t('tmReactivate')}
          </Button>
        )}
        {member.status === 'left' ? null : (
          <Button
            variant="ghost"
            muted={team.busy || lastManager}
            onClick={() => (lastManager ? show(t('tmLastManager')) : setConfirming('left'))}
          >
            {t('tmRemove')}
          </Button>
        )}
        <Note>{member.status === 'active' ? t('tmSuspendNote') : t('tmRemoveNote')}</Note>
      </div>

      {/* ── the second, deliberate tap ───────────────────────────────────── */}
      <Sheet
        open={confirming !== null}
        title={t(confirming === 'left' ? 'tmConfirmRemove' : 'tmConfirmSuspend').replace(
          '{name}',
          member.displayName,
        )}
        onClose={() => setConfirming(null)}
      >
        <div className={ui.stackTight}>
          <InfoNote icon="info">
            {t(confirming === 'left' ? 'tmConfirmRemoveBody' : 'tmConfirmSuspendBody')}
          </InfoNote>
          <Button
            muted={team.busy}
            onClick={() => void setStatus(confirming === 'left' ? 'left' : 'suspended')}
          >
            {t(confirming === 'left' ? 'tmRemove' : 'tmSuspend')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            {t('tmKeep')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

function DemoMember() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money, num, hours, dateFor, area } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const { employeeId } = useParams();

  const employee = state.employees.find((e) => e.id === employeeId) ?? state.employees[0];

  const payouts = state.distributions.slice(0, 4).map((distribution) => {
    const mine = shareOf(state, distribution, employee.id);
    return {
      id: distribution.id,
      date: dateFor(distribution.dateKey, distribution.date).split(' · ')[0],
      meta: mine.hours ? hours(mine.hours) : t('off'),
      amount: money(mine.amount),
    };
  });

  return (
    <Screen
      title={t('teamMember')}
      cta={{
        label: t('save'),
        onClick: () => {
          show(t('saved'));
          navigate(-1);
        },
      }}
    >
      <div className={styles.identity}>
        <Avatar name={employee.name} size={54} tinted />
        <div style={{ minWidth: 0 }}>
          <p className={styles.identityName} style={{ fontSize: 20 }}>
            {employee.name}
          </p>
          <p className={styles.identityMeta}>
            {t(employee.roleId)} · {area(employee.area)}
          </p>
        </div>
      </div>

      <div className={ui.stackTight}>
        <SectionLabel>{t('areaHead')}</SectionLabel>
        <ChipGroup<AreaId>
          label={t('areaHead')}
          value={employee.area}
          options={AREA_ORDER.map((areaId) => ({ value: areaId, label: area(areaId) }))}
          onChange={(next) =>
            dispatch({ type: 'setEmployeeArea', employeeId: employee.id, area: next })
          }
        />
      </div>

      <div className={ui.stackTight}>
        <SectionLabel>{t('roleHead')}</SectionLabel>
        <Card padding="none" clip>
          {ROLES_BY_AREA[employee.area].map((roleId: RoleId) => (
            <button
              key={roleId}
              type="button"
              className={`${ui.insetRow} ${ui.insetRowInteractive}`}
              style={{ minHeight: 54 }}
              onClick={() =>
                dispatch({ type: 'setEmployeeRole', employeeId: employee.id, roleId })
              }
              aria-pressed={roleId === employee.roleId}
            >
              <RadioDot on={roleId === employee.roleId} />
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t(roleId)}</span>
              <span className={ui.rowValue} style={{ fontSize: 14 }}>
                ×{num(ROLE_POINTS[roleId], 1)}
              </span>
            </button>
          ))}
        </Card>
        <Note>{t('rolePointsNote')}</Note>
      </div>

      <Card padding="padded">
        <div className={ui.inline}>
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{t('personalMult')}</span>
            <span className={ui.rowMeta} style={{ display: 'block' }}>
              {t('multNote')}
            </span>
          </span>
          <button
            type="button"
            className={ui.stepButton}
            style={{ width: 44, height: 44 }}
            onClick={() =>
              dispatch({ type: 'adjustMultiplier', employeeId: employee.id, delta: -0.05 })
            }
            aria-label={`${t('personalMult')} −`}
          >
            −
          </button>
          <span
            className="tabular"
            style={{ minWidth: 56, textAlign: 'center', fontSize: 16, fontWeight: 500 }}
          >
            ×{num(employee.multiplier, 2)}
          </span>
          <button
            type="button"
            className={`${ui.stepButton} ${ui.stepButtonUp}`}
            style={{ width: 44, height: 44 }}
            onClick={() =>
              dispatch({ type: 'adjustMultiplier', employeeId: employee.id, delta: 0.05 })
            }
            aria-label={`${t('personalMult')} +`}
          >
            +
          </button>
        </div>
      </Card>

      <Card padding="padded">
        <div className={ui.stackTight}>
          <p className={ui.noteBody} style={{ fontSize: 13 }}>
            {t('last4')}
          </p>
          {payouts.map((payout) => (
            <div key={payout.id} className={ui.inline} style={{ fontSize: 14 }}>
              <span className={ui.rowMain}>{payout.date}</span>
              <span className={ui.rowMeta} style={{ marginRight: 12 }}>
                {payout.meta}
              </span>
              <span
                className="tabular"
                style={{ fontWeight: 600, color: 'var(--color-money-row)' }}
              >
                {payout.amount}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </Screen>
  );
}
