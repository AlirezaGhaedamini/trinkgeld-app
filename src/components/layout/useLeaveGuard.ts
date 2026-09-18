import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext, useLocation, type Navigator } from 'react-router-dom';

/**
 * The one `popstate` listener the guard owns, registered when this module is
 * first evaluated — before <HashRouter> mounts and adds its own.
 *
 * Order is everything here, and it is not what one might assume: an event
 * dispatched AT window has no capture phase, so a `capture: true` listener
 * added later still runs after the router's (measured in this app's browser:
 * registration order, whatever the flag). Only a listener registered first
 * can keep the router from seeing a step. It forwards to whichever guard is
 * active, if any. It lives on window, not in module scope, so a development
 * hot-reload of this file cannot register a second one.
 */
const POP_HOST = '__tipcrewLeaveGuard';
interface PopHost {
  interceptor: ((event: PopStateEvent) => void) | null;
}
function installPopGuard(): PopHost {
  const w = window as Window & { [POP_HOST]?: PopHost };
  const existing = w[POP_HOST];
  if (existing) return existing;
  const host: PopHost = { interceptor: null };
  w[POP_HOST] = host;
  window.addEventListener('popstate', (event) => host.interceptor?.(event));
  return host;
}
installPopGuard();

/**
 * Holds any navigation that would leave an area of the app while `active`, and
 * hands it to the screen to confirm or drop.
 *
 * WHY NOT useBlocker
 * React Router's own blocker only exists in a data router. TipCrew renders a
 * plain <HashRouter>, and moving to createHashRouter would change more than
 * blocking: a data router wraps route elements in its own error boundary, so
 * a render error would show React Router's page instead of ours
 * (components/layout/ErrorBoundary.tsx). The three ways a hash app can move are
 * therefore held here, directly, and only while there is something to lose:
 *
 *  · navigate() — every in-app move (tabs, the + button, links, <Navigate>)
 *    goes through the router's navigator. While active, its push and replace
 *    are wrapped; a move that stays inside passes untouched, one that leaves
 *    is held instead of performed. The originals are restored the moment the
 *    guard is released, and on unmount.
 *
 *  · browser back / forward (and the header arrow, which is history.go(-1)) —
 *    by the time `popstate` fires the browser has already moved. The guard's
 *    listener runs before the router's (see installPopGuard below), stops it
 *    from seeing the event, and steps back by exactly the distance travelled,
 *    read from the entry numbers React Router stores in history.state. The
 *    restoring step is swallowed too, so the router never sees either half and
 *    nothing loops. Proceeding replays the step with the guard stood aside.
 *
 *  · reload, closing the tab, leaving the site — the browser's own prompt,
 *    the only thing a page may do there.
 *
 * An entry React Router did not number — one made by typing an address into
 * the bar — cannot be measured, and a guessed distance could strand somebody
 * on the wrong page. For that step the screen they were on is put back as a
 * NEW entry instead, and the address they went for is only visited if they
 * confirm. Nothing is guessed, and every attempt still offers the way out.
 */
export function useLeaveGuard(active: boolean, isInside: (pathname: string) => boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const [held, setHeld] = useState<(() => void) | null>(null);

  /** The entry number and path of the screen currently shown, kept current. */
  const shownIdx = useRef<number | null>(entryIndex(window.history.state));
  const shownPath = useRef(location.pathname + location.search);
  useEffect(() => {
    shownIdx.current = entryIndex(window.history.state);
    shownPath.current = location.pathname + location.search;
  }, [location]);

  /** The navigator's own push, while the guard has it wrapped. */
  const originalPush = useRef<Navigator['push'] | null>(null);

  /** One history step the guard must let pass: the replay of a confirmed leave. */
  const passNextPop = useRef(false);

  // ── navigate(): push and replace ────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const push = navigator.push;
    const replace = navigator.replace;
    originalPush.current = push;
    const hold =
      (original: Navigator['push']): Navigator['push'] =>
      (...args) => {
        const [to] = args;
        const pathname = typeof to === 'string' ? to.split(/[?#]/)[0] : to.pathname;
        if (!pathname || isInside(pathname)) {
          original.apply(navigator, args);
          return;
        }
        setHeld(() => () => original.apply(navigator, args));
      };
    navigator.push = hold(push);
    navigator.replace = hold(replace);
    return () => {
      navigator.push = push;
      navigator.replace = replace;
      originalPush.current = null;
    };
  }, [active, navigator, isInside]);

  // ── back / forward ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const host = installPopGuard();
    let swallowRestore = false;
    const onPop = (event: PopStateEvent) => {
      if (swallowRestore) {
        swallowRestore = false;
        event.stopImmediatePropagation();
        return;
      }
      if (passNextPop.current) {
        passNextPop.current = false;
        return;
      }
      if (isInside(hashPathname())) return;
      const from = shownIdx.current;
      const to = entryIndex(event.state);
      if (from !== null && from === to) return;

      event.stopImmediatePropagation();

      if (from !== null && to !== null) {
        // Measured: step back by exactly the distance travelled.
        const delta = to - from;
        swallowRestore = true;
        window.history.go(-delta);
        setHeld(() => () => {
          passNextPop.current = true;
          window.history.go(delta);
        });
        return;
      }

      // Unmeasured: put the screen back as a new entry; go on only if confirmed.
      const target = window.location.hash.replace(/^#/, '') || '/';
      const push = originalPush.current ?? navigator.push;
      push.call(navigator, shownPath.current);
      setHeld(() => () => push.call(navigator, target));
    };
    host.interceptor = onPop;
    return () => {
      if (host.interceptor === onPop) host.interceptor = null;
      // With the guard stood down the router sees every step anyway; a pass
      // left over from a confirmed leave must not outlive it.
      passNextPop.current = false;
    };
  }, [active, isInside, navigator]);

  // ── reload, close, leave the site ───────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [active]);

  /** Carry out the held move. Call after the screen has let go of its changes. */
  const proceed = useCallback(() => {
    const go = held;
    setHeld(null);
    go?.();
  }, [held]);

  /** Forget the held move and stay. */
  const stay = useCallback(() => setHeld(null), []);

  return { held: held !== null, proceed, stay };
}

/** React Router numbers every entry it creates; 0 is the first in this tab. */
function entryIndex(state: unknown): number | null {
  return typeof state === 'object' && state !== null && 'idx' in state && typeof state.idx === 'number'
    ? state.idx
    : null;
}

/** The route path of the current hash URL, without its query. */
function hashPathname(): string {
  return window.location.hash.replace(/^#/, '').split(/[?#]/)[0] || '/';
}
