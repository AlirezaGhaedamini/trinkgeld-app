/**
 * The CSV, built from the export dataset and from nothing else.
 *
 * ── WHY SEMICOLONS AND A BOM ───────────────────────────────────────────────
 * This is a German-market product, and the file people open it with is Excel on
 * a German Windows machine. That Excel reads a comma-separated file as one
 * column unless the user runs the import wizard, and it reads a UTF-8 file as
 * mojibake unless the file starts with a byte-order mark. Both are famous, both
 * silently produce a document the manager will not trust, and neither is
 * anybody's fault at the moment they happen.
 *
 * So: a UTF-8 BOM, semicolon delimiters, CRLF line endings — the combination
 * Excel opens correctly by double-click in every locale that matters here.
 *
 * ── WHY EVERY AMOUNT APPEARS TWICE ─────────────────────────────────────────
 * Once as integer cents, once formatted with a comma decimal separator. The
 * cents column is the one to compute with: it cannot be misread by a locale,
 * cannot lose a trailing zero and cannot be turned into a date. The formatted
 * column is the one to read. Giving only the formatted one would make the file
 * pretty and unusable; giving only cents would make it correct and unreadable.
 *
 * ── WHY THE SHAPE IS ONE LONG TABLE ────────────────────────────────────────
 * A spreadsheet is a grid, so the export is a grid: one row per fact, with a
 * `record_type` column saying what kind of fact it is. Sections would look
 * nicer and would break every sort, filter and pivot the manager might apply.
 */

import type { PeriodExport } from '@/period/types';

/** Excel on a German machine needs this or the umlauts arrive as mojibake. */
export const CSV_BOM = '﻿';
export const CSV_DELIMITER = ';';
export const CSV_NEWLINE = '\r\n';

/**
 * One field, quoted the way RFC 4180 says.
 *
 * Everything is quoted rather than only the fields that need it: a value that
 * gains a semicolon later cannot then break the file, and a leading `=` or `+`
 * cannot be read by a spreadsheet as a formula.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Integer cents as a German decimal: 133750 → "1337,50". Never a locale call. */
export function csvMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const part = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole},${part}`;
}

/** Fixed decimals with a comma, for points, multipliers and units. */
export function csvNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace('.', ',');
}

export const CSV_COLUMNS = [
  'record_type',
  'business_date',
  'period_start',
  'period_end',
  'distribution_ref',
  'distribution_status',
  'is_current',
  'is_correction',
  'replaces_ref',
  'correction_source',
  'correction_reason',
  'correction_note',
  'rule_version',
  'method',
  'overlap_basis',
  'min_overlap_minutes',
  'member_name',
  'area',
  'role',
  'worked_minutes',
  'overlap_minutes',
  'points',
  'multiplier',
  'units',
  'acknowledgement',
  'settlement_kind',
  'settlement_method',
  'settlement_reason',
  'settlement_still_counts',
  'event_at',
  'recorded_after_close',
  'note',
  'amount_cents',
  'amount',
] as const;

type Row = Partial<Record<(typeof CSV_COLUMNS)[number], string | number | null>>;

const yesNo = (v: boolean) => (v ? 'yes' : 'no');

/**
 * Short, stable references instead of UUIDs.
 *
 * A manager reading a spreadsheet needs to see that row 14 corrects row 9; a
 * 36-character identifier in every cell makes that harder, not easier. The
 * mapping is deterministic — the same export always numbers the same way —
 * and the full id never leaves the database.
 */
function refs(data: PeriodExport): Map<string, string> {
  const map = new Map<string, string>();
  data.distributions.forEach((d, i) => map.set(d.id, `D${String(i + 1).padStart(3, '0')}`));
  return map;
}

/** The export as rows, in the order the file will have them. */
export function csvRows(data: PeriodExport): Row[] {
  const ref = refs(data);
  const rows: Row[] = [];
  const { period, summary } = data;

  rows.push({
    record_type: 'period',
    period_start: period.periodStart,
    period_end: period.periodEnd,
    note: `${period.workplaceName} · ${period.timezone} · business day from ${String(
      period.businessDayStartHour,
    ).padStart(2, '0')}:00 · basis: ${period.basis}`,
    event_at: period.generatedAt,
  });

  if (period.close) {
    rows.push({
      record_type: 'close',
      period_start: period.periodStart,
      period_end: period.periodEnd,
      member_name: period.close.closedByName,
      event_at: period.close.closedAt,
      note: period.close.note,
    });
  }

  const totals: [string, number][] = [
    ['current_entitlement', summary.currentEntitlementCents],
    ['replaced_entitlement', summary.replacedEntitlementCents],
    ['payout_events_gross', summary.payoutTotalCents],
    ['reversals', -summary.reversalTotalCents],
    ['effective_settled', summary.effectiveSettledCents],
    ['outstanding', summary.outstandingCents],
  ];
  for (const [name, cents] of totals) {
    rows.push({
      record_type: 'summary',
      period_start: period.periodStart,
      period_end: period.periodEnd,
      note: name,
      amount_cents: cents,
      amount: csvMoney(cents),
    });
  }
  rows.push({
    record_type: 'summary',
    period_start: period.periodStart,
    period_end: period.periodEnd,
    note: `distributions_current=${summary.distributionsCurrent} replaced=${summary.distributionsReplaced} corrections=${summary.corrections} records_after_close=${summary.recordsAfterClose}`,
  });

  for (const d of data.distributions) {
    const base: Row = {
      business_date: d.periodStart,
      period_start: d.periodStart,
      period_end: d.periodEnd,
      distribution_ref: ref.get(d.id) ?? '',
      distribution_status: d.status,
      is_current: yesNo(d.isCurrent),
      is_correction: yesNo(d.isCorrection),
      replaces_ref: d.supersedesId ? (ref.get(d.supersedesId) ?? '') : '',
      correction_source: d.correctionSource ?? '',
      correction_reason: d.correctionReason ?? '',
      correction_note: d.correctionNote ?? d.triggerQueryNote ?? '',
      rule_version: d.ruleVersion,
      method: d.method,
      overlap_basis: d.overlapBasis,
      min_overlap_minutes: d.minOverlapMinutes,
      recorded_after_close: yesNo(d.afterClose),
    };

    rows.push({
      ...base,
      record_type: 'distribution',
      event_at: d.sentAt ?? d.createdAt,
      amount_cents: d.entitlementCents,
      amount: csvMoney(d.entitlementCents),
      note: `people=${d.peopleCount}`,
    });

    for (const m of d.members) {
      rows.push({
        ...base,
        record_type: 'share',
        member_name: m.memberName,
        area: m.areaName,
        role: m.roleName ?? '',
        worked_minutes: m.workedMinutes,
        overlap_minutes: m.overlapMinutes,
        points: csvNumber(m.points),
        multiplier: csvNumber(m.multiplier),
        units: csvNumber(m.units),
        acknowledgement: m.ackStatus,
        event_at: m.acknowledgedAt ?? '',
        amount_cents: m.amountCents,
        amount: csvMoney(m.amountCents),
      });
    }

    for (const e of d.settlement) {
      rows.push({
        ...base,
        record_type: 'settlement',
        settlement_kind: e.kind,
        settlement_method: e.method ?? '',
        settlement_reason: e.reason ?? '',
        settlement_still_counts: yesNo(e.stillCounts),
        member_name: e.actorName ?? '',
        event_at: e.eventAt,
        recorded_after_close: yesNo(e.afterClose),
        note: e.note ?? '',
        amount_cents: e.amountCents,
        amount: csvMoney(e.amountCents),
      });
    }
  }

  return rows;
}

/** The finished file, ready to be handed to a download. */
export function buildCsv(data: PeriodExport): string {
  const header = CSV_COLUMNS.map(csvField).join(CSV_DELIMITER);
  const body = csvRows(data).map((row) =>
    CSV_COLUMNS.map((c) => csvField(row[c] ?? '')).join(CSV_DELIMITER),
  );
  return CSV_BOM + [header, ...body].join(CSV_NEWLINE) + CSV_NEWLINE;
}

/** `tipcrew-2023-09-01-2023-09-07.csv` — sorts by period in a folder listing. */
export function csvFilename(data: PeriodExport): string {
  return `tipcrew-${data.period.periodStart}-${data.period.periodEnd}.csv`;
}

/**
 * The totals a reader can add up from the file itself.
 *
 * Used by the tests to prove the CSV and the structured export agree: if these
 * ever diverge, the file is lying about the database.
 */
export function csvTotals(csv: string): Record<string, number> {
  const out: Record<string, number> = {};
  const lines = csv.replace(/^﻿/, '').split(CSV_NEWLINE).filter(Boolean);
  const header = lines[0].split(CSV_DELIMITER).map((h) => h.replace(/^"|"$/g, ''));
  const typeAt = header.indexOf('record_type');
  const noteAt = header.indexOf('note');
  const centsAt = header.indexOf('amount_cents');
  for (const line of lines.slice(1)) {
    const cells = line.split(CSV_DELIMITER).map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (cells[typeAt] !== 'summary') continue;
    const cents = Number(cells[centsAt]);
    if (Number.isFinite(cents) && cells[centsAt] !== '') out[cells[noteAt]] = cents;
  }
  return out;
}
