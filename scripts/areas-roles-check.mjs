/**
 * Live area and role verification for TipCrew Phase 3F.
 *
 * Creating, renaming, reordering, archiving, restoring and deleting the
 * vocabulary a workplace divides tips by — against the real project over plain
 * fetch, with the two test users and a fresh workplace per run.
 *
 *   node scripts/areas-roles-check.mjs
 *
 * WHAT IT WRITES. One workplace per run, tagged with the run's timestamp, plus
 * a second one the other test user manages so cross-tenant refusals come from a
 * real manager. It also calculates and sends one distribution, because the
 * thing this phase must never break is a payment already made. Point it at a
 * development project.
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

console.log(`\n  TipCrew — live area and role verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

const created = await rpc(A.token, 'create_workplace', { p_name: `Ops Test ${STAMP}` });
const WP = typeof created.body === 'string' ? created.body : null;
if (!WP) die(`create_workplace failed: HTTP ${created.status}`);

const other = await rpc(B.token, 'create_workplace', { p_name: `Ops Rival ${STAMP}` });
const WP_OTHER = typeof other.body === 'string' ? other.body : null;

const invite = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const inviteRow = Array.isArray(invite.body) ? invite.body[0] : invite.body;
if (!inviteRow?.token) die(`create_invitation failed: HTTP ${invite.status}`);
const accepted = await rpc(B.token, 'accept_invitation', { p_token: inviteRow.token });
const M_B = typeof accepted.body === 'string' ? accepted.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${accepted.status}`);

const roster = await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`);
const M_A = roster.rows?.find((m) => m.role === 'manager')?.id ?? null;

const areas0 = await get(A.token, `workplace_areas?select=id,key,name,sort_order&workplace_id=eq.${WP}`);
const A_SERVICE = areas0.rows?.find((a) => a.key === 'service')?.id ?? null;
const A_BAR = areas0.rows?.find((a) => a.key === 'bar')?.id ?? null;
const A_RUNNER = areas0.rows?.find((a) => a.key === 'runner')?.id ?? null;
const roles0 = await get(A.token, `workplace_roles?select=id,key,area_id&workplace_id=eq.${WP}`);
const R_SERVER = roles0.rows?.find((r) => r.key === 'server')?.id ?? null;
const R_RUNNER = roles0.rows?.find((r) => r.key === 'runner')?.id ?? null;

const xAreas = WP_OTHER
  ? await get(B.token, `workplace_areas?select=id,key&workplace_id=eq.${WP_OTHER}`) : { rows: [] };
const X_SERVICE = xAreas.rows?.find((a) => a.key === 'service')?.id ?? null;

await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });

const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

/* ── 1, 2 · reading, and who may write ───────────────────────────────────── */
{
  check('1. the manager can list the areas of their workplace',
    (areas0.rows?.length ?? 0) === 6 && !!A_SERVICE,
    `${areas0.rows?.length ?? '?'} area(s) seeded`);

  const employeeSees = await get(B.token, `workplace_areas?select=id&workplace_id=eq.${WP}`);
  check('1b. …and so can an employee, because they work under them',
    (employeeSees.rows?.length ?? 0) === 6, `${employeeSees.rows?.length ?? '?'} visible to staff`);
}
{
  const created2 = await rpc(B.token, 'create_workplace_area', { p_workplace_id: WP, p_name: 'Ghost' });
  const renamed = await patch(B.token, `workplace_areas?id=eq.${A_BAR}`, { name: 'Hacked' });
  const archived = await rpc(B.token, 'archive_workplace_area', { p_area_id: A_RUNNER });
  const reordered = await rpc(B.token, 'reorder_workplace_areas', {
    p_workplace_id: WP, p_ids: [A_BAR, A_SERVICE],
  });
  const usage = await rpc(B.token, 'area_usage', { p_area_id: A_BAR });
  const after = await get(A.token, `workplace_areas?select=name,archived_at&id=eq.${A_BAR}`);
  check('2. an employee cannot create, rename, archive, reorder or even inspect an area',
    !created2.ok && (!renamed.ok || (renamed.rows?.length ?? 0) === 0) && !archived.ok &&
      !reordered.ok && !usage.ok && after.rows?.[0]?.name === 'Bar',
    `create ${created2.status}, rename ${renamed.status} (${renamed.rows?.length ?? 0} rows), ` +
      `archive ${archived.status}, reorder ${reordered.status}, usage ${usage.status}`);
}

/* ── 3, 4 · creating ─────────────────────────────────────────────────────── */
let A_NEW = null;
{
  const r = await rpc(A.token, 'create_workplace_area', { p_workplace_id: WP, p_name: 'Späti Küche' });
  A_NEW = typeof r.body === 'string' ? r.body : null;
  const row = A_NEW ? await get(A.token, `workplace_areas?select=key,name,sort_order&id=eq.${A_NEW}`) : null;
  check('3. the manager can create an area, and the database derives its key',
    r.ok && row?.rows?.[0]?.key === 'spaeti_kueche' && row?.rows?.[0]?.name === 'Späti Küche',
    `HTTP ${r.status}, key ${row?.rows?.[0]?.key}`);
  check('3b. …and it lands at the end of the order',
    (row?.rows?.[0]?.sort_order ?? 0) > 60, `sort_order ${row?.rows?.[0]?.sort_order}`);
}
{
  const blank = await rpc(A.token, 'create_workplace_area', { p_workplace_id: WP, p_name: '   ' });
  const symbols = await rpc(A.token, 'create_workplace_area', { p_workplace_id: WP, p_name: '!!!' });
  const dupe = await rpc(A.token, 'create_workplace_area', { p_workplace_id: WP, p_name: 'bar' });
  const count = await get(A.token, `workplace_areas?select=id&workplace_id=eq.${WP}`);
  check('4. a blank name, a name with nothing usable in it, and a duplicate are all refused',
    !blank.ok && !symbols.ok && !dupe.ok && (count.rows?.length ?? 0) === 7,
    `blank ${blank.status}, symbols ${symbols.status}, duplicate ${dupe.status}; ${count.rows?.length ?? '?'} area(s)`);
}

/* ── 5 · renaming ────────────────────────────────────────────────────────── */
{
  const r = await patch(A.token, `workplace_areas?id=eq.${A_NEW}`, { name: 'Late kitchen' });
  const row = await get(A.token, `workplace_areas?select=key,name&id=eq.${A_NEW}`);
  const clash = await patch(A.token, `workplace_areas?id=eq.${A_NEW}`, { name: 'Bar' });
  check('5. the manager can rename an area, its key does not move, and a clash is refused',
    r.ok && row.rows?.[0]?.name === 'Late kitchen' && row.rows?.[0]?.key === 'spaeti_kueche' && !clash.ok,
    `rename ${r.status}, key ${row.rows?.[0]?.key}, clash ${clash.status}`);
}

/* ── 6, 7 · ordering ─────────────────────────────────────────────────────── */
{
  const r = await rpc(A.token, 'reorder_workplace_areas', {
    p_workplace_id: WP, p_ids: [A_BAR, A_SERVICE, A_RUNNER],
  });
  const rows = await get(A.token, `workplace_areas?select=id,sort_order&workplace_id=eq.${WP}&order=sort_order`);
  const order = (rows.rows ?? []).map((a) => a.id);
  check('6. the manager can reorder the areas',
    r.ok && order.indexOf(A_BAR) < order.indexOf(A_SERVICE),
    `HTTP ${r.status}; Bar before Service: ${order.indexOf(A_BAR) < order.indexOf(A_SERVICE)}`);
  await rpc(A.token, 'reorder_workplace_areas', { p_workplace_id: WP, p_ids: [A_SERVICE, A_BAR, A_RUNNER] });
}
{
  const foreignArea = await rpc(A.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: X_SERVICE, p_name: 'Sneaky',
  });
  const foreignOrder = await rpc(A.token, 'reorder_workplace_areas', {
    p_workplace_id: WP, p_ids: [X_SERVICE],
  });
  const foreignWorkplace = await rpc(A.token, 'create_workplace_area', {
    p_workplace_id: WP_OTHER, p_name: 'Sneaky',
  });
  const settings = await patch(A.token, `workplace_areas?id=eq.${X_SERVICE}`, { name: 'Hacked' });
  check('7. a manager cannot reach into another workplace at all',
    !foreignArea.ok && !foreignOrder.ok && !foreignWorkplace.ok &&
      (!settings.ok || (settings.rows?.length ?? 0) === 0),
    `role in their area ${foreignArea.status}, reorder ${foreignOrder.status}, ` +
      `create there ${foreignWorkplace.status}, rename ${settings.status}`);
}

/* ── 8, 9, 10 · archiving an area ────────────────────────────────────────── */
{
  const r = await rpc(B.token, 'archive_workplace_area', { p_area_id: A_NEW });
  check('8. an employee cannot archive an area', !r.ok, `HTTP ${r.status}`);
}
{
  const blocked = await rpc(A.token, 'archive_workplace_area', { p_area_id: A_SERVICE });
  const usage = await rpc(A.token, 'area_usage', { p_area_id: A_SERVICE });
  const u = usage.body ?? {};
  check('9. an area two people work in cannot be archived, and the count is reported',
    !blocked.ok && Number(u.members) === 2,
    `HTTP ${blocked.status}; usage members ${u.members}, roles ${u.roles}, open shifts ${u.open_shifts}`);
  check('9b. …and the usage report carries no money',
    !/cents|amount|total/i.test(JSON.stringify(u)), JSON.stringify(u).slice(0, 120));

  // Runner has one seeded role and nothing else. Archive the role, then the area.
  const roleFirst = await rpc(A.token, 'archive_workplace_area', { p_area_id: A_RUNNER });
  const archiveRole = await rpc(A.token, 'archive_workplace_role', { p_role_id: R_RUNNER });
  const nowOk = await rpc(A.token, 'archive_workplace_area', { p_area_id: A_RUNNER });
  const row = await get(A.token, `workplace_areas?select=archived_at&id=eq.${A_RUNNER}`);
  check('9c. an area that still holds a live role is refused until the role goes first',
    !roleFirst.ok && archiveRole.ok && nowOk.ok && row.rows?.[0]?.archived_at !== null,
    `with role ${roleFirst.status}, role archived ${archiveRole.status}, then ${nowOk.status}`);
  check('9d. …and the row is stamped, not deleted',
    (await get(A.token, `workplace_areas?select=id&id=eq.${A_RUNNER}`)).rows?.length === 1,
    'the area is still there, archived');
}
{
  const draft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const D = typeof draft.body === 'string' ? draft.body : null;
  const share = await patch(A.token,
    `distribution_rule_areas?rule_id=eq.${D}&area_id=eq.${A_RUNNER}`, { percentage: 20 });
  const member = await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_RUNNER });
  const shift = await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: '2019-12-01',
    starts_at: iso('2019-12-01', 18), ends_at: iso('2019-12-01', 22),
    break_minutes: 0, status: 'submitted', area_id: A_RUNNER,
  });
  const role = await rpc(A.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: A_RUNNER, p_name: 'Late runner',
  });
  const rounding = await patch(A.token, `distribution_rules?id=eq.${D}`, { rounding_area_id: A_RUNNER });
  check('10. an archived area is refused everywhere a NEW reference would be written',
    !share.ok && (!member.ok || (member.rows?.length ?? 0) === 0) && !shift.ok && !role.ok && !rounding.ok,
    `share ${share.status}, member ${member.status}, shift ${shift.status}, role ${role.status}, rounding ${rounding.status}`);

  const areasForShift = await get(A.token,
    `workplace_areas?select=id&workplace_id=eq.${WP}&archived_at=is.null`);
  check('10b. …and it is gone from the list the app offers',
    !(areasForShift.rows ?? []).some((a) => a.id === A_RUNNER),
    `${areasForShift.rows?.length ?? '?'} live area(s)`);

  await rpc(A.token, 'restore_workplace_area', { p_area_id: A_RUNNER });
  const back = await get(A.token, `workplace_areas?select=archived_at&id=eq.${A_RUNNER}`);
  check('10c. …until the manager brings it back',
    back.rows?.[0]?.archived_at === null, 'restored');
  await rpc(A.token, 'archive_workplace_area', { p_area_id: A_RUNNER });
}

/* ── 12 to 19 · roles ────────────────────────────────────────────────────── */
let R_NEW = null;
{
  const r = await rpc(A.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: A_BAR, p_name: 'Bar Lead', p_points: 1.3,
  });
  R_NEW = typeof r.body === 'string' ? r.body : null;
  const row = R_NEW ? await get(A.token, `workplace_roles?select=key,name,points,area_id&id=eq.${R_NEW}`) : null;
  check('12. the manager can create a role inside one of their own areas',
    r.ok && row?.rows?.[0]?.key === 'bar_lead' && row?.rows?.[0]?.area_id === A_BAR &&
      Number(row?.rows?.[0]?.points) === 1.3,
    `HTTP ${r.status}, key ${row?.rows?.[0]?.key}, points ${row?.rows?.[0]?.points}`);

  const dupe = await rpc(A.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: A_BAR, p_name: 'bar lead',
  });
  const elsewhere = await rpc(A.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: A_SERVICE, p_name: 'Bar Lead',
  });
  const twin = typeof elsewhere.body === 'string' ? elsewhere.body : null;
  const twinRow = twin ? await get(A.token, `workplace_roles?select=key&id=eq.${twin}`) : null;
  check('12b. …a second of the same name in the same area is refused, in another area it is not',
    !dupe.ok && elsewhere.ok && twinRow?.rows?.[0]?.key === 'bar_lead_2',
    `duplicate ${dupe.status}, elsewhere ${elsewhere.status} with key ${twinRow?.rows?.[0]?.key}`);
}
{
  const r = await rpc(B.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: A_BAR, p_name: 'Ghost',
  });
  const points = await patch(B.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 5 });
  const renamed = await patch(B.token, `workplace_roles?id=eq.${R_SERVER}`, { name: 'Hacked' });
  const archived = await rpc(B.token, 'archive_workplace_role', { p_role_id: R_NEW });
  const usage = await rpc(B.token, 'role_usage', { p_role_id: R_SERVER });
  const after = await get(A.token, `workplace_roles?select=name,points&id=eq.${R_SERVER}`);
  check('13/18. an employee cannot create, rename, repoint, archive or inspect a role',
    !r.ok && (!points.ok || (points.rows?.length ?? 0) === 0) &&
      (!renamed.ok || (renamed.rows?.length ?? 0) === 0) && !archived.ok && !usage.ok &&
      after.rows?.[0]?.name === 'Server' && Number(after.rows?.[0]?.points) === 1,
    `create ${r.status}, points ${points.status}, rename ${renamed.status}, ` +
      `archive ${archived.status}, usage ${usage.status}`);
}
{
  const foreign = await rpc(A.token, 'create_workplace_role', {
    p_workplace_id: WP, p_area_id: X_SERVICE, p_name: 'Sneaky',
  });
  check('15. a role cannot be put into another workplace’s area', !foreign.ok, `HTTP ${foreign.status}`);
}
{
  const renamed = await patch(A.token, `workplace_roles?id=eq.${R_NEW}`, { name: 'Bar lead (evening)' });
  const repointed = await patch(A.token, `workplace_roles?id=eq.${R_NEW}`, { points: 1.4 });
  const tooHigh = await patch(A.token, `workplace_roles?id=eq.${R_NEW}`, { points: 9 });
  const zero = await patch(A.token, `workplace_roles?id=eq.${R_NEW}`, { points: 0 });
  check('16/17. the manager can rename a role and set its points, within the range the column allows',
    renamed.ok && repointed.ok && Number(repointed.rows?.[0]?.points) === 1.4 && !tooHigh.ok && !zero.ok,
    `rename ${renamed.status}, points ${repointed.status}, 9 ${tooHigh.status}, 0 ${zero.status}`);
}
{
  const r = await rpc(A.token, 'reorder_workplace_roles', { p_area_id: A_BAR, p_ids: [R_NEW] });
  const wrongArea = await rpc(A.token, 'reorder_workplace_roles', { p_area_id: A_BAR, p_ids: [R_SERVER] });
  check('19. roles can be reordered inside their area, and only inside it',
    r.ok && !wrongArea.ok, `reorder ${r.status}, foreign role ${wrongArea.status}`);
}
{
  const blocked = await rpc(A.token, 'archive_workplace_role', { p_role_id: R_SERVER });
  const usage = await rpc(A.token, 'role_usage', { p_role_id: R_SERVER });
  const ok2 = await rpc(A.token, 'archive_workplace_role', { p_role_id: R_NEW });
  const row = await get(A.token, `workplace_roles?select=archived_at&id=eq.${R_NEW}`);
  check('20. a role two people hold cannot be archived; one nobody holds can',
    !blocked.ok && Number((usage.body ?? {}).members) === 2 && ok2.ok &&
      row.rows?.[0]?.archived_at !== null,
    `held ${blocked.status} (members ${(usage.body ?? {}).members}), free ${ok2.status}`);
}
{
  const member = await patch(A.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_NEW });
  const shift = await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: '2019-12-02',
    starts_at: iso('2019-12-02', 18), ends_at: iso('2019-12-02', 22),
    break_minutes: 0, status: 'submitted', area_id: A_BAR, workplace_role_id: R_NEW,
  });
  check('21. an archived role is refused for a new assignment and for a new shift',
    (!member.ok || (member.rows?.length ?? 0) === 0) && !shift.ok,
    `member ${member.status} (${member.rows?.length ?? 0} rows), shift ${shift.status}`);

  const live = await get(A.token, `workplace_roles?select=id&workplace_id=eq.${WP}&archived_at=is.null`);
  check('21b. …and it is gone from the list the app offers',
    !(live.rows ?? []).some((r) => r.id === R_NEW), `${live.rows?.length ?? '?'} live role(s)`);
}

/* ── 22, 24 · a paid distribution does not move ──────────────────────────── */
const DAY = '2019-12-10';
let SENT = null;
let BEFORE = '';
{
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${
    (await get(A.token, `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows?.[0]?.id
  }&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  const draftId = (await get(A.token, `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows?.[0]?.id;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${draftId}`, { method: 'hours', min_overlap_minutes: 15 });
  await rpc(A.token, 'activate_rule', { p_rule_id: draftId });

  for (const member of [M_A, M_B]) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY,
      starts_at: iso(DAY, 18), ends_at: iso(DAY, 22), break_minutes: 0, status: 'approved',
    });
  }
  const pool = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY, period_end: DAY,
    label: `ops ${STAMP}`, cash_cents: 10000, source: 'manual', status: 'open', created_by: M_A,
  });
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: pool.rows?.[0]?.id });
  SENT = typeof calc.body === 'string' ? calc.body : null;
  if (SENT) await rpc(A.token, 'send_distribution', { p_distribution_id: SENT });
  const entries = await get(A.token,
    `tip_distribution_entries?select=area_name,role_name,points,amount_cents&distribution_id=eq.${SENT}&order=amount_cents`);
  BEFORE = JSON.stringify(entries.rows ?? []);
  check('22a. a distribution can be calculated and sent under the current names',
    calc.ok && !!SENT && /"Service"/.test(BEFORE), `HTTP ${calc.status}`);
}
{
  await patch(A.token, `workplace_areas?id=eq.${A_SERVICE}`, { name: 'Front of house' });
  await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { name: 'Waiter', points: 2.2 });
  const entries = await get(A.token,
    `tip_distribution_entries?select=area_name,role_name,points,amount_cents&distribution_id=eq.${SENT}&order=amount_cents`);
  const AFTER = JSON.stringify(entries.rows ?? []);
  check('22. renaming an area and a role, and moving its points, leaves the paid distribution word for word',
    BEFORE === AFTER && /"Service"/.test(AFTER) && /"Server"/.test(AFTER),
    `${(entries.rows ?? []).length} entries compared`);

  const rule = await get(A.token, `tip_distributions?select=rule_id,rule_version&id=eq.${SENT}`);
  const frozen = await get(A.token,
    `distribution_rule_roles?select=points&rule_id=eq.${rule.rows?.[0]?.rule_id}&workplace_role_id=eq.${R_SERVER}`);
  check('24. …and the rule version it used still holds the points it froze',
    Number(frozen.rows?.[0]?.points) === 1, `frozen ${frozen.rows?.[0]?.points}, definition now 2.2`);
}

/* ── 11, 23 · deleting, and what the database refuses to let go ──────────── */
{
  const made = await rpc(A.token, 'create_workplace_area', { p_workplace_id: WP, p_name: `Typo ${STAMP}` });
  const TMP = typeof made.body === 'string' ? made.body : null;
  const usage = TMP ? await rpc(A.token, 'area_usage', { p_area_id: TMP }) : { body: {} };
  const gone = TMP ? await del(A.token, `workplace_areas?id=eq.${TMP}`) : { ok: false, status: 0 };
  const still = TMP ? await get(A.token, `workplace_areas?select=id&id=eq.${TMP}`) : null;
  check('11. an area nothing refers to reports no references, and can be removed outright',
    Number((usage.body ?? {}).references) === 0 && gone.ok && (still?.rows?.length ?? 1) === 0,
    `references ${(usage.body ?? {}).references}, DELETE HTTP ${gone.status}`);

  const refused = await del(A.token, `workplace_areas?id=eq.${A_SERVICE}`);
  const refusedRole = await del(A.token, `workplace_roles?id=eq.${R_SERVER}`);
  const survives = await get(A.token, `workplace_areas?select=id&id=eq.${A_SERVICE}`);
  check('23. …while one a distribution has been paid under cannot be, and is untouched',
    !refused.ok && !refusedRole.ok && (survives.rows?.length ?? 0) === 1,
    `area DELETE ${refused.status}, role DELETE ${refusedRole.status}`);

  const usedUsage = await rpc(A.token, 'area_usage', { p_area_id: A_SERVICE });
  check('23b. …and its usage report says so before the manager tries',
    Number((usedUsage.body ?? {}).references) > 0 &&
      Number((usedUsage.body ?? {}).distributions) === 1,
    `references ${(usedUsage.body ?? {}).references}, distributions ${(usedUsage.body ?? {}).distributions}`);
}

/* ── 25, 26 · without a session ──────────────────────────────────────────── */
{
  const read = await get(null, `workplace_areas?select=id&workplace_id=eq.${WP}`);
  const create = await rpc(null, 'create_workplace_area', { p_workplace_id: WP, p_name: 'Ghost' });
  const rename = await patch(null, `workplace_areas?id=eq.${A_BAR}`, { name: 'Hacked' });
  const usage = await rpc(null, 'area_usage', { p_area_id: A_BAR });
  const after = await get(A.token, `workplace_areas?select=name&id=eq.${A_BAR}`);
  check('25. without a session none of it is readable or writable',
    (read.status >= 400 || (read.rows?.length ?? 0) === 0) && !create.ok &&
      (!rename.ok || (rename.rows?.length ?? 0) === 0) && !usage.ok &&
      after.rows?.[0]?.name === 'Bar',
    `read ${read.status}, create ${create.status}, rename ${rename.status}, usage ${usage.status}`);

  check('26. demo mode reaches the database not at all — it builds no client',
    after.rows?.[0]?.name === 'Bar',
    'the browser suite (harness/cfg.cjs 12a-12d) asserts the demo build performs no Supabase call');
}

console.log(`\n  created for this run:`);
console.log(`    workplace    ${WP}`);
console.log(`    distribution ${SENT}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
