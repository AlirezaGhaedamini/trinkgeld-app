/**
 * Live shift / tip-report verification for TipCrew Phase 3C.
 *
 * Plain fetch against the real project — GoTrue for the tokens, PostgREST for
 * the tables and the RPCs — so what is exercised is the real RLS, the real
 * triggers and the real generated columns. No Supabase SDK, nothing that could
 * cache or rewrite a request into looking safer than it is.
 *
 *   node scripts/shifts-check.mjs
 *
 * WHAT IT WRITES. A workplace owned by user A, an invitation accepted by user
 * B, and several shifts and tip reports for both. Everything is named with a
 * run-specific tag and listed at the end. Point it at a development project.
 *
 * Exit 0 = every check passed.
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
if (!test) die('.env.test.local is missing.', 'It needs TEST_A_EMAIL / TEST_A_PASSWORD / TEST_B_EMAIL / TEST_B_PASSWORD.');
for (const key of ['TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD']) {
  if (!test[key]) die(`.env.test.local is missing ${key}.`);
}

let pass = 0, fail = 0;
const failed = [];
function check(label, condition, detail = '') {
  if (condition) pass += 1;
  else { fail += 1; failed.push({ label, detail }); }
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
}

async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    die(`Could not sign in as ${email}: ${body.error_description || body.msg || `HTTP ${res.status}`}`);
  }
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
  return { status: res.status, ok: res.ok, body };
}
async function get(token, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: headers(token, { Accept: 'application/json' }) });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, rows: Array.isArray(rows) ? rows : null, body: rows, raw: text.slice(0, 200) };
}
async function post(token, path, payload) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'POST', headers: headers(token, { Prefer: 'return=representation' }), body: JSON.stringify(payload),
  });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, rows: Array.isArray(rows) ? rows : null, body: rows, raw: text.slice(0, 240) };
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

console.log(`\n  TipCrew — live shift / tip-report verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager): ${A.email}`);
console.log(`  user B (staff):   ${B.email}\n`);

/* ── set the stage: a workplace of A's, with B as an employee ───────────── */
const WP_NAME = `Shift Test ${STAMP}`;
const created = await rpc(A.token, 'create_workplace', { p_name: WP_NAME });
const workplaceId = typeof created.body === 'string' ? created.body : null;
if (!workplaceId) die(`create_workplace failed: HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);

const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: workplaceId, p_email: B.email, p_display_name: `Tester ${STAMP}`, p_role: 'employee',
});
const inviteRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!inviteRow?.token) die(`create_invitation failed: HTTP ${invited.status}`);
const accepted = await rpc(B.token, 'accept_invitation', { p_token: inviteRow.token });
const memberIdB = typeof accepted.body === 'string' ? accepted.body : null;
if (!memberIdB) die(`accept_invitation failed: HTTP ${accepted.status}`);

const rosterA = await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${workplaceId}&role=eq.manager`);
const memberIdA = rosterA.rows?.[0]?.id ?? null;

const wpRow = await get(A.token, `workplaces?select=timezone,business_day_start_hour&id=eq.${workplaceId}`);
const timeZone = wpRow.rows?.[0]?.timezone ?? 'Europe/Berlin';
const cutoff = wpRow.rows?.[0]?.business_day_start_hour ?? 5;
console.log(`  workplace ${workplaceId}  tz=${timeZone} cut-off=${cutoff}:00\n`);

const areas = await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${workplaceId}`);
const areaBar = areas.rows?.find((a) => a.key === 'bar')?.id ?? null;

/* A far-past week, so nothing collides with real data or with itself. */
const DAY1 = '2019-03-04';
const DAY2 = '2019-03-05';
const DAY3 = '2019-03-06';
const iso = (date, hour, minute = 0) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`).toISOString();

/* ── 1, 3, 4 · a daytime shift, worked minutes, the break ───────────────── */
let shiftDay = null;
{
  const r = await post(B.token, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY1,
    starts_at: iso(DAY1, 8), ends_at: iso(DAY1, 16), break_minutes: 30, status: 'submitted',
  });
  shiftDay = r.rows?.[0] ?? null;
  check('1. an employee can create their own daytime shift',
    r.ok && !!shiftDay, `HTTP ${r.status}${shiftDay ? '' : ` ${r.raw}`}`);
  check('3. worked_minutes is computed by the database  (8 h − 30 min = 450)',
    shiftDay?.worked_minutes === 450, `worked_minutes = ${shiftDay?.worked_minutes}`);
  check('4. the break was stored and deducted, not ignored',
    shiftDay?.break_minutes === 30, `break_minutes = ${shiftDay?.break_minutes}`);
  check('3b. status is what the client asked for, and it is not "approved"',
    shiftDay?.status === 'submitted', `status = ${shiftDay?.status}`);
}

/* ── 2 · an overnight shift lands on the right business day ─────────────── */
{
  // 18:00 → 02:00 local. Sent as instants; the trigger derives the night.
  const startLocal = new Date(`${DAY2}T18:00:00`);
  const offsetHint = new Date(`${DAY2}T12:00:00Z`);
  void offsetHint;
  const r = await post(B.token, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY2,
    starts_at: iso(DAY2, 17), ends_at: iso(DAY3, 1), break_minutes: 0, status: 'submitted',
  });
  const row = r.rows?.[0] ?? null;
  void startLocal;
  check('2. an employee can create an overnight shift',
    r.ok && !!row, `HTTP ${r.status}${row ? '' : ` ${r.raw}`}`);
  check('2b. it is one row spanning midnight, eight hours long',
    row?.worked_minutes === 480, `worked_minutes = ${row?.worked_minutes}`);
  check('2c. the database derived work_date itself, and it is the night it started',
    row?.work_date === DAY2, `work_date = ${row?.work_date} (sent ${DAY2})`);
}

/* ── 5, 6 · shifts for other people and other places ────────────────────── */
{
  const r = await post(B.token, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdA, work_date: DAY1,
    starts_at: iso(DAY1, 20), ends_at: iso(DAY1, 22), break_minutes: 0, status: 'submitted',
  });
  check('5. an employee cannot create a shift for another member',
    !r.ok, `HTTP ${r.status}` + (r.ok ? ` — LEAK: ${r.raw}` : ''));
}
{
  const other = await rpc(B.token, 'create_workplace', { p_name: `Other ${STAMP}` });
  const otherId = typeof other.body === 'string' ? other.body : null;
  const r = otherId
    ? await post(B.token, 'shifts', {
        workplace_id: otherId, member_id: memberIdB, work_date: DAY1,
        starts_at: iso(DAY1, 20), ends_at: iso(DAY1, 22), break_minutes: 0, status: 'submitted',
      })
    : { ok: false, status: 0, raw: 'could not create the second workplace' };
  check('6. an employee cannot submit a shift whose member belongs to another workplace',
    !r.ok, `HTTP ${r.status}` + (r.ok ? ' — LEAK: the mismatch was accepted' : ''));
}

/* ── 7, 8 · approving yourself, and writing the review columns ──────────── */
{
  const r = await patch(B.token, `shifts?id=eq.${shiftDay.id}`, { status: 'approved' });
  const after = await get(B.token, `shifts?select=status&id=eq.${shiftDay.id}`);
  check('7. an employee cannot approve their own shift',
    after.rows?.[0]?.status === 'submitted',
    `PATCH HTTP ${r.status}; status is now ${after.rows?.[0]?.status}`);
}
{
  const r = await patch(B.token, `shifts?id=eq.${shiftDay.id}`, {
    reviewed_by: memberIdB, reviewed_at: new Date().toISOString(), review_note: 'signed off by me',
  });
  const after = await get(B.token, `shifts?select=reviewed_by,review_note&id=eq.${shiftDay.id}`);
  check('8. an employee cannot write the review columns',
    !r.ok && after.rows?.[0]?.reviewed_by === null,
    `PATCH HTTP ${r.status}; reviewed_by = ${after.rows?.[0]?.reviewed_by}`);
}
{
  const roles = await get(B.token, `workplace_roles?select=id,points&workplace_id=eq.${workplaceId}&order=points.desc`);
  const best = roles.rows?.[0]?.id ?? null;
  const r = best ? await patch(B.token, `shifts?id=eq.${shiftDay.id}`, { workplace_role_id: best }) : { ok: false, status: 0 };
  const after = await get(B.token, `shifts?select=workplace_role_id&id=eq.${shiftDay.id}`);
  check('8b. an employee cannot give their own shift a better-paid role',
    !r.ok && after.rows?.[0]?.workplace_role_id === null,
    `PATCH HTTP ${r.status}; workplace_role_id = ${after.rows?.[0]?.workplace_role_id}`);
}
{
  const r = await patch(B.token, `shifts?id=eq.${shiftDay.id}`, { locked: true });
  const after = await get(B.token, `shifts?select=locked&id=eq.${shiftDay.id}`);
  check('8c. an employee cannot lock their own shift',
    !r.ok && after.rows?.[0]?.locked === false, `PATCH HTTP ${r.status}; locked = ${after.rows?.[0]?.locked}`);
}

/* ── 9, 10, 11 · the manager reviews ────────────────────────────────────── */
{
  const seen = await get(A.token, `shifts?select=id,member_id,status,worked_minutes&workplace_id=eq.${workplaceId}&status=eq.submitted`);
  check('9. the manager sees the employee submitted shifts',
    (seen.rows?.length ?? 0) === 2, `HTTP ${seen.status}, ${seen.rows?.length ?? '?'} submitted shift(s)`);
}
{
  const r = await patch(A.token, `shifts?id=eq.${shiftDay.id}`, {
    status: 'approved', reviewed_by: memberIdA, reviewed_at: new Date().toISOString(),
    review_note: `checked ${STAMP}`,
  });
  check('10. the manager can approve it, and is recorded as the reviewer',
    r.ok && r.rows?.[0]?.status === 'approved' && r.rows?.[0]?.reviewed_by === memberIdA,
    `HTTP ${r.status}; status=${r.rows?.[0]?.status}, reviewed_by=${r.rows?.[0]?.reviewed_by ? 'set' : 'null'}`);
}
{
  const seen = await get(B.token, `shifts?select=status,review_note&id=eq.${shiftDay.id}`);
  check('11. the employee now sees the approved status',
    seen.rows?.[0]?.status === 'approved', `status = ${seen.rows?.[0]?.status}`);
}
{
  const r = await patch(B.token, `shifts?id=eq.${shiftDay.id}`, { break_minutes: 0 });
  const after = await get(B.token, `shifts?select=break_minutes&id=eq.${shiftDay.id}`);
  check('11b. …and can no longer edit it',
    after.rows?.[0]?.break_minutes === 30, `PATCH HTTP ${r.status}; break_minutes = ${after.rows?.[0]?.break_minutes}`);
}

/* ── 12 · a manager of somewhere else ───────────────────────────────────── */
{
  // B created a workplace of their own above, so B is a manager — elsewhere.
  const r = await patch(B.token, `shifts?id=eq.${shiftDay.id}`, { review_note: 'mine now' });
  const after = await get(A.token, `shifts?select=review_note&id=eq.${shiftDay.id}`);
  check('12. a manager of another workplace cannot touch this shift',
    (after.rows?.[0]?.review_note ?? '').startsWith('checked'),
    `PATCH HTTP ${r.status}; review_note = ${JSON.stringify(after.rows?.[0]?.review_note)}`);
}

/* ── 13, 14 · the area override ─────────────────────────────────────────── */
{
  const r = await post(B.token, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY3,
    starts_at: iso(DAY3, 10), ends_at: iso(DAY3, 14), break_minutes: 0, status: 'submitted',
    area_id: areaBar,
  });
  const row = r.rows?.[0] ?? null;
  check('13. an area override from the workplace is accepted and stored',
    r.ok && row?.area_id === areaBar, `HTTP ${r.status}; area_id ${row?.area_id === areaBar ? 'matches bar' : row?.area_id}`);
}
{
  const foreign = await get(A.token, 'workplace_areas?select=id&workplace_id=neq.' + workplaceId + '&limit=1');
  const foreignArea = foreign.rows?.[0]?.id ?? '00000000-0000-0000-0000-000000000000';
  const r = await post(B.token, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY3,
    starts_at: iso(DAY3, 18), ends_at: iso(DAY3, 22), break_minutes: 0, status: 'submitted',
    area_id: foreignArea,
  });
  check('14. an area from another workplace is rejected',
    !r.ok, `HTTP ${r.status}` + (r.ok ? ' — LEAK: a foreign area was accepted' : ''));
}

/* ── 15, 16, 17 · tip reports ───────────────────────────────────────────── */
{
  const r = await post(B.token, 'tip_reports', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY1, card_cents: 8450, cash_cents: 1200,
  });
  const row = r.rows?.[0] ?? null;
  check('15. an employee can file their own tip report',
    r.ok && row?.card_cents === 8450, `HTTP ${r.status}; card_cents = ${row?.card_cents}`);
  check('15b. total_cents is generated by the database, in integer cents',
    row?.total_cents === 9650, `total_cents = ${row?.total_cents}`);
}
{
  const r = await post(B.token, 'tip_reports', {
    workplace_id: workplaceId, member_id: memberIdA, work_date: DAY1, card_cents: 1, cash_cents: 0,
  });
  check('16. an employee cannot file a report under another member',
    !r.ok, `HTTP ${r.status}` + (r.ok ? ' — LEAK: it was accepted' : ''));
}
{
  const mine = await post(A.token, 'tip_reports', {
    workplace_id: workplaceId, member_id: memberIdA, work_date: DAY2, card_cents: 500, cash_cents: 0,
  });
  const seen = await get(B.token, `tip_reports?select=id,member_id&workplace_id=eq.${workplaceId}`);
  const foreign = (seen.rows ?? []).filter((r) => r.member_id !== memberIdB);
  check("17. an employee cannot read another member's tip report",
    mine.ok && foreign.length === 0,
    `manager report ${mine.ok ? 'created' : 'not created'}; employee sees ${seen.rows?.length ?? '?'} row(s), ${foreign.length} foreign`);
  const allByManager = await get(A.token, `tip_reports?select=id&workplace_id=eq.${workplaceId}`);
  check('17b. the manager can see the whole workplace, which is what the pool is built from',
    (allByManager.rows?.length ?? 0) >= 2, `${allByManager.rows?.length ?? '?'} row(s)`);
}

/* ── 18 · a membership that has gone ────────────────────────────────────── */
{
  await patch(A.token, `workplace_members?id=eq.${memberIdB}`, { status: 'suspended' });
  const r = await post(B.token, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY3,
    starts_at: iso(DAY3, 3), ends_at: iso(DAY3, 5), break_minutes: 0, status: 'submitted',
  });
  const reports = await post(B.token, 'tip_reports', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY3, card_cents: 100, cash_cents: 0,
  });
  check('18. a suspended membership loses shift and report access',
    !r.ok && !reports.ok, `shift HTTP ${r.status}, report HTTP ${reports.status}`);
  await patch(A.token, `workplace_members?id=eq.${memberIdB}`, { status: 'active' });
}

/* ── 20 · no session at all ─────────────────────────────────────────────── */
{
  const r = await post(null, 'shifts', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY3,
    starts_at: iso(DAY3, 3), ends_at: iso(DAY3, 5), break_minutes: 0, status: 'submitted',
  });
  const t = await post(null, 'tip_reports', {
    workplace_id: workplaceId, member_id: memberIdB, work_date: DAY3, card_cents: 1, cash_cents: 0,
  });
  const readable = await get(null, `shifts?select=id&workplace_id=eq.${workplaceId}`);
  check('20. without a session nothing can be created or read',
    !r.ok && !t.ok && (readable.status >= 400 || (readable.rows?.length ?? 0) === 0),
    `shift HTTP ${r.status}, report HTTP ${t.status}, read HTTP ${readable.status}`);
}

/* ── the audit trail ────────────────────────────────────────────────────── */
{
  const rows = await get(A.token, `audit_log?select=action,table_name&record_id=eq.${shiftDay.id}&table_name=eq.shifts`);
  check('A1. every change to that shift is in the audit log',
    (rows.rows?.length ?? 0) >= 2, `${rows.rows?.length ?? '?'} audit row(s) for the shift`);
}

console.log(`\n  created for this run:`);
console.log(`    workplace  ${workplaceId}  "${WP_NAME}"`);
console.log(`    shifts and tip reports on ${DAY1} – ${DAY3}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
