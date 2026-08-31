import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import styles from '@/components/layout/layout.module.css';

export interface ScreenAction {
  label?: string;
  icon?: IconName;
  onClick: () => void;
}

interface ScreenProps {
  /** Omit for full-bleed screens such as sign-in and the sent confirmation. */
  title?: string;
  kicker?: string;
  /** Title size — the prototype uses 26px for tab roots, 20px for pushed views. */
  titleSize?: number;
  back?: 'arrow' | 'close' | false;
  action?: ScreenAction;
  /** Primary sticky button at the bottom. */
  cta?: {
    label: string;
    onClick: () => void;
    muted?: boolean;
    note?: string;
    noteColor?: string;
    secondary?: { label: string; onClick: () => void };
  };
  /** True when a tab bar follows, so the CTA bar drops its safe-area padding. */
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
  action,
  cta,
  aboveTabs = false,
  center = false,
  children,
}: ScreenProps) {
  const navigate = useNavigate();

  return (
    <>
      {title !== undefined ? (
        <header className={styles.header}>
          {back ? (
            <button
              type="button"
              className={styles.backButton}
              onClick={() => navigate(-1)}
              aria-label="Back"
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
          !cta && !aboveTabs ? styles.bodyLoose : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>

      {cta ? (
        <div className={`${styles.ctaBar} ${aboveTabs ? styles.ctaBarAboveTabs : ''}`}>
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
      ) : null}
    </>
  );
}
