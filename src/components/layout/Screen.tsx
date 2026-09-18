import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/hooks/useI18n';
import { useTabsPresent } from '@/components/layout/tabsContext';
import styles from '@/components/layout/layout.module.css';

export interface ScreenAction {
  label?: string;
  icon?: IconName;
  onClick: () => void;
}

/** The sticky button at the bottom of a screen, and the note above it. */
export interface ScreenCta {
  label: string;
  onClick: () => void;
  muted?: boolean;
  note?: string;
  noteColor?: string;
  secondary?: { label: string; onClick: () => void };
}

interface ScreenProps {
  /** Omit for full-bleed screens such as sign-in and the sent confirmation. */
  title?: string;
  kicker?: string;
  /** Title size — the prototype uses 26px for tab roots, 20px for pushed views. */
  titleSize?: number;
  back?: 'arrow' | 'close' | false;
  action?: ScreenAction;
  /**
   * Where the back arrow goes when there is no earlier screen of this app to
   * return to — the screen was opened straight from a link, a bookmark or a new
   * tab. With app history behind it, back is always the browser's own back, so
   * the arrow and the browser button never disagree.
   */
  backTo?: string;
  /** Primary sticky button at the bottom. */
  cta?: ScreenCta;
  /**
   * A note in the sticky bottom bar with no button under it: a running figure
   * the screen's own controls change, kept in view while the body scrolls.
   * Ignored when `cta` is set — a button carries its own note.
   */
  footnote?: { text: string; color?: string };
  /**
   * True when a tab bar follows, so the CTA bar drops its safe-area padding
   * and the body drops the room it reserves when nothing follows it.
   * Defaults to what the layout says, which is the only thing that knows.
   */
  aboveTabs?: boolean;
  center?: boolean;
  children: ReactNode;
}

/**
 * Every screen is header + scrolling body + optional sticky CTA.
 *
 * Returned as a fragment on purpose: the three parts become direct children of
 * the app column, so the body is the only thing that scrolls and the CTA never
 * covers content.
 */
export function Screen({
  title,
  kicker,
  titleSize = 20,
  back = 'arrow',
  backTo,
  action,
  cta,
  footnote,
  aboveTabs,
  center = false,
  children,
}: ScreenProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  /* The layout that draws the bar is the authority; the prop is an override
     for a screen that has to disagree with it. */
  const tabsPresent = useTabsPresent();
  const tabsBelow = aboveTabs ?? tabsPresent;

  /* React Router numbers the entries it creates in `history.state.idx`; 0 is
     the first screen this tab opened. `location.key === 'default'` is the
     usual test, but it misses a first screen reached through a redirect — an
     old /manager/rules bookmark lands on idx 0 with a real key — and there
     navigate(-1) would leave the app. Replacing rather than pushing keeps the
     browser's own back from bouncing between the two. */
  const goBack = () => {
    const entry: unknown = window.history.state;
    const idx =
      typeof entry === 'object' && entry !== null && 'idx' in entry && typeof entry.idx === 'number'
        ? entry.idx
        : 0;
    if (backTo && idx === 0) navigate(backTo, { replace: true });
    else navigate(-1);
  };

  return (
    <>
      {title !== undefined ? (
        <header className={styles.header}>
          {back ? (
            <button
              type="button"
              className={styles.backButton}
              onClick={goBack}
              aria-label={back === 'close' ? t('close') : t('back')}
            >
              <Icon name={back === 'close' ? 'x' : 'arrow-left'} size={22} />
            </button>
          ) : null}
          <div className={styles.headerText}>
            {kicker ? <p className={styles.headerKicker}>{kicker}</p> : null}
            <h1 className={styles.headerTitle} style={{ fontSize: titleSize }}>
              {title}
            </h1>
          </div>
          {action ? (
            <button type="button" className={styles.headerAction} onClick={action.onClick}>
              {action.icon ? <Icon name={action.icon} size={19} /> : null}
              {action.label}
            </button>
          ) : null}
        </header>
      ) : null}

      <div
        className={[
          styles.body,
          'app-scroll',
          center ? styles.bodyCentered : '',
          !cta && !footnote && !tabsBelow ? styles.bodyLoose : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>

      {cta ? (
        <div className={`${styles.ctaBar} ${tabsBelow ? styles.ctaBarAboveTabs : ''}`}>
          {cta.note ? (
            <p className={styles.ctaNote} style={{ color: cta.noteColor ?? 'var(--color-text-muted)' }}>
              {cta.note}
            </p>
          ) : null}
          <div className={styles.ctaRow}>
            {cta.secondary ? (
              <Button variant="secondary" onClick={cta.secondary.onClick}>
                {cta.secondary.label}
              </Button>
            ) : null}
            <Button muted={cta.muted} onClick={cta.onClick}>
              {cta.label}
            </Button>
          </div>
        </div>
      ) : footnote ? (
        <div className={`${styles.ctaBar} ${tabsBelow ? styles.ctaBarAboveTabs : ''}`}>
          <p className={styles.ctaNote} style={{ color: footnote.color ?? 'var(--color-text-muted)' }}>
            {footnote.text}
          </p>
        </div>
      ) : null}
    </>
  );
}
