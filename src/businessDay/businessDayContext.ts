import { createContext } from 'react';
import type { BusinessDayValue } from '@/businessDay/types';

export const BusinessDayContext = createContext<BusinessDayValue | null>(null);
