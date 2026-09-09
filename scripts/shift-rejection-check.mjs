/**
 * Live verification of the rejected-shift correction loop and the
 * shift_rejected notification (Phase 3R-D, migrations 34 and 35).
 *
 * The round trip the manual release test could not complete, end to end over
 * the real REST path with the anon key and two ordinary accounts:
 *
 *   manager rejects → employee is told → the notification names the exact
 *   shift → the employee loads exactly that shift, note included → edits it →
 *   resubmits → the manager sees it submitted again → approves → the employee
 *   sees it approved. Then the second rejection, the locks, the shape of the
 *   inbox row, and the arithmetic behind direct time entry as the database
 *   computes it.
 *
 *   node scripts/shift-rejection-check.mjs
 *
 * UNTIL MIGRATIONS 34 AND 35 ARE PUSHED, the notification checks cannot run:
 * the script probes for member_notifications.shift_id, runs everything that
 * does not need it, reports the notification checks as SKIPPED and exits 2.
 * It does not pretend they passed.
 *
 * WHAT IT WRITES. One workplace per run, tagged with the run's timestamp, and a
 * handful of shifts on far-past dates. Point it at a development project.
 *
 * Exit 0 = every check passed. Exit 1 = a check failed. Exit 2 = setup or
 * migrations missing.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');

function readEnvFile(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}
function die(message, hint) {
  console.error(`\n  ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(2);
}

const local = readEnvFile('.env.local');
if (!local) die('.env.local is missing.');
const URL_BASE = (local.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = local.VITE_SUPABASE_ANON_KEY || '';
if (!URL_BASE || !ANON) die('.env.local is missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
if (/service[_-]?role/i.test(ANON) || /^sb_secret_/.test(ANON)) {
  die('That looks like a service-role key.', 'This test must run with the anon key — the point is that RLS applies.');
}
const test = readEnvFile('.env.test.local');
if (!test) die('.env.test.local is missing.');
for (const key of ['TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD']) {
  if (!test[key]) die(`.env.test.local is missing ${key}.`);
}

let pass = 0, fail = 0, skipped = 0;
const failed = [];
function check(label, condition, detail = '') {
  if (condition) pass += 1;
  else { fail += 1; failed.push({ label, detail }); }
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
}
function skip(label) {
  skipped += 1;
  console.log(`  SKIP  ${label}`);
}

async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) die(`Could not sign in as ${email}: HTTP ${res.status}`);
  return { token: body.access_token, userId: body.user?.id, email };
}
const headers = (token, extra = {}) =>
  token
    ? { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }
    : { apikey: ANON, 'Content-Type': 'application/json', ...extra };

async function rpc(token, name, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body, raw: text.slice(0, 200) };
}
async function get(token, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: headers(token, { Accept: 'application/json' }) });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 240) };
}
async function post(token, path, payload) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'POST', headers: headers(token, { Prefer: 'return=representation' }), body: JSON.stringify(payload),
  });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 240) };
}
async function patch(token, path, payload) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'PATCH', headers: headers(token, { Prefer: 'return=representation' }), body: JSON.stringify(payload),
  });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 240) };
}
/** Refused means the server said no, or RLS filtered the row so nothing moved. */
const refused = (r) => !r.ok || (r.rows?.length ?? 0) === 0;
const iso = (d, h, m = 0) =>
  new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).toISOString();

console.log(`\n  TipCrew — live rejected-shift correction + notification verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Reject Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status} ${createdWp.raw}`);

const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const invRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!invRow?.token) die(`create_invitation failed: HTTP ${invited.status}`);
const accepted = await rpc(B.token, 'accept_invitation', { p_token: invRow.token });
const M_B = typeof accepted.body === 'string' ? accepted.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${accepted.status}`);

const roster = await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`);
const M_A = roster.rows?.find((m) => m.role === 'manager')?.id ?? null;
if (!M_A) die('could not resolve the manager membership');

/* Migrations 34/35 present? The column is the whole difference. */
const probe = await get(A.token, 'member_notifications?select=shift_id&limit=1');
const MIGRATED = probe.status === 200;
if (!MIGRATED) {
  console.log('  NOTE  member_notifications.shift_id is not on this project: migrations 34 and 35');
  console.log('        are not applied. Notification checks are SKIPPED below; exit code will be 2.\n');
}

const NOTIF_COLS = MIGRATED
  ? 'id,workplace_id,member_id,type,distribution_id,query_id,payout_id,reversal_id,shift_id,payload,created_at,read_at'
  : 'id,workplace_id,member_id,type,payload,created_at,read_at';
const inboxOf = (token) =>
  get(token, `member_notifications?select=${NOTIF_COLS}&workplace_id=eq.${WP}&order=created_at.desc`);
const rejectedRowsFor = async (token, shiftId) => {
  const inbox = await inboxOf(token);
  return (inbox.rows ?? []).filter((n) => n.type === 'shift_rejected' && n.shift_id === shiftId);
};

/* Far-past dates, so nothing collides with real data or with itself. */
const DAY1 = '2019-05-06';
const DAY2 = '2019-05-07';
const DAY3 = '2019-05-08';
const DAY4 = '2019-05-09';
const DAY5 = '2019-05-10';
const DAY6 = '2019-05-11';
const NOTE1 = `Finish time is wrong ${STAMP}`;
const NOTE2 = `Still not right ${STAMP}`;

/* The app's own reads and writes, spelled the way the screens spell them. */
const ownShift = (id) => get(B.token, `shifts?select=*&id=eq.${id}&workplace_id=eq.${WP}&member_id=eq.${M_B}`);
const review = (id, status, note) => patch(A.token, `shifts?id=eq.${id}&workplace_id=eq.${WP}`, {
  status, reviewed_by: M_A, reviewed_at: new Date().toISOString(), review_note: note ?? null,
});
const resubmit = (id, day, endHour, endMinute, breakMinutes) =>
  patch(B.token, `shifts?id=eq.${id}&member_id=eq.${M_B}`, {
    starts_at: iso(day, 18), ends_at: iso(day, endHour, endMinute), break_minutes: breakMinutes,
    status: 'submitted', submitted_at: new Date().toISOString(),
  });

/* ── 1 · the employee submits, the manager sends it back ─────────────────── */
console.log('  — the loop —');
let S1 = null;
{
  const r = await post(B.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: DAY1,
    starts_at: iso(DAY1, 18), ends_at: iso(DAY1, 23), break_minutes: 30, status: 'submitted',
    submitted_at: new Date().toISOString(),
  });
  S1 = r.rows?.[0]?.id ?? null;
  check('1. the employee submits a shift', r.ok && S1 !== null && r.rows[0].worked_minutes === 270,
    `HTTP ${r.status}, worked_minutes ${r.rows?.[0]?.worked_minutes}`);
}
{
  const r = await review(S1, 'rejected', NOTE1);
  check('2. the manager sends it back with a note', r.ok && r.rows?.[0]?.status === 'rejected',
    `HTTP ${r.status} ${r.ok ? '' : r.raw}`);
}

/* ── 2 · the employee is told, and only the employee ─────────────────────── */
if (MIGRATED) {
  const mine = await rejectedRowsFor(B.token, S1);
  check('3. the employee has exactly one shift_rejected notification for that shift',
    mine.length === 1, `${mine.length} row(s)`);
  check('4. …addressed to their own membership and unread',
    mine[0]?.member_id === M_B && mine[0]?.read_at === null,
    `member ${mine[0]?.member_id === M_B}, read_at ${mine[0]?.read_at}`);
  check('5. …carrying the business date and NOT the manager\'s note',
    mine[0]?.payload?.work_date === DAY1 && !('review_note' in (mine[0]?.payload ?? {}))
      && !JSON.stringify(mine[0]?.payload ?? {}).includes('wrong'),
    JSON.stringify(mine[0]?.payload));
  check('6. …and it names the exact shift, which is what #/hours?shift=<id> opens',
    mine[0]?.shift_id === S1, `shift_id ${mine[0]?.shift_id}`);
  const managers = await rejectedRowsFor(A.token, S1);
  check('7. the manager receives nothing about it', managers.length === 0, `${managers.length} row(s)`);
} else {
  for (const n of [3, 4, 5, 6, 7]) skip(`${n}. notification check (migrations 34/35 not applied)`);
}

/* ── 3 · the employee opens exactly that shift ───────────────────────────── */
{
  const r = await ownShift(S1);
  check('8. the employee loads the exact rejected shift under their own scope',
    r.ok && r.rows?.length === 1 && r.rows[0].status === 'rejected' && r.rows[0].locked === false,
    `HTTP ${r.status}, ${r.rows?.length ?? 0} row(s), status ${r.rows?.[0]?.status}`);
  check('9. …with the manager\'s note visible on it', r.rows?.[0]?.review_note === NOTE1,
    `review_note ${JSON.stringify(r.rows?.[0]?.review_note)}`);
}
{
  // A shift that is not theirs: the manager's own row in the same workplace.
  const other = await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_A, work_date: DAY1,
    starts_at: iso(DAY1, 10), ends_at: iso(DAY1, 15), break_minutes: 0, status: 'approved',
  });
  const SA = other.rows?.[0]?.id ?? null;
  const scoped = await ownShift(SA);
  const bare = await get(B.token, `shifts?select=id&id=eq.${SA}`);
  check('10. a foreign shift id comes back empty under the app\'s own scope — a safe not-found',
    SA !== null && scoped.ok && scoped.rows?.length === 0, `${scoped.rows?.length ?? '?'} row(s)`);
  check('11. …and the row policy alone already hides it, without the client\'s filters',
    bare.ok && bare.rows?.length === 0, `${bare.rows?.length ?? '?'} row(s)`);
}

/* ── 4 · edit, resubmit ──────────────────────────────────────────────────── */
{
  const r = await resubmit(S1, DAY1, 23, 30, 30);
  check('12. the employee corrects the times and resubmits with the existing update path',
    r.ok && r.rows?.length === 1 && r.rows[0].status === 'submitted' && r.rows[0].worked_minutes === 300,
    `HTTP ${r.status}, status ${r.rows?.[0]?.status}, worked_minutes ${r.rows?.[0]?.worked_minutes}`);
  check('13. …and the earlier review stays on the row as history, note included',
    r.rows?.[0]?.reviewed_at !== null && r.rows?.[0]?.review_note === NOTE1,
    `reviewed_at ${r.rows?.[0]?.reviewed_at}, note ${JSON.stringify(r.rows?.[0]?.review_note)}`);
}
if (MIGRATED) {
  const mine = await rejectedRowsFor(B.token, S1);
  check('14. resubmitting changes nothing in the inbox', mine.length === 1, `${mine.length} row(s)`);
  const marked = await rpc(B.token, 'mark_notification_read', { p_notification_id: mine[0]?.id });
  const after = await rejectedRowsFor(B.token, S1);
  check('15. the employee marks it read through the RPC', marked.ok && after[0]?.read_at !== null,
    `HTTP ${marked.status}, read_at ${after[0]?.read_at}`);
} else {
  for (const n of [14, 15]) skip(`${n}. notification check (migrations 34/35 not applied)`);
}

/* ── 5 · the manager sees it again, approves ─────────────────────────────── */
{
  const queue = await get(A.token, `shifts?select=id,status,reviewed_at,review_note&workplace_id=eq.${WP}&status=eq.submitted`);
  const row = (queue.rows ?? []).find((s) => s.id === S1);
  check('16. the manager\'s queue shows it submitted again', Boolean(row), `${queue.rows?.length ?? 0} submitted row(s)`);
  check('17. …recognisable as a resubmission: submitted, with a review still on it',
    row?.status === 'submitted' && row?.reviewed_at !== null, `reviewed_at ${row?.reviewed_at}`);
}
{
  const r = await review(S1, 'approved');
  check('18. the manager approves the corrected shift', r.ok && r.rows?.[0]?.status === 'approved', `HTTP ${r.status}`);
  check('19. …and the decision replaced the old note, so nothing stale remains', r.rows?.[0]?.review_note === null,
    `review_note ${JSON.stringify(r.rows?.[0]?.review_note)}`);
  const seen = await ownShift(S1);
  check('20. the employee sees it approved', seen.rows?.[0]?.status === 'approved', `status ${seen.rows?.[0]?.status}`);
}
if (MIGRATED) {
  const all = (await inboxOf(B.token)).rows ?? [];
  check('21. approving adds no notification of any type', all.length === 1, `${all.length} row(s) in the inbox`);
} else {
  skip('21. notification check (migrations 34/35 not applied)');
}

/* ── 6 · rejected again: one row, re-armed ───────────────────────────────── */
console.log('\n  — a second rejection —');
{
  const r = await review(S1, 'rejected', NOTE2);
  check('22. the manager can send the approved shift back again', r.ok && r.rows?.[0]?.status === 'rejected', `HTTP ${r.status}`);
}
if (MIGRATED) {
  const mine = await rejectedRowsFor(B.token, S1);
  check('23. the inbox still holds exactly one row for the shift — no duplicate', mine.length === 1, `${mine.length} row(s)`);
  check('24. …re-armed: unread again', mine[0]?.read_at === null, `read_at ${mine[0]?.read_at}`);
  check('25. …and its payload is still the date alone, without either note',
    mine[0]?.payload?.work_date === DAY1 && !JSON.stringify(mine[0]?.payload ?? {}).includes(STAMP),
    JSON.stringify(mine[0]?.payload));
} else {
  for (const n of [23, 24, 25]) skip(`${n}. notification check (migrations 34/35 not applied)`);
}

/* ── 7 · what the employee cannot do ─────────────────────────────────────── */
console.log('\n  — the locks —');
{
  await patch(A.token, `shifts?id=eq.${S1}&workplace_id=eq.${WP}`, { locked: true });
  const r = await resubmit(S1, DAY1, 23, 45, 30);
  check('26. a locked rejected shift cannot be resubmitted by the employee', refused(r),
    `HTTP ${r.status}, ${r.rows?.length ?? 0} row(s) changed`);
  await patch(A.token, `shifts?id=eq.${S1}&workplace_id=eq.${WP}`, { locked: false });
  const again = await resubmit(S1, DAY1, 23, 45, 30);
  check('27. …and can be once the manager unlocks it', again.ok && again.rows?.[0]?.status === 'submitted',
    `HTTP ${again.status}, status ${again.rows?.[0]?.status}`);
}
let S2 = null;
{
  const r = await post(B.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: DAY2,
    starts_at: iso(DAY2, 18), ends_at: iso(DAY2, 23), break_minutes: 0, status: 'submitted',
    submitted_at: new Date().toISOString(),
  });
  S2 = r.rows?.[0]?.id ?? null;
  await review(S2, 'approved');
  const edit = await resubmit(S2, DAY2, 23, 30, 0);
  check('28. an approved shift cannot be edited by the employee', S2 !== null && refused(edit),
    `HTTP ${edit.status}, ${edit.rows?.length ?? 0} row(s) changed`);
}
if (MIGRATED) {
  const forged = await post(B.token, 'member_notifications', {
    workplace_id: WP, member_id: M_B, type: 'shift_rejected', shift_id: S2, payload: { work_date: DAY2 },
  });
  check('29. the employee cannot write themselves a shift_rejected row', !forged.ok,
    `HTTP ${forged.status}`);
  const mine = await rejectedRowsFor(B.token, S1);
  const rearm = await patch(B.token, `member_notifications?id=eq.${mine[0]?.id}`, { read_at: null });
  check('30. …nor touch read_at directly', refused(rearm), `HTTP ${rearm.status}, ${rearm.rows?.length ?? 0} row(s)`);
} else {
  for (const n of [29, 30]) skip(`${n}. notification check (migrations 34/35 not applied)`);
}

/* ── 8 · direct time entry, as the database computes it ──────────────────── */
console.log('\n  — direct time entry —');
{
  const file = (day, startH, endDay, endH, brk) => post(B.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: day,
    starts_at: iso(day, startH), ends_at: iso(endDay, endH), break_minutes: brk, status: 'submitted',
    submitted_at: new Date().toISOString(),
  });
  const a = await file(DAY3, 18, DAY3, 23, 30);
  check('31. 18:00 → 23:00 with a 30-minute break is 4 h 30 min', a.rows?.[0]?.worked_minutes === 270,
    `worked_minutes ${a.rows?.[0]?.worked_minutes}`);
  const b = await file(DAY4, 18, DAY5, 2, 30);
  check('32. 18:00 → 02:00 with a 30-minute break is one overnight shift of 7 h 30 min',
    b.rows?.[0]?.worked_minutes === 450 && b.rows?.[0]?.work_date === DAY4,
    `worked_minutes ${b.rows?.[0]?.worked_minutes}, work_date ${b.rows?.[0]?.work_date}`);
  const c = await file(DAY6, 8, DAY6, 17, 60);
  check('33. 08:00 → 17:00 with a 60-minute break is 8 h', c.rows?.[0]?.worked_minutes === 480,
    `worked_minutes ${c.rows?.[0]?.worked_minutes}`);
  /* A break longer than the shift is refused by the FORM (validateDraft, proved
     offline by scripts/client-logic-check.mjs) before any round trip. The
     database does not refuse it: worked_minutes is generated as
     greatest(0, span − break), so what it stores for such a row is zero — no
     hours, never negative ones. Asserted as the truth it is. */
  const d = await post(B.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: DAY5,
    starts_at: iso(DAY5, 18), ends_at: iso(DAY5, 19), break_minutes: 90, status: 'submitted',
  });
  check('34. a break longer than the shift, if it ever reached the database, is worth zero minutes — not negative ones',
    d.ok && d.rows?.[0]?.worked_minutes === 0, `HTTP ${d.status}, worked_minutes ${d.rows?.[0]?.worked_minutes}`);
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    shift under test      ${S1}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
console.log(`  skipped: ${skipped === 0 ? 'none' : `${skipped} (migrations 34/35 not applied)`}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail > 0 ? 1 : MIGRATED ? 0 : 2);
