import { Screen } from '@/components/layout/Screen';
import { BrandMark } from '@/components/brand/BrandMark';
import { useI18n } from '@/hooks/useI18n';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/**
 * Shown for the moment it takes to read a persisted session out of storage.
 *
 * Deliberately the sign-in screen's own brand block and nothing else — same
 * component, same classes, no new visual vocabulary — so a refresh looks like
 * the app settling rather than a different screen flashing past.
 */
export function AuthSplash() {
  const { t } = useI18n();

  return (
    <Screen back={false} center>
      <div className={styles.signIn}>
        <div className={ui.stackTight}>
          <BrandMark />
          <h1 className={styles.wordmark}>TipCrew</h1>
          <p className={styles.tagline}>{t('authRestoring')}</p>
        </div>
      </div>
    </Screen>
  );
}
