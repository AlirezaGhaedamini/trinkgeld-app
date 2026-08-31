import { createContext } from 'react';
import type { AreaId, Language } from '@/types';
import type { StringKey } from '@/i18n/strings';

export interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Look up a string. Unknown keys return the key, never `undefined`. */
  t: (key: StringKey) => string;
  /** Money, in the reader's locale: "€2,480.00" / "2.480,00 €". */
  money: (amount: number) => string;
  /** A plain number with a fixed number of decimals. */
  num: (value: number, decimals: number) => string;
  /** "45%" / "45 %". */
  percent: (value: number) => string;
  /** "8.5 h" / "8,5 Std". */
  hours: (value: number) => string;
  /** "13 people" / "13 Personen". */
  people: (count: number) => string;
  /** Minutes as "45 min" under an hour, "1.5 h" above it. */
  duration: (minutes: number) => string;
  /** Translated area name. */
  area: (area: AreaId) => string;
  /** "Sat 22 Aug · evening" — the demo dataset's date labels. */
  dateLabel: (dateKey: string) => string;
  /**
   * A distribution's date: the demo label when it carries a demo key, the real
   * calendar day otherwise. Distributions created in the app use the latter.
   */
  dateFor: (dateKey: string, isoDate: string) => string;
  /** ["22", "AUG"] for the little calendar chip. */
  chipFor: (dateKey: string, isoDate: string) => [string, string];
  /** A real calendar day: "Sat 22 Aug" / "Sa 22. Aug". */
  day: (date: Date) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);
