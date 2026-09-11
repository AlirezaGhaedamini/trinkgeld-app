/**
 * Static checks of the pure client decisions Phase 3R-B added.
 *
 * Two modules carry decisions that must hold without a browser and without a
 * network: which dataset a build boots with (src/state/dataMode.ts), and when
 * a refused retry may be treated as an operation that already succeeded
 * (src/distribution/recovery.ts). Both are pure — every input comes in as an
 * argument — so they are imported here directly and driven through their
 * decision tables.
 *
 *   node scripts/client-logic-check.mjs
 *
 * Runs on Node 22.6+ with its built-in type stripping; the script re-launches
 * itself with the flag when needed. No dependency, no build step, no network.
 *
 * Exit 0 = every check passed.
 */

import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(HERE), '..');

if (!process.execArgv.includes('--experimental-strip-types')) {
  const run = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', HERE, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(run.status ?? 1);
}

/* `@/` is Vite's alias for src/. Node knows nothing of it, so a resolve hook
   maps it for the modules imported below — src/shifts/types.ts reaches its
   sibling that way. Registered from a data: URL so it needs no file of its own. */
const SRC = pathToFileURL(resolve(ROOT, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
    const SRC = ${JSON.stringify(SRC)};
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith('@/')) {
        const target = new URL(specifier.slice(2), SRC).href;
        return next(target.endsWith('.ts') ? target : target + '.ts', context);
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const dataMode = await import(pathToFileURL(resolve(ROOT, 'src/state/dataMode.ts')).href);
const recovery = await import(pathToFileURL(resolve(ROOT, 'src/distribution/recovery.ts')).href);
const shiftTypes = await import(pathToFileURL(resolve(ROOT, 'src/shifts/types.ts')).href);
const notifications = await import(pathToFileURL(resolve(ROOT, 'src/notifications/types.ts')).href);
const ack = await import(pathToFileURL(resolve(ROOT, 'src/distribution/ack.ts')).href);
const strings = await import(pathToFileURL(resolve(ROOT, 'src/i18n/strings.ts')).href);
const tabs = await import(pathToFileURL(resolve(ROOT, 'src/components/layout/tabs.ts')).href);
const moneyLib = await import(pathToFileURL(resolve(ROOT, 'src/lib/money.ts')).href);
const csvLib = await import(pathToFileURL(resolve(ROOT, 'src/period/csv.ts')).href);

let pass = 0, fail = 0;
const failed = [];
function check(label, condition, detail = '') {
  if (condition) pass += 1;
  else { fail += 1; failed.push({ label, detail }); }
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n  TipCrew — client logic checks (offline)\n');

/* ── the demo gate ───────────────────────────────────────────────────────── */
const { resolveDataMode, demoAllowed } = dataMode;
const prod = { configured: true, dev: false, allowFlag: undefined };
const dev = { configured: true, dev: true, allowFlag: undefined };
const bare = { configured: false, dev: false, allowFlag: undefined };
const staging = { configured: true, dev: false, allowFlag: 'true' };

check('1. a configured production build does not allow demo', !demoAllowed(prod));
check('2. …a development build does', demoAllowed(dev));
check('3. …a build with no Supabase credentials does', demoAllowed(bare));
check('4. …and a build that says VITE_ALLOW_DEMO=true does', demoAllowed(staging));
check('5. …but only the exact string "true"',
  !demoAllowed({ ...prod, allowFlag: 'TRUE' }) && !demoAllowed({ ...prod, allowFlag: '1' }) &&
    !demoAllowed({ ...prod, allowFlag: 'yes' }));

check('6. production ignores ?demo=1 and boots real',
  same(resolveDataMode({ ...prod, urlParam: '1', stored: null }), { mode: 'empty', persist: null }));
check('7. production ignores a browser that remembered demo, and clears that memory',
  same(resolveDataMode({ ...prod, urlParam: null, stored: 'demo' }), { mode: 'empty', persist: 'empty' }));
check('8. production with ?demo=1 AND a stored demo still boots real and clears it',
  same(resolveDataMode({ ...prod, urlParam: '1', stored: 'demo' }), { mode: 'empty', persist: 'empty' }));
check('9. production leaves a stored "empty" alone',
  same(resolveDataMode({ ...prod, urlParam: null, stored: 'empty' }), { mode: 'empty', persist: null }));
check('10. a development build honours ?demo=1 and remembers it',
  same(resolveDataMode({ ...dev, urlParam: '1', stored: null }), { mode: 'demo', persist: 'demo' }));
check('11. …and ?demo=true, ?demo=0 and ?demo=false',
  resolveDataMode({ ...dev, urlParam: 'true', stored: null }).mode === 'demo' &&
    same(resolveDataMode({ ...dev, urlParam: '0', stored: 'demo' }), { mode: 'empty', persist: 'empty' }) &&
    same(resolveDataMode({ ...dev, urlParam: 'false', stored: 'demo' }), { mode: 'empty', persist: 'empty' }));
check('12. …and a remembered demo without a URL switch',
  same(resolveDataMode({ ...dev, urlParam: null, stored: 'demo' }), { mode: 'demo', persist: null }));
check('13. an unconfigured build honours ?demo=1',
  resolveDataMode({ ...bare, urlParam: '1', stored: null }).mode === 'demo');
check('14. a staging build with the explicit flag honours ?demo=1',
  resolveDataMode({ ...staging, urlParam: '1', stored: null }).mode === 'demo');
check('15. an invalid stored value falls back to real, wherever demo is allowed',
  same(resolveDataMode({ ...dev, urlParam: null, stored: 'garbage' }), { mode: 'empty', persist: null }) &&
    same(resolveDataMode({ ...dev, urlParam: 'maybe', stored: null }), { mode: 'empty', persist: null }));
check('16. nothing stored and nothing asked means real',
  same(resolveDataMode({ ...dev, urlParam: null, stored: null }), { mode: 'empty', persist: null }));

/* ── retry after a lost response ─────────────────────────────────────────── */
const {
  sendMayHaveSucceeded, sendRecovered, discardMayHaveSucceeded, discardRecovered,
  acceptMayHaveSucceeded, acceptRecovered,
} = recovery;

check('17. only "only a draft can be sent" opens a send recovery',
  sendMayHaveSucceeded('alreadySent') && !sendMayHaveSucceeded('stale') &&
    !sendMayHaveSucceeded('notManager') && !sendMayHaveSucceeded(undefined));
check('18. a reload proves a send only for sent or confirmed',
  sendRecovered('sent') && sendRecovered('confirmed'));
check('19. …never for a draft, a cancelled or replaced row, or no row at all',
  !sendRecovered('draft') && !sendRecovered('cancelled') && !sendRecovered(null) && !sendRecovered(undefined));
check('20. only a zero-row DELETE opens a discard recovery',
  discardMayHaveSucceeded('draftGone') && !discardMayHaveSucceeded('notManager') &&
    !discardMayHaveSucceeded(undefined));
check('21. a reload proves a discard only when the row is gone',
  discardRecovered(false) && !discardRecovered(true));
check('22. only "already used" opens an invitation recovery',
  acceptMayHaveSucceeded('inviteUsed') && !acceptMayHaveSucceeded('inviteExpired') &&
    !acceptMayHaveSucceeded('invalidInvite') && !acceptMayHaveSucceeded(undefined));
check('23. the invitation row proves an acceptance only when THIS account accepted it',
  acceptRecovered({ status: 'accepted', acceptedBy: 'user-1' }, 'user-1'));
check('24. …not when somebody else did, not when it was withdrawn, not without a row or a user',
  !acceptRecovered({ status: 'accepted', acceptedBy: 'user-2' }, 'user-1') &&
    !acceptRecovered({ status: 'revoked', acceptedBy: null }, 'user-1') &&
    !acceptRecovered({ status: 'expired', acceptedBy: null }, 'user-1') &&
    !acceptRecovered(null, 'user-1') &&
    !acceptRecovered({ status: 'accepted', acceptedBy: 'user-1' }, null));

/* ── direct time entry (src/shifts/types.ts) ─────────────────────────────── */
/* The hours form types wall-clock times; endMinutesFor() decides which side
   of midnight the end is on and validateDraft() makes the database's checks
   before the round trip. The same three cases the release test asked for. */
const { endMinutesFor, validateDraft } = shiftTypes;
const clock = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const entry = (start, end, breakMinutes) => {
  const startMinutes = clock(start);
  const endMinutes = endMinutesFor(startMinutes, clock(end));
  const v = validateDraft({ startMinutes, endMinutes, breakMinutes });
  return v.ok ? v.workedMinutes : `refused:${v.reason}`;
};

check('25. 18:00 → 23:00 with a 30-minute break is 4 h 30 min', entry('18:00', '23:00', 30) === 270);
check('26. 18:00 → 02:00 with a 30-minute break is one overnight shift of 7 h 30 min',
  entry('18:00', '02:00', 30) === 450 && endMinutesFor(clock('18:00'), clock('02:00')) === 1560);
check('27. 08:00 → 17:00 with a 60-minute break is 8 h', entry('08:00', '17:00', 60) === 480);
check('28. a break longer than the shift is refused, and so is one that swallows it exactly',
  entry('18:00', '19:00', 90) === 'refused:breakTooLong' && entry('18:00', '19:00', 60) === 'refused:breakTooLong');
check('29. an end typed at the start time is a 24-hour span, refused rather than read as zero',
  entry('18:00', '18:00', 0) === 'refused:tooLong');
check('30. an end typed before any start is kept as the wall clock until the start arrives',
  endMinutesFor(null, clock('02:00')) === 120 && endMinutesFor(clock('20:00'), 1560) === 1560);

/* ── notification deep links (src/notifications/types.ts) ────────────────── */
/* The inbox draws its chevron from notificationTarget() and navigates with it,
   so these drive the very function the screen uses — not a copy of its rules.
   The blank-screen bug of the release test lives here: an event this build
   cannot describe must produce a row, never `undefined` handed to t(). */
const {
  NOTIFICATION_TYPES, isNotificationType, notificationTarget,
  notificationTitleKey, notificationBodyKey, notificationIcon,
} = notifications;
const { lineageHeadId } = ack;
const { EN, DE } = strings;

const note = (over = {}) => ({
  id: 'n1', workplaceId: 'w1', memberId: 'm1', type: 'shift_rejected',
  distributionId: null, queryId: null, payoutId: null, reversalId: null,
  shiftId: 'a0000000-0000-4000-8000-000000000001',
  payload: {}, createdAt: '2026-09-07T09:00:00Z', readAt: null, ...over,
});
/* Two versions of one night: D1 was sent, then replaced by D2. */
const DISTS = [
  { id: 'd1', supersededBy: 'd2' },
  { id: 'd2', supersededBy: null },
];
const ctx = (role, distributions = DISTS) => ({ role, distributions, lineageHeadId });

check('31. a shift_rejected notification opens that exact shift on the hours screen',
  notificationTarget(note(), ctx('employee')) === '/hours?shift=a0000000-0000-4000-8000-000000000001');
check('32. …and leads nowhere when it carries no shift id',
  notificationTarget(note({ shiftId: null }), ctx('employee')) === null);
check('33. …by the same rule for a manager, since the shift is still their own row',
  notificationTarget(note(), ctx('manager')) === '/hours?shift=a0000000-0000-4000-8000-000000000001');
check('34. an event this build does not know leads nowhere instead of guessing a route',
  notificationTarget(note({ type: 'some_future_type', shiftId: 'x' }), ctx('employee')) === null);
check('35. …and is described by real copy rather than by undefined — the blank-screen bug',
  notificationTitleKey(note({ type: 'some_future_type' })) === 'nTitleUnknown' &&
    notificationBodyKey(note({ type: 'some_future_type' })) === 'nBodyUnknown');
check('36. EVERY key the inbox can ask for exists in BOTH dictionaries, so t() never returns undefined',
  [...NOTIFICATION_TYPES, 'some_future_type'].every((type) => {
    for (const outcome of [null, 'correction_required', 'no_correction']) {
      const n = note({ type, payload: { outcome } });
      for (const key of [notificationTitleKey(n), notificationBodyKey(n)]) {
        if (typeof key !== 'string' || !(key in EN) || !(key in DE)) return false;
        if (typeof EN[key] !== 'string' || typeof DE[key] !== 'string') return false;
      }
    }
    return true;
  }));
check('37. …and every one of them resolves to an icon name, unknown types included',
  [...NOTIFICATION_TYPES, 'some_future_type'].every(
    (type) => typeof notificationIcon(note({ type })) === 'string'));
check('38. isNotificationType accepts exactly the seven this build knows',
  NOTIFICATION_TYPES.length === 7 && NOTIFICATION_TYPES.every(isNotificationType) &&
    !isNotificationType('shift_approved') && !isNotificationType(''));
check('39. an employee is sent to the CURRENT version of a corrected night, not the retired one',
  notificationTarget(note({ type: 'distribution_sent', distributionId: 'd1', shiftId: null }),
    ctx('employee')) === '/payout/d2');
check('40. …a manager to the manager view of the version the event names',
  notificationTarget(note({ type: 'distribution_sent', distributionId: 'd1', shiftId: null }),
    ctx('manager')) === '/manager/distributions/d1');
check('41. a member dropped from a correction lands on the version they can still read',
  notificationTarget(note({ type: 'distribution_corrected', distributionId: 'd2', shiftId: null }),
    ctx('employee', [{ id: 'd1', supersededBy: 'd2' }])) === '/payout/d1');
check('42. …and on nothing at all when they can read neither version',
  notificationTarget(note({ type: 'distribution_corrected', distributionId: 'd2', shiftId: null }),
    ctx('employee', [])) === null);
check('43. a question raised goes to the manager view whoever is looking',
  notificationTarget(note({ type: 'query_raised', distributionId: 'd2', queryId: 'q1', shiftId: null }),
    ctx('employee')) === '/manager/distributions/d2');

/* ── which tab a nested route belongs to (src/components/layout/tabs.ts) ── */
/* The bar now stays under the manager's pushed screens, so "which section am I
   in" has to answer for paths several levels deep. This drives the same
   function BottomNav does. */
const { activeTabFor } = tabs
const mgr = (p) => activeTabFor(p, 'manager')
const emp = (p) => activeTabFor(p, 'employee')

check('44. the four manager roots light their own tab',
  mgr('/manager') === '/manager' &&
    mgr('/manager/distributions') === '/manager/distributions' &&
    mgr('/manager/team') === '/manager/team' &&
    mgr('/manager/rules') === '/manager/rules')
check('45. Overview does not swallow every path beneath it',
  mgr('/manager/team') !== '/manager' && mgr('/manager/rules/period') !== '/manager')
check('46. a distribution, however deep, reads as History',
  mgr('/manager/distributions/abc-123') === '/manager/distributions')
check('47. …and so does the sent confirmation, which shares no prefix with it',
  mgr('/manager/sent') === '/manager/distributions' &&
    mgr('/manager/sent/abc-123') === '/manager/distributions')
check('48. a team member reads as Team, and so does the invitation screen',
  mgr('/manager/team/abc-123') === '/manager/team' && mgr('/manager/invite') === '/manager/team')
check('49. every rules subpage reads as Rules, longest prefix winning over /manager',
  ['areas', 'roles', 'workplace', 'period'].every(
    (p) => mgr(`/manager/rules/${p}`) === '/manager/rules'))
check('50. the screens the dashboard launches read as Overview',
  mgr('/manager/hours') === '/manager' && mgr('/manager/reports') === '/manager' &&
    mgr('/manager/overlap') === '/manager')
check('51. the wizard claims no tab at all — it shows no bar, so nothing may light up',
  ['/manager/new', '/manager/new/pool', '/manager/new/areas', '/manager/new/hours',
    '/manager/new/result'].every((p) => mgr(p) === null))
check('52. a path that merely starts with a tab\'s letters is not that tab',
  mgr('/manager/teams') === null && mgr('/manager/rulesets') === null &&
    mgr('/managerial') === null)
check('53. a route outside the tabbed area answers null rather than guessing',
  mgr('/signin') === null && mgr('/') === null && mgr('/join') === null &&
    emp('/signin') === null && emp('/') === null && emp('/join') === null)
check('54. the employee roots light their own tab',
  emp('/home') === '/home' && emp('/hours') === '/hours' &&
    emp('/history') === '/history' && emp('/profile') === '/profile')
check('55. the rejected-shift deep link is still the hours screen',
  emp('/hours') === '/hours')
check('56. a share reads as History, however it was opened',
  emp('/payout/abc-123') === '/history')
check('57. reporting the night\'s tips reads as Home',
  emp('/report') === '/home')
check('58. the language screen stays under You',
  emp('/profile/language') === '/profile')
check('59. the shared inbox keeps each role in its own section',
  emp('/notifications') === '/home' && mgr('/notifications') === '/manager')
check('60. the account screen reads as Rules for a manager, who reaches it from there',
  mgr('/profile') === '/manager/rules' && mgr('/profile/language') === '/manager/rules')
check('61. the two roles never read each other\'s routes',
  emp('/manager/team') === null && emp('/manager') === null &&
    mgr('/home') === null && mgr('/history') === null)
check('62. every route the app can show a bar on resolves to a tab, for its own role',
  [['/home', 'employee'], ['/hours', 'employee'], ['/history', 'employee'],
    ['/profile', 'employee'], ['/profile/language', 'employee'], ['/payout/x', 'employee'],
    ['/report', 'employee'], ['/notifications', 'employee'],
    ['/manager', 'manager'], ['/manager/distributions', 'manager'], ['/manager/team', 'manager'],
    ['/manager/rules', 'manager'], ['/manager/sent/x', 'manager'],
    ['/manager/distributions/x', 'manager'], ['/manager/team/x', 'manager'],
    ['/manager/rules/period', 'manager'], ['/manager/hours', 'manager'],
    ['/manager/reports', 'manager'], ['/manager/overlap', 'manager'],
    ['/manager/invite', 'manager'], ['/manager/sent', 'manager'],
    ['/notifications', 'manager'], ['/profile', 'manager'],
  ].every(([p, r]) => activeTabFor(p, r) !== null))
check('63. …and the only screens with no section are the ones that show no bar',
  ['/manager/new', '/manager/new/pool', '/manager/new/areas', '/manager/new/hours',
    '/manager/new/result', '/signin', '/signup', '/join', '/workplaces'].every(
      (p) => mgr(p) === null && emp(p) === null))

/* ── the money keypad's arithmetic (src/lib/money.ts) ────────────────────── */
/* Integer cents only: the release test found a pool stuck at EUR 0.22 because
   the keypad was wired to the wrong store, so the arithmetic itself is worth
   pinning down. A till shifts digits in; backspace shifts them out. */
const { pushDigit, popDigit, centsToAmount } = moneyLib
const type = (start, digits) => [...String(digits)].reduce((c, d) => pushDigit(c, Number(d)), start)

check('64. typing 1234 into an empty field is EUR 12.34',
  type(0, '1234') === 1234 && centsToAmount(1234) === 12.34)
check('65. typing 500 is EUR 5.00, not EUR 500',
  type(0, '500') === 500 && centsToAmount(500) === 5)
check('66. backspace walks 12.34 down to zero one digit at a time',
  [popDigit(1234), popDigit(123), popDigit(12), popDigit(1)].join(',') === '123,12,1,0')
check('67. …and zero stays zero however often it is pressed',
  popDigit(0) === 0 && popDigit(popDigit(0)) === 0)
check('68. a new amount can be typed after reaching zero',
  type(popDigit(popDigit(22)), '1234') === 1234)
check('69. digits shift into an existing amount rather than replacing it — 0.22 then 1234 is 2212.34',
  type(22, '1234') === 221234)
check('70. every step is an integer, so no cent is lost to float arithmetic',
  [type(0, '1'), type(0, '19'), type(0, '199'), popDigit(199)].every(Number.isInteger))
check('71. the amount is bounded, so a stuck key cannot overflow the column',
  pushDigit(99_999_999, 9) === 99_999_999)

/* ── the financial export (src/period/csv.ts) ───────────────────────────── */
/* A release test found the old file unreadable in Excel: 34 technical columns,
   record types interleaved, raw engine enums. These pin the replacement — the
   shape a manager sees, and the promise that it still agrees with the
   authoritative dataset it was built from. */
const { buildCsv, csvTotals, csvDuration, csvMoney, csvText, CSV_BOM, CSV_NEWLINE } = csvLib
const en = (k) => EN[k]
const de = (k) => DE[k]

const exportFixture = ({ settlement = true, corrections = true, role = true, method = true } = {}) => ({
  period: {
    workplaceId: 'ignored', workplaceName: 'Harness Bar', city: 'Berlin', currency: 'EUR',
    timezone: 'Europe/Berlin', businessDayStartHour: 5,
    periodStart: '2026-09-01', periodEnd: '2026-09-07',
    generatedAt: '2026-09-08T09:00:00+00:00', basis: 'current',
    close: { id: 'c-uuid', closedAt: '2026-09-08T09:00:00+00:00', closedByName: 'Dana Boss', note: null },
  },
  summary: {
    distributionsCurrent: 2, distributionsReplaced: corrections ? 1 : 0, corrections: corrections ? 1 : 0,
    currentEntitlementCents: 100000, replacedEntitlementCents: corrections ? 90000 : 0,
    payoutEvents: settlement ? 2 : 0, payoutTotalCents: settlement ? 100000 : 0,
    reversalEvents: settlement ? 1 : 0, reversalTotalCents: settlement ? 50000 : 0,
    effectiveSettledCents: settlement ? 50000 : 0, outstandingCents: settlement ? 50000 : 100000,
    unresolvedQuestions: 0, unacknowledgedShares: 0, recordsAfterClose: 0,
  },
  distributions: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      periodStart: '2026-09-05', periodEnd: '2026-09-05', status: 'cancelled',
      isCurrent: false, isCorrection: false, supersedesId: null,
      correctionSource: null, correctionReason: null, correctionNote: null, triggerQueryNote: null,
      ruleVersion: 1, method: 'hours_points', overlapBasis: 'longest_shift', minOverlapMinutes: 15,
      peopleCount: 1, poolCents: 90000, entitlementCents: 90000,
      createdAt: '2026-09-05T22:00:00+00:00', sentAt: '2026-09-05T23:00:00+00:00', afterClose: false,
      members: [
        { memberName: 'Lena Mertens', areaName: 'Service', roleName: role ? 'Server' : null,
          workedMinutes: 270, overlapMinutes: 270, points: 1, multiplier: 1, units: 4.5,
          amountCents: 90000, roundingAdjustmentCents: 0, ackStatus: 'acknowledged',
          acknowledgedAt: '2026-09-06T08:00:00+00:00' },
      ],
      settlement: [],
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      periodStart: '2026-09-05', periodEnd: '2026-09-05', status: 'sent',
      isCurrent: true, isCorrection: corrections,
      supersedesId: corrections ? '11111111-1111-4111-8111-111111111111' : null,
      correctionSource: corrections ? 'manager' : null,
      correctionReason: corrections ? 'hours' : null,
      correctionNote: corrections ? 'Lena finished at 23:30' : null, triggerQueryNote: null,
      ruleVersion: 1, method: 'equal', overlapBasis: 'pairwise', minOverlapMinutes: 15,
      peopleCount: 2, poolCents: 100000, entitlementCents: 100000,
      createdAt: '2026-09-06T09:00:00+00:00', sentAt: '2026-09-06T10:00:00+00:00', afterClose: false,
      members: [
        { memberName: '=cmd|calc', areaName: 'Service', roleName: role ? 'Server' : null,
          workedMinutes: 450, overlapMinutes: 450, points: 1, multiplier: 1, units: 7.5,
          amountCents: 50000, roundingAdjustmentCents: 0, ackStatus: 'pending', acknowledgedAt: null },
        { memberName: 'Bo Bar', areaName: 'Bär', roleName: role ? 'Bartender' : null,
          workedMinutes: 480, overlapMinutes: 480, points: 1, multiplier: 1, units: 8,
          amountCents: 50000, roundingAdjustmentCents: 0, ackStatus: 'queried', acknowledgedAt: null },
      ],
      settlement: settlement
        ? [
            { kind: 'payout', payoutId: 'p-uuid', reversalId: null, eventAt: '2026-09-07T12:00:00+00:00',
              amountCents: 100000, method: method ? 'bank_transfer' : null, reason: null, note: null,
              actorName: 'Dana Boss', stillCounts: false, afterClose: false },
            { kind: 'reversal', payoutId: 'p-uuid', reversalId: 'r-uuid', eventAt: '2026-09-07T13:00:00+00:00',
              amountCents: -50000, method: null, reason: 'wrong_method', note: null,
              actorName: 'Dana Boss', stillCounts: true, afterClose: true },
          ]
        : [],
    },
  ],
})

const file = buildCsv(exportFixture(), en)
const body = file.replace(CSV_BOM, '')
const lines = body.split(CSV_NEWLINE)
const blocks = body.split(CSV_NEWLINE + CSV_NEWLINE)

check('72. the file still opens in German Excel: BOM, semicolons, CRLF',
  file.startsWith(CSV_BOM) && file.includes(';') && file.includes('\r\n') && !/[^\r]\n/.test(file))
check('73. every field is quoted, so a stray semicolon cannot break a row',
  lines.filter(Boolean).every((l) => l.split(';').every((c) => c.startsWith('"') && c.endsWith('"'))))
check('74. four sections, separated by blank lines', blocks.length === 4)
check('75. each section carries its own heading and its own narrow header row',
  blocks[1].includes(EN.csvDistributionsHead) && blocks[2].includes(EN.csvSharesHead) &&
    blocks[3].includes(EN.csvEventsHead) && blocks[0].includes(EN.csvSummaryHead))
check('76. no section is more than eight columns wide — the old file was 34',
  Math.max(...lines.filter(Boolean).map((l) => l.split(';').length)) <= 8)
check('77. not one uuid reaches the file',
  !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(file))
check('78. no raw engine enum reaches the file either',
  !['hours_points', 'longest_shift', 'pairwise', 'bank_transfer', 'wrong_method',
    'acknowledged', 'record_type', 'amount_cents', 'entry_ack_status'].some((e) => file.includes(e)))
check('79. distributions are numbered, and a correction names the row it replaces',
  file.includes('"D001"') && file.includes('"D002"') &&
    lines.some((l) => l.includes('"D002"') && l.includes('"D001"')))
check('80. worked time reads as a shift, not as a minute count',
  csvDuration(270) === '4:30' && csvDuration(450) === '7:30' && csvDuration(480) === '8:00' &&
    file.includes('"7:30"') && file.includes('"8:00"'))
check('81. money is one German-decimal column, and a reversal keeps its sign',
  csvMoney(100000) === '1000,00' && csvMoney(-50000) === '-500,00' && file.includes('"-500,00"'))
check('82. a member name that looks like a formula is defused, not executed',
  csvText('=cmd|calc') === `"'=cmd|calc"` && csvText('+1') === `"'+1"` && csvText('@x') === `"'@x"` &&
    file.includes(`"'=cmd|calc"`))
check('83. …while a real negative number is left alone',
  csvText('-500,00') === '"-500,00"' && csvMoney(-1) === '-0,01')

/* csvTotals is the invariant that survived the rewrite: the human file must
   still agree with the authoritative dataset it was built from. */
const data = exportFixture()
const totals = csvTotals(file, en)
check('84. the file still reports the six authoritative totals back',
  totals[EN.csvCurrentEntitlement] === data.summary.currentEntitlementCents &&
  totals[EN.csvSettled] === data.summary.effectiveSettledCents &&
  totals[EN.csvOutstanding] === data.summary.outstandingCents &&
  totals[EN.csvReplacedEntitlement] === data.summary.replacedEntitlementCents &&
  totals[EN.csvCorrections] === data.summary.corrections &&
  totals[EN.csvRecordsAfterClose] === data.summary.recordsAfterClose,
  JSON.stringify(totals))
check('85. …and it reads them from Section 1 only, so a share row cannot be mistaken for a total',
  csvTotals(blocks[0] + CSV_NEWLINE, en)[EN.csvSettled] === data.summary.effectiveSettledCents)

/* The decision recorded in csv.ts: no `sep=` line, because Excel stops
   honouring the UTF-8 BOM once one is present and the names arrive as
   mojibake. Integrity of a person's name beats delimiter auto-detection. */
check('93. the file starts with the UTF-8 BOM and nothing else',
  file.startsWith(CSV_BOM) && file.charCodeAt(0) === 0xfeff &&
    body.startsWith('"' + EN.csvSummaryHead + '"'))
check('94. …no sep= declaration anywhere, so the BOM keeps its meaning',
  !file.includes('sep=') && !/^sep=/m.test(body))

/* German. */
const german = buildCsv(exportFixture(), de)
check('86. the export follows the app language, headers and enum labels alike',
  german.includes(DE.csvSharesHead) && german.includes(DE.csvEmployee) &&
    german.includes(DE.csvEventReversal) && !german.includes(EN.csvSharesHead))
check('87. umlauts survive, and the German totals parse back the same',
  german.includes('Bär') && csvTotals(german, de)[DE.csvOutstanding] === data.summary.outstandingCents)

/* Empty and partial states. */
const bareFile = buildCsv(exportFixture({ settlement: false, corrections: false, role: false, method: false }), en)
const bareBlocks = bareFile.replace(CSV_BOM, '').trimEnd().split(CSV_NEWLINE + CSV_NEWLINE)
check('88. with no payments, no corrections and no roles the file is still four valid sections',
  bareBlocks.length === 4 && bareBlocks[3].split(CSV_NEWLINE).length === 2,
  `${bareBlocks.length} block(s), last has ${bareBlocks[3]?.split(CSV_NEWLINE).length} line(s)`)
check('89. …a distribution with no payment says so rather than showing an empty cell',
  bareFile.includes(EN.csvNoPayment))
check('90. …and a missing role or method is an empty cell, never the word null or undefined',
  !/"(null|undefined)"/.test(bareFile))
const reversedOut = exportFixture()
reversedOut.distributions[1].settlement[1].amountCents = -100000
check('91. a payout taken back in full reads as reversed, not as paid',
  buildCsv(reversedOut, en).includes(EN.csvReversedOut) && !file.includes(EN.csvReversedOut))
check('92. …and a partial reversal shows what is left, signed correctly',
  file.includes('"500,00"'))

/* ── section 3 lists CURRENT shares only (phase 3S-B) ───────────────────── */
/* The 3S-A audit found a corrected night putting the same person on two rows —
   the replaced version and the one that replaced it — under a heading that says
   "what each person is owed", with nothing in the row to tell them apart. Adding
   that column up by hand paid the night twice, which is the one arithmetic the
   whole export exists to prevent. The replaced versions are still in section 2,
   with their status and the ref of what replaced them. */
const shareBlock = blocks[2].split(CSV_NEWLINE).filter(Boolean)
const shareRows = shareBlock.slice(2) // the section heading, then the column header
const cellsOf = (line) => line.split(';').map((c) => c.replace(/^"|"$/g, ''))
const sharePeople = shareRows.map((l) => cellsOf(l)[2])
const shareSum = shareRows.reduce(
  (total, l) => total + Math.round(parseFloat(cellsOf(l)[6].replace(/\./g, '').replace(',', '.')) * 100),
  0,
)

check('95. a corrected night lists each person once, not once per version',
  sharePeople.length === new Set(sharePeople).size, sharePeople.join(' | '))
check('96. …and the shares add up to exactly what the period says is owed',
  shareSum === data.summary.currentEntitlementCents,
  `${shareSum} vs ${data.summary.currentEntitlementCents}`)
check('97. …while the replaced version is still on the record, in the distributions section',
  blocks[1].includes('"D001"') && blocks[1].includes('"D002"'))
check('98. …and section 3 no longer carries the replaced version at all',
  !shareRows.some((l) => cellsOf(l)[1] === 'D001'), shareRows.map((l) => cellsOf(l)[1]).join(','))

/* ── the password-recovery callback URL (phase 3S-C) ─────────────────────── */
/* The 3S-C human smoke found password reset landing on "this link is no longer
   valid". The link was fine; the redirect was not. TipCrew routes on the
   fragment, the redirect named a hash route, and GoTrue appends the PKCE code
   to whatever it is given — so the code arrived INSIDE the fragment, where
   supabase-js parses `url.hash.substring(1)` as a query string and finds a key
   called "/reset/new?code" instead of "code".

   These drive the REAL parser out of the installed @supabase/auth-js, so the
   check fails if that behaviour ever changes, and pin the redirect shape that
   works. */
const { parseParametersFromURL } = await import(
  pathToFileURL(resolve(ROOT, 'node_modules/@supabase/auth-js/dist/main/lib/helpers.js')).href
).then((m) => m.default ?? m)

/* recovery.ts reads the address bar at module scope, so the stub goes up first. */
globalThis.window = { location: { origin: 'https://tipcrew.de', pathname: '/', search: '?tc=recovery' } }
const authRecovery = await import(pathToFileURL(resolve(ROOT, 'src/auth/recovery.ts')).href)

const codeIn = (url) => parseParametersFromURL(url).code

check('99. the shape that broke it: a code after a fragment is invisible to supabase-js',
  codeIn('https://tipcrew.de/#/reset/new?code=abc123') === undefined &&
    Object.keys(parseParametersFromURL('https://tipcrew.de/#/reset/new?code=abc123'))[0] === '/reset/new?code')
check('100. …while the same code in the query string is found, which is why signup always worked',
  codeIn('https://tipcrew.de/?code=abc123') === 'abc123')

const redirect = authRecovery.recoveryRedirectUrl({ origin: 'https://tipcrew.de', pathname: '/' })
check('101. the recovery redirect carries NO fragment, so nothing can swallow the code',
  !redirect.includes('#') && redirect === 'https://tipcrew.de/?tc=recovery', redirect)
check('102. …and a code appended to it is still found by the real parser',
  codeIn(`${redirect}&code=abc123`) === 'abc123')
check('103. …with the marker surviving beside it, so the app knows which screen to open',
  parseParametersFromURL(`${redirect}&code=abc123`).tc === 'recovery')
check('104. a recovery landing is recognised from the address bar, before any async work',
  authRecovery.isRecoveryCallback() === true)
check('105. …and stops being recognised once the new password is saved',
  (authRecovery.clearRecoveryCallback(), authRecovery.isRecoveryCallback() === false))
check('106. …the PASSWORD_RECOVERY event is a second, independent way in',
  (authRecovery.markRecoveryCallback(), authRecovery.isRecoveryCallback() === true))
check('107. an ordinary load is not mistaken for a recovery',
  (globalThis.window.location.search = '?code=abc123',
   authRecovery.refreshRecoveryCallback(),
   authRecovery.isRecoveryCallback() === false))

/* ── summary ─────────────────────────────────────────────────────────────── */
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\n  Failed:');
  for (const f of failed) console.log(`   - ${f.label}${f.detail ? `  (${f.detail})` : ''}`);
  console.log('');
  process.exit(1);
}
console.log('');
