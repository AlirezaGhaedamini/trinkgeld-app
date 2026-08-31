import { useReducer, type ReactNode } from 'react';
import { appReducer, initialState } from '@/state/appReducer';
import { AppDispatchContext, AppStateContext } from '@/state/context';

/**
 * Single source of truth for the demo.
 *
 * Everything the app mutates lives here — session, roster, rules, hours,
 * reports and distributions — behind a reducer with an explicit action union.
 * When Supabase arrives, the reducer becomes the optimistic local half and each
 * action gains a matching mutation; no component has to change.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
