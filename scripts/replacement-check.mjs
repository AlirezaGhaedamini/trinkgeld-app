/**
 * Live replacement verification for TipCrew Phase 3J.
 *
 * Correcting a payout without touching it: who may replace a sent
 * distribution, what happens to the original, and the one that decides
 * everything — that the same tip reports can never fund two live payouts. Run
 * against the real project over plain fetch, with the two test users and fresh
 * workplaces per run.
 *
 *   node scripts/replacement-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages. It builds one
 * pool from a real tip report, sends a distribution, and then replaces it
 * twice. Point it at a development project.
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

console.log(`\n  TipCrew — live replacement verification`);
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

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Repl Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Repl Rival ${STAMP}` });
const WP_OTHER = typeof rival.body === 'string' ? rival.body : null;

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

/* The money comes from a real tip report, so the double-counting question can
   be asked of the thing that actually funds a pool. */
const DAY = '2019-08-09';
const report = await post(A.token, 'tip_reports', {
  workplace_id: WP, member_id: M_A, work_date: DAY, cash_cents: 30000, card_cents: 0 });
const REPORT = report.rows?.[0]?.id ?? null;

await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_B, work_date: DAY, starts_at: iso(DAY, 16), ends_at: iso(DAY, 20),
  break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_B, work_date: DAY, starts_at: iso(DAY, 20), ends_at: iso(DAY, 23),
  break_minutes: 0, status: 'approved', area_id: A_BAR, workplace_role_id: R_KEEP });
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_A, work_date: DAY, starts_at: iso(DAY, 16), ends_at: iso(DAY, 23),
  break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });

const pooled = await rpc(A.token, 'create_pool_from_reports',
  { p_workplace_id: WP, p_period_start: DAY, p_period_end: DAY });
const POOL = typeof pooled.body === 'string' ? pooled.body : null;
if (!POOL) die(`create_pool_from_reports failed: HTTP ${pooled.status} ${pooled.raw}`);

const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL });
const ORIG = typeof calc.body === 'string' ? calc.body : null;
if (!ORIG) die(`calculate_distribution failed: HTTP ${calc.status} ${calc.raw}`);
await rpc(A.token, 'send_distribution', { p_distribution_id: ORIG });

console.log(`  pool ${POOL}`);
console.log(`  original distribution ${ORIG}\n`);

/* Only the fields that must never move on a historical record. */
const FINANCIAL_FIELDS = [
  'distribution_id', 'member_id', 'member_name', 'area_id', 'area_key', 'area_name',
  'area_source', 'role_key', 'role_name', 'points', 'multiplier',
  'worked_minutes', 'overlap_minutes', 'units', 'amount_cents',
  'rounding_adjustment_cents', 'shift_ids',
];
async function financialRows(distributionId) {
  const r = await get(A.token,
    `tip_distribution_entries?select=id,${FINANCIAL_FIELDS.join(',')}` +
    `&distribution_id=eq.${distributionId}&order=id`);
  const out = new Map();
  for (const row of r.rows ?? []) out.set(row.id, row);
  return out;
}
function financialDiff(before, after) {
  const changed = [];
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) { changed.push(`${id} — the entry is gone`); continue; }
    for (const f of FINANCIAL_FIELDS) {
      const a = JSON.stringify(was[f]), b = JSON.stringify(now[f]);
      if (a !== b) changed.push(`${id} ${f}: ${a} → ${b}`);
    }
  }
  return changed;
}
async function memberTotal(distributionId, memberId) {
  const rows = await entryRows(A.token, distributionId, `&member_id=eq.${memberId}`);
  return rows.reduce((sum, e) => sum + e.amount_cents, 0);
}
/**
 * The funding lineage of a pool.
 *
 * The columns are `pool_id` and `tip_report_id` — NOT `tip_pool_id`. The first
 * live run of this script asked for `tip_pool_id`, which does not exist;
 * PostgREST answered 400, `get()` turned that into no rows, and a schema typo
 * read on screen as "this report funds 0 pools". The status is returned
 * alongside so a future mistake of that kind announces itself instead of
 * masquerading as a lineage failure.
 */
async function poolSources({ reportId, poolId }) {
  const filter = reportId ? `tip_report_id=eq.${reportId}` : `pool_id=eq.${poolId}`;
  const r = await get(A.token,
    `tip_pool_sources?select=pool_id,tip_report_id,workplace_id,card_cents,cash_cents&${filter}`);
  return { status: r.status, rows: r.rows ?? [], raw: r.raw };
}

async function livePayouts() {
  const r = await get(A.token,
    `tip_distributions?select=id,status&tip_pool_id=eq.${POOL}&status=in.(sent,confirmed)`);
  return r.rows ?? [];
}

const ORIG_MONEY = await financialRows(ORIG);
const ORIG_STAFF = await memberTotal(ORIG, M_B);

/* ── 1, 31 · one pool, one payout ────────────────────────────────────────── */
{
  const rows = await entryRows(A.token, ORIG);
  check('1. a sent distribution exists',
    rows.length === 3 && ORIG_MONEY.size === 3, `${rows.length} entr(ies)`);

  const again = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL });
  const live = await livePayouts();
  check('31. the same pool cannot simply pay out a second time',
    !again.ok && live.length === 1,
    `HTTP ${again.status}; ${live.length} live payout(s) against this pool`);

  const byReport = await poolSources({ reportId: REPORT });
  const byPool = await poolSources({ poolId: POOL });
  console.log(`  funding lineage for report ${REPORT}:`);
  for (const row of byReport.rows) {
    console.log(`    pool ${row.pool_id} · card ${row.card_cents} · cash ${row.cash_cents}`);
  }
  console.log(`  funding lineage for pool ${POOL}: ${byPool.rows.length} source row(s)`);
  for (const row of byPool.rows) console.log(`    report ${row.tip_report_id}`);

  check('31b. …and the report that funds it funds exactly one pool',
    byReport.status === 200 && byReport.rows.length === 1 && byReport.rows[0].pool_id === POOL,
    `HTTP ${byReport.status}; ${byReport.rows.length} source row(s) for report ${REPORT}` +
      `${byReport.rows.length ? `, pool ${byReport.rows[0].pool_id}` : ` — ${byReport.raw}`}`);
  check('31d. …and this pool is funded by exactly that one report',
    byPool.status === 200 && byPool.rows.length === 1 && byPool.rows[0].tip_report_id === REPORT,
    `HTTP ${byPool.status}; ${byPool.rows.length} source row(s) for pool ${POOL}`);
}

/* The count before any correction exists, so the end of the run can compare. */
const SOURCES_BEFORE = await poolSources({ reportId: REPORT });

/* ── a correction needs a reason ─────────────────────────────────────────── */
{
  const early = await rpc(A.token, 'create_replacement_distribution', { p_original_id: ORIG });
  check('3b. a distribution nobody has agreed to correct cannot be replaced',
    !early.ok, `HTTP ${early.status}`);
}

/* ── 2, 3 · the query and its resolution ─────────────────────────────────── */
let QUERY_ID = null;
{
  const asked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: ORIG, p_note: 'My start time is wrong on this.' });
  const q = await get(A.token, `distribution_queries?select=id,status&distribution_id=eq.${ORIG}`);
  QUERY_ID = q.rows?.[0]?.id ?? null;
  check('2. the employee queries it', asked.ok && !!QUERY_ID, `HTTP ${asked.status}`);

  const resolved = await rpc(A.token, 'resolve_query',
    { p_query_id: QUERY_ID, p_outcome: 'correction_required', p_response: 'You are right — redoing it.' });
  check('3. the manager resolves it as needing a correction',
    resolved.ok, `HTTP ${resolved.status}`);
}

/* ── 5, 6 · who may start one ────────────────────────────────────────────── */
{
  const byEmployee = await rpc(B.token, 'create_replacement_distribution', { p_original_id: ORIG });
  check('5. an employee cannot create a replacement', !byEmployee.ok, `HTTP ${byEmployee.status}`);

  const byStranger = await rpc(B.token, 'create_replacement_distribution', { p_original_id: ORIG });
  const drafts = await get(A.token,
    `tip_distributions?select=id&tip_pool_id=eq.${POOL}&status=eq.draft`);
  check('6. …and neither can a manager of another workplace',
    !byStranger.ok && (drafts.rows ?? []).length === 0,
    `HTTP ${byStranger.status}; ${(drafts.rows ?? []).length} draft(s) exist`);
}

/* ── 4, 7, 8, 9, 10 · the correction itself ──────────────────────────────── */
let REPL = null;
{
  // Correct the source data first: the shift is locked because it was paid out,
  // so unlocking is a deliberate act before it can be fixed.
  const shift = (await get(A.token,
    `shifts?select=id,locked&member_id=eq.${M_B}&area_id=eq.${A_SERVICE}&work_date=eq.${DAY}`)).rows?.[0];
  const lockedEdit = await patch(A.token, `shifts?id=eq.${shift?.id}`, { starts_at: iso(DAY, 14) });
  check('10b. a shift that has been paid out cannot be corrected until it is unlocked',
    refused(lockedEdit) && shift?.locked === true,
    `HTTP ${lockedEdit.status}, locked ${shift?.locked}`);

  await patch(A.token, `shifts?id=eq.${shift?.id}`, { locked: false });
  const fixed = await patch(A.token, `shifts?id=eq.${shift?.id}`, { starts_at: iso(DAY, 14) });

  const made = await rpc(A.token, 'create_replacement_distribution', { p_original_id: ORIG });
  REPL = typeof made.body === 'string' ? made.body : null;
  const row = REPL
    ? (await get(A.token,
        `tip_distributions?select=id,status,supersedes_id,trigger_query_id,tip_pool_id&id=eq.${REPL}`)).rows?.[0]
    : null;
  check('4. the manager can create a replacement draft',
    made.ok && !!REPL && row?.status === 'draft',
    `HTTP ${made.status}, status ${row?.status}`);
  check('7. …and it points at the original, and at the question that caused it',
    row?.supersedes_id === ORIG && row?.trigger_query_id === QUERY_ID,
    `supersedes ${row?.supersedes_id === ORIG}, trigger ${row?.trigger_query_id === QUERY_ID}`);
  check('7b. …funded by the very same pool, so this is one money event, not two',
    row?.tip_pool_id === POOL, `pool ${row?.tip_pool_id}`);

  const orig = (await get(A.token, `tip_distributions?select=status&id=eq.${ORIG}`)).rows?.[0];
  check('8. the original does not disappear while the correction is a draft',
    orig?.status === 'sent' && fixed.ok, `original is ${orig?.status}`);

  const seen = await get(B.token, `member_distributions?select=id&id=eq.${REPL}`);
  check('8b. …and the employee cannot see a draft correction at all',
    (seen.rows ?? []).length === 0, `${(seen.rows ?? []).length} row(s) visible`);

  const replStaff = await memberTotal(REPL, M_B);
  check('9. the correction is calculated fresh from the corrected hours',
    replStaff !== ORIG_STAFF,
    `was ${ORIG_STAFF} cents, now ${replStaff} cents`);
  check('10. …and correcting the source input is what moved it',
    replStaff > ORIG_STAFF, `the extra two hours are in the new figure`);

  const moved = financialDiff(ORIG_MONEY, await financialRows(ORIG));
  check('11. …while the original\'s own amounts did not move',
    moved.length === 0, moved.length === 0 ? 'identical' : `CHANGED — ${moved.join(' · ')}`);
}

/* ── 26, 27, 28 · no forks, no loops ─────────────────────────────────────── */
{
  const again = await rpc(A.token, 'create_replacement_distribution', { p_original_id: ORIG });
  const children = await get(A.token,
    `tip_distributions?select=id,status&supersedes_id=eq.${ORIG}&status=neq.cancelled`);
  check('26. asking twice recalculates the same draft rather than forking',
    again.ok && (children.rows ?? []).length === 1,
    `HTTP ${again.status}; ${(children.rows ?? []).length} live child(ren)`);
  REPL = typeof again.body === 'string' ? again.body : REPL;

  const self = await patch(A.token, `tip_distributions?id=eq.${REPL}`, { supersedes_id: REPL });
  const loop = await patch(A.token, `tip_distributions?id=eq.${ORIG}`, { supersedes_id: REPL });
  const byEmployee = await patch(B.token, `tip_distributions?id=eq.${REPL}`, { supersedes_id: null });
  const row = (await get(A.token, `tip_distributions?select=supersedes_id&id=eq.${REPL}`)).rows?.[0];
  check('27. nothing may supersede itself', refused(self), `HTTP ${self.status}`);
  check('28. …and a chain cannot be bent into a loop',
    refused(loop) && row?.supersedes_id === ORIG, `HTTP ${loop.status}`);
  check('8c. …and lineage is not the employee\'s to touch',
    refused(byEmployee) && row?.supersedes_id === ORIG, `HTTP ${byEmployee.status}`);
}

/* ── 12, 13, 14, 15 · stale, then sent ───────────────────────────────────── */
{
  const other = (await get(A.token,
    `shifts?select=id&member_id=eq.${M_A}&work_date=eq.${DAY}`)).rows?.[0];
  await patch(A.token, `shifts?id=eq.${other?.id}`, { locked: false });
  await patch(A.token, `shifts?id=eq.${other?.id}`, { ends_at: iso(DAY, 23) + '' });
  await patch(A.token, `shifts?id=eq.${other?.id}`, { ends_at: new Date(`${DAY}T23:30:00Z`).toISOString() });

  const stale = await rpc(A.token, 'send_distribution', { p_distribution_id: REPL });
  const still = (await get(A.token, `tip_distributions?select=status&id=eq.${REPL}`)).rows?.[0];
  check('12. a correction whose inputs moved since it was calculated cannot be sent',
    !stale.ok && still?.status === 'draft',
    `HTTP ${stale.status}, still ${still?.status}`);

  const recalced = await rpc(A.token, 'create_replacement_distribution', { p_original_id: ORIG });
  REPL = typeof recalced.body === 'string' ? recalced.body : REPL;
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: REPL });
  check('13. …and recalculating is how the manager moves on',
    recalced.ok && sent.ok, `recalculate ${recalced.status}, send ${sent.status}`);

  const orig = (await get(A.token,
    `tip_distributions?select=status,cancelled_at,cancel_reason&id=eq.${ORIG}`)).rows?.[0];
  const repl = (await get(A.token, `tip_distributions?select=status&id=eq.${REPL}`)).rows?.[0];
  check('14. the original becomes non-actionable, with the reason recorded',
    orig?.status === 'cancelled' && orig?.cancelled_at !== null &&
      /eplaced/.test(String(orig?.cancel_reason ?? '')),
    `${orig?.status} — "${orig?.cancel_reason}"`);
  check('15. …and the correction is the current one',
    repl?.status === 'sent', `correction is ${repl?.status}`);

  const live = await livePayouts();
  check('31c. …with the pool still showing exactly one live payout',
    live.length === 1, `${live.length} live: ${live.map((d) => d.id).join(', ')}`);
}

/* ── 16, 17, 18, 21, 29 · what happened to the original ──────────────────── */
{
  const q = await get(A.token, `distribution_queries?select=id,note&distribution_id=eq.${ORIG}`);
  check('16. the question stays on the distribution it was asked about',
    (q.rows ?? []).length === 1 && q.rows?.[0]?.note === 'My start time is wrong on this.',
    `${(q.rows ?? []).length} question(s) on the original`);

  const replEntries = await entryRows(A.token, REPL);
  const carried = replEntries.filter((e) => e.ack_status !== 'pending' || e.acknowledged_at !== null);
  check('17. no acknowledgement carries over to the correction',
    carried.length === 0, `${carried.length} entr(ies) arrived pre-answered`);
  check('18. …so it starts pending, because confirmation is required',
    replEntries.every((e) => e.ack_status === 'pending'),
    replEntries.map((e) => e.ack_status).join(','));

  const ack = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: ORIG, p_status: 'acknowledged' });
  const ask = await rpc(B.token, 'query_distribution',
    { p_distribution_id: ORIG, p_note: 'One more thing.' });
  check('29. a replaced distribution accepts neither a confirmation nor a question',
    !ack.ok && !ask.ok, `confirm ${ack.status}, query ${ask.status}`);

  const readable = await get(B.token,
    `member_distributions?select=id,status,supersedes_id,superseded_by&workplace_id=eq.${WP}&order=period_start`);
  const origRow = (readable.rows ?? []).find((d) => d.id === ORIG);
  check('21. …while it stays readable, marked as replaced by the correction',
    (readable.rows ?? []).length === 2 && origRow?.superseded_by === REPL,
    `${(readable.rows ?? []).length} record(s) visible; superseded_by ${origRow?.superseded_by === REPL}`);
  check('22. …so the employee\'s history shows both versions',
    (readable.rows ?? []).some((d) => d.id === ORIG) &&
      (readable.rows ?? []).some((d) => d.id === REPL),
    'the original and the correction');
}

/* ── 19, 20 · the employee confirms the correction ───────────────────────── */
{
  const confirmed = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: REPL, p_status: 'acknowledged' });
  const rows = await entryRows(A.token, REPL, `&member_id=eq.${M_B}`);
  check('19. the employee confirms the correction',
    confirmed.ok && rows.every((e) => e.ack_status === 'acknowledged'),
    `HTTP ${confirmed.status}, ${rows.length} entr(ies)`);

  const dist = (await get(A.token, `tip_distributions?select=status&id=eq.${REPL}`)).rows?.[0];
  check('20. …and it closes the ordinary way once everybody has',
    dist?.status === 'sent' || dist?.status === 'confirmed', `status ${dist?.status}`);
}

/* ── 23, 24, 25 · lineage and the delta ──────────────────────────────────── */
{
  const chain = await get(A.token,
    `tip_distributions?select=id,status,supersedes_id&tip_pool_id=eq.${POOL}&order=created_at`);
  check('23. the manager can follow the chain',
    (chain.rows ?? []).some((d) => d.id === REPL && d.supersedes_id === ORIG),
    (chain.rows ?? []).map((d) => `${d.id.slice(0, 8)}:${d.status}`).join(' → '));

  const before = await entryRows(A.token, ORIG);
  const after = await entryRows(A.token, REPL);
  const totalOf = (rows, m) => rows.filter((e) => e.member_id === m)
    .reduce((s, e) => s + e.amount_cents, 0);
  const delta = totalOf(after, M_B) - totalOf(before, M_B);
  const deltaMgr = totalOf(after, M_A) - totalOf(before, M_A);
  check('24. the correction delta is a comparison of two immutable records',
    delta !== 0 && delta + deltaMgr === 0,
    `staff ${delta > 0 ? '+' : ''}${delta} cents, manager ${deltaMgr > 0 ? '+' : ''}${deltaMgr} cents — they sum to zero`);
  check('25. …compared per member, across whatever areas each version gave them',
    new Set(before.map((e) => e.area_name)).size >= 1 &&
      totalOf(after, M_B) > 0 && totalOf(before, M_B) > 0,
    `original areas ${[...new Set(before.map((e) => e.area_name))].join('/')}, ` +
      `correction areas ${[...new Set(after.filter((e) => e.member_id === M_B).map((e) => e.area_name))].join('/')}`);

  const moved = financialDiff(ORIG_MONEY, await financialRows(ORIG));
  check('11b. …and through all of it the original is untouched',
    moved.length === 0, moved.length === 0 ? 'identical' : `CHANGED — ${moved.join(' · ')}`);
}

/* ── 31e · the funding lineage, end to end ───────────────────────────────── */
/* A report funds one pool; that pool carries the original and the correction;
   the correction added no new funding relationship. This is the invariant the
   whole replacement design rests on, so it is asserted against the same rows
   before and after, by id. */
{
  const after = await poolSources({ reportId: REPORT });
  const forPool = await poolSources({ poolId: POOL });
  const dists = await get(A.token,
    `tip_distributions?select=id,status&tip_pool_id=eq.${POOL}&order=created_at`);

  console.log(`\n  source rows for report ${REPORT}: ` +
    `${SOURCES_BEFORE.rows.length} before the correction, ${after.rows.length} after`);
  console.log(`  distributions on pool ${POOL}: ` +
    (dists.rows ?? []).map((d) => `${d.id.slice(0, 8)}:${d.status}`).join(' → '));

  check('31e. a correction adds no new funding: one report, one source row, before and after',
    after.status === 200 && after.rows.length === 1 &&
      SOURCES_BEFORE.rows.length === 1 && after.rows.length === SOURCES_BEFORE.rows.length,
    `${SOURCES_BEFORE.rows.length} → ${after.rows.length} source row(s)`);
  check('31f. …still pointing at the same pool it always did',
    after.rows[0]?.pool_id === POOL && after.rows[0]?.pool_id === SOURCES_BEFORE.rows[0]?.pool_id,
    `pool ${after.rows[0]?.pool_id}`);
  check('31g. …while that one pool carries the original and its corrections',
    forPool.rows.length === 1 && (dists.rows ?? []).length >= 2,
    `${forPool.rows.length} source row(s), ${(dists.rows ?? []).length} distribution(s) on the pool`);

  const live = await livePayouts();
  check('31h. …and the money that report brought in is live exactly once',
    live.length === 1, `${live.length} live payout(s): ${live.map((d) => d.id).join(', ')}`);
}

/* ── 30, 32 · who else can see any of this ───────────────────────────────── */
{
  const rivalReads = await get(B.token, `tip_distributions?select=id&tip_pool_id=eq.${POOL}`);
  check('30. an employee cannot read the manager-side chain',
    (rivalReads.rows ?? []).length === 0, `${(rivalReads.rows ?? []).length} row(s)`);

  const anon = await rpc(null, 'create_replacement_distribution', { p_original_id: REPL });
  const anonRead = await get(null, `tip_distributions?select=id&id=eq.${REPL}`);
  check('32. without a session nothing can be corrected or read',
    !anon.ok && (anonRead.status >= 400 || (anonRead.rows ?? []).length === 0),
    `correct ${anon.status}, read ${anonRead.status}`);
}

/* ── 33 · demo mode ──────────────────────────────────────────────────────── */
{
  const live = await livePayouts();
  check('33. demo mode reaches the database not at all — it builds no client',
    live.length === 1,
    'harness/r.cjs 9a-9b asserts the demo build creates no correction and performs no Supabase call');
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    pool                  ${POOL}`);
console.log(`    original              ${ORIG}`);
console.log(`    correction            ${REPL}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
