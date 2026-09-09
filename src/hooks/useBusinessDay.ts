import { useContext } from 'react';
import { BusinessDayContext } from '@/businessDay/businessDayContext';
import type { BusinessDayValue } from '@/businessDay/types';

/** The server's business day for the active workplace. Throws outside <BusinessDayProvider>. */
export function useBusinessDay(): BusinessDayValue {
  const value = useContext(BusinessDayContext);
  if (!value) throw new Error('useBusinessDay must be used inside <BusinessDayProvider>');
  return value;
}
