import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Icon } from '@/components/ui/Icon';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { distributionById } from '@/state/selectors';
import styles from '@/pages/pages.module.css';

/** Confirmation after a distribution goes out to the team. */
export function SentPage() {
  const state = useAppState();
  const { t, money, people, language } = useI18n();
  const navigate = useNavigate();

  const sent = state.lastSentId ? distributionById(state, state.lastSentId) : undefined;
  const amount = money(sent?.poolAmount ?? 0);
  const headcount = people(sent?.peopleCount ?? 0);

  const body =
    language === 'Deutsch'
      ? `${amount} an ${headcount}. Alle sehen jetzt ihre Aufschlüsselung und bestätigen sie.`
      : `${amount} to ${headcount}. Everyone can see their breakdown now and confirms it.`;

  return (
    <Screen
      back={false}
      cta={{
        label: t('viewDist'),
        onClick: () => navigate(`/manager/distributions/${sent?.id ?? ''}`, { replace: true }),
        secondary: { label: t('done'), onClick: () => navigate('/manager', { replace: true }) },
      }}
    >
      <div className={styles.sent}>
        <span className={styles.sentMark}>
          <Icon name="check" size={34} color="var(--color-accent)" />
        </span>
        <h1 className={styles.sentTitle}>{t('sentTitle')}</h1>
        <p className={styles.sentBody}>{body}</p>
      </div>
    </Screen>
  );
}
