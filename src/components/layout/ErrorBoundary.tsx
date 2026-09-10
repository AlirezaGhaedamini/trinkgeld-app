import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/hooks/useI18n';
import ui from '@/components/ui/ui.module.css';

/**
 * The last thing between an unexpected render throw and a blank phone.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * and under HashRouter the URL that caused it stays in the address bar — so a
 * reload reproduces it and the app looks permanently dead. That happened once
 * in this project already, from a translation lookup on a value the build did
 * not know, and the 3S-A audit called the absence of a boundary a release risk
 * rather than a tidiness one.
 *
 * What this deliberately does NOT do: stand in for a screen's own error state.
 * Every domain hook already classifies its failures and every page renders them
 * — a network error, a refused write, an empty period. Those never throw, so
 * they never reach here. This is only for the programming mistake nobody
 * predicted, and the user is told that in those words rather than shown a
 * stack.
 *
 * The two ways out use window directly rather than the router, because a throw
 * during routing must not leave the fallback depending on the thing that broke.
 */

interface Copy {
  title: string;
  body: string;
  reload: string;
  home: string;
}

interface Props extends Copy {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

class Boundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Development only. Nothing is sent anywhere, and nothing about the error
    // reaches the screen: a stack trace is not something to hand a person
    // holding a phone in a bar, and it is not ours to leak either.
    if (import.meta.env.DEV) {
      console.error('[TipCrew] unhandled render error', error, info.componentStack);
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className={ui.boundary} role="alert">
        <h1 className={ui.boundaryTitle}>{this.props.title}</h1>
        <p className={ui.boundaryBody}>{this.props.body}</p>
        <div className={ui.boundaryActions}>
          <Button
            block
            onClick={() => {
              window.location.reload();
            }}
          >
            {this.props.reload}
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => {
              // Back to the router's entry point, then reload, so the route
              // that threw is not simply rendered again.
              window.location.hash = '#/';
              window.location.reload();
            }}
          >
            {this.props.home}
          </Button>
        </div>
      </div>
    );
  }
}

/**
 * Reads the copy through the i18n provider, which sits OUTSIDE this boundary in
 * App.tsx — so the strings are already resolved by the time anything inside can
 * throw, and the fallback never has to guess at a language.
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Boundary
      title={t('ebTitle')}
      body={t('ebBody')}
      reload={t('ebReload')}
      home={t('ebHome')}
    >
      {children}
    </Boundary>
  );
}
