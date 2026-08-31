import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { PointsBadge } from '@/components/ui/Badge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { AREA_ORDER } from '@/data/areas';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** The roster, grouped by area, with each person's effective points. */
export function TeamPage() {
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
