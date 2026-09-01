import { useEffect, useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoNote, Lede, Note } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { RULE_FAILURE_KEY } from '@/rules/errors';
import { useRules } from '@/rules/useRules';
import type { RolePoints } from '@/rules/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

const MIN = 0.1;
const MAX = 5;

/**
 * Role weights — manager only.
 *
 * These live on `workplace_roles`, not on the rule version, because
 * activate_rule() DELETEs the version's role rows and re-reads them from the
 * role definitions. So this screen edits the *input* to the next activation;
 * the version that is in force keeps the copy it froze, which is why each row
 * also shows that number when it differs.
 */
export function RolePointsPage() {
  const rules = useRules();
  const { t, num } = useI18n();
  const { show } = useToast();

  const roles = useMemo(() => rules.state?.roles ?? [], [rules.state]);
  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const role of roles) next[role.roleId] = role.points;
    setValues(next);
  }, [roles]);

  if (!rules.enabled) {
    return (
      <Screen title={t('rolePointsTitle')} back="arrow">
        <EmptyState title={t('ruleReadOnly')} />
      </Screen>
    );
  }

  const changed = roles.filter((role) => (values[role.roleId] ?? role.points) !== role.points);
  const pending = roles.some(
    (role) => role.activePoints !== null && role.activePoints !== (values[role.roleId] ?? role.points),
  );

  const save = async () => {
    if (changed.length === 0) {
      show(t('ruleUnchanged'));
      return;
    }
    const result = await rules.saveRolePoints(
      changed.map((role) => ({ roleId: role.roleId, points: values[role.roleId] ?? role.points })),
    );
    show(result.ok ? t('rolePointsSaved') : t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  /* Grouped by area, because a role belongs to exactly one area and the
     database refuses any other pairing. */
  const byArea = new Map<string, RolePoints[]>();
  for (const role of roles) {
    const list = byArea.get(role.areaName) ?? [];
    list.push(role);
    byArea.set(role.areaName, list);
  }

  return (
    <Screen
      title={t('rolePointsTitle')}
      back="arrow"
      cta={{
        label: t('save'),
        muted: rules.busy || changed.length === 0,
        onClick: () => void save(),
      }}
    >
      <Lede>{t('rolePointsD')}</Lede>

      {[...byArea.entries()].map(([areaName, list]) => (
        <div key={areaName} className={ui.stackTight}>
          <SectionLabel>{areaName}</SectionLabel>
          <Card padding="none" clip>
            {list.map((role) => {
              const value = values[role.roleId] ?? role.points;
              const sliderId = `points-${role.roleId}`;
              const drifted = role.activePoints !== null && role.activePoints !== value;
              return (
                <div key={role.roleId} className={styles.areaCard} style={{ padding: '12px 14px' }}>
                  <div className={ui.inline}>
                    <span className={ui.rowMain}>
                      <label htmlFor={sliderId} className={ui.rowTitle}>
                        {role.roleName}
                      </label>
                      {drifted ? (
                        <span className={ui.rowMeta} style={{ display: 'block', marginTop: 2 }}>
                          {t('rolePointsFrozen')}: ×{num(role.activePoints ?? 0, 2)}
                        </span>
                      ) : null}
                    </span>
                    <Badge tone={drifted ? 'tint' : 'quiet'}>×{num(value, 2)}</Badge>
                  </div>
                  <input
                    id={sliderId}
                    className={ui.range}
                    type="range"
                    min={MIN}
                    max={MAX}
                    step={0.1}
                    value={value}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [role.roleId]: Number(event.target.value),
                      }))
                    }
                  />
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      <Note>{t('rolePointsRange')}</Note>
      {pending ? <InfoNote icon="info">{t('rolePointsPending')}</InfoNote> : null}
    </Screen>
  );
}
