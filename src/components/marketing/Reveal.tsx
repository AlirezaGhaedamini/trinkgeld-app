import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import styles from '@/components/marketing/marketing.module.css';

/**
 * A block that fades up the first time it scrolls into view.
 *
 * CSS does the animating; this only flips one class, once, from an
 * IntersectionObserver — no scroll listener, no animation library. Anything
 * that cannot run it (no IntersectionObserver, reduced motion) is shown
 * immediately, and the stylesheet's reduced-motion block makes `.reveal`
 * visible regardless, so content is never left hidden waiting for an event.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Milliseconds, for a gentle stagger across a row of cards. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const classes = [styles.reveal, shown ? styles.revealIn : '', className]
    .filter(Boolean)
    .join(' ');
  const style: CSSProperties | undefined = delay ? { transitionDelay: `${delay}ms` } : undefined;

  return (
    <div ref={ref} className={classes} style={style}>
      {children}
    </div>
  );
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Scroll to a section of the page and move focus to its heading.
 *
 * Not an `<a href="#how">`: the app runs on HashRouter, so a fragment link is a
 * ROUTE change — `#how` would be matched against the route table, fall
 * through to the catch-all and redirect. The sections are reached by id and
 * scrollIntoView instead, and focus follows so keyboard and screen-reader users
 * land where sighted users do.
 */
export function scrollToSection(id: string): void {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const heading = section.querySelector<HTMLElement>('h2');
  heading?.focus({ preventScroll: true });
}
