import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { Icon, type IconName } from '@/components/ui/Icon';
import { MarketingNav, NAV_SECTIONS } from '@/components/marketing/MarketingNav';
import { LegalLinks } from '@/components/marketing/PublicShell';
import { Reveal, scrollToSection } from '@/components/marketing/Reveal';
import {
  EmployeeMock,
  HeroComposition,
  HistoryMock,
  HoursEntryMock,
  ManagerMock,
  RulesMock,
  StepCalcVisual,
  StepRulesVisual,
  StepShareVisual,
  StepShiftVisual,
} from '@/components/marketing/mockups';
import styles from '@/components/marketing/marketing.module.css';
import { useI18n } from '@/hooks/useI18n';
import type { StringKey } from '@/i18n/strings';

/**
 * The public homepage: what a signed-out visitor sees at https://tipcrew.de/.
 *
 * Rendered in place by HomeRedirect (src/components/layout/guards.tsx) for a
 * settled, signed-out session that is not an auth redirect, and loaded lazily,
 * so the authenticated app neither grows nor changes. It reads no session,
 * workplace or demo state — only the language — and every way out of it is a
 * plain route link to the existing /signup and /signin screens, which keep
 * owning their own behaviour (invitation tokens included).
 *
 * Every product claim on this page is checked against docs/BACKEND.md and the
 * shipped screens: the three methods, area percentages, minimum shared time,
 * rounding to the pool, rule versions with input snapshots, corrections as
 * replacements, per-workplace peer visibility, invitations that carry area and
 * role, the 6-character workplace code. Nothing about pricing, certifications,
 * native apps or customers is said, because none of it exists.
 */
export function MarketingPage() {
  const { t, language } = useI18n();

  // The document title and description follow the language. index.html carries
  // the English pair for crawlers; this keeps the tab and a shared link right
  // once a visitor switches to German, and restores whatever was there before
  // when the visitor signs in and the page unmounts.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousTitle = document.title;
    const previousDescription = meta?.content ?? '';
    document.title = t('mkMetaTitle');
    if (meta) meta.content = t('mkMetaDescription');
    return () => {
      document.title = previousTitle;
      if (meta) meta.content = previousDescription;
    };
  }, [t, language]);

  return (
    <div className={styles.root}>
      <a
        href="#/"
        className={styles.skip}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('mkSkip')}
      </a>
      <MarketingNav />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Hero />
        <Problem />
        <HowItWorks />
        <Rules />
        <Managers />
        <Team />
        <History />
        <Invitations />
        <Mobile />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function SectionHead({
  kicker,
  title,
  lead,
  centered = false,
}: {
  kicker: StringKey;
  title: StringKey;
  lead?: StringKey;
  centered?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Reveal className={`${styles.sectionHead} ${centered ? styles.centered : ''}`}>
      <p className={styles.kicker}>{t(kicker)}</p>
      {/* Focus target for the in-page navigation (scrollToSection). */}
      <h2 className={styles.h2} tabIndex={-1}>
        {t(title)}
      </h2>
      {lead ? <p className={styles.lead}>{t(lead)}</p> : null}
    </Reveal>
  );
}

function Feature({ icon, title, body }: { icon: IconName; title: StringKey; body: StringKey }) {
  const { t } = useI18n();
  return (
    <li className={styles.feature}>
      <span className={styles.iconBox} aria-hidden>
        <Icon name={icon} size={22} />
      </span>
      <div>
        <h3 className={styles.h3}>{t(title)}</h3>
        <p className={styles.body}>{t(body)}</p>
      </div>
    </li>
  );
}

function PrimaryCta({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Link to="/signup" className={`${styles.btn} ${styles.btnPrimary}`}>
      {children ?? t('mkGetStarted')}
      <Icon name="caret-right" size={16} />
    </Link>
  );
}

/* ── sections ───────────────────────────────────────────────────────────── */

function Hero() {
  const { t } = useI18n();
  const venues: Array<{ key: StringKey; color: string }> = [
    { key: 'mkVenueRestaurants', color: 'var(--color-area-service)' },
    { key: 'mkVenueCafes', color: 'var(--color-area-kitchen)' },
    { key: 'mkVenueBars', color: 'var(--color-area-bar)' },
    { key: 'mkVenueHotels', color: 'var(--color-accent)' },
  ];
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.container}>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.heroKicker}>
              <span className={styles.heroKickerDot} aria-hidden />
              {t('mkHeroKicker')}
            </p>
            <h1 id="hero-title" className={styles.h1}>
              <span className={styles.h1Line}>{t('mkHeroTitle1')}</span>
              <span className={`${styles.h1Line} ${styles.h1Accent}`}>{t('mkHeroTitle2')}</span>
            </h1>
            <p className={styles.heroLead}>{t('mkHeroLead')}</p>
            <div className={styles.heroCtas}>
              <PrimaryCta />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => scrollToSection('how')}
              >
                {t('mkHeroSecondary')}
              </button>
            </div>
            <p className={styles.heroNote}>
              <Icon name="check-circle" size={18} color="var(--color-money)" />
              {t('mkHeroNote')}
            </p>
          </div>
          <HeroComposition />
        </div>

        <div className={styles.venues}>
          <p className={styles.venuesLabel}>{t('mkBuiltFor')}</p>
          <ul className={styles.venueList}>
            {venues.map((venue) => (
              <li key={venue.key} className={styles.venue}>
                <span className={styles.dot} style={{ background: venue.color }} aria-hidden />
                {t(venue.key)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  const { t } = useI18n();
  const pains: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'clipboard-text', title: 'mkPain1Title', body: 'mkPain1Body' },
    { icon: 'warning-circle', title: 'mkPain2Title', body: 'mkPain2Body' },
    { icon: 'clock', title: 'mkPain3Title', body: 'mkPain3Body' },
    { icon: 'users-three', title: 'mkPain4Title', body: 'mkPain4Body' },
  ];
  return (
    <section className={`${styles.section} ${styles.sectionWhite}`}>
      <div className={styles.container}>
        <SectionHead kicker="mkProblemKicker" title="mkProblemTitle" lead="mkProblemLead" />
        <ul className={styles.grid4}>
          {pains.map((pain, index) => (
            <li key={pain.title}>
              <Reveal delay={index * 80} className={styles.card}>
                <span className={styles.iconBox} aria-hidden>
                  <Icon name={pain.icon} size={22} />
                </span>
                <h3 className={styles.h3}>{t(pain.title)}</h3>
                <p className={styles.body}>{t(pain.body)}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useI18n();
  const steps: Array<{ title: StringKey; body: StringKey; visual: ReactNode }> = [
    { title: 'mkStep1Title', body: 'mkStep1Body', visual: <StepRulesVisual /> },
    { title: 'mkStep2Title', body: 'mkStep2Body', visual: <StepShiftVisual /> },
    { title: 'mkStep3Title', body: 'mkStep3Body', visual: <StepCalcVisual /> },
    { title: 'mkStep4Title', body: 'mkStep4Body', visual: <StepShareVisual /> },
  ];
  return (
    <section id="how" className={styles.section}>
      <div className={styles.container}>
        <SectionHead kicker="mkHowKicker" title="mkHowTitle" />
        <ol className={styles.grid4}>
          {steps.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 90} className={styles.card}>
                <div className={styles.stepTop}>
                  <span className={styles.stepNum} aria-hidden>
                    {index + 1}
                  </span>
                  {index < steps.length - 1 ? <span className={styles.stepLine} aria-hidden /> : null}
                </div>
                <h3 className={styles.h3}>{t(step.title)}</h3>
                <p className={styles.body}>{t(step.body)}</p>
                {step.visual}
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Rules() {
  const { t } = useI18n();
  const factors: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'clock', title: 'mkFactorHours', body: 'mkFactorHoursBody' },
    { icon: 'users-three', title: 'mkFactorOverlap', body: 'mkFactorOverlapBody' },
    { icon: 'pause', title: 'mkFactorBreaks', body: 'mkFactorBreaksBody' },
    { icon: 'squares-four', title: 'mkFactorAreas', body: 'mkFactorAreasBody' },
    { icon: 'briefcase', title: 'mkFactorRoles', body: 'mkFactorRolesBody' },
    { icon: 'hourglass-medium', title: 'mkFactorMinOverlap', body: 'mkFactorMinOverlapBody' },
    { icon: 'list-dashes', title: 'mkFactorPercent', body: 'mkFactorPercentBody' },
    { icon: 'money', title: 'mkFactorRounding', body: 'mkFactorRoundingBody' },
  ];
  return (
    <section id="features" className={`${styles.section} ${styles.sectionWhite}`}>
      <div className={styles.container}>
        <div className={styles.split}>
          <div>
            <SectionHead kicker="mkRulesKicker" title="mkRulesTitle" lead="mkRulesLead" />
            <ul className={styles.factorGrid} style={{ marginTop: 0 }}>
              {factors.map((factor) => (
                <li key={factor.title} className={styles.factor}>
                  <span className={styles.iconBox} aria-hidden>
                    <Icon name={factor.icon} size={18} />
                  </span>
                  <div>
                    <h3 className={styles.factorTitle}>{t(factor.title)}</h3>
                    <p className={styles.factorBody}>{t(factor.body)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <Reveal>
            <RulesMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Managers() {
  const features: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'user-plus', title: 'mkMgr1Title', body: 'mkMgr1Body' },
    { icon: 'check-circle', title: 'mkMgr2Title', body: 'mkMgr2Body' },
    { icon: 'gear', title: 'mkMgr3Title', body: 'mkMgr3Body' },
    { icon: 'money', title: 'mkMgr4Title', body: 'mkMgr4Body' },
    { icon: 'file-arrow-down', title: 'mkMgr5Title', body: 'mkMgr5Body' },
    { icon: 'door-open', title: 'mkMgr6Title', body: 'mkMgr6Body' },
  ];
  return (
    <section id="teams" className={styles.section}>
      <div className={styles.container}>
        <div className={`${styles.split} ${styles.splitReverse}`}>
          <div>
            <SectionHead kicker="mkManagerKicker" title="mkManagerTitle" lead="mkManagerLead" />
            <ul className={styles.featureList} style={{ marginTop: 0 }}>
              {features.map((feature) => (
                <Feature key={feature.title} {...feature} />
              ))}
            </ul>
          </div>
          <Reveal>
            <ManagerMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Team() {
  const features: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'clock', title: 'mkEmp1Title', body: 'mkEmp1Body' },
    { icon: 'hourglass-medium', title: 'mkEmp2Title', body: 'mkEmp2Body' },
    { icon: 'hand-heart', title: 'mkEmp3Title', body: 'mkEmp3Body' },
    { icon: 'calendar-blank', title: 'mkEmp4Title', body: 'mkEmp4Body' },
    { icon: 'bell', title: 'mkEmp5Title', body: 'mkEmp5Body' },
    { icon: 'lock-simple', title: 'mkEmp6Title', body: 'mkEmp6Body' },
  ];
  return (
    <section className={`${styles.section} ${styles.sectionWhite}`}>
      <div className={styles.container}>
        <div className={styles.split}>
          <div>
            <SectionHead kicker="mkTeamKicker" title="mkTeamTitle" lead="mkTeamLead" />
            <ul className={styles.featureList} style={{ marginTop: 0 }}>
              {features.map((feature) => (
                <Feature key={feature.title} {...feature} />
              ))}
            </ul>
          </div>
          <Reveal>
            <EmployeeMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function History() {
  const features: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'shield-check', title: 'mkHist1Title', body: 'mkHist1Body' },
    { icon: 'notebook', title: 'mkHist2Title', body: 'mkHist2Body' },
    { icon: 'arrow-counter-clockwise', title: 'mkHist3Title', body: 'mkHist3Body' },
  ];
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={`${styles.split} ${styles.splitReverse}`}>
          <div>
            <SectionHead kicker="mkHistoryKicker" title="mkHistoryTitle" lead="mkHistoryLead" />
            <ul className={styles.featureList} style={{ marginTop: 0, gridTemplateColumns: '1fr' }}>
              {features.map((feature) => (
                <Feature key={feature.title} {...feature} />
              ))}
            </ul>
          </div>
          <Reveal>
            <HistoryMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Invitations() {
  const { t } = useI18n();
  const steps: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'user-plus', title: 'mkInv1Title', body: 'mkInv1Body' },
    { icon: 'paper-plane-tilt', title: 'mkInv2Title', body: 'mkInv2Body' },
    { icon: 'user', title: 'mkInv3Title', body: 'mkInv3Body' },
    { icon: 'users-three', title: 'mkInv4Title', body: 'mkInv4Body' },
  ];
  return (
    <section className={`${styles.section} ${styles.sectionWhite}`}>
      <div className={styles.container}>
        <SectionHead kicker="mkInviteKicker" title="mkInviteTitle" lead="mkInviteLead" centered />
        <ol className={styles.flow}>
          {steps.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 90} className={styles.flowStep}>
                <span className={styles.flowIcon} aria-hidden>
                  <Icon name={step.icon} size={24} />
                </span>
                <div>
                  <h3 className={styles.h3}>{t(step.title)}</h3>
                  <p className={styles.body}>{t(step.body)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
        <Reveal>
          <div className={styles.inviteCard} aria-hidden>
            <span className={styles.iconBox}>
              <Icon name="user-plus" size={20} />
            </span>
            <div className={styles.grow}>
              <div style={{ fontWeight: 600 }}>{t('mkMockInvite')} · Mira Kaya</div>
              <div className={styles.mockLabel}>
                {t('areaBar')} · {t('rBartender')}
              </div>
            </div>
            <span className={styles.mockRowValueAccent}>{t('mkMockJoined')}</span>
          </div>
          <p className={styles.inviteNote}>{t('mkInviteCode')}</p>
        </Reveal>
      </div>
    </section>
  );
}

function Mobile() {
  const { t } = useI18n();
  const points: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
    { icon: 'sneaker-move', title: 'mkMob1Title', body: 'mkMob1Body' },
    { icon: 'eye', title: 'mkMob2Title', body: 'mkMob2Body' },
    { icon: 'check-circle', title: 'mkMob3Title', body: 'mkMob3Body' },
  ];
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <Reveal className={styles.mintPanel}>
          <div>
            <p className={styles.kicker}>{t('mkMobileKicker')}</p>
            <h2 className={styles.h2} tabIndex={-1}>
              {t('mkMobileTitle')}
            </h2>
            <p className={styles.lead}>{t('mkMobileLead')}</p>
            <ul className={styles.mobilePoints}>
              {points.map((point) => (
                <Feature key={point.title} {...point} />
              ))}
            </ul>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <HoursEntryMock />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Faq() {
  const { t } = useI18n();
  const items: Array<[StringKey, StringKey]> = [
    ['mkFaq1Q', 'mkFaq1A'],
    ['mkFaq2Q', 'mkFaq2A'],
    ['mkFaq3Q', 'mkFaq3A'],
    ['mkFaq4Q', 'mkFaq4A'],
    ['mkFaq5Q', 'mkFaq5A'],
    ['mkFaq6Q', 'mkFaq6A'],
    ['mkFaq7Q', 'mkFaq7A'],
  ];
  return (
    <section id="faq" className={`${styles.section} ${styles.sectionWhite}`}>
      <div className={styles.container}>
        <div className={styles.faqGrid}>
          <div>
            <SectionHead kicker="mkFaqKicker" title="mkFaqTitle" />
          </div>
          <div className={styles.faqList}>
            {items.map(([question, answer]) => (
              <details key={question} className={styles.faqItem}>
                <summary className={styles.faqSummary}>
                  <h3 className={styles.h3} style={{ fontSize: 'inherit' }}>
                    {t(question)}
                  </h3>
                  <Icon name="caret-right" size={18} className={styles.faqChevron} />
                </summary>
                <p className={styles.faqAnswer}>{t(answer)}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  const { t } = useI18n();
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <Reveal className={styles.ctaPanel}>
          <div className={styles.ctaLogo}>
            <BrandMark height={72} />
          </div>
          <h2 className={styles.h2}>{t('mkCtaTitle')}</h2>
          <p className={styles.lead}>{t('mkCtaLead')}</p>
          <div className={styles.ctaButtons}>
            <PrimaryCta />
            <Link to="/signin" className={`${styles.btn} ${styles.btnSecondary}`}>
              {t('mkSignIn')}
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div>
            <div className={styles.brand} style={{ marginRight: 0 }}>
              <span className={styles.brandTile}>
            <BrandMark height={36} />
          </span>
              <span aria-hidden>TipCrew</span>
            </div>
            <p className={styles.footerTagline}>{t('mkFooterTagline')}</p>
          </div>
          <nav aria-label={t('mkFooterProduct')}>
            <h2 className={styles.footerHeading}>{t('mkFooterProduct')}</h2>
            <ul className={styles.footerLinks}>
              {NAV_SECTIONS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.footerLink}
                    onClick={() => scrollToSection(item.id)}
                  >
                    {t(item.label)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label={t('mkFooterAccount')}>
            <h2 className={styles.footerHeading}>{t('mkFooterAccount')}</h2>
            <ul className={styles.footerLinks}>
              <li>
                <Link to="/signin" className={styles.footerLink}>
                  {t('mkSignIn')}
                </Link>
              </li>
              <li>
                <Link to="/signup" className={styles.footerLink}>
                  {t('mkGetStarted')}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <div className={`${styles.footerBottom} ${styles.footerBottomRow}`}>
          <p>{t('mkFooterCopy').replace('{year}', String(year))}</p>
          <LegalLinks />
        </div>
      </div>
    </footer>
  );
}
