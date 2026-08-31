import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { DICTIONARIES, type StringKey } from '@/i18n/strings';
import { I18nContext, type I18nValue } from '@/i18n/context';
import type { AreaId, Language } from '@/types';

const AREA_KEY: Record<AreaId, StringKey> = {
  Service: 'areaService',
  Bar: 'areaBar',
  Kitchen: 'areaKitchen',
  Runner: 'areaRunner',
  Host: 'areaHost',
  Management: 'areaManagement',
};

const DATE_LABELS: Record<Language, Record<string, string>> = {
  English: {
    sat22: 'Sat 22 Aug · evening',
    fri21: 'Fri 21 Aug · evening',
    thu20: 'Thu 20 Aug · evening',
    sat15: 'Sat 15 Aug · evening',
    fri14: 'Fri 14 Aug · evening',
  },
  Deutsch: {
    sat22: 'Sa 22. Aug · Abend',
    fri21: 'Fr 21. Aug · Abend',
    thu20: 'Do 20. Aug · Abend',
    sat15: 'Sa 15. Aug · Abend',
    fri14: 'Fr 14. Aug · Abend',
  },
};

const DATE_CHIPS: Record<string, [string, string]> = {
  sat22: ['22', 'AUG'],
  fri21: ['21', 'AUG'],
  thu20: ['20', 'AUG'],
  sat15: ['15', 'AUG'],
  fri14: ['14', 'AUG'],
};

const STORAGE_KEY = 'tipcrew.language';

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'English' || stored === 'Deutsch') return stored;
  } catch {
    /* private mode, blocked storage — fall through to the default */
  }
  return 'English';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* non-fatal: the choice just will not survive a reload */
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTIONARIES[language];
    const german = language === 'Deutsch';
    const locale = german ? 'de-DE' : 'en-US';

    const t = (key: StringKey) => dict[key] ?? key;

    const num = (input: number, decimals: number) =>
      input.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

    const money = (amount: number) => {
      const formatted = num(amount, 2);
      return german ? `${formatted} €` : `€${formatted}`;
    };

    const hours = (value: number) => `${num(value, 1)} ${t('hSuffix')}`;

    return {
      language,
      setLanguage,
      t,
      money,
      num,
      percent: (value: number) => (german ? `${value} %` : `${value}%`),
      hours,
      people: (count: number) => `${count} ${count === 1 ? t('person') : t('people')}`,
      duration: (minutes: number) =>
        minutes < 60
          ? `${Math.round(minutes)} ${t('minutesShort')}`
          : `${num(minutes / 60, minutes % 60 ? 1 : 0)} ${t('hSuffix')}`,
      area: (area: AreaId) => t(AREA_KEY[area]),
      dateLabel: (dateKey: string) => DATE_LABELS[language][dateKey] ?? dateKey,
      dateFor: (dateKey: string, isoDate: string) =>
        DATE_LABELS[language][dateKey] ??
        new Date(isoDate).toLocaleDateString(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
      chipFor: (dateKey: string, isoDate: string) => {
        const known = DATE_CHIPS[dateKey];
        if (known) return known;
        const date = new Date(isoDate);
        return [
          String(date.getDate()),
          date.toLocaleDateString(locale, { month: 'short' }).toUpperCase(),
        ];
      },
      day: (date: Date) =>
        date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }),
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
