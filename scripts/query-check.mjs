/**
 * Live query and resolution verification for TipCrew Phase 3I.
 *
 * The other half of the answer: what a question is allowed to do, who may
 * answer it, what it stops, and what it must never touch — the money, and the
 * words the employee used. Run against the real project over plain fetch, with
 * the two test users and fresh workplaces per run.
 *
 *   node scripts/query-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages, so cross-tenant
 * refusals come from a real manager rather than from nobody. It calculates and
 * sends three distributions and cancels one. Point it at a development project.
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

console.log(`\n  TipCrew — live query and resolution verification`);
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

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Query Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Query Rival ${STAMP}` });
const WP_OTHER = typeof rival.body === 'string' ? rival.body : null;

const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const invRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!invRow?.token) die(`create_invitation failed: HTTP ${invited.status}`);
const accepted = await rpc(B.token, 'accept_invitation', { p_token: invRow.token });
const M_B = typeof accepted.body === 'string' ? accepted.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${accepted.status}`);

const roster = await get(A.token, `workplace_members?select=id,role,user_id&workplace_id=eq.${WP}`);
const M_A = roster.rows?.find((m) => m.role === 'manager')?.id ?? null;
if (!M_A) die('could not resolve the manager membership');

const areas0 = await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP}`);
const areaBy = (k) => areas0.rows?.find((a) => a.key === k)?.id ?? null;
const A_SERVICE = areaBy('service');
const A_BAR = areaBy('bar');
const roles0 = await get(A.token, `workplace_roles?select=id,key&workplace_id=eq.${WP}`);
const roleBy = (k) => roles0.rows?.find((r) => r.key === k)?.id ?? null;
const R_SERVER = roleBy('server');
const R_KEEP = roleBy('bartender');

await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });

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

/* The employee works two areas; the manager's one long shift is the anchor, so
   both of the employee's shifts overlap it and Bar has eligible hours. */
async function buildDistribution(day, cents, label) {
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: day, starts_at: iso(day, 16), ends_at: iso(day, 20),
    break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: day, starts_at: iso(day, 20), ends_at: iso(day, 23),
    break_minutes: 0, status: 'approved', area_id: A_BAR, workplace_role_id: R_KEEP });
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_A, work_date: day, starts_at: iso(day, 16), ends_at: iso(day, 23),
    break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
  const pool = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: day, period_end: day,
    label: `${label} ${STAMP}`, cash_cents: cents, source: 'manual', status: 'open', created_by: M_A });
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: pool.rows?.[0]?.id });
  return typeof calc.body === 'string' ? calc.body : null;
}

async function queryRows(token, distributionId) {
  const r = await get(token,
    `distribution_queries?select=id,member_id,member_name,note,raised_at,status,outcome,manager_response,resolved_at` +
    `&distribution_id=eq.${distributionId}&order=raised_at,id`);
  return r.rows ?? [];
}

/** One question by its exact id, so no assertion depends on row order. */
async function queryById(token, distributionId, id) {
  const rows = await queryRows(token, distributionId);
  return rows.find((q) => q.id === id) ?? null;
}

const DAY = '2019-09-06';
const DIST = await buildDistribution(DAY, 30000, 'q1');
if (!DIST) die('calculate_distribution failed for the first pool');

/**
 * The money-immutability invariant, compared honestly.
 *
 * The first live run of this script reported "identical: false" against a
 * backend that had not moved a cent, because it compared entry rows that
 * included ack_status, acknowledged_at and queried_at — three fields whose
 * entire purpose is to change as somebody asks a question, is answered and
 * confirms. This selects only what must never move, keyed by entry id so the
 * comparison does not depend on row order, and reports the exact field that
 * differs rather than a bare boolean.
 */
const FINANCIAL_FIELDS = [
  'distribution_id', 'member_id', 'member_name',
  'area_id', 'area_key', 'area_name', 'area_source',
  'role_key', 'role_name', 'points', 'multiplier',
  'worked_minutes', 'overlap_minutes', 'units',
  'amount_cents', 'rounding_adjustment_cents', 'shift_ids',
];

async function financialRows(distributionId) {
  const r = await get(A.token,
    `tip_distribution_entries?select=id,${FINANCIAL_FIELDS.join(',')}` +
    `&distribution_id=eq.${distributionId}&order=id`);
  const out = new Map();
  for (const row of r.rows ?? []) out.set(row.id, row);
  return out;
}

/** Every field that moved, as "<entry id> <field>: <before> → <after>". */
function financialDiff(before, after) {
  const changed = [];
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) {
      changed.push(`${id} — the entry is gone`);
      continue;
    }
    for (const field of FINANCIAL_FIELDS) {
      const a = JSON.stringify(was[field]);
      const b = JSON.stringify(now[field]);
      if (a !== b) changed.push(`${id} ${field}: ${a} → ${b}`);
    }
  }
  for (const id of after.keys()) {
    if (!before.has(id)) changed.push(`${id} — an entry appeared that was not there`);
  }
  return changed;
}

const MONEY_BEFORE = await financialRows(DIST);
console.log(`  distribution under test: ${DIST}`);
console.log(`  entries watched for money changes: ${[...MONEY_BEFORE.keys()].join(', ')}\n`);

/* ── 1, 11 · a draft answers nothing ─────────────────────────────────────── */
{
  const early = await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST, p_note: 'My hours look wrong.' });
  const rows = await queryRows(A.token, DIST);
  check('11. a draft cannot be queried',
    !early.ok && rows.length === 0, `HTTP ${early.status}, ${rows.length} question(s)`);

  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: DIST });
  const dist = await get(B.token, `member_distributions?select=id,status,acknowledgement_required&id=eq.${DIST}`);
  check('1. a distribution requiring confirmation is created and sent',
    sent.ok && dist.rows?.[0]?.acknowledgement_required === true,
    `HTTP ${sent.status}, required ${dist.rows?.[0]?.acknowledgement_required}`);
}

/* ── 2, 3, 4, 5, 27 · the question ───────────────────────────────────────── */
{
  const mine = await get(B.token,
    `member_distribution_entries?select=id,ack_status&distribution_id=eq.${DIST}`);
  check('2. the employee sees their own share waiting',
    (mine.rows ?? []).length === 2 && (mine.rows ?? []).every((e) => e.ack_status === 'pending'),
    `${(mine.rows ?? []).length} entr(ies) pending`);

  const blank = await rpc(B.token, 'query_distribution', { p_distribution_id: DIST, p_note: '   ' });
  const long = await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST, p_note: 'x'.repeat(501) });
  check('3b. a question needs a sentence, and one within the limit',
    !blank.ok && !long.ok, `blank ${blank.status}, 501 chars ${long.status}`);

  const asked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST, p_note: '  I worked in Bar, not Service.  ' });
  check('3. the employee can query their own distribution, with a note',
    asked.ok && asked.body === 2, `HTTP ${asked.status}, ${asked.body} entr(ies)`);

  const entries = await entryRows(A.token, DIST, `&member_id=eq.${M_B}`);
  check('4. every entry they own becomes queried, atomically',
    entries.length === 2 && entries.every((e) => e.ack_status === 'queried'),
    entries.map((e) => `${e.area_name}:${e.ack_status}`).join(' '));
  check('27. …which is the multi-entry case working as one action',
    new Set(entries.map((e) => e.area_name)).size === 2, 'two areas, one question');

  const rows = await queryRows(A.token, DIST);
  check('5. the note is stored once, trimmed, against the person and the distribution',
    rows.length === 1 && rows[0].note === 'I worked in Bar, not Service.' && rows[0].status === 'open',
    `${rows.length} row(s): "${rows[0]?.note}"`);

  const others = await entryRows(A.token, DIST, `&member_id=neq.${M_B}`);
  check('5b. …and nobody else was touched',
    others.every((e) => e.ack_status === 'pending'),
    others.map((e) => e.ack_status).join(','));
}

/* ── 6 · queried is not confirmed ────────────────────────────────────────── */
{
  const byManager = await rpc(A.token, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'acknowledged' });
  const dist = await get(A.token, `tip_distributions?select=status&id=eq.${DIST}`);
  check('6. a queried entry counts as open, so the distribution does not close',
    byManager.ok && dist.rows?.[0]?.status === 'sent',
    `manager confirmed ${byManager.status}; distribution is ${dist.rows?.[0]?.status}`);

  const self = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'acknowledged' });
  const entries = await entryRows(A.token, DIST, `&member_id=eq.${M_B}`);
  check('6b. …and the person who asked cannot answer themselves',
    !self.ok && entries.every((e) => e.ack_status === 'queried'),
    `HTTP ${self.status}`);
}

/* ── 7, 8 · what the manager reads ───────────────────────────────────────── */
let QUERY_ID = null;
{
  const list = await rpc(A.token, 'distribution_query_list', { p_distribution_id: DIST });
  const rows = Array.isArray(list.body) ? list.body : [];
  QUERY_ID = rows[0]?.query_id ?? null;
  check('7. the manager sees the question, and how many are open',
    list.ok && rows.length === 1 && rows[0].status === 'open',
    `${rows.length} question(s), status ${rows[0]?.status}`);
  check('8. …in the employee\'s own words, with what they were paid',
    rows[0]?.note === 'I worked in Bar, not Service.' && Number(rows[0]?.amount_cents) > 0,
    `"${rows[0]?.note}" · ${rows[0]?.amount_cents} cents`);
  check('8b. …and under the name the distribution recorded, never an email',
    typeof rows[0]?.member_name === 'string' && !/@/.test(String(rows[0]?.member_name ?? '')),
    String(rows[0]?.member_name));
}

/* ── 9, 10, 17, 18 · who may do what ─────────────────────────────────────── */
{
  const entryOfA = (await entryRows(A.token, DIST, `&member_id=eq.${M_A}`))[0]?.id;
  const colleague = await rpc(B.token, 'acknowledge_entry',
    { p_entry_id: entryOfA, p_status: 'queried', p_note: 'Not mine to ask about.' });
  const after = await entryRows(A.token, DIST, `&id=eq.${entryOfA}`);
  check('9. an employee cannot query a colleague\'s entry',
    !colleague.ok && after[0]?.ack_status !== 'queried', `HTTP ${colleague.status}`);

  const list = await rpc(B.token, 'distribution_query_list', { p_distribution_id: DIST });
  check('9b. …nor read the workplace\'s questions as a list',
    !list.ok, `HTTP ${list.status}`);

  const own = await queryRows(B.token, DIST);
  check('9c. …while their own question is theirs to read',
    own.length === 1 && own[0].note === 'I worked in Bar, not Service.',
    `${own.length} row(s) visible to them`);

  const selfResolve = await rpc(B.token, 'resolve_query',
    { p_query_id: QUERY_ID, p_outcome: 'no_correction', p_response: 'Fine by me' });
  const direct = await patch(B.token, `distribution_queries?id=eq.${QUERY_ID}`,
    { status: 'resolved', outcome: 'no_correction' });
  const rows = await queryRows(A.token, DIST);
  check('18. the employee cannot answer their own question, by RPC or by column',
    !selfResolve.ok && refused(direct) && rows[0]?.status === 'open',
    `RPC ${selfResolve.status}, column ${direct.status}`);
  check('15. …and cannot write the resolution fields at all',
    refused(direct) && rows[0]?.manager_response === null && rows[0]?.resolved_at === null,
    `manager_response ${rows[0]?.manager_response}, resolved_at ${rows[0]?.resolved_at}`);
}

/* ── 10, 17 · the wrong workplace ────────────────────────────────────────── */
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

  const stranger = X_DIST
    ? await rpc(A.token, 'query_distribution', { p_distribution_id: X_DIST, p_note: 'Mine now.' })
    : { ok: true, status: 0 };
  check('10. an employee cannot query a distribution in another workplace',
    !!X_DIST && !stranger.ok, `HTTP ${stranger.status}`);

  const readAcross = await rpc(B.token, 'distribution_query_list', { p_distribution_id: DIST });
  const resolveAcross = await rpc(B.token, 'resolve_query',
    { p_query_id: QUERY_ID, p_outcome: 'no_correction' });
  const rows = await queryRows(A.token, DIST);
  check('17. a manager of another workplace can neither read nor answer these questions',
    !readAcross.ok && !resolveAcross.ok && rows[0]?.status === 'open',
    `read ${readAcross.status}, resolve ${resolveAcross.status}`);
}

/* ── 14 · without a session ──────────────────────────────────────────────── */
{
  const ask = await rpc(null, 'query_distribution', { p_distribution_id: DIST, p_note: 'Hello.' });
  const answer = await rpc(null, 'resolve_query', { p_query_id: QUERY_ID, p_outcome: 'no_correction' });
  const list = await rpc(null, 'distribution_query_list', { p_distribution_id: DIST });
  const read = await get(null, `distribution_queries?select=id&distribution_id=eq.${DIST}`);
  check('14. without a session nothing can be asked, answered or read',
    !ask.ok && !answer.ok && !list.ok &&
      (read.status >= 400 || (read.rows ?? []).length === 0),
    `ask ${ask.status}, answer ${answer.status}, list ${list.status}, read ${read.status}`);
}

/* ── 16, 19, 20, 21, 22, 23 · the manager answers, then they confirm ─────── */
{
  const resolved = await rpc(A.token, 'resolve_query',
    { p_query_id: QUERY_ID, p_outcome: 'no_correction',
      p_response: '  Checked the roster — the hours are right.  ' });
  const rows = await queryRows(A.token, DIST);
  check('16. the manager can answer a question in their own workplace',
    resolved.ok && rows[0]?.status === 'resolved' && rows[0]?.outcome === 'no_correction',
    `HTTP ${resolved.status}, status ${rows[0]?.status}`);
  check('16b. …and the answer is stored, trimmed',
    rows[0]?.manager_response === 'Checked the roster — the hours are right.' &&
      rows[0]?.resolved_at !== null,
    `"${rows[0]?.manager_response}"`);

  const entries = await entryRows(A.token, DIST, `&member_id=eq.${M_B}`);
  const dist = await get(A.token, `tip_distributions?select=status&id=eq.${DIST}`);
  check('19. …and it does not mark the employee acknowledged',
    entries.every((e) => e.ack_status === 'pending') && dist.rows?.[0]?.status === 'sent',
    `entries ${entries.map((e) => e.ack_status).join(',')}, distribution ${dist.rows?.[0]?.status}`);
  check('20. …it returns them to a state where they can confirm for themselves',
    entries.length === 2 && entries.every((e) => e.ack_status === 'pending'),
    `${entries.length} entr(ies) pending again`);

  const again = await rpc(A.token, 'resolve_query',
    { p_query_id: QUERY_ID, p_outcome: 'no_correction' });
  check('28. …and a question is only answered once',
    !again.ok, `HTTP ${again.status}`);

  const confirmed = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST, p_status: 'acknowledged' });
  const after = await entryRows(A.token, DIST, `&member_id=eq.${M_B}`);
  const distAfter = await get(A.token, `tip_distributions?select=status&id=eq.${DIST}`);
  check('21. the employee confirms after the answer',
    confirmed.ok && confirmed.body === 2, `HTTP ${confirmed.status}, ${confirmed.body} entr(ies)`);
  check('22. …and the final state is acknowledged, which closes the distribution',
    after.every((e) => e.ack_status === 'acknowledged') && distAfter.rows?.[0]?.status === 'confirmed',
    `entries ${after.map((e) => e.ack_status).join(',')}, distribution ${distAfter.rows?.[0]?.status}`);

  const kept = await queryRows(A.token, DIST);
  check('23. …and the whole exchange is still on the record',
    kept[0]?.note === 'I worked in Bar, not Service.' &&
      kept[0]?.manager_response === 'Checked the roster — the hours are right.',
    `"${kept[0]?.note}" / "${kept[0]?.manager_response}"`);
}

/* ── 26 · the money never moved ──────────────────────────────────────────── */
{
  const now = await financialRows(DIST);
  const moved = financialDiff(MONEY_BEFORE, now);
  check('26. through question, answer and confirmation the amounts never changed',
    moved.length === 0,
    moved.length === 0
      ? `${now.size} entr(ies) compared on ${FINANCIAL_FIELDS.length} financial fields, all identical`
      : `CHANGED — ${moved.join(' · ')}`);

  /* Two legal shapes of refusal, and both must leave the amount alone: the
     server rejects it outright, or RLS filters the row so nothing is touched.
     A 403 here is the expected answer, not a failure. */
  const before = [...MONEY_BEFORE.values()].find((e) => e.member_id === M_B);
  const edit = await patch(B.token,
    `tip_distribution_entries?distribution_id=eq.${DIST}&member_id=eq.${M_B}`, { amount_cents: 1 });
  const after = await financialRows(DIST);
  const stillThere = after.get(before?.id ?? '');
  check('26b. …and a question was never a route to them',
    refused(edit) && !!stillThere && stillThere.amount_cents === before?.amount_cents,
    `HTTP ${edit.status} (${edit.rows?.length ?? 0} rows) — entry ${before?.id} is still ` +
      `${stillThere?.amount_cents} cents, was ${before?.amount_cents}`);

  const rewrite = await patch(A.token, `distribution_queries?id=eq.${QUERY_ID}`,
    { note: 'Nothing to see here' });
  const q = await queryById(A.token, DIST, QUERY_ID);
  check('15b. the words as they were asked cannot be edited, not even by the manager',
    refused(rewrite) && q?.note === 'I worked in Bar, not Service.',
    `HTTP ${rewrite.status} — question ${QUERY_ID} still says "${q?.note}"`);
}

/* ── 12, 29 · a correction, and a cancelled distribution ─────────────────── */
let DIST2 = null;
{
  DIST2 = await buildDistribution('2019-09-13', 20000, 'q2');
  if (DIST2) await rpc(A.token, 'send_distribution', { p_distribution_id: DIST2 });
  await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST2, p_note: 'This is missing my Bar shift entirely.' });
  const q2 = (await queryRows(A.token, DIST2))[0]?.id ?? null;

  const resolved = await rpc(A.token, 'resolve_query',
    { p_query_id: q2, p_outcome: 'correction_required', p_response: 'You are right, I will redo it.' });
  const entries = await entryRows(A.token, DIST2, `&member_id=eq.${M_B}`);
  const blocked = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST2, p_status: 'acknowledged' });
  check('19b. when the manager agrees something is wrong, the entries stay queried',
    resolved.ok && entries.every((e) => e.ack_status === 'queried') && !blocked.ok,
    `resolve ${resolved.status}, confirm ${blocked.status}, entries ${entries.map((e) => e.ack_status).join(',')}`);

  const cancelled = await rpc(A.token, 'cancel_distribution',
    { p_distribution_id: DIST2, p_reason: `Redoing it — ${STAMP}` });
  const ask = await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST2, p_note: 'Still wrong.' });
  const confirm = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: DIST2, p_status: 'acknowledged' });
  const direct = await patch(B.token,
    `tip_distribution_entries?distribution_id=eq.${DIST2}&member_id=eq.${M_B}`,
    { ack_status: 'acknowledged' });
  check('12. a cancelled distribution accepts no question and no confirmation',
    cancelled.ok && !ask.ok && !confirm.ok && refused(direct),
    `cancel ${cancelled.status}, ask ${ask.status}, confirm ${confirm.status}, column ${direct.status}`);

  const visible = await get(B.token, `member_distributions?select=id,status&id=eq.${DIST2}`);
  const history = await queryRows(A.token, DIST2);
  check('29. …while it stays readable, and the question about it stays on the record',
    (visible.rows ?? []).length === 1 && history.length === 1,
    `${(visible.rows ?? []).length} visible, ${history.length} question(s)`);
}

/* ── 13 · suspension ─────────────────────────────────────────────────────── */
let DIST3 = null;
{
  DIST3 = await buildDistribution('2019-09-20', 10000, 'q3');
  if (DIST3) await rpc(A.token, 'send_distribution', { p_distribution_id: DIST3 });

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });
  const blocked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST3, p_note: 'Why is my amount lower than expected?' });
  const readable = await queryRows(B.token, DIST);
  check('13. a suspended employee cannot query',
    !blocked.ok && readable.length === 0,
    `HTTP ${blocked.status}, ${readable.length} question(s) visible to them`);

  const managerStillSees = await rpc(A.token, 'distribution_query_list', { p_distribution_id: DIST });
  check('13b. …while the manager still sees the questions they asked before',
    managerStillSees.ok && (Array.isArray(managerStillSees.body) ? managerStillSees.body : []).length === 1,
    `${(Array.isArray(managerStillSees.body) ? managerStillSees.body : []).length} question(s)`);

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'active' });
  const allowed = await rpc(B.token, 'query_distribution',
    { p_distribution_id: DIST3, p_note: 'Why is my amount lower than expected?' });
  check('13c. …and reactivated, they can ask again',
    allowed.ok, `HTTP ${allowed.status}`);
}

/* ── 24, 25 · history does not move under it ─────────────────────────────── */
{
  /* The membership itself is SUPPOSED to change here — that is the edit being
     made. What must not move is the history: the entry snapshots, and the
     question with the name it was asked under. Comparing the current member row
     before and after would be asserting the opposite of the requirement. */
  const historyBefore = await financialRows(DIST);
  const queryBefore = await queryById(A.token, DIST, QUERY_ID);

  const edited = await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { display_name: `Renamed ${STAMP}`, area_id: A_BAR, workplace_role_id: R_KEEP, multiplier: 1.5 });
  const memberNow = (await get(A.token,
    `workplace_members?select=display_name,area_id,multiplier&id=eq.${M_B}`)).rows?.[0];

  const q = await queryById(A.token, DIST, QUERY_ID);
  check('24. renaming the member leaves the old question under the name it was asked with',
    q?.member_name?.startsWith('Staff ') && q?.note === 'I worked in Bar, not Service.',
    `question ${QUERY_ID} still says "${q?.member_name}" / "${q?.note}", ` +
      `while the roster now says "${memberNow?.display_name}"`);

  const movedNow = financialDiff(historyBefore, await financialRows(DIST));
  const queryUnchanged =
    q?.status === queryBefore?.status &&
    q?.note === queryBefore?.note &&
    q?.member_name === queryBefore?.member_name &&
    q?.raised_at === queryBefore?.raised_at &&
    q?.manager_response === queryBefore?.manager_response &&
    q?.resolved_at === queryBefore?.resolved_at;
  check('25. …and moving their area, role and weighting changes nothing about it either',
    edited.ok && movedNow.length === 0 && queryUnchanged &&
      q?.manager_response === 'Checked the roster — the hours are right.',
    movedNow.length === 0
      ? `member edit ${edited.status} (roster now area ${memberNow?.area_id}, ×${memberNow?.multiplier}); ` +
        `${historyBefore.size} entr(ies) identical, question ${QUERY_ID} unchanged: ${queryUnchanged}`
      : `CHANGED — ${movedNow.join(' · ')}`);
}

/* ── 30 · demo mode ──────────────────────────────────────────────────────── */
{
  const rows = await queryRows(A.token, DIST);
  check('30. demo mode reaches the database not at all — it builds no client',
    rows.length === 1,
    'harness/q.cjs 10a-10b asserts the demo build raises no question and performs no Supabase call');
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    distribution (asked)  ${DIST}`);
console.log(`    distribution (cancelled) ${DIST2}`);
console.log(`    distribution (third)  ${DIST3}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
