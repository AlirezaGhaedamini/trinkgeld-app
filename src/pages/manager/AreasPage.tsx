import { useEffect, useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { InfoNote, Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { iconForAreaKey } from '@/data/areas';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { CONFIG_FAILURE_KEY, type ConfigFailure } from '@/config/errors';
import { useConfig } from '@/config/useConfig';
import { areaIsUnused, moved, type AreaUsage, type ConfigArea } from '@/config/types';
import ui from '@/components/ui/ui.module.css';

/**
 * The areas a workplace divides tips between — manager only.
 *
 * Everything financial points at these ids with `on delete restrict`, and every
 * distribution keeps a copy of the name it was paid under, so this screen only
 * ever renames, reorders, archives and restores. Deleting is offered exactly
 * when the database would allow it: nothing at all refers to the row.
 */
export function AreasPage() {
  const config = useConfig();
  const { t } = useI18n();
  const { show } = useToast();

  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [editing, setEditing] = useState<ConfigArea | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [inPool, setInPool] = useState(true);
  const [usage, setUsage] = useState<AreaUsage | null>(null);

  const live = useMemo(
    () => (config.state?.areas ?? []).filter((a) => !a.archived),
    [config.state],
  );
  const archived = useMemo(
    () => (config.state?.areas ?? []).filter((a) => a.archived),
    [config.state],
  );

  useEffect(() => {
    setOrder(live.map((a) => a.id));
  }, [live]);

  if (!config.enabled) {
    return (
      <Screen title={t('cfgAreasTitle')} back="arrow">
        <EmptyState title={t('ruleReadOnly')} />
      </Screen>
    );
  }

  const fail = (failure: ConfigFailure | undefined, count?: number | null) => {
    const base = t(CONFIG_FAILURE_KEY[failure ?? 'unknown']);
    show(count ? `${base} (${count})` : base);
  };

  const openEditor = async (area: ConfigArea) => {
    setEditing(area);
    setCreating(false);
    setName(area.name);
    setInPool(area.isPoolEligible);
    setUsage(null);
    const result = await config.areaUsage(area.id);
    if (result.ok) setUsage(result.value ?? null);
  };

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setName('');
    setInPool(true);
    setUsage(null);
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const save = async () => {
    const result = creating
      ? await config.createArea(name, inPool)
      : await config.updateArea(editing!.id, { name, isPoolEligible: inPool });
    if (!result.ok) {
      fail(result.failure, result.count);
      return;
    }
    show(t('cfgSaved'));
    close();
  };

  const archive = async () => {
    const result = await config.archiveArea(editing!.id);
    if (!result.ok) {
      fail(result.failure, result.count);
      return;
    }
    show(t('cfgArchivedToast'));
    close();
  };

  const remove = async () => {
    const result = await config.deleteArea(editing!.id);
    if (!result.ok) {
      fail(result.failure, result.count);
      return;
    }
    show(t('cfgDeletedToast'));
    close();
  };

  const restore = async (area: ConfigArea) => {
    const result = await config.restoreArea(area.id);
    show(result.ok ? t('cfgRestoredToast') : t(CONFIG_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const move = async (id: string, delta: -1 | 1) => {
    const next = moved(order, id, delta);
    if (next === order) return;
    setOrder(next);
    const result = await config.reorderAreas(next);
    if (!result.ok) fail(result.failure, result.count);
  };

  const ordered = reordering
    ? order.map((id) => live.find((a) => a.id === id)).filter((a): a is ConfigArea => Boolean(a))
    : live;

  return (
    <Screen
      title={t('cfgAreasTitle')}
      back="arrow"
      action={
        live.length > 1
          ? {
              label: reordering ? t('cfgReorderDone') : t('cfgReorder'),
              onClick: () => setReordering((value) => !value),
            }
          : undefined
      }
    >
      <div className={ui.stackTight}>
        <SectionLabel>{t('cfgLive')}</SectionLabel>
        <Card padding="none" clip>
          {ordered.map((area, index) =>
            reordering ? (
              <div key={area.id} className={ui.insetRow}>
                <Icon name={iconForAreaKey(area.key)} size={17} color="var(--color-text-muted)" />
                <span className={`${ui.rowMain} ${ui.rowTitle}`}>{area.name}</span>
                <button
                  type="button"
                  className={ui.chip}
                  aria-label={`${t('cfgMoveUp')} — ${area.name}`}
                  disabled={index === 0 || config.busy}
                  onClick={() => void move(area.id, -1)}
                >
                  <Icon name="caret-right" size={12} style={{ transform: 'rotate(-90deg)' }} />
                </button>
                <button
                  type="button"
                  className={ui.chip}
                  aria-label={`${t('cfgMoveDown')} — ${area.name}`}
                  disabled={index === ordered.length - 1 || config.busy}
                  onClick={() => void move(area.id, 1)}
                >
                  <Icon name="caret-right" size={12} style={{ transform: 'rotate(90deg)' }} />
                </button>
              </div>
            ) : (
              <button
                key={area.id}
                type="button"
                className={`${ui.insetRow} ${ui.insetRowInteractive}`}
                aria-label={`${t('cfgEditArea')} — ${area.name}`}
                onClick={() => void openEditor(area)}
              >
                <Icon name={iconForAreaKey(area.key)} size={17} color="var(--color-text-muted)" />
                <span className={`${ui.rowMain} ${ui.rowTitle}`}>{area.name}</span>
                <Badge tone="quiet">
                  {area.isPoolEligible ? t('cfgInPoolOn') : t('cfgInPoolOff')}
                </Badge>
                <Icon name="caret-right" size={13} className={ui.chevron} />
              </button>
            ),
          )}
        </Card>

        {reordering ? null : (
          <button
            type="button"
            className={ui.insetRow}
            style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--ring)', minHeight: 48 }}
            onClick={openCreate}
          >
            <Icon name="plus" size={16} color="var(--color-accent)" />
            <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
              {t('cfgAddArea')}
            </span>
          </button>
        )}
      </div>

      {archived.length > 0 ? (
        <div className={ui.stackTight}>
          <SectionLabel>{t('cfgArchivedHead')}</SectionLabel>
          <Card padding="none" clip>
            {archived.map((area) => (
              <div key={area.id} className={ui.insetRow}>
                <span
                  className={`${ui.rowMain} ${ui.rowTitle}`}
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {area.name}
                </span>
                <button
                  type="button"
                  className={ui.chip}
                  disabled={config.busy}
                  onClick={() => void restore(area)}
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
        open={creating || editing !== null}
        title={creating ? t('cfgNewArea') : t('cfgEditArea')}
        onClose={close}
      >
        <div className={ui.stackTight}>
          <label className={ui.fieldLabel} htmlFor="area-name">
            {t('cfgNameLabel')}
          </label>
          <input
            id="area-name"
            className={ui.fieldInput}
            type="text"
            maxLength={40}
            placeholder={t('cfgNameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <Card padding="none" clip>
            <div className={ui.insetRow}>
              <span className={`${ui.rowMain} ${ui.rowTitle}`}>{t('cfgInPool')}</span>
              <Toggle on={inPool} label={t('cfgInPool')} onChange={() => setInPool((v) => !v)} />
            </div>
          </Card>

          {editing && usage ? (
            <>
              <SectionLabel>{t('cfgUsageTitle')}</SectionLabel>
              <Card padding="none" clip>
                {[
                  [usage.members, t('cfgUsageMembers')],
                  [usage.openShifts, t('cfgUsageShifts')],
                  [usage.roles, t('cfgUsageRoles')],
                  [usage.fundedRules, t('cfgUsageRules')],
                  [usage.distributions, t('cfgUsageDistributions')],
                ].map(([count, label]) => (
                  <div key={String(label)} className={ui.insetRow}>
                    <span className={`${ui.rowMain} ${ui.rowTitle}`}>{label}</span>
                    <span className={`${ui.rowValue} tabular`}>{count}</span>
                  </div>
                ))}
              </Card>
              {areaIsUnused(usage) ? <Note>{t('cfgUsageNone')}</Note> : null}
              <InfoNote icon="info">{t('cfgArchiveNote')}</InfoNote>
            </>
          ) : null}

          <Button onClick={() => void save()} muted={config.busy || name.trim().length === 0}>
            {t('save')}
          </Button>

          {editing ? (
            areaIsUnused(usage) ? (
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
