import { createContext, useContext, type ReactNode } from 'react';
import styles from '@/components/layout/layout.module.css';

const InShell = createContext(false);

/**
 * The device column every screen sits in: the viewport-high page that never
 * scrolls itself, and inside it the screen that carries the device's safe-area
 * insets (`.screen` in layout.module.css — the only place the top inset is
 * applied). A Screen's header, body, button bar and the tab bar all lay out
 * inside it, so each of them starts below the status bar / Dynamic Island and
 * ends above the home indicator without knowing either exists.
 *
 * WHY IT IS ITS OWN COMPONENT
 * AppLayout used to be the only thing that drew this frame, and the session
 * splash is rendered by the route guards, which sit ABOVE AppLayout. So the
 * splash — the first thing on screen at every cold start — got no frame at
 * all: no inset (its logo painted from y = 0, under the status bar), no
 * centring, and the page canvas colour instead of the app's. One frame, used
 * by both, keeps that from happening to anything else drawn outside a layout.
 *
 * Inside an existing frame it renders its children and nothing else, so a
 * screen that is sometimes drawn by a guard and sometimes by a layout can
 * never end up with a frame inside a frame.
 */
export function ShellFrame({
  above,
  below,
  children,
}: {
  /** Drawn above the device column on large screens (the demo switcher). */
  above?: ReactNode;
  /** Drawn below it on large screens (the demo hint). */
  below?: ReactNode;
  children: ReactNode;
}) {
  const nested = useContext(InShell);
  if (nested) return <>{children}</>;

  return (
    <InShell.Provider value>
      <div className={styles.page}>
        {above}
        <div className={styles.screenHost}>
          <div className={styles.screen}>{children}</div>
        </div>
        {below}
      </div>
    </InShell.Provider>
  );
}
