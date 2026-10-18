import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { scrollToSection } from '@/components/marketing/Reveal';
import styles from '@/components/marketing/marketing.module.css';
import { useI18n } from '@/hooks/useI18n';
import type { StringKey } from '@/i18n/strings';
import type { Language } from '@/types';

/** The in-page sections the bar links to, in page order. */
export const NAV_SECTIONS: ReadonlyArray<{ id: string; label: StringKey }> = [
  { id: 'how', label: 'mkNavHow' },
  { id: 'features', label: 'mkNavFeatures' },
  { id: 'teams', label: 'mkNavTeams' },
  { id: 'faq', label: 'mkNavFaq' },
];

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  const options: Array<{ value: Language; short: string }> = [
    { value: 'English', short: 'EN' },
    { value: 'Deutsch', short: 'DE' },
  ];
  return (
    <div className={styles.langSwitch} role="group" aria-label={t('mkLangLabel')}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.langOption}
          aria-pressed={language === option.value}
          lang={option.value === 'Deutsch' ? 'de' : 'en'}
          aria-label={option.value}
          onClick={() => setLanguage(option.value)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}

/**
 * The sticky top bar: logo, section links, language, sign-in and sign-up.
 *
 * Below 1000px the section links move into a disclosure panel under the bar.
 * It is a plain disclosure (button with aria-expanded/aria-controls), not a
 * modal: the page behind stays reachable, Escape closes it and returns focus to
 * the button, and choosing an entry closes it.
 */
export function MarketingNav() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    // The panel only exists below the desktop breakpoint; widening the window
    // past it must not leave an invisible "open" state behind.
    const wide = window.matchMedia('(min-width: 1000px)');
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open, close]);

  const go = (id: string) => {
    // The panel overlays the page rather than pushing it down, so closing it
    // moves nothing and the target can be measured right away.
    setOpen(false);
    scrollToSection(id);
  };

  return (
    <header className={`${styles.nav} ${scrolled || open ? styles.navScrolled : ''}`}>
      <div className={`${styles.container} ${styles.navInner}`}>
        <Link
          to="/"
          className={styles.brand}
          aria-label={t('mkHomeLabel')}
          onClick={() => window.scrollTo({ top: 0 })}
        >
          <span className={styles.brandTile}>
            <BrandMark height={36} />
          </span>
          <span aria-hidden>TipCrew</span>
        </Link>

        <nav className={styles.navLinks} aria-label={t('mkHomeLabel')}>
          {NAV_SECTIONS.map((item) => (
            <button key={item.id} type="button" className={styles.navLink} onClick={() => go(item.id)}>
              {t(item.label)}
            </button>
          ))}
        </nav>

        <div className={styles.navActions}>
          <div className={styles.navDesktopOnly}>
            <LanguageSwitch />
          </div>
          <Link to="/signin" className={`${styles.btn} ${styles.btnText} ${styles.navDesktopOnly}`}>
            {t('mkSignIn')}
          </Link>
          <Link to="/signup" className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall} ${styles.navCta}`}>
            {t('mkGetStarted')}
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls="marketing-menu"
            aria-label={open ? t('mkMenuClose') : t('mkMenuOpen')}
            onClick={() => setOpen((value) => !value)}
          >
            <span className={`${styles.burger} ${open ? styles.burgerOpen : ''}`} aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {open ? (
        <div id="marketing-menu" ref={panelRef} className={styles.mobileMenu}>
          <div className={styles.container}>
            <nav aria-label={t('mkHomeLabel')}>
              <ul className={styles.mobileList}>
                {NAV_SECTIONS.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={styles.mobileLink} onClick={() => go(item.id)}>
                      {t(item.label)}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className={styles.mobileLang}>
              <span>{t('mkLangLabel')}</span>
              <LanguageSwitch />
            </div>
            <div className={styles.mobileFooter}>
              <Link to="/signup" className={`${styles.btn} ${styles.btnPrimary}`}>
                {t('mkGetStarted')}
              </Link>
              <Link to="/signin" className={`${styles.btn} ${styles.btnSecondary}`}>
                {t('mkSignIn')}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
