import { useEffect, useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { InfoNote, Lede, Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Sheet } from '@/components/ui/Sheet';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { CONFIG_FAILURE_KEY, type ConfigFailure } from '@/config/errors';
import { useConfig } from '@/config/useConfig';
import { moved, roleIsUnused, type ConfigRole, type RoleUsage } from '@/config/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

const MIN_POINTS = 0.1;
const MAX_POINTS = 5;

/**
 * The roles inside each area, and what an hour of each is worth — manager only.
 *
 * `workplace_roles.points` is the live input: activate_rule() copies it onto the
 * next rule version, and a version already in force keeps the copy it froze. So
 * a row whose current points differ from what is in force says both numbers,
 * because only one of them is being paid today.
 *
 * A role belongs to exactly one area and the database refuses any other pairing,
 * so roles are grouped under their area and created from inside it.
 */
export function RolesPage() {
  const config = useConfig();
  const { t, num } = useI18n();
  const { show } = useToast();

  const [reordering, setReordering] = useState(false);
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [points, setPoints] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<ConfigRole | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [usage, setUsage] = useState<RoleUsage | null>(null);

  const areas = useMemo(
    () => (config.state?.areas ?? []).filter((a) => !a.archived),
    [config.state],
  );
  const roles = useMemo(() => config.state?.roles ?? [], [config.state]);

  useEffect(() => {
    const nextOrders: Record<string, string[]> = {};
    const nextPoints: Record<string, number> = {};
    for (const role of roles) {
      nextPoints[role.id] = role.points;
      if (role.archived) continue;
      (nextOrders[role.areaId] ??= []).push(role.id);
    }
    setOrders(nextOrders);
    setPoints(nextPoints);
  }, [roles]);

  if (!config.enabled) {
    return (
      <Screen title={t('cfgRolesTitle')} back="arrow">
        <EmptyState title={t('ruleReadOnly')} />
      </Screen>
    );
  }

  const fail = (failure: ConfigFailure | undefined, count?: number | null) => {
    const base = t(CONFIG_FAILURE_KEY[failure ?? 'unknown']);
    show(count ? `${base} (${count})` : base);
  };

  const archived = roles.filter((r) => r.archived);
  const changed = roles.filter((r) => !r.archived && (points[r.id] ?? r.points) !== r.points);
  const pending = roles.some(
    (r) => !r.archived && r.activePoints !== null && r.activePoints !== (points[r.id] ?? r.points),
  );

  const savePoints = async () => {
    if (changed.length === 0) {
      show(t('ruleUnchanged'));
      return;
    }
    for (const role of changed) {
      const result = await config.updateRole(role.id, { points: points[role.id] ?? role.points });
      if (!result.ok) {
        fail(result.failure, result.count);
        return;
      }
    }
    show(t('rolePointsSaved'));
  };

  const openEditor = async (role: ConfigRole) => {
    setEditing(role);
    setCreatingIn(null);
    setName(role.name);
    setUsage(null);
    const result = await config.roleUsage(role.id);
    if (result.ok) setUsage(result.value ?? null);
  };

  const close = () => {
    setEditing(null);
    setCreatingIn(null);
  };

  const save = async () => {
    const result = creatingIn
      ? await config.createRole(creatingIn, name, 1)
      : await config.updateRole(editing!.id, { name });
    if (!result.ok) {
      fail(result.failure, result.count);
      return;
    }
    show(t('cfgSaved'));
    close();
  };

  const archive = async () => {
    const result = await config.archiveRole(editing!.id);
    if (!result.ok) {
      fail(result.failure, result.count);
      return;
    }
    show(t('cfgArchivedToast'));
    close();
  };

  const remove = async () => {
    const result = await config.deleteRole(editing!.id);
    if (!result.ok) {
      fail(result.failure, result.count);
      return;
    }
    show(t('cfgDeletedToast'));
    close();
  };

  const restore = async (role: ConfigRole) => {
    const result = await config.restoreRole(role.id);
    show(result.ok ? t('cfgRestoredToast') : t(CONFIG_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const move = async (areaId: string, roleId: string, delta: -1 | 1) => {
    const current = orders[areaId] ?? [];
    const next = moved(current, roleId, delta);
    if (next === current) return;
    setOrders({ ...orders, [areaId]: next });
    const result = await config.reorderRoles(areaId, next);
    if (!result.ok) fail(result.failure, result.count);
  };

  return (
    <Screen
      title={t('cfgRolesTitle')}
      back="arrow"
      action={{
        label: reordering ? t('cfgReorderDone') : t('cfgReorder'),
        onClick: () => setReordering((value) => !value),
      }}
      cta={
        reordering
          ? undefined
          : {
              label: t('save'),
              muted: config.busy || changed.length === 0,
              onClick: () => void savePoints(),
            }
      }
    >
      <Lede>{t('rolePointsD')}</Lede>

      {areas.map((area) => {
        const list = (orders[area.id] ?? [])
          .map((id) => roles.find((r) => r.id === id))
          .filter((r): r is ConfigRole => Boolean(r));
        return (
          <div key={area.id} className={ui.stackTight}>
            <SectionLabel>{area.name}</SectionLabel>
            <Card padding="none" clip>
              {list.length === 0 ? (
                <div className={ui.insetRow}>
                  <span className={`${ui.rowMain} ${ui.rowMeta}`}>{t('cfgNoRoles')}</span>
                </div>
              ) : null}
              {list.map((role, index) => {
                const value = points[role.id] ?? role.points;
                const drifted = role.activePoints !== null && role.activePoints !== value;
                const sliderId = `points-${role.id}`;
                return reordering ? (
                  <div key={role.id} className={ui.insetRow}>
                    <span className={`${ui.rowMain} ${ui.rowTitle}`}>{role.name}</span>
                    <button
                      type="button"
                      className={ui.chip}
                      aria-label={`${t('cfgMoveUp')} — ${role.name}`}
                      disabled={index === 0 || config.busy}
                      onClick={() => void move(area.id, role.id, -1)}
                    >
                      <Icon name="caret-right" size={12} style={{ transform: 'rotate(-90deg)' }} />
                    </button>
                    <button
                      type="button"
                      className={ui.chip}
                      aria-label={`${t('cfgMoveDown')} — ${role.name}`}
                      disabled={index === list.length - 1 || config.busy}
                      onClick={() => void move(area.id, role.id, 1)}
                    >
                      <Icon name="caret-right" size={12} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                  </div>
                ) : (
                  <div key={role.id} className={styles.areaCard} style={{ padding: '12px 14px' }}>
                    <div className={ui.inline}>
                      <span className={ui.rowMain}>
                        <label htmlFor={sliderId} className={ui.rowTitle}>
                          {role.name}
                        </label>
                        {drifted ? (
                          <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                            {t('rolePointsFrozen')}: ×{num(role.activePoints ?? 0, 2)}
                          </span>
                        ) : null}
                      </span>
                      <Badge tone={drifted ? 'tint' : 'quiet'}>×{num(value, 2)}</Badge>
                      <button
                        type="button"
                        className={ui.chip}
                        aria-label={`${t('cfgEditRole')} — ${role.name}`}
                        onClick={() => void openEditor(role)}
                      >
                        <Icon name="caret-right" size={12} />
                      </button>
                    </div>
                    <input
                      id={sliderId}
                      className={ui.range}
                      type="range"
                      min={MIN_POINTS}
                      max={MAX_POINTS}
                      step={0.1}
                      value={value}
                      onChange={(event) =>
                        setPoints((current) => ({
                          ...current,
                          [role.id]: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                );
              })}
            </Card>
            {reordering ? null : (
              <button
                type="button"
                className={ui.insetRow}
                style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--ring)', minHeight: 48 }}
                onClick={() => {
                  setCreatingIn(area.id);
                  setEditing(null);
                  setName('');
                  setUsage(null);
                }}
              >
                <Icon name="plus" size={16} color="var(--color-accent)" />
                <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  {t('cfgAddRole')}
                </span>
              </button>
            )}
          </div>
        );
      })}

      <Note>{t('rolePointsRange')}</Note>
      {pending ? <InfoNote icon="info">{t('cfgRolePointsNote')}</InfoNote> : null}

      {archived.length > 0 ? (
        <div className={ui.stackTight}>
          <SectionLabel>{t('cfgArchivedHead')}</SectionLabel>
          <Card padding="none" clip>
            {archived.map((role) => (
              <div key={role.id} className={ui.insetRow}>
                <span
                  className={`${ui.rowMain} ${ui.rowTitle}`}
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {role.name}
                </span>
                <button
                  type="button"
                  className={ui.chip}
                  disabled={config.busy}
                  onClick={() => void restore(role)}
                >
                  {t('cfgRestore')}
                </button>
              </div>
            ))}
          </Card>
          <Note>{t('cfgArchivedNote')}</Note>
        </div>
      ) : null}

      <Sheet
        open={creatingIn !== null || editing !== null}
        title={creatingIn ? t('cfgNewRole') : t('cfgEditRole')}
        onClose={close}
      >
        <div className={ui.stackTight}>
          <label className={ui.fieldLabel} htmlFor="role-name">
            {t('cfgNameLabel')}
          </label>
          <input
            id="role-name"
            className={ui.fieldInput}
            type="text"
            maxLength={40}
            placeholder={t('cfgNameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          {editing && usage ? (
            <>
              <SectionLabel>{t('cfgUsageTitle')}</SectionLabel>
              <Card padding="none" clip>
                {[
                  [usage.members, t('cfgUsageMembers')],
                  [usage.openShifts, t('cfgUsageShifts')],
                  [usage.ruleVersions, t('cfgUsageDistributions')],
                ].map(([count, label]) => (
                  <div key={String(label)} className={ui.insetRow}>
                    <span className={`${ui.rowMain} ${ui.rowTitle}`}>{label}</span>
                    <span className={`${ui.rowValue} tabular`}>{count}</span>
                  </div>
                ))}
              </Card>
              {roleIsUnused(usage) ? <Note>{t('cfgUsageNone')}</Note> : null}
              <InfoNote icon="info">{t('cfgArchiveNote')}</InfoNote>
            </>
          ) : null}

          <Button onClick={() => void save()} muted={config.busy || name.trim().length === 0}>
            {t('save')}
          </Button>

          {editing ? (
            roleIsUnused(usage) ? (
              <Button variant="ghost" onClick={() => void remove()}>
                {t('cfgDelete')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void archive()}>
                {t('cfgArchive')}
              </Button>
            )
          ) : null}
        </div>
      </Sheet>
    </Screen>
  );
}
