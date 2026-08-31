import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';

/**
 * How the shift being worked on is labelled.
 *
 * With the sample workplace loaded this is the demo evening (Sat 22 Aug); on a
 * real install it is simply today, so a fresh app never shows a date nobody
 * chose.
 */
export function useShiftLabel() {
  const { dataMode } = useAppState();
  const { dateLabel, day } = useI18n();

  if (dataMode === 'demo') {
    const full = dateLabel('sat22');
    return { full, short: full.split(' · ')[0] };
  }

  const today = day(new Date());
  return { full: today, short: today };
}

/** The label for a shift a day earlier — used by the shift picker. */
export function usePreviousShiftLabel() {
  const { dataMode } = useAppState();
  const { dateLabel, day } = useI18n();

  if (dataMode === 'demo') return dateLabel('fri21').split(' · ')[0];

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return day(yesterday);
}
