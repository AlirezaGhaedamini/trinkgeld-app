import { createContext } from 'react';

export interface ToastValue {
  message: string | null;
  /** Show a transient confirmation. Replaces any message already showing. */
  show: (message: string) => void;
}

export const ToastContext = createContext<ToastValue | null>(null);
