/**
 * Live member and team verification for TipCrew Phase 3G.
 *
 * The roster: who may change somebody's area, role, weighting, standing and
 * membership, who may not, and what a change is allowed to do to money that has
 * already been paid. Run against the real project over plain fetch, with the
 * two test users and fresh workplaces per run.
 *
 *   node scripts/members-check.mjs
 *
 * WHAT IT WRITES. Four workplaces per run, each tagged with the run's
 * timestamp: the one under test, a rival one the other test user manages (so
 * cross-tenant refusals come from a real manager, not from nobody), one for the
 * join-request flow and one for the invitation flow. It also calculates and
 * sends one distribution, because the thing this phase must never disturb is a
 * payment already made. Point it at a development project.
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
if (!test) die('.env.test.local is missing.');
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
  return { status: res.status, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 200) };
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
async function del(token, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'DELETE', headers: headers(token, { Prefer: 'return=representation' }),
  });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 240) };
}

/**
 * A write is refused if the server rejected it, or if RLS silently filtered the
 * row so that nothing was touched. Both are the same answer to the caller: you
 * did not change that. Never infer either one from a table-wide count.
 */
const refused = (r) => !r.ok || (r.rows?.length ?? 0) === 0;

async function memberRow(token, id, columns = 'id,role,status,area_id,workplace_role_id,multiplier,user_id,display_name') {
  const r = await get(token, `workplace_members?select=${columns}&id=eq.${id}`);
  return r.rows?.[0] ?? null;
}

console.log(`\n  TipCrew — live member and team verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Team Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Team Rival ${STAMP}` });
const WP_OTHER = typeof rival.body === 'string' ? rival.body : null;

const joinWp = await rpc(A.token, 'create_workplace', { p_name: `Team Join ${STAMP}` });
const WP_JOIN = typeof joinWp.body === 'string' ? joinWp.body : null;

const inviteWp = await rpc(A.token, 'create_workplace', { p_name: `Team Invite ${STAMP}` });
const WP_INVITE = typeof inviteWp.body === 'string' ? inviteWp.body : null;

const firstInvite = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const firstRow = Array.isArray(firstInvite.body) ? firstInvite.body[0] : firstInvite.body;
if (!firstRow?.token) die(`create_invitation failed: HTTP ${firstInvite.status}`);
const acceptedFirst = await rpc(B.token, 'accept_invitation', { p_token: firstRow.token });
const M_B = typeof acceptedFirst.body === 'string' ? acceptedFirst.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${acceptedFirst.status}`);

const roster0 = await get(A.token, `workplace_members?select=id,role,user_id&workplace_id=eq.${WP}`);
const M_A = roster0.rows?.find((m) => m.role === 'manager')?.id ?? null;
if (!M_A) die('could not find the manager membership just created');

const areas0 = await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP}`);
const areaBy = (key) => areas0.rows?.find((a) => a.key === key)?.id ?? null;
const A_SERVICE = areaBy('service'), A_BAR = areaBy('bar'), A_RUNNER = areaBy('runner');

const roles0 = await get(A.token, `workplace_roles?select=id,key,area_id&workplace_id=eq.${WP}`);
const roleBy = (key) => roles0.rows?.find((r) => r.key === key)?.id ?? null;
const R_SERVER = roleBy('server'), R_SENIOR = roleBy('senior_server');
const R_BARTENDER = roleBy('bartender'), R_RUNNER = roleBy('runner');

const xAreas = WP_OTHER
  ? await get(B.token, `workplace_areas?select=id,key&workplace_id=eq.${WP_OTHER}`) : { rows: [] };
const X_SERVICE = xAreas.rows?.find((a) => a.key === 'service')?.id ?? null;
const xRoles = WP_OTHER
  ? await get(B.token, `workplace_roles?select=id,key&workplace_id=eq.${WP_OTHER}`) : { rows: [] };
const X_SERVER = xRoles.rows?.find((r) => r.key === 'server')?.id ?? null;
const xRoster = WP_OTHER
  ? await get(B.token, `workplace_members?select=id,role&workplace_id=eq.${WP_OTHER}`) : { rows: [] };
const M_B_OTHER = xRoster.rows?.find((m) => m.role === 'manager')?.id ?? null;

await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });

const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

/* ── history is made first, so every later edit has something to disturb ─── */

const DAY = '2019-11-14';
let SENT = null;
let ENTRIES_BEFORE = '';
{
  const draftId = (await get(A.token,
    `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows?.[0]?.id;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${draftId}`, { method: 'points', min_overlap_minutes: 15 });
  await rpc(A.token, 'activate_rule', { p_rule_id: draftId });

  for (const member of [M_A, M_B]) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY,
      starts_at: iso(DAY, 17), ends_at: iso(DAY, 23), break_minutes: 0, status: 'approved',
    });
  }
  const pool = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY, period_end: DAY,
    label: `team ${STAMP}`, cash_cents: 12000, source: 'manual', status: 'open', created_by: M_A,
  });
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: pool.rows?.[0]?.id });
  SENT = typeof calc.body === 'string' ? calc.body : null;
  if (SENT) await rpc(A.token, 'send_distribution', { p_distribution_id: SENT });
  const entries = await get(A.token,
    `tip_distribution_entries?select=member_id,member_name,area_name,role_name,points,multiplier,amount_cents` +
    `&distribution_id=eq.${SENT}&order=member_id`);
  ENTRIES_BEFORE = JSON.stringify(entries.rows ?? []);
  check('0. a distribution can be paid before any of this, so there is history to protect',
    calc.ok && !!SENT && (entries.rows?.length ?? 0) === 2,
    `HTTP ${calc.status}, ${entries.rows?.length ?? '?'} entries, distribution ${SENT}`);
}

/* ── 1 · the manager reads their own roster, and only their own ──────────── */
{
  const rows = await get(A.token,
    `workplace_members?select=id,display_name,role,status,area_id,workplace_role_id,multiplier,joined_at` +
    `&workplace_id=eq.${WP}`);
  const ids = (rows.rows ?? []).map((m) => m.id);
  check('1. the manager can list their team',
    rows.status === 200 && ids.includes(M_A) && ids.includes(M_B) && ids.length === 2,
    `${ids.length} member(s): manager ${ids.includes(M_A)}, employee ${ids.includes(M_B)}`);

  const foreign = await get(A.token, `workplace_members?select=id&workplace_id=eq.${WP_OTHER}`);
  check('1b. …and sees nothing of a workplace they do not belong to',
    (foreign.rows ?? []).length === 0, `${(foreign.rows ?? []).length} row(s) from the rival workplace`);

  const asStaff = await get(B.token, `workplace_members?select=id,multiplier&workplace_id=eq.${WP}`);
  check('1c. an employee sees the roster they work in — names and weightings, nothing to change them with',
    (asStaff.rows ?? []).length === 2, `${(asStaff.rows ?? []).length} row(s) visible to staff`);
}

/* ── 2 · an employee cannot reach a manager's write paths ────────────────── */
{
  const editOther = await patch(B.token, `workplace_members?id=eq.${M_A}`, { multiplier: 9 });
  const promoteOther = await patch(B.token, `workplace_members?id=eq.${M_A}`, { role: 'employee' });
  const requests = await rpc(B.token, 'pending_join_requests', { p_workplace_id: WP });
  const invite = await rpc(B.token, 'create_invitation', {
    p_workplace_id: WP, p_email: 'ghost@example.invalid', p_display_name: 'Ghost', p_role: 'manager',
  });
  const after = await memberRow(A.token, M_A);
  check('2. an employee cannot edit another member, read the join queue, or invite anyone',
    refused(editOther) && refused(promoteOther) && !requests.ok && !invite.ok &&
      Number(after.multiplier) === 1 && after.role === 'manager',
    `edit ${editOther.status} (${editOther.rows?.length ?? 0} rows), promote ${promoteOther.status}, ` +
      `queue ${requests.status}, invite ${invite.status}`);
}

/* ── 19 (email) · what a manager may learn about a person ────────────────── */
{
  const profile = await get(A.token, `profiles?select=id,email,full_name&id=eq.${B.userId}`);
  const own = await get(A.token, `profiles?select=id&id=eq.${A.userId}`);
  check('2b. the manager cannot read a colleague\'s profile row, so the roster shows the name it stores',
    (profile.rows ?? []).length === 0 && (own.rows ?? []).length === 1,
    `colleague ${(profile.rows ?? []).length} row(s), own ${(own.rows ?? []).length} row(s)`);

  const name = await patch(B.token, `workplace_members?id=eq.${M_B}`, { display_name: `Staff ${STAMP} B` });
  check('2c. …and the one thing a person may change about their own membership is that name',
    name.ok && (name.rows?.length ?? 0) === 1, `HTTP ${name.status}`);
}

/* ── 3, 4 · default area ─────────────────────────────────────────────────── */
{
  const moved = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_BAR, workplace_role_id: R_BARTENDER });
  const row = await memberRow(A.token, M_B);
  check('3. the manager can move an employee to another area, with a role from it',
    moved.ok && row.area_id === A_BAR && row.workplace_role_id === R_BARTENDER,
    `HTTP ${moved.status}, area ${row.area_id === A_BAR}, role ${row.workplace_role_id === R_BARTENDER}`);

  const back = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_SERVICE, workplace_role_id: R_SERVER });
  check('3b. …and back again', back.ok, `HTTP ${back.status}`);
}
{
  const own = await patch(B.token, `workplace_members?id=eq.${M_B}`, { area_id: A_BAR });
  const row = await memberRow(A.token, M_B);
  check('4. an employee cannot move themselves to another area',
    refused(own) && row.area_id === A_SERVICE,
    `HTTP ${own.status} (${own.rows?.length ?? 0} rows), still in Service: ${row.area_id === A_SERVICE}`);
}

/* ── 5, 6 · default role, and the membership role ────────────────────────── */
{
  const r = await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_SENIOR });
  const row = await memberRow(A.token, M_B);
  check('5. the manager can change an employee\'s default role within their area',
    r.ok && row.workplace_role_id === R_SENIOR, `HTTP ${r.status}`);
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_SERVER });
}
{
  const own = await patch(B.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_SENIOR });
  const promote = await patch(B.token, `workplace_members?id=eq.${M_B}`, { role: 'manager' });
  const row = await memberRow(A.token, M_B);
  check('6. an employee can change neither their default role nor their standing in the workplace',
    refused(own) && refused(promote) && row.workplace_role_id === R_SERVER && row.role === 'employee',
    `role ${own.status}, promotion ${promote.status}, still ${row.role}`);
}
{
  const up = await patch(A.token, `workplace_members?id=eq.${M_B}`, { role: 'manager' });
  const asManager = await memberRow(A.token, M_B);
  const down = await patch(A.token, `workplace_members?id=eq.${M_B}`, { role: 'employee' });
  const asEmployee = await memberRow(A.token, M_B);
  check('6b. the manager can promote and demote, because a second manager makes it safe',
    up.ok && asManager.role === 'manager' && down.ok && asEmployee.role === 'employee',
    `promote ${up.status}, demote ${down.status}`);
}

/* ── 7, 8 · the weighting ────────────────────────────────────────────────── */
{
  const r = await patch(A.token, `workplace_members?id=eq.${M_B}`, { multiplier: 1.25 });
  const row = await memberRow(A.token, M_B);
  check('7. the manager can change an employee\'s weighting',
    r.ok && Number(row.multiplier) === 1.25, `HTTP ${r.status}, multiplier ${row.multiplier}`);

  const negative = await patch(A.token, `workplace_members?id=eq.${M_B}`, { multiplier: -1 });
  const huge = await patch(A.token, `workplace_members?id=eq.${M_B}`, { multiplier: 99 });
  const still = await memberRow(A.token, M_B);
  check('7b. …but not to a negative one, or one outside the range the database allows',
    refused(negative) && refused(huge) && Number(still.multiplier) === 1.25,
    `negative ${negative.status}, 99× ${huge.status}, multiplier still ${still.multiplier}`);
}
{
  const own = await patch(B.token, `workplace_members?id=eq.${M_B}`, { multiplier: 2 });
  const row = await memberRow(A.token, M_B);
  check('8. an employee cannot change their own weighting',
    refused(own) && Number(row.multiplier) === 1.25,
    `HTTP ${own.status} (${own.rows?.length ?? 0} rows), multiplier ${row.multiplier}`);
}

/* ── 9, 10 · another workplace's vocabulary ──────────────────────────────── */
{
  const area = await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: X_SERVICE });
  const role = await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: X_SERVER });
  const both = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: X_SERVICE, workplace_role_id: X_SERVER });
  const row = await memberRow(A.token, M_B);
  check('9. an area belonging to another workplace is refused',
    refused(area) && refused(both) && row.area_id === A_SERVICE,
    `area ${area.status}, area+role ${both.status}`);
  check('10. …and so is a role belonging to another workplace',
    refused(role) && row.workplace_role_id === R_SERVER, `role ${role.status}`);
}

/* ── 11, 12 · archived vocabulary ────────────────────────────────────────── */
{
  const roleGone = await rpc(A.token, 'archive_workplace_role', { p_role_id: R_RUNNER });
  const areaGone = await rpc(A.token, 'archive_workplace_area', { p_area_id: A_RUNNER });
  const assignArea = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_RUNNER, workplace_role_id: null });
  const row = await memberRow(A.token, M_B);
  check('11. an archived area cannot be handed to anybody new',
    roleGone.ok && areaGone.ok && refused(assignArea) && row.area_id === A_SERVICE,
    `archive role ${roleGone.status}, archive area ${areaGone.status}, assign ${assignArea.status}`);

  const assignRole = await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_RUNNER });
  check('12. …nor an archived role',
    refused(assignRole) && (await memberRow(A.token, M_B)).workplace_role_id === R_SERVER,
    `HTTP ${assignRole.status}`);
}

/* ── 13 · a role from the wrong area ─────────────────────────────────────── */
{
  const mismatched = await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_BARTENDER });
  const alsoMismatched = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_BAR, workplace_role_id: R_SERVER });
  const row = await memberRow(A.token, M_B);
  check('13. a role from one area cannot be given to somebody working in another',
    refused(mismatched) && refused(alsoMismatched) &&
      row.area_id === A_SERVICE && row.workplace_role_id === R_SERVER,
    `role alone ${mismatched.status}, area+wrong role ${alsoMismatched.status}`);
}

/* ── the account link is never a direct write ────────────────────────────── */
{
  const steal = await patch(A.token, `workplace_members?id=eq.${M_B}`, { user_id: A.userId });
  const detach = await patch(A.token, `workplace_members?id=eq.${M_B}`, { user_id: null });
  const move = await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_id: WP_OTHER });
  const row = await memberRow(A.token, M_B);
  check('13b. a manager cannot attach, detach or relocate an account by editing the row',
    refused(steal) && refused(detach) && refused(move) && row.user_id === B.userId,
    `steal ${steal.status}, detach ${detach.status}, move ${move.status}`);
}

/* ── 14, 15, 16 · suspension ─────────────────────────────────────────────── */
{
  const selfSuspend = await patch(B.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });
  check('14a. an employee cannot suspend themselves',
    refused(selfSuspend) && (await memberRow(A.token, M_B)).status === 'active',
    `HTTP ${selfSuspend.status}`);

  const r = await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });
  const row = await memberRow(A.token, M_B);
  check('14. the manager can suspend an employee, and the record stays',
    r.ok && row.status === 'suspended' && row.id === M_B, `HTTP ${r.status}, status ${row.status}`);
}
{
  const entries = await get(B.token, `tip_distribution_entries?select=id&distribution_id=eq.${SENT}`);
  const dists = await get(B.token, `tip_distributions?select=id&workplace_id=eq.${WP}`);
  const pools = await get(B.token, `tip_pools?select=id&workplace_id=eq.${WP}`);
  check('15. a suspended member can no longer see the money — not their own share, not the pool',
    (entries.rows ?? []).length === 0 && (dists.rows ?? []).length === 0 && (pools.rows ?? []).length === 0,
    `entries ${(entries.rows ?? []).length}, distributions ${(dists.rows ?? []).length}, pools ${(pools.rows ?? []).length}`);

  const shift = await post(B.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: '2019-11-20',
    starts_at: iso('2019-11-20', 18), ends_at: iso('2019-11-20', 22), break_minutes: 0, status: 'submitted',
  });
  const report = await post(B.token, 'tip_reports', {
    workplace_id: WP, member_id: M_B, work_date: '2019-11-20', cash_cents: 500, card_cents: 0,
  });
  check('16. …and cannot file a shift or a tip report either',
    !shift.ok && !report.ok, `shift ${shift.status}, report ${report.status}`);

  const roster = await get(B.token, `workplace_members?select=id&workplace_id=eq.${WP}`);
  check('16b. …and the roster of that workplace closes behind them',
    (roster.rows ?? []).length === 0, `${(roster.rows ?? []).length} row(s) still visible`);
}

/* ── 17, 18 · bringing them back ─────────────────────────────────────────── */
{
  const r = await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'active' });
  const row = await memberRow(A.token, M_B);
  check('17. the manager can bring a suspended member back',
    r.ok && row.status === 'active', `HTTP ${r.status}, status ${row.status}`);

  const entries = await get(B.token, `tip_distribution_entries?select=id,member_id&distribution_id=eq.${SENT}`);
  const mine = (entries.rows ?? []).filter((e) => e.member_id === M_B);
  check('18. …and their own share is theirs to see again — only their own',
    mine.length === 1 && (entries.rows ?? []).length === 1,
    `${(entries.rows ?? []).length} entr(y/ies) visible, own ${mine.length}`);
}

/* ── 19 · the last manager ───────────────────────────────────────────────── */
{
  const demote = await patch(A.token, `workplace_members?id=eq.${M_A}`, { role: 'employee' });
  const suspend = await patch(A.token, `workplace_members?id=eq.${M_A}`, { status: 'suspended' });
  const leave = await patch(A.token, `workplace_members?id=eq.${M_A}`,
    { status: 'left', left_at: new Date().toISOString() });
  const row = await memberRow(A.token, M_A);
  check('19. the last manager cannot demote, suspend or remove themselves',
    !demote.ok && !suspend.ok && !leave.ok && row.role === 'manager' && row.status === 'active',
    `demote ${demote.status}, suspend ${suspend.status}, leave ${leave.status}; still ${row.role}/${row.status}`);
}

/* ── 20 · another workplace's roster ─────────────────────────────────────── */
{
  const edit = await patch(A.token, `workplace_members?id=eq.${M_B_OTHER}`, { multiplier: 2 });
  const suspend = await patch(A.token, `workplace_members?id=eq.${M_B_OTHER}`, { status: 'suspended' });
  const row = await memberRow(B.token, M_B_OTHER);
  check('20. a manager cannot touch a member of a workplace they do not manage',
    refused(edit) && refused(suspend) && Number(row.multiplier) === 1 && row.status === 'active',
    `edit ${edit.status} (${edit.rows?.length ?? 0} rows), suspend ${suspend.status}`);
}

/* ── a suspended manager is not a manager ────────────────────────────────── */
/* The corollary of the rule this phase rests on: current membership status
   controls access. A manager who is suspended must lose the authority too. */
{
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { role: 'manager' });
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });

  const editRoster = await patch(B.token, `workplace_members?id=eq.${M_A}`, { multiplier: 1.5 });
  const queue = await rpc(B.token, 'pending_join_requests', { p_workplace_id: WP });
  const invite = await rpc(B.token, 'create_invitation', {
    p_workplace_id: WP, p_email: 'ghost@example.invalid', p_display_name: 'Ghost', p_role: 'manager',
  });
  const untouched = await memberRow(A.token, M_A);
  check('20b. a suspended manager keeps the title and loses the authority',
    refused(editRoster) && !queue.ok && !invite.ok && Number(untouched.multiplier) === 1,
    `edit ${editRoster.status} (${editRoster.rows?.length ?? 0} rows), queue ${queue.status}, invite ${invite.status}`);

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'active' });
  const back = await patch(B.token, `workplace_members?id=eq.${M_A}`, { multiplier: 1 });
  check('20c. …and reinstating them hands it straight back',
    back.ok, `HTTP ${back.status}`);
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { role: 'employee' });
}

/* ── 21, 22, 24 · join requests ──────────────────────────────────────────── */
let JOIN_MEMBER = null;
{
  const code = (await get(A.token, `workplaces?select=join_code&id=eq.${WP_JOIN}`)).rows?.[0]?.join_code;
  const asked = await rpc(B.token, 'request_join', { p_join_code: code });
  const REQ = typeof asked.body === 'string' ? asked.body : null;

  const queue = await rpc(A.token, 'pending_join_requests', { p_workplace_id: WP_JOIN });
  const listed = (Array.isArray(queue.body) ? queue.body : []).find((r) => r.invitation_id === REQ);
  check('21a. the request reaches the manager\'s queue, with a name and nothing else',
    asked.ok && !!REQ && !!listed && typeof listed.requester_name === 'string' &&
      !('email' in listed) && !('token' in listed),
    `request ${asked.status}, queue ${queue.status}, keys ${listed ? Object.keys(listed).join(',') : '—'}`);

  const nosy = await rpc(B.token, 'pending_join_requests', { p_workplace_id: WP_JOIN });
  check('21b. …and somebody who does not manage that workplace is told no, not given an empty list',
    !nosy.ok, `HTTP ${nosy.status}`);

  // The requester's own row is the employee-controlled input. Even a manager
  // rewriting it to 'manager' must not produce one.
  const selfRaise = await patch(B.token, `invitations?id=eq.${REQ}`, { proposed_role: 'manager' });
  await patch(A.token, `invitations?id=eq.${REQ}`, { proposed_role: 'manager' });

  const byRequester = await rpc(B.token, 'approve_join_request', { p_invitation_id: REQ });
  check('21c. …and it is approved by the manager of that workplace, by nobody else',
    !byRequester.ok,
    `HTTP ${byRequester.status} — B is both the person who asked and a manager of a different ` +
      `workplace; SQL M38/M39 separate those two actors`);

  const approved = await rpc(A.token, 'approve_join_request', {
    p_invitation_id: REQ, p_area_id: null, p_workplace_role_id: null,
  });
  JOIN_MEMBER = typeof approved.body === 'string' ? approved.body : null;
  const row = JOIN_MEMBER ? await memberRow(A.token, JOIN_MEMBER) : null;
  check('21. the manager can approve a join request, and it creates the membership',
    approved.ok && !!JOIN_MEMBER && row?.status === 'active' && row?.user_id === B.userId,
    `HTTP ${approved.status}, member ${JOIN_MEMBER}`);
  check('24. …as an employee, whatever the request said — the requester cannot rewrite it, ' +
        'and the server does not read it',
    refused(selfRaise) && row?.role === 'employee',
    `requester's own edit ${selfRaise.status}; created as ${row?.role}`);

  const again = await rpc(A.token, 'approve_join_request', { p_invitation_id: REQ });
  const rosterNow = await get(A.token, `workplace_members?select=id&workplace_id=eq.${WP_JOIN}`);
  check('22. the same request cannot be approved twice',
    !again.ok && (rosterNow.rows ?? []).length === 2,
    `HTTP ${again.status}; ${(rosterNow.rows ?? []).length} member(s) in that workplace`);

  const bogus = await rpc(A.token, 'approve_join_request',
    { p_invitation_id: '00000000-0000-0000-0000-000000000000' });
  check('22b. …and neither can one that does not exist', !bogus.ok, `HTTP ${bogus.status}`);
}

/* ── 22c · a declined request is as spent as an accepted one ─────────────── */
/* Run before the invitation flow below, so B is still a stranger here. */
{
  const code = (await get(A.token, `workplaces?select=join_code&id=eq.${WP_INVITE}`)).rows?.[0]?.join_code;
  const asked = await rpc(B.token, 'request_join', { p_join_code: code });
  const REQ2 = typeof asked.body === 'string' ? asked.body : null;

  const declined = await patch(A.token, `invitations?id=eq.${REQ2}`, { status: 'declined' });
  const revive = await rpc(A.token, 'approve_join_request', { p_invitation_id: REQ2 });
  const roster = await get(A.token, `workplace_members?select=id&workplace_id=eq.${WP_INVITE}`);
  const queue = await rpc(A.token, 'pending_join_requests', { p_workplace_id: WP_INVITE });
  check('22c. a declined request leaves the queue and cannot be approved afterwards',
    asked.ok && declined.ok && !revive.ok && (roster.rows ?? []).length === 1 &&
      (Array.isArray(queue.body) ? queue.body : []).length === 0,
    `request ${asked.status}, decline ${declined.status}, approve ${revive.status}; ` +
      `${(roster.rows ?? []).length} member(s), ${(Array.isArray(queue.body) ? queue.body : []).length} pending`);
}

/* ── 23 · invitations ────────────────────────────────────────────────────── */
{
  const areasI = await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP_INVITE}`);
  const I_SERVICE = areasI.rows?.find((a) => a.key === 'service')?.id ?? null;
  const rolesI = await get(A.token, `workplace_roles?select=id,key&workplace_id=eq.${WP_INVITE}`);
  const I_SERVER = rolesI.rows?.find((r) => r.key === 'server')?.id ?? null;

  const made = await rpc(A.token, 'create_invitation', {
    p_workplace_id: WP_INVITE, p_email: B.email, p_display_name: `Invited ${STAMP}`,
    p_role: 'employee', p_area_id: I_SERVICE, p_workplace_role_id: I_SERVER,
  });
  const row = Array.isArray(made.body) ? made.body[0] : made.body;
  const TOKEN = row?.token ?? null;
  const INV = row?.invitation_id ?? null;

  const stored = await get(A.token, `invitations?select=id,status,token_hash,proposed_role&id=eq.${INV}`);
  check('23a. an invitation stores a hash, never the token it handed back once',
    made.ok && !!TOKEN && stored.rows?.[0]?.token_hash && stored.rows?.[0]?.token_hash !== TOKEN,
    `HTTP ${made.status}, hash differs from token: ${stored.rows?.[0]?.token_hash !== TOKEN}`);

  const raise = await patch(B.token, `invitations?id=eq.${INV}`, { proposed_role: 'manager' });
  const accepted = await rpc(B.token, 'accept_invitation', { p_token: TOKEN });
  const MEMBER = typeof accepted.body === 'string' ? accepted.body : null;
  const created = MEMBER ? await memberRow(A.token, MEMBER) : null;
  check('23. the membership an invitation creates takes its role from the invitation, not from the person accepting',
    refused(raise) && accepted.ok && created?.role === 'employee' && created?.status === 'active' &&
      created?.area_id === I_SERVICE && created?.workplace_role_id === I_SERVER,
    `invitee's edit ${raise.status}, accept ${accepted.status}, created as ${created?.role}`);

  const reuse = await rpc(B.token, 'accept_invitation', { p_token: TOKEN });
  check('23b. …and the token is spent', !reuse.ok, `HTTP ${reuse.status}`);

  const listed = await get(B.token, `invitations?select=id,token_hash&workplace_id=eq.${WP_INVITE}`);
  check('23c. …and no list hands anybody a usable secret',
    (listed.rows ?? []).every((i) => !i.token_hash) || (listed.rows ?? []).length === 0 ||
      !(listed.rows ?? []).some((i) => i.token_hash === TOKEN),
    `${(listed.rows ?? []).length} row(s) visible to the invitee, none containing the token`);
}

/* ── 25 · what all of that did to a payment already made ─────────────────── */
{
  await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_BAR, workplace_role_id: R_BARTENDER, multiplier: 2,
      display_name: `Renamed ${STAMP}` });
  const entries = await get(A.token,
    `tip_distribution_entries?select=member_id,member_name,area_name,role_name,points,multiplier,amount_cents` +
    `&distribution_id=eq.${SENT}&order=member_id`);
  const after = JSON.stringify(entries.rows ?? []);
  check('25. moving somebody\'s area, role, weighting and name leaves the paid distribution word for word',
    ENTRIES_BEFORE === after && /"Service"/.test(after) && /"Server"/.test(after),
    `${(entries.rows ?? []).length} entries compared; identical: ${ENTRIES_BEFORE === after}`);

  const edit = await patch(A.token,
    `tip_distribution_entries?distribution_id=eq.${SENT}&member_id=eq.${M_B}`, { amount_cents: 1 });
  check('25b. …and it cannot be edited afterwards even deliberately',
    refused(edit), `HTTP ${edit.status} (${edit.rows?.length ?? 0} rows)`);

  await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_SERVICE, workplace_role_id: R_SERVER, multiplier: 1 });
  const nowNamed = (await memberRow(A.token, M_B, 'id,display_name')).display_name;
  const recorded = (await get(A.token,
    `tip_distribution_entries?select=member_name&distribution_id=eq.${SENT}&member_id=eq.${M_B}`))
    .rows?.[0]?.member_name;
  check('25c. …and the name on the entry is a snapshot, not a lookup',
    !!recorded && !!nowNamed && recorded !== nowNamed,
    `entry says "${recorded}", the roster now says "${nowNamed}"`);
}

/* ── 11 (removal) · what "remove" means ──────────────────────────────────── */
{
  const hard = await del(A.token, `workplace_members?id=eq.${M_B}`);
  const still = await memberRow(A.token, M_B);
  check('26a. a membership the history points at cannot be deleted — the database refuses',
    refused(hard) && !!still,
    `HTTP ${hard.status}; the row is still there: ${!!still}`);

  const removed = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { status: 'left', left_at: new Date().toISOString() });
  const row = await memberRow(A.token, M_B, 'id,status,left_at,user_id,display_name');
  check('26b. removal is a standing, so the trail keeps pointing at somebody',
    removed.ok && row.status === 'left' && row.left_at !== null && row.user_id === B.userId,
    `HTTP ${removed.status}, status ${row.status}`);

  const entries = await get(A.token,
    `tip_distribution_entries?select=member_id,amount_cents&distribution_id=eq.${SENT}&order=member_id`);
  check('26c. …and the entry that names them is untouched by it',
    (entries.rows ?? []).some((e) => e.member_id === M_B), `${(entries.rows ?? []).length} entries`);
}

/* ── 26 · what the app reads to recover an active workplace ──────────────── */
{
  const active = await get(B.token,
    `workplace_members?select=id,workplace_id,role&user_id=eq.${B.userId}&status=eq.active`);
  const ids = (active.rows ?? []).map((m) => m.workplace_id);
  check('26. after removal the lost workplace is gone from what the app resolves, and the others remain',
    !ids.includes(WP) && ids.includes(WP_OTHER) && ids.includes(WP_JOIN) && ids.includes(WP_INVITE),
    `active in ${ids.length} workplace(s); the one they left is among them: ${ids.includes(WP)}`);

  const gone = await get(B.token, `tip_distribution_entries?select=id&distribution_id=eq.${SENT}`);
  check('26d. …and their access to the money there went with the membership',
    (gone.rows ?? []).length === 0, `${(gone.rows ?? []).length} entr(y/ies) still visible`);
}

/* ── 27 · without a session ──────────────────────────────────────────────── */
{
  const read = await get(null, `workplace_members?select=id&workplace_id=eq.${WP}`);
  const edit = await patch(null, `workplace_members?id=eq.${M_B}`, { role: 'manager' });
  const queue = await rpc(null, 'pending_join_requests', { p_workplace_id: WP });
  const approve = await rpc(null, 'approve_join_request',
    { p_invitation_id: '00000000-0000-0000-0000-000000000000' });
  const invite = await rpc(null, 'create_invitation', {
    p_workplace_id: WP, p_email: 'ghost@example.invalid', p_display_name: 'Ghost', p_role: 'manager',
  });
  const row = await memberRow(A.token, M_B);
  check('27. without a session the roster is neither readable nor writable',
    (read.status >= 400 || (read.rows ?? []).length === 0) && refused(edit) && !queue.ok &&
      !approve.ok && !invite.ok && row.role === 'employee',
    `read ${read.status}, edit ${edit.status}, queue ${queue.status}, approve ${approve.status}, invite ${invite.status}`);
}

/* ── 28 · demo mode ──────────────────────────────────────────────────────── */
{
  const before = await get(A.token, `workplace_members?select=id&workplace_id=eq.${WP}`);
  check('28. demo mode reaches the database not at all — it builds no client',
    (before.rows ?? []).length === 2,
    'harness/mem.cjs 11a-11d asserts the demo build performs no Supabase call while the roster is edited');
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    join-request test     ${WP_JOIN}`);
console.log(`    invitation test       ${WP_INVITE}`);
console.log(`    distribution          ${SENT}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
