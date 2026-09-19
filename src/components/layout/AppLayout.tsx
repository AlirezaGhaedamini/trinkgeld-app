import { Outlet } from 'react-router-dom';
import { BottomNav } from '@/components/layout/BottomNav';
import { TabsPresentContext } from '@/components/layout/tabsContext';
import { DemoBar } from '@/components/layout/DemoBar';
import { ShellFrame } from '@/components/layout/ShellFrame';
import { Toast } from '@/components/ui/Toast';
import { useRealAuth } from '@/hooks/useAuth';
import { useWorkplace } from '@/hooks/useWorkplace';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import styles from '@/components/layout/layout.module.css';

interface AppLayoutProps {
  /** Tab roots show the bottom navigation; pushed screens do not. */
  withTabs?: boolean;
}

/**
 * The device column.
 *
 * The tab bar, when there is one, is the LAST FLEX ITEM of the screen column
 * rather than a fixed overlay. That is what makes it permanent without it
 * ever covering anything: `.page` is the viewport height with its own scroll
 * switched off, `.body` is the only thing that scrolls, and the bar keeps its
 * own room at the bottom including the iOS inset. Screens below are told it
 * is there through TabsPresentContext, so their bottom spacing follows the
 * layout instead of each page having to remember.
 *
 * The bar is withheld in one case, and it is not a route: when the person has
 * no ACTIVE membership. Every tab leads behind RequireWorkplace, which would
 * bounce them straight back, so on the two screens that exist precisely
 * because there is no workplace yet the bar would be a row of dead buttons.
 * Someone who already works somewhere and is only switching keeps it.
 *
 * On a phone it fills the viewport. From 900px up it is shown inside the
 * prototype's frame — and, in demo mode only, with the demo switcher above
 * and the usage hint below, the presentation the design was signed off in.
 * A real account never sees either: the switcher's role and data-mode
 * buttons are the one control that could move a production user into the
 * sample dataset, and the hint describes a prototype, not their workplace.
 */
export function AppLayout({ withTabs = false }: AppLayoutProps) {
  const { message } = useToast();
  const { language } = useI18n();
  const real = useRealAuth();
  const workplace = useWorkplace();

  /* One decision, feeding both the bar and the spacing below it, so the two
     can never disagree. Demo mode has no memberships and always shows it. */
  const showTabs = withTabs && (!workplace.enabled || workplace.activeMembership !== null);

  return (
    <TabsPresentContext.Provider value={showTabs}>
      <ShellFrame
        above={real ? null : <DemoBar />}
        below={
          real ? null : (
            <p className={styles.footerHint}>
              {language === 'Deutsch'
                ? 'Alles ist anklickbar: Tabs, Karten, Listenzeilen, Zurück. Der Rechner rechnet mit den Zahlen, die du eingibst.'
                : 'Everything is clickable: tabs, cards, list rows, back. The calculator uses the numbers you actually enter.'}
            </p>
          )
        }
      >
        <Outlet />
        {showTabs ? <BottomNav /> : null}
        {message ? <Toast message={message} /> : null}
      </ShellFrame>
    </TabsPresentContext.Provider>
  );
}
