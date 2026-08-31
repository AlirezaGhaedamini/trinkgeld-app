/** A member's own count of what came in on a shift. Money is integer cents. */

import type { Tables } from '@/types/database';

export interface TipReport {
  id: string;
  workplaceId: string;
  memberId: string;
  workDate: string;
  cardCents: number;
  cashCents: number;
  totalCents: number;
  note: string | null;
  reportedAt: string;
  memberName?: string;
}

export function toTipReport(row: Tables<'tip_reports'>): TipReport {
  return {
    id: row.id,
    workplaceId: row.workplace_id,
    memberId: row.member_id,
    workDate: row.work_date,
    cardCents: row.card_cents,
    cashCents: row.cash_cents,
    totalCents: row.total_cents ?? row.card_cents + row.cash_cents,
    note: row.note,
    reportedAt: row.reported_at,
  };
}

/**
 * Money never becomes a float.
 *
 * The keypad already produces integer cents, so this exists for the one case
 * where a value arrives as typed text. It parses the digits, never
 * `parseFloat(x) * 100` — which turns 8.15 € into 814.9999999999999 cents.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, '').replace(/[€$£]/g, '');
  if (cleaned === '') return null;
  const match = /^(\d+)(?:[.,](\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (!Number.isSafeInteger(whole)) return null;
  return whole * 100 + Number(fraction);
}

export const MAX_REPORT_CENTS = 100_000_00; // 100 000 € — a typo guard, not a rule.

export function validateReport(cardCents: number, cashCents: number): boolean {
  if (!Number.isInteger(cardCents) || !Number.isInteger(cashCents)) return false;
  if (cardCents < 0 || cashCents < 0) return false;
  if (cardCents + cashCents <= 0) return false;
  return cardCents + cashCents <= MAX_REPORT_CENTS;
}
