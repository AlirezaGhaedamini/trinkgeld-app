import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { Note } from '@/components/ui/Note';
import { RadioDot } from '@/components/ui/RadioDot';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { AREA_ORDER } from '@/data/areas';
import { ROLES_BY_AREA, ROLE_POINTS } from '@/data/roles';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { shareOf } from '@/state/selectors';
import type { AreaId, RoleId } from '@/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * A team member's area, role and personal multiplier — the manager-only levers
 * that decide how their hours count. Changing any of them recalculates every
 * live figure in the app immediately.
 */
export function MemberPage() {
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
