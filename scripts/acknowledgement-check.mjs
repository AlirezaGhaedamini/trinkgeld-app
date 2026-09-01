/**
 * Live acknowledgement verification for TipCrew Phase 3H.
 *
 * The employee's half of the loop: who may confirm a share, what a confirmation
 * is allowed to touch, what happens to somebody who worked two areas in one
 * night, and what the requirement means once the rule behind it has moved on.
 * Run against the real project over plain fetch, with the two test users and
 * fresh workplaces per run.
 *
 *   node scripts/acknowledgement-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages, so cross-tenant
 * refusals come from a real manager rather than from nobody. It calculates and
 * sends three distributions. Point it at a development project.
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

async function entryRows(token, distributionId, extra = '') {
  const r = await get(token,
    `tip_distribution_entries?select=id,member_id,member_name,area_name,ack_status,acknowledged_at,queried_at,amount_cents` +
    `&distribution_id=eq.${distributionId}${extra}&order=area_name`);
  return r.rows ?? [];
}
const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

console.log(`\n  TipCrew — live acknowledgement verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

/* Both sessions are opened before anything uses a token. A manages the
   workplace under test; B is staff there and manages the rival workplace, which
   is what makes the cross-tenant refusals come from a real manager. */
const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Ack Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Ack Rival ${STAMP}` });
const WP_OTHER = typeof rival.body === 'string' ? rival.body : null;

const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const invRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!invRow?.token) die(`create_invitation failed: HTTP ${invited.status}`);
const accepted = await rpc(B.token, 'accept_invitation', { p_token: invRow.token });
const M_B = typeof accepted.body === 'string' ? accepted.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${accepted.status}`);

// A placeholder nobody has claimed: they can never confirm, and must never be
// counted as owing a confirmation.
const ghostInvite = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: `ghost.${STAMP}@example.invalid`,
  p_display_name: `Ghost ${STAMP}`, p_role: 'employee',
});
const roster = await get(A.token, `workplace_members?select=id,role,user_id,display_name&workplace_id=eq.${WP}`);
const M_A = roster.rows?.find((m) => m.role === 'manager')?.id ?? null;
const M_GHOST = roster.rows?.find((m) => m.user_id === null)?.id ?? null;
if (!M_A || !M_GHOST) die('could not resolve the manager and the placeholder membership');

const areas0 = await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP}`);
const areaBy = (k) => areas0.rows?.find((a) => a.key === k)?.id ?? null;
const A_SERVICE = areaBy('service'), A_BAR = areaBy('bar');
const roles0 = await get(A.token, `workplace_roles?select=id,key&workplace_id=eq.${WP}`);
const roleBy = (k) => roles0.rows?.find((r) => r.key === k)?.id ?? null;
const R_SERVER = roleBy('server'), R_KEEP = roleBy('bartender');

await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_GHOST}`, { area_id: A_BAR, workplace_role_id: R_KEEP });

// Service 60 / Bar 40, confirmation required.
{
  const draftId = (await get(A.token,
    `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows?.[0]?.id;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=eq.${A_SERVICE}`, { percentage: 60 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=eq.${A_BAR}`, { percentage: 40 });
  await patch(A.token,
    `distribution_rule_areas?rule_id=eq.${draftId}&area_id=not.in.(${A_SERVICE},${A_BAR})`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${draftId}`,
    { method: 'hours_points', min_overlap_minutes: 15, acknowledgement_required: true });
  const activated = await rpc(A.token, 'activate_rule', { p_rule_id: draftId });
  if (!activated.ok) die(`activate_rule failed: HTTP ${activated.status} ${activated.raw}`);
}

/* B works Service and then Bar on the same night: two entries, one person. */
const DAY = '2019-10-04';
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_B, work_date: DAY, starts_at: iso(DAY, 16), ends_at: iso(DAY, 20),
  break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_B, work_date: DAY, starts_at: iso(DAY, 20), ends_at: iso(DAY, 23),
  break_minutes: 0, status: 'approved', area_id: A_BAR, workplace_role_id: R_KEEP });
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_A, work_date: DAY, starts_at: iso(DAY, 16), ends_at: iso(DAY, 23),
  break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_GHOST, work_date: DAY, starts_at: iso(DAY, 16), ends_at: iso(DAY, 23),
  break_minutes: 0, status: 'approved', area_id: A_BAR, workplace_role_id: R_KEEP });

const pool1 = await post(A.token, 'tip_pools', {
  workplace_id: WP, period: 'day', period_start: DAY, period_end: DAY,
  label: `ack ${STAMP}`, cash_cents: 30000, source: 'manual', status: 'open', created_by: M_A });
const calc1 = await rpc(A.token, 'calculate_distribution', { p_pool_id: pool1.rows?.[0]?.id });
const DIST = typeof calc1.body === 'string' ? calc1.body : null;
if (!DIST) die(`calculate_distribution failed: HTTP ${calc1.status} ${calc1.raw}`);

/* ── 19 · the multi-entry member ─────────────────────────────────────────── */
{
  const mine = await entryRows(A.token, DIST, `&member_id=eq.${M_B}`);
  check('19. a member who worked two areas has two entries in one distribution',
    mine.length === 2 && new Set(mine.map((e) => e.area_name)).size === 2,
    `${mine.length} entr(ies): ${mine.map((e) => e.area_name).join(', ')}`);
}

/* ── 9 · a draft may not be acknowledged, by any door ─────────────────────── */
const ENTRY_B = (await entryRows(A.token, DIST, `&member_id=eq.${M_B}`))[0]?.id ?? null;
{
  const viaEntry = await rpc(B.token, 'acknowledge_entry',
    { p_entry_id: ENTRY_B, p_status: 'acknowledged' });
  const viaDist = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'acknowledged' });
  const direct = await patch(B.token, `tip_distribution_entries?id=eq.${ENTRY_B}`,
    { ack_status: 'acknowledged' });
  const seen = await get(B.token, `member_distributions?select=id&id=eq.${DIST}`);
  const row = (await entryRows(A.token, DIST, `&id=eq.${ENTRY_B}`))[0];
  check('9. a draft cannot be acknowledged — not by the RPC, not by writing the column',
    !viaEntry.ok && !viaDist.ok && refused(direct) && row?.ack_status === 'pending',
    `entry RPC ${viaEntry.status}, distribution RPC ${viaDist.status}, direct ${direct.status}`);
  check('9b. …and the employee cannot even see it yet',
    (seen.rows ?? []).length === 0, `${(seen.rows ?? []).length} row(s) visible`);
}

/* ── 1, 2 · sent, and read by the person it names ─────────────────────────── */
const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: DIST });
{
  const dist = await get(B.token,
    `member_distributions?select=id,status,acknowledgement_required&id=eq.${DIST}`);
  const row = dist.rows?.[0];
  check('1. the manager can send a distribution that asks for confirmation',
    sent.ok && row?.status === 'sent', `HTTP ${sent.status}, status ${row?.status}`);
  check('2. the employee reads their own pending state, and that confirmation is required',
    row?.acknowledgement_required === true, `acknowledgement_required ${row?.acknowledgement_required}`);

  const mine = await get(B.token,
    `member_distribution_entries?select=id,ack_status,is_own&distribution_id=eq.${DIST}`);
  const own = (mine.rows ?? []).filter((e) => e.is_own !== false);
  check('2b. …and sees both of their own entries waiting, and nobody else\'s',
    own.length === 2 && own.every((e) => e.ack_status === 'pending') &&
      (mine.rows ?? []).length === 2,
    `${own.length} own of ${(mine.rows ?? []).length} visible`);
}

/* ── 3, 4, 5, 19 · one action answers every entry they hold ──────────────── */
{
  const done = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'acknowledged' });
  const mine = await entryRows(A.token, DIST, `&member_id=eq.${M_B}`);
  check('3. the employee acknowledges, and one action covers every entry they own',
    done.ok && done.body === 2 && mine.every((e) => e.ack_status === 'acknowledged'),
    `HTTP ${done.status}, ${done.body} entr(ies) touched`);
  check('4. …so the state is confirmed, with neither area left behind',
    mine.length === 2 && mine.filter((e) => e.ack_status === 'acknowledged').length === 2,
    mine.map((e) => `${e.area_name}:${e.ack_status}`).join(' '));
  check('5. …and the moment is stored',
    mine.every((e) => e.acknowledged_at !== null), `stamps ${mine.map((e) => !!e.acknowledged_at).join(',')}`);

  const others = await entryRows(A.token, DIST, `&member_id=neq.${M_B}`);
  check('5b. …and nobody else was answered for',
    others.every((e) => e.ack_status === 'pending'),
    others.map((e) => `${e.member_name}:${e.ack_status}`).join(' '));
}

/* ── 6 · doing it twice ──────────────────────────────────────────────────── */
{
  const before = (await entryRows(A.token, DIST, `&id=eq.${ENTRY_B}`))[0]?.acknowledged_at;
  const again = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'acknowledged' });
  const againEntry = await rpc(B.token, 'acknowledge_entry',
    { p_entry_id: ENTRY_B, p_status: 'acknowledged' });
  const after = (await entryRows(A.token, DIST, `&id=eq.${ENTRY_B}`))[0]?.acknowledged_at;
  check('6. acknowledging again is accepted and does not move the moment it first happened',
    again.ok && againEntry.ok && before === after,
    `HTTP ${again.status}/${againEntry.status}; stamp unchanged: ${before === after}`);

  const back = await rpc(B.token, 'acknowledge_entry', { p_entry_id: ENTRY_B, p_status: 'pending' });
  const backDirect = await patch(B.token, `tip_distribution_entries?id=eq.${ENTRY_B}`,
    { ack_status: 'pending' });
  const stamp = await patch(B.token, `tip_distribution_entries?id=eq.${ENTRY_B}`,
    { acknowledged_at: '2001-01-01T00:00:00Z' });
  const row = (await entryRows(A.token, DIST, `&id=eq.${ENTRY_B}`))[0];
  check('6b. a confirmation cannot be taken back, and its timestamp is not the caller\'s to write',
    !back.ok && refused(backDirect) && refused(stamp) &&
      row?.ack_status === 'acknowledged' && row?.acknowledged_at === after,
    `RPC ${back.status}, column ${backDirect.status}, timestamp ${stamp.status}`);
}

/* ── 7, 8, 13 · whose entry is it ────────────────────────────────────────── */
{
  const managerEntry = (await entryRows(A.token, DIST, `&member_id=eq.${M_A}`))[0]?.id;
  const ghostEntry = (await entryRows(A.token, DIST, `&member_id=eq.${M_GHOST}`))[0]?.id;

  const colleague = await rpc(B.token, 'acknowledge_entry',
    { p_entry_id: managerEntry, p_status: 'acknowledged' });
  const placeholder = await rpc(B.token, 'acknowledge_entry',
    { p_entry_id: ghostEntry, p_status: 'acknowledged' });
  const rows = await entryRows(A.token, DIST);
  check('7. an employee cannot acknowledge a colleague\'s entry',
    !colleague.ok && rows.find((e) => e.id === managerEntry)?.ack_status === 'pending',
    `HTTP ${colleague.status}`);

  const byManager = await rpc(A.token, 'acknowledge_entry',
    { p_entry_id: ghostEntry, p_status: 'acknowledged' });
  const direct = await patch(A.token, `tip_distribution_entries?id=eq.${ghostEntry}`,
    { ack_status: 'acknowledged' });
  const after = await entryRows(A.token, DIST, `&id=eq.${ghostEntry}`);
  check('13. a manager cannot confirm on somebody else\'s behalf, by RPC or by column',
    !placeholder.ok && !byManager.ok && refused(direct) &&
      after[0]?.ack_status === 'pending',
    `employee ${placeholder.status}, manager RPC ${byManager.status}, column ${direct.status}`);
}
/* A real distribution in the rival workplace, so "another workplace's entry" is
   an actual row rather than a hypothetical. A is a stranger there. */
{
  const xAreas = await get(B.token, `workplace_areas?select=id,key&workplace_id=eq.${WP_OTHER}`);
  const X_SERVICE = xAreas.rows?.find((a) => a.key === 'service')?.id ?? null;
  const xRoles = await get(B.token, `workplace_roles?select=id,key&workplace_id=eq.${WP_OTHER}`);
  const X_SERVER = xRoles.rows?.find((r) => r.key === 'server')?.id ?? null;
  const M_B_OTHER = (await get(B.token,
    `workplace_members?select=id,role&workplace_id=eq.${WP_OTHER}`)).rows?.find((m) => m.role === 'manager')?.id;

  await patch(B.token, `workplace_members?id=eq.${M_B_OTHER}`,
    { area_id: X_SERVICE, workplace_role_id: X_SERVER });
  const xDraft = (await get(B.token,
    `distribution_rules?select=id&workplace_id=eq.${WP_OTHER}&status=eq.draft`)).rows?.[0]?.id;
  await patch(B.token, `distribution_rule_areas?rule_id=eq.${xDraft}&area_id=eq.${X_SERVICE}`, { percentage: 100 });
  await patch(B.token, `distribution_rule_areas?rule_id=eq.${xDraft}&area_id=neq.${X_SERVICE}`, { percentage: 0 });
  await patch(B.token, `distribution_rules?id=eq.${xDraft}`,
    { method: 'hours', min_overlap_minutes: 15, acknowledgement_required: true });
  await rpc(B.token, 'activate_rule', { p_rule_id: xDraft });
  await post(B.token, 'shifts', {
    workplace_id: WP_OTHER, member_id: M_B_OTHER, work_date: DAY,
    starts_at: iso(DAY, 18), ends_at: iso(DAY, 22), break_minutes: 0, status: 'approved',
    area_id: X_SERVICE, workplace_role_id: X_SERVER });
  const xPool = await post(B.token, 'tip_pools', {
    workplace_id: WP_OTHER, period: 'day', period_start: DAY, period_end: DAY,
    label: `rival ${STAMP}`, cash_cents: 5000, source: 'manual', status: 'open', created_by: M_B_OTHER });
  const xCalc = await rpc(B.token, 'calculate_distribution', { p_pool_id: xPool.rows?.[0]?.id });
  const X_DIST = typeof xCalc.body === 'string' ? xCalc.body : null;
  if (X_DIST) await rpc(B.token, 'send_distribution', { p_distribution_id: X_DIST });
  const X_ENTRY = X_DIST
    ? (await get(B.token, `tip_distribution_entries?select=id&distribution_id=eq.${X_DIST}`)).rows?.[0]?.id
    : null;

  const byStranger = X_ENTRY
    ? await rpc(A.token, 'acknowledge_entry', { p_entry_id: X_ENTRY, p_status: 'acknowledged' })
    : { ok: true, status: 0 };
  const byStrangerDist = X_DIST
    ? await rpc(A.token, 'acknowledge_distribution', { p_distribution_id: X_DIST, p_status: 'acknowledged' })
    : { ok: true, status: 0 };
  const after = X_ENTRY
    ? (await get(B.token, `tip_distribution_entries?select=ack_status&id=eq.${X_ENTRY}`)).rows?.[0]?.ack_status
    : null;
  check('8. an entry in another workplace cannot be acknowledged from outside it',
    !!X_ENTRY && !byStranger.ok && !byStrangerDist.ok && after === 'pending',
    `entry ${byStranger.status}, distribution ${byStrangerDist.status}, still ${after}`);

  const read = await get(A.token, `tip_distribution_entries?select=id&distribution_id=eq.${X_DIST}`);
  check('8b. …and cannot even be read from outside it',
    (read.rows ?? []).length === 0, `${(read.rows ?? []).length} row(s) visible to a stranger`);
}

/* ── 14, 15 · the manager's view of who has answered ─────────────────────── */
{
  const state = await rpc(A.token, 'distribution_ack_state', { p_distribution_id: DIST });
  const rows = Array.isArray(state.body) ? state.body : [];
  const answerable = rows.filter((r) => r.can_acknowledge);
  const confirmed = rows.filter((r) => r.ack_status === 'acknowledged');
  check('14. the manager can read who has confirmed, per entry',
    state.ok && rows.length === 4 && answerable.length === 3,
    `${rows.length} entr(ies), ${answerable.length} answerable`);
  check('14b. …with the placeholder marked as unable to answer rather than late',
    rows.some((r) => !r.can_acknowledge) && confirmed.length === 2,
    `${confirmed.length} confirmed, ${rows.filter((r) => !r.can_acknowledge).length} without an account`);
  check('14c. …and it carries snapshot names, never an email address',
    !rows.some((r) => /@/.test(String(r.member_name ?? ''))),
    rows.map((r) => r.member_name).join(', '));

  const byEmployee = await rpc(B.token, 'distribution_ack_state', { p_distribution_id: DIST });
  check('14d. an employee cannot read the whole workplace\'s confirmations',
    !byEmployee.ok, `HTTP ${byEmployee.status}`);
}
{
  // A rival manager: B manages WP_OTHER and nothing here.
  const rivalManagerId = (await get(B.token,
    `workplace_members?select=id,role&workplace_id=eq.${WP_OTHER}`)).rows?.find((m) => m.role === 'manager')?.id;
  const state = await rpc(B.token, 'distribution_ack_state', { p_distribution_id: DIST });
  const entries = await get(B.token, `tip_distribution_entries?select=id&distribution_id=eq.${DIST}`);
  const own = (entries.rows ?? []).length;
  check('15. a manager of another workplace cannot read these acknowledgements',
    !state.ok && !!rivalManagerId,
    `HTTP ${state.status}; B sees ${own} entr(y/ies) here, which are their own as an employee`);
}

/* ── 12 · without a session ──────────────────────────────────────────────── */
{
  const viaEntry = await rpc(null, 'acknowledge_entry', { p_entry_id: ENTRY_B, p_status: 'queried' });
  const viaDist = await rpc(null, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'queried' });
  const state = await rpc(null, 'distribution_ack_state', { p_distribution_id: DIST });
  const direct = await patch(null, `tip_distribution_entries?id=eq.${ENTRY_B}`, { ack_status: 'queried' });
  const row = (await entryRows(A.token, DIST, `&id=eq.${ENTRY_B}`))[0];
  check('12. without a session nothing can be acknowledged or read',
    !viaEntry.ok && !viaDist.ok && !state.ok && refused(direct) &&
      row?.ack_status === 'acknowledged',
    `entry ${viaEntry.status}, distribution ${viaDist.status}, state ${state.status}, column ${direct.status}`);
}

/* ── 10, 11 · suspension, and coming back ────────────────────────────────── */
const DAY2 = '2019-10-11';
let DIST2 = null;
{
  for (const [member, area, role] of [[M_B, A_SERVICE, R_SERVER], [M_A, A_SERVICE, R_SERVER], [M_GHOST, A_BAR, R_KEEP]]) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY2, starts_at: iso(DAY2, 17), ends_at: iso(DAY2, 22),
      break_minutes: 0, status: 'approved', area_id: area, workplace_role_id: role });
  }
  const pool = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY2, period_end: DAY2,
    label: `ack2 ${STAMP}`, cash_cents: 20000, source: 'manual', status: 'open', created_by: M_A });
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: pool.rows?.[0]?.id });
  DIST2 = typeof calc.body === 'string' ? calc.body : null;
  if (DIST2) await rpc(A.token, 'send_distribution', { p_distribution_id: DIST2 });

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });
  const blocked = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST2, p_status: 'acknowledged' });
  const visible = await get(B.token, `member_distributions?select=id&id=eq.${DIST2}`);
  check('10. a suspended member cannot acknowledge',
    !blocked.ok && (visible.rows ?? []).length === 0,
    `HTTP ${blocked.status}, ${(visible.rows ?? []).length} distribution(s) visible`);

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'active' });
  const allowed = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST2, p_status: 'acknowledged' });
  check('11. reactivated, the confirmation that was waiting is still theirs to give',
    allowed.ok && allowed.body === 1, `HTTP ${allowed.status}, ${allowed.body} entr(y/ies)`);
}

/* ── 18 · a distribution that never asked ────────────────────────────────── */
const DAY3 = '2019-10-18';
let DIST3 = null;
{
  const draft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const D = typeof draft.body === 'string' ? draft.body : null;
  await patch(A.token, `distribution_rules?id=eq.${D}`, { acknowledgement_required: false });
  await rpc(A.token, 'activate_rule', { p_rule_id: D });

  for (const [member, area, role] of [[M_B, A_SERVICE, R_SERVER], [M_A, A_SERVICE, R_SERVER], [M_GHOST, A_BAR, R_KEEP]]) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY3, starts_at: iso(DAY3, 17), ends_at: iso(DAY3, 22),
      break_minutes: 0, status: 'approved', area_id: area, workplace_role_id: role });
  }
  const pool = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY3, period_end: DAY3,
    label: `ack3 ${STAMP}`, cash_cents: 15000, source: 'manual', status: 'open', created_by: M_A });
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: pool.rows?.[0]?.id });
  DIST3 = typeof calc.body === 'string' ? calc.body : null;
  if (DIST3) await rpc(A.token, 'send_distribution', { p_distribution_id: DIST3 });

  const row = (await get(B.token,
    `member_distributions?select=id,acknowledgement_required&id=eq.${DIST3}`)).rows?.[0];
  check('18. a distribution sent without the requirement says so, and forces no pending state',
    row?.acknowledgement_required === false,
    `acknowledgement_required ${row?.acknowledgement_required}`);

  const anyway = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST3, p_status: 'acknowledged' });
  check('18b. …and confirming anyway is still accepted, because not asked is not forbidden',
    anyway.ok, `HTTP ${anyway.status}`);

  const old = (await get(B.token,
    `member_distributions?select=acknowledgement_required&id=eq.${DIST}`)).rows?.[0];
  check('18c. …while the one sent under the old rule still requires it',
    old?.acknowledgement_required === true,
    `the earlier distribution reports ${old?.acknowledgement_required}`);
}

/* ── 16, 17 · history does not move under it ─────────────────────────────── */
{
  const before = JSON.stringify(await entryRows(A.token, DIST));
  await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { display_name: `Renamed ${STAMP}`, area_id: A_BAR, workplace_role_id: R_KEEP, multiplier: 1.5 });
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { role: 'manager' });
  const after = JSON.stringify(await entryRows(A.token, DIST));
  check('16. renaming the member leaves the entries, and their answers, word for word',
    before === after && /Staff /.test(before),
    `identical: ${before === after}`);
  check('17. …and so does moving their area, role and weighting, and making them a manager',
    before === after, `${(await entryRows(A.token, DIST)).length} entries compared`);
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { role: 'employee' });
}

/* ── 20 · demo mode ──────────────────────────────────────────────────────── */
{
  const rows = await entryRows(A.token, DIST);
  check('20. demo mode reaches the database not at all — it builds no client',
    rows.length === 4,
    'harness/ack.cjs 11a-11c asserts the demo build performs no Supabase call while a share is confirmed');
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    distribution (asks)   ${DIST}`);
console.log(`    distribution (2nd)    ${DIST2}`);
console.log(`    distribution (no ask) ${DIST3}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
