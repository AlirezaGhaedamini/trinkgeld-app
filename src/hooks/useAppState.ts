import { useContext } from 'react';
import { AppDispatchContext, AppStateContext } from '@/state/context';
import type { AppState, Dispatch } from '@/state/types';

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState must be used inside <AppStateProvider>');
  return state;
}

export function useAppDispatch(): Dispatch {
  const dispatch = useContext(AppDispatchContext);
  if (!dispatch) throw new Error('useAppDispatch must be used inside <AppStateProvider>');
  return dispatch;
}
