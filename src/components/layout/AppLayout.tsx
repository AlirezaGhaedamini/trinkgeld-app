import { Outlet } from 'react-router-dom';
import { BottomNav } from '@/components/layout/BottomNav';
import { DemoBar } from '@/components/layout/DemoBar';
import { Toast } from '@/components/ui/Toast';
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
 * On a phone it fills the viewport. From 900px up it is shown inside the
 * prototype's frame, with the demo switcher above and the usage hint below —
 * the presentation the design was signed off in.
 */
export function AppLayout({ withTabs = false }: AppLayoutProps) {
  const { message } = useToast();
  const { language } = useI18n();

  return (
    <div className={styles.page}>
      <DemoBar />
      <div className={styles.screenHost}>
        <div className={styles.screen}>
          <Outlet />
          {withTabs ? <BottomNav /> : null}
          {message ? <Toast message={message} /> : null}
        </div>
      </div>
      <p className={styles.footerHint}>
        {language === 'Deutsch'
          ? 'Alles ist anklickbar: Tabs, Karten, Listenzeilen, Zurück. Der Rechner rechnet mit den Zahlen, die du eingibst.'
          : 'Everything is clickable: tabs, cards, list rows, back. The calculator uses the numbers you actually enter.'}
      </p>
    </div>
  );
}
