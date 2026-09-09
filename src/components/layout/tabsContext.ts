import { createContext, useContext } from 'react';

/**
 * Is the tab bar underneath this screen?
 *
 * `Screen` needs the answer for one reason only: spacing. With the bar below,
 * the sticky call-to-action drops its own safe-area padding because the bar
 * already carries it, and the body drops the extra bottom room it reserves when
 * nothing follows it.
 *
 * It used to be a prop each page passed by hand, which meant every page had to
 * agree with what the router had decided — and once the bar started appearing
 * under pushed screens, a dozen more pages would have had to remember. The
 * layout that renders the bar is the only thing that actually knows, so it
 * says so here and `Screen` reads it. The prop survives as an override for a
 * screen that needs to disagree.
 */
export const TabsPresentContext = createContext(false);

export function useTabsPresent(): boolean {
  return useContext(TabsPresentContext);
}
