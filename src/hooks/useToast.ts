import { useContext } from 'react';
import { ToastContext, type ToastValue } from '@/state/toastContext';

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
