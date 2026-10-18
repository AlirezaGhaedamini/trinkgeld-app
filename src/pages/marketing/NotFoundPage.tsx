import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { useDocumentTitle } from '@/components/layout/RouteTitle';
import { PublicShell } from '@/components/marketing/PublicShell';
import styles from '@/components/marketing/marketing.module.css';
import { useI18n } from '@/hooks/useI18n';

/**
 * What an address that matches no route shows.
 *
 * It used to redirect to the root, which for a signed-out visitor meant a
 * mistyped or stale link silently became the homepage. It now says so. The
 * button goes to the root, which is the right home for whoever is looking:
 * the marketing page when signed out, the app when signed in.
 *
 * Auth fragments never get here — the router's fallback checks for them first
 * and keeps sending them to the root (src/auth/callback.ts).
 */
export function NotFoundPage() {
  const { t } = useI18n();
  useDocumentTitle(t('titleNotFound'));

  return (
    <PublicShell>
      <div className={`${styles.container} ${styles.statusPage}`}>
        <div className={styles.statusCard}>
          <div className={styles.ctaLogo}>
            <span className={styles.brandTile} style={{ borderRadius: 18 }}>
              <BrandMark height={72} />
            </span>
          </div>
          <p className={`${styles.kicker} ${styles.kickerCentered}`}>{t('nfKicker')}</p>
          <h1 className={styles.h2}>{t('nfTitle')}</h1>
          <p className={styles.lead}>{t('nfBody')}</p>
          <div className={styles.ctaButtons}>
            <Link to="/" className={`${styles.btn} ${styles.btnPrimary}`}>
              {t('nfHome')}
            </Link>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
