import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import styles from '@/components/layout/layout.module.css';

interface Tab {
  to: string;
  icon: IconName;
  label: string;
}

/**
 * Four tabs for an employee, four plus a raised "new distribution" action for a
 * manager. The active tab uses the filled icon weight, as in the prototype.
 */
export function BottomNav() {
  const { session } = useAppState();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const manager = session.role === 'manager';

  const tabs: Tab[] = manager
    ? [
        { to: '/manager', icon: 'squares-four', label: t('tabOverview') },
        { to: '/manager/distributions', icon: 'list-dashes', label: t('tabHistory') },
        { to: '/manager/team', icon: 'users-three', label: t('tabTeam') },
        { to: '/manager/rules', icon: 'gear', label: t('tabSettings') },
      ]
    : [
        { to: '/home', icon: 'house', label: t('tabHome') },
        { to: '/hours', icon: 'clock', label: t('myHoursTab') },
        { to: '/history', icon: 'list-dashes', label: t('tabHistory') },
        { to: '/profile', icon: 'user', label: t('tabYou') },
      ];

  const isActive = (to: string) => (to === '/manager' ? pathname === to : pathname.startsWith(to));

  const rendered = tabs.map((tab) => (
    <button
      key={tab.to}
      type="button"
      className={`${styles.tab} ${isActive(tab.to) ? styles.tabActive : ''}`}
      aria-current={isActive(tab.to) ? 'page' : undefined}
      onClick={() => navigate(tab.to)}
    >
      <Icon name={tab.icon} fill={isActive(tab.to)} size={22} />
      <span className={styles.tabLabel}>{tab.label}</span>
    </button>
  ));

  if (manager) {
    rendered.splice(
      2,
      0,
      <button
        key="new"
        type="button"
        className={styles.tabAction}
        onClick={() => navigate('/manager/new/pool')}
        aria-label={t('newDistribution')}
      >
        <Icon name="plus" size={24} />
      </button>,
    );
  }

  return (
    <nav className={styles.tabBar} aria-label={t('workplace')}>
      {rendered}
    </nav>
  );
}
