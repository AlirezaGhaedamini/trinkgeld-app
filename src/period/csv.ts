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
 * Excel opens correctly by double-click on the German machines this targets.
 *
 * AND DELIBERATELY NO `sep=;` LINE. It is the obvious fix for the other case —
 * an Excel whose list separator is a comma drops the whole file into column A —
 * and it was tried, opened in Excel, and reverted: once a `sep=` line is
 * present Excel stops honouring the UTF-8 BOM and reads the bytes as the
 * system ANSI codepage, so `Jürgen Groß` arrives as mojibake. Measured across
 * six variants: any `sep=` line buys the columns and costs the encoding,
 * whatever the delimiter, and that trade is wrong for a file full of people's
 * names. On a non-German Excel the import wizard is the answer, not this line.
 *
 * ── WHY IT IS FOUR SECTIONS AND NOT ONE TABLE ──────────────────────────────
 * It used to be one grid of 34 columns with a `record_type` telling you which
 * kind of row you were looking at, on the reasoning that sections would break
 * sorting and filtering. A release test settled that argument: opened in Excel
 * it read as a database dump — most cells empty on any given row, engine inputs
 * beside payroll figures, and summary facts packed into a note string. The four
 * things a manager opens this file to learn each have their own shape, so each
 * gets its own block of six to eight columns, separated by a blank line. Every
 * block still sorts and filters on its own, which is as much as anyone did with
 * the flat version anyway.
 *
 * ── WHAT NEVER APPEARS ─────────────────────────────────────────────────────
 * No uuid, no member id, no auth id, no email, no token. Distributions are
 * numbered D001, D002 in the order the export lists them, which is what makes
 * "this one replaces that one" legible. Engine inputs — points, multipliers,
 * units, overlap minutes, the rule version, the overlap basis — are how the
 * split was computed and belong on the screen that explains it, not in a
 * handover to an accountant.
 *
 * ── LANGUAGE ───────────────────────────────────────────────────────────────
 * The file follows the app's language, because the language screen promises it
 * does. Enum values are never printed raw: they go through the same label maps
 * the screens use, so the spreadsheet and the app cannot disagree about what
 * `hours_points` is called.
 */

import type { StringKey } from '@/i18n/strings';
import type { PeriodExport } from '@/period/types';
import type { PayoutMethod, ReversalReason } from '@/distribution/types';
import {
  ACK_STATUS_LABEL,
  CORRECTION_REASON_LABEL,
  DISTRIBUTION_STATUS_LABEL,
  PAYOUT_METHOD_LABEL,
  REVERSAL_REASON_LABEL,
} from '@/distribution/ack';
import type { CorrectionReason } from '@/distribution/ack';
import { METHOD_LABEL } from '@/rules/types';
import type { RuleMethod } from '@/rules/types';

/** Excel on a German machine needs this or the umlauts arrive as mojibake. */
export const CSV_BOM = '﻿';
export const CSV_DELIMITER = ';';
export const CSV_NEWLINE = '\r\n';

/** The app's translator, narrowed to what this module needs. */
export type Translate = (key: StringKey) => string;

/**
 * One field, quoted the way RFC 4180 says.
 *
 * Everything is quoted rather than only the fields that need it: a value that
 * gains a semicolon later cannot then break the file.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Free text, defused.
 *
 * Quoting keeps a value in one cell; it does NOT stop Excel treating a cell
 * that begins `=`, `+`, `@` — or `-` followed by something that is not a
 * number — as a formula once the file is open. The values in this file that a
 * person can author are names and notes, so those go through here and get a
 * leading apostrophe, which Excel consumes as "this is text" and does not
 * display. Numbers, dates and refs are built by this module and never touched,
 * so a negative amount stays a negative amount.
 */
export function csvText(value: string | null | undefined): string {
  const text = value ?? '';
  const risky = /^[=+@\t\r]/.test(text) || /^-(?![\d.,])/.test(text);
  return csvField(risky ? `'${text}` : text);
}

/** Integer cents as a German decimal: 133750 → "1337,50". Never a locale call. */
export function csvMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const part = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole},${part}`;
}

/** Minutes as a person reads a shift: 270 → "4:30", 480 → "8:00". */
export function csvDuration(minutes: number): string {
  const total = Math.max(0, Math.trunc(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `2026-09-05T21:00:00Z` → `2026-09-05 21:00`. Never re-zoned in the browser. */
export function csvMoment(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}

/**
 * Short, stable references instead of UUIDs.
 *
 * A manager reading a spreadsheet needs to see that row 14 corrects row 9; a
 * 36-character identifier in every cell makes that harder, not easier. The
 * mapping is deterministic — the same export always numbers the same way —
 * and the full id never leaves the database.
 */
export function distributionRefs(data: PeriodExport): Map<string, string> {
  const map = new Map<string, string>();
  data.distributions.forEach((d, i) => map.set(d.id, `D${String(i + 1).padStart(3, '0')}`));
  return map;
}

/** The label keys Section 1 uses, in the order it prints them. */
export const SUMMARY_ROWS = [
  'csvWorkplace',
  'csvPeriod',
  'csvClosedAt',
  'csvClosedBy',
  'csvCurrentDistributions',
  'csvCurrentEntitlement',
  'csvSettled',
  'csvOutstanding',
  'csvCorrections',
  'csvReplacedEntitlement',
  'csvRecordsAfterClose',
] as const satisfies readonly StringKey[];

type Line = string;

const row = (cells: string[]): Line => cells.join(CSV_DELIMITER);

/**
 * The whole file as lines, so the sections are visible in one place and the
 * offline check can read them back without a parser of its own.
 */
export function csvSections(data: PeriodExport, t: Translate): Line[] {
  const { period, summary } = data;
  const ref = distributionRefs(data);
  const yes = t('csvYes');
  const no = t('csvNo');
  const yesNo = (v: boolean) => (v ? yes : no);
  const lines: Line[] = [];

  /* ── 1 · the period, as label and value ─────────────────────────────── */
  lines.push(row([csvField(t('csvSummaryHead')), csvField('')]));
  const summaryValues: string[] = [
    [period.workplaceName, period.city].filter(Boolean).join(', '),
    `${period.periodStart} – ${period.periodEnd}`,
    period.close ? csvMoment(period.close.closedAt) : t('csvNotClosed'),
    period.close?.closedByName ?? '',
    String(summary.distributionsCurrent),
    csvMoney(summary.currentEntitlementCents),
    csvMoney(summary.effectiveSettledCents),
    csvMoney(summary.outstandingCents),
    String(summary.corrections),
    csvMoney(summary.replacedEntitlementCents),
    String(summary.recordsAfterClose),
  ];
  SUMMARY_ROWS.forEach((key, i) => {
    lines.push(row([csvField(t(key)), csvText(summaryValues[i])]));
  });

  /* ── 2 · the distributions ──────────────────────────────────────────── */
  lines.push('');
  lines.push(row([csvField(t('csvDistributionsHead'))]));
  lines.push(
    row(
      [
        'csvDate',
        'csvRef',
        'csvStatus',
        'csvCorrection',
        'csvReplaces',
        'csvMethod',
        'csvTotalTips',
        'csvSettlement',
      ].map((k) => csvField(t(k as StringKey))),
    ),
  );
  for (const d of data.distributions) {
    /* correction_reason is a database enum, but it reaches here as a plain
       string. An unknown value is possible only if the enum grows without this
       map, and then the honest thing is "Yes" and no invented reason. */
    const reasonKey =
      d.correctionReason && d.correctionReason in CORRECTION_REASON_LABEL
        ? CORRECTION_REASON_LABEL[d.correctionReason as CorrectionReason]
        : null;
    const correction = d.isCorrection ? (reasonKey ? `${yes} · ${t(reasonKey)}` : yes) : no;
    /* What the money did, from the events themselves. ExportSettlementEvent
       signs a reversal negative precisely so that a column of them sums to what
       still counts, so this is the signed sum of every event and not a filter
       on stillCounts: a payout fully taken back reads as reversed, not paid. */
    const settledCents = d.settlement.reduce((sum, e) => sum + e.amountCents, 0);
    const settlement =
      d.settlement.length === 0
        ? t('csvNoPayment')
        : `${csvMoney(settledCents)}${settledCents === 0 ? ` · ${t('csvReversedOut')}` : ''}`;
    lines.push(
      row([
        csvField(d.periodStart),
        csvField(ref.get(d.id) ?? ''),
        csvField(t(DISTRIBUTION_STATUS_LABEL[d.status as keyof typeof DISTRIBUTION_STATUS_LABEL])),
        csvText(correction),
        csvField(d.supersedesId ? (ref.get(d.supersedesId) ?? '') : ''),
        csvField(t(METHOD_LABEL[d.method as RuleMethod])),
        csvField(csvMoney(d.entitlementCents)),
        csvText(settlement),
      ]),
    );
  }

  /* ── 3 · what each person is owed ───────────────────────────────────── */
  lines.push('');
  lines.push(row([csvField(t('csvSharesHead'))]));
  lines.push(
    row(
      [
        'csvDate',
        'csvRef',
        'csvEmployee',
        'csvArea',
        'csvRole',
        'csvWorkedTime',
        'csvShare',
        'csvAcknowledgement',
      ].map((k) => csvField(t(k as StringKey))),
    ),
  );
  for (const d of data.distributions) {
    for (const m of d.members) {
      lines.push(
        row([
          csvField(d.periodStart),
          csvField(ref.get(d.id) ?? ''),
          csvText(m.memberName),
          csvText(m.areaName),
          csvText(m.roleName ?? ''),
          csvField(csvDuration(m.workedMinutes)),
          csvField(csvMoney(m.amountCents)),
          csvField(t(ACK_STATUS_LABEL[m.ackStatus as keyof typeof ACK_STATUS_LABEL])),
        ]),
      );
    }
  }

  /* ── 4 · money actually moving ──────────────────────────────────────── */
  /* A payout settles a DISTRIBUTION, not a person: there is no per-employee
     payment record anywhere in this product, and inventing a column for one
     would be the file asserting something the database never said. So these
     rows name the distribution and who recorded the event. */
  lines.push('');
  lines.push(row([csvField(t('csvEventsHead'))]));
  lines.push(
    row(
      [
        'csvDate',
        'csvRef',
        'csvEvent',
        'csvMethodOrReason',
        'csvAmount',
        'csvRecordedBy',
        'csvStillCounts',
        'csvAfterClose',
      ].map((k) => csvField(t(k as StringKey))),
    ),
  );
  for (const d of data.distributions) {
    for (const e of d.settlement) {
      const detail =
        e.kind === 'payout'
          ? e.method
            ? t(PAYOUT_METHOD_LABEL[e.method as PayoutMethod])
            : ''
          : e.reason
            ? t(REVERSAL_REASON_LABEL[e.reason as ReversalReason])
            : '';
      lines.push(
        row([
          csvField(csvMoment(e.eventAt)),
          csvField(ref.get(d.id) ?? ''),
          csvField(e.kind === 'payout' ? t('csvEventPayout') : t('csvEventReversal')),
          csvText(detail),
          csvField(csvMoney(e.amountCents)),
          csvText(e.actorName ?? ''),
          csvField(yesNo(e.stillCounts)),
          csvField(yesNo(e.afterClose)),
        ]),
      );
    }
  }

  return lines;
}

/** The finished file, ready to be handed to a download. */
export function buildCsv(data: PeriodExport, t: Translate): string {
  return CSV_BOM + csvSections(data, t).join(CSV_NEWLINE) + CSV_NEWLINE;
}

/** `tipcrew-2023-09-01-2023-09-07.csv` — sorts by period in a folder listing. */
export function csvFilename(data: PeriodExport): string {
  return `tipcrew-${data.period.periodStart}-${data.period.periodEnd}.csv`;
}

/**
 * The totals a reader can add up from the file itself.
 *
 * The point has not changed with the format: if the human file and the
 * structured export ever disagree, the file is lying about the database, and a
 * test should say so before an accountant does. It reads Section 1 back by its
 * own printed labels, so it is checking what a person would actually see —
 * including the translation — rather than a private column name.
 *
 * Money comes back as integer cents, parsed from the German decimal the file
 * prints, so a caller compares like with like against the export.
 */
export function csvTotals(csv: string, t: Translate): Record<string, number> {
  const out: Record<string, number> = {};
  const label = (key: StringKey) => t(key);
  const money = new Set<string>([
    label('csvCurrentEntitlement'),
    label('csvSettled'),
    label('csvOutstanding'),
    label('csvReplacedEntitlement'),
  ]);
  const counts = new Set<string>([
    label('csvCurrentDistributions'),
    label('csvCorrections'),
    label('csvRecordsAfterClose'),
  ]);

  for (const line of csv.replace(/^﻿/, '').split(CSV_NEWLINE)) {
    if (line === '') break; // Section 1 ends at the first blank line.
    const cells = line
      .split(CSV_DELIMITER)
      .map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const [name, value] = cells;
    if (value === undefined) continue;
    if (money.has(name)) {
      const negative = value.trim().startsWith('-');
      const digits = value.replace(/[^\d]/g, '');
      if (digits === '') continue;
      out[name] = (negative ? -1 : 1) * Number(digits);
    } else if (counts.has(name)) {
      const n = Number(value);
      if (Number.isFinite(n)) out[name] = n;
    }
  }
  return out;
}
