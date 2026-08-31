import { createContext } from 'react';
import type { AppState, Dispatch } from '@/state/types';

export const AppStateContext = createContext<AppState | null>(null);
export const AppDispatchContext = createContext<Dispatch | null>(null);
