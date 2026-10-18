import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { LanguageSwitch } from '@/components/marketing/MarketingNav';
import styles from '@/components/marketing/marketing.module.css';
import { useI18n } from '@/hooks/useI18n';

/**
 * The frame for the small public pages around the homepage: the 404 and the
 * legal pages. Same canvas, logo, language switch and safe-area handling as
 * the marketing page, without its section navigation — there are no sections
 * to scroll to here, and every way back goes through the logo.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={`${styles.root} ${styles.publicRoot}`}>
      <header className={`${styles.nav} ${styles.navScrolled}`}>
        <div className={`${styles.container} ${styles.navInner}`}>
          <Link to="/" className={styles.brand} aria-label={t('mkHomeLabel')}>
            <span className={styles.brandTile}>
              <BrandMark height={36} />
            </span>
            <span aria-hidden>TipCrew</span>
          </Link>
          <LanguageSwitch />
        </div>
      </header>
      <main id="main" className={styles.publicMain}>
        {children}
      </main>
      <footer className={styles.publicFooter}>
        <div className={`${styles.container} ${styles.publicFooterInner}`}>
          <span>{t('mkFooterCopy').replace('{year}', String(new Date().getFullYear()))}</span>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}

/** Privacy and imprint, wherever the public pages list them. */
export function LegalLinks() {
  const { t } = useI18n();
  return (
    <nav aria-label={t('mkFooterLegal')}>
      <ul className={styles.legalLinks}>
        <li>
          <Link to="/privacy" className={styles.footerLink}>
            {t('mkFooterPrivacy')}
          </Link>
        </li>
        <li>
          <Link to="/imprint" className={styles.footerLink}>
            {t('mkFooterImprint')}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
