/**
 * Live manager-correction verification for TipCrew Phase 3K.
 *
 * A manager who finds the error themselves must be able to start the SAME
 * replacement flow an employee's question starts — one engine, one lineage,
 * one pool — without anybody fabricating a question first. This script proves
 * that against the real project over plain fetch, and finishes by proving the
 * Phase 3J employee route still behaves exactly as it did.
 *
 *   node scripts/manager-correction-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages. Inside the first
 * it builds two days, two tip reports, two pools and two sent distributions —
 * one for each door — and corrects both. Point it at a development project.
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
/**
 * A write is refused if the server rejected it, or if RLS silently filtered the
 * row so that nothing was touched. Both are the same answer to the caller: you
 * did not change that. Never infer either one from a table-wide count.
 */
const refused = (r) => !r.ok || (r.rows?.length ?? 0) === 0;

const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

console.log(`\n  TipCrew — live manager-correction verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Corr Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Corr Rival ${STAMP}` });
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

/**
 * One night, sent and paid. Built twice — one for each door — so the manager
 * route and the employee route are exercised against separate money and neither
 * can borrow the other's state.
 */
async function night(day, cashCents) {
  const report = await post(A.token, 'tip_reports', {
    workplace_id: WP, member_id: M_A, work_date: day, cash_cents: cashCents, card_cents: 0 });
  const reportId = report.rows?.[0]?.id ?? null;
  if (!reportId) die(`tip_reports insert failed for ${day}: HTTP ${report.status} ${report.raw}`);

  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: day, starts_at: iso(day, 16), ends_at: iso(day, 20),
    break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: day, starts_at: iso(day, 20), ends_at: iso(day, 23),
    break_minutes: 0, status: 'approved', area_id: A_BAR, workplace_role_id: R_KEEP });
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_A, work_date: day, starts_at: iso(day, 16), ends_at: iso(day, 23),
    break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });

  const pooled = await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: day, p_period_end: day });
  const poolId = typeof pooled.body === 'string' ? pooled.body : null;
  if (!poolId) die(`create_pool_from_reports failed for ${day}: HTTP ${pooled.status} ${pooled.raw}`);

  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: poolId });
  const distId = typeof calc.body === 'string' ? calc.body : null;
  if (!distId) die(`calculate_distribution failed for ${day}: HTTP ${calc.status} ${calc.raw}`);
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: distId });
  if (!sent.ok) die(`send_distribution failed for ${day}: HTTP ${sent.status} ${sent.raw}`);
  return { day, reportId, poolId, distId };
}

const DAY_M = '2019-08-09';   // the manager's own finding
const DAY_E = '2019-08-16';   // the employee's question
const MGR = await night(DAY_M, 30000);
const EMP = await night(DAY_E, 24000);

console.log(`  manager door:  pool ${MGR.poolId}  original ${MGR.distId}`);
console.log(`  employee door: pool ${EMP.poolId}  original ${EMP.distId}\n`);

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
/** Every lineage column of one distribution, read as the manager. */
const LINEAGE = 'id,status,tip_pool_id,supersedes_id,trigger_query_id,' +
  'correction_reason,correction_note,initiated_by,initiated_at';
async function lineageOf(id) {
  const r = await get(A.token, `tip_distributions?select=${LINEAGE}&id=eq.${id}`);
  return r.rows?.[0] ?? null;
}
async function queriesOn(distributionId) {
  const r = await get(A.token,
    `distribution_queries?select=id,status,outcome,note&distribution_id=eq.${distributionId}`);
  return r.rows ?? [];
}
async function allQueries() {
  const r = await get(A.token, `distribution_queries?select=id,distribution_id&workplace_id=eq.${WP}`);
  return r.rows ?? [];
}
/** Every draft currently sitting on a pool, by id. */
async function draftsOn(poolId) {
  const r = await get(A.token,
    `tip_distributions?select=id,correction_reason,correction_note,supersedes_id` +
    `&tip_pool_id=eq.${poolId}&status=eq.draft`);
  return r.rows ?? [];
}
async function livePayouts(poolId) {
  const r = await get(A.token,
    `tip_distributions?select=id,status&tip_pool_id=eq.${poolId}&status=in.(sent,confirmed)`);
  return r.rows ?? [];
}
async function poolSources({ reportId, poolId }) {
  const filter = reportId ? `tip_report_id=eq.${reportId}` : `pool_id=eq.${poolId}`;
  const r = await get(A.token,
    `tip_pool_sources?select=pool_id,tip_report_id,workplace_id,card_cents,cash_cents&${filter}`);
  return { status: r.status, rows: r.rows ?? [], raw: r.raw };
}
/** Unlock a paid-out shift and move its start, so the recalculation differs. */
async function moveStart(memberId, day, hour) {
  const shift = (await get(A.token,
    `shifts?select=id&member_id=eq.${memberId}&area_id=eq.${A_SERVICE}&work_date=eq.${day}`)).rows?.[0];
  await patch(A.token, `shifts?id=eq.${shift?.id}`, { locked: false });
  return patch(A.token, `shifts?id=eq.${shift?.id}`, { starts_at: iso(day, hour) });
}

const MGR_MONEY = await financialRows(MGR.distId);
const NOTE = 'The roster says Lena started at 14:00, not 16:00.';

/* ── 1-4 · who may open the manager door at all ──────────────────────────── */
{
  const rows = await financialRows(MGR.distId);
  check('1. a sent distribution exists to be corrected',
    rows.size === 3, `${rows.size} entr(ies)`);

  const byEmployee = await rpc(B.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'hours', p_note: NOTE });
  check('2. an employee cannot start a correction, reason or no reason',
    !byEmployee.ok, `HTTP ${byEmployee.status}`);

  const byRival = await rpc(B.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'tip_amount', p_note: 'Let me at it.' });
  check('3. …and neither can a manager of another workplace',
    !byRival.ok, `HTTP ${byRival.status}; rival workplace ${WP_OTHER}`);

  const anon = await rpc(null, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'hours', p_note: NOTE });
  check('4. …and without a session, nothing at all',
    !anon.ok, `HTTP ${anon.status}`);
}

/* ── 5-8 · a reason is required, and blank is not a reason ────────────────
 *
 * Each invalid request is followed immediately by a look at the pool, so that a
 * draft can be attributed to the request that made it rather than inferred from
 * a total at the end. The first live Phase 3K run reported "1 draft" here with
 * no way to tell which of the three requests had produced it — it was the
 * whitespace one, which the backend was accepting.
 */
{
  const attempts = [];
  const attempt = async (label, args) => {
    const before = await draftsOn(MGR.poolId);
    const res = await rpc(A.token, 'create_replacement_distribution',
      { p_original_id: MGR.distId, ...args });
    const after = await draftsOn(MGR.poolId);
    const seen = new Set(before.map((d) => d.id));
    const created = after.filter((d) => !seen.has(d.id));
    attempts.push({ label, res, created });
    return { res, created };
  };

  const noNote = await attempt('no explanation at all', { p_reason: 'hours' });
  check('5. a category with no explanation is refused',
    !noNote.res.ok, `HTTP ${noNote.res.status}`);

  // The exact bytes the JSON string "    \n\t  " carries: four spaces, a
  // newline, a tab, two spaces. One-argument btrim() in the database trims a
  // space and nothing else, so this survived migration 24 as a two-character
  // note and was accepted.
  const ws = await attempt('whitespace-only explanation',
    { p_reason: 'hours', p_note: '    \n\t  ' });
  check('6. …and whitespace is not an explanation',
    !ws.res.ok, `HTTP ${ws.res.status}`);

  const spaces = await attempt('spaces-only explanation',
    { p_reason: 'hours', p_note: '     ' });
  check('6b. …nor spaces alone',
    !spaces.res.ok, `HTTP ${spaces.res.status}`);

  // No-break space, narrow no-break space, zero-width space, ideographic space:
  // what a paste out of a word processor actually leaves behind.
  const invisible = await attempt('invisible-characters explanation',
    { p_reason: 'role', p_note: '\u00a0\u202f\u200b\u3000' });
  check('6c. …nor the invisible characters a paste from a word processor leaves',
    !invisible.res.ok, `HTTP ${invisible.res.status}`);

  const long = await attempt('501-character explanation',
    { p_reason: 'other', p_note: `  ${'x'.repeat(501)}\n` });
  check('7. …and an explanation longer than the column allows is refused',
    !long.res.ok, `HTTP ${long.res.status} at 501 characters after trimming`);

  const guilty = attempts.filter((a) => a.created.length > 0);
  const drafts = await draftsOn(MGR.poolId);
  check('8. …and none of those refusals left a draft behind',
    drafts.length === 0 && guilty.length === 0,
    guilty.length === 0
      ? `${drafts.length} draft(s) on the pool`
      : guilty.map((a) => `"${a.label}" (HTTP ${a.res.status}) created ` +
          a.created.map((d) => `${d.id} reason=${d.correction_reason} ` +
            `note=${JSON.stringify(d.correction_note)}`).join(' + ')).join(' · '));

  // The accepting side of the same boundary. These do create a draft, which the
  // idempotent recalculation in check 21 then replaces — so they run after
  // check 8 has had its clean look at the pool.
  const one = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'hours', p_note: ' \n\t x \r ' });
  const oneRow = typeof one.body === 'string' ? await lineageOf(one.body) : null;
  check('8b. one visible character is a reason, stored trimmed of everything around it',
    one.ok && oneRow?.correction_note === 'x',
    `HTTP ${one.status}, stored ${JSON.stringify(oneRow?.correction_note)}`);

  const five = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'rule', p_note: `  \t${'y'.repeat(500)} \n ` });
  const fiveRow = typeof five.body === 'string' ? await lineageOf(five.body) : null;
  check('8c. …and exactly 500 characters inside whitespace are accepted, and stored as 500',
    five.ok && fiveRow?.correction_note === 'y'.repeat(500),
    `HTTP ${five.status}, stored ${fiveRow?.correction_note?.length ?? '—'} character(s)`);
}

/* ── 9-18 · the correction itself ────────────────────────────────────────── */
let M_REPL = null;
{
  await moveStart(M_B, DAY_M, 14);

  const made = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'hours', p_note: `  ${NOTE}  ` });
  M_REPL = typeof made.body === 'string' ? made.body : null;
  const row = M_REPL ? await lineageOf(M_REPL) : null;

  check('9. a manager can correct a distribution nobody has questioned',
    made.ok && !!M_REPL, `HTTP ${made.status}`);
  check('10. …and what comes back is a draft, not a payout',
    row?.status === 'draft', `status ${row?.status}`);
  check('11. …pointing at the distribution it replaces',
    row?.supersedes_id === MGR.distId, `supersedes ${row?.supersedes_id}`);
  check('12. …funded by the very same pool, so this is one money event, not two',
    row?.tip_pool_id === MGR.poolId, `pool ${row?.tip_pool_id}`);

  const qs = await queriesOn(MGR.distId);
  const every = await allQueries();
  check('13. …with no question fabricated on the distribution',
    qs.length === 0, `${qs.length} question(s) on ${MGR.distId}`);
  check('14. …none anywhere in the workplace, and no question id on the row',
    every.length === 0 && row?.trigger_query_id === null,
    `${every.length} question(s) in the workplace; trigger_query_id ${row?.trigger_query_id}`);

  check('15. …carrying the category the manager chose',
    row?.correction_reason === 'hours', `reason ${row?.correction_reason}`);
  check('16. …and the explanation, trimmed of the spaces around it',
    row?.correction_note === NOTE,
    `note ${JSON.stringify(row?.correction_note)}`);
  check('17. …stamped with the actor the server derived from the session',
    row?.initiated_by === M_A && row?.initiated_at !== null,
    `initiated_by ${row?.initiated_by} (manager membership ${M_A})`);

  const forged = await patch(A.token, `tip_distributions?id=eq.${M_REPL}`,
    { initiated_by: M_B, correction_reason: 'tip_amount', correction_note: 'not mine' });
  const after = await lineageOf(M_REPL);
  check('18. …and none of that is the browser\'s to write or rewrite afterwards',
    refused(forged) && after?.initiated_by === M_A && after?.correction_reason === 'hours',
    `HTTP ${forged.status}; still ${after?.initiated_by} / ${after?.correction_reason}`);
}

/* ── 19-20 · the original stays exactly as it was sent ───────────────────── */
{
  const orig = await lineageOf(MGR.distId);
  check('19. the original is untouched while the correction is only a draft',
    orig?.status === 'sent', `original is ${orig?.status}`);

  const moved = financialDiff(MGR_MONEY, await financialRows(MGR.distId));
  check('20. …and not one figure on it moved',
    moved.length === 0, moved.length === 0 ? 'identical' : `CHANGED — ${moved.join(' · ')}`);
}

/* ── 21-22 · asking twice ────────────────────────────────────────────────── */
{
  const again = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'tip_amount', p_note: 'Actually the cash count was short.' });
  const next = typeof again.body === 'string' ? again.body : null;
  const children = await get(A.token,
    `tip_distributions?select=id,status&supersedes_id=eq.${MGR.distId}&status=neq.cancelled`);
  check('21. asking again recalculates the one draft rather than forking the chain',
    again.ok && (children.rows ?? []).length === 1,
    `HTTP ${again.status}; ${(children.rows ?? []).length} live child(ren)`);
  M_REPL = next ?? M_REPL;

  const row = await lineageOf(M_REPL);
  check('22. …and the draft carries the reason given on that call, not the first one',
    row?.correction_reason === 'tip_amount' &&
      row?.correction_note === 'Actually the cash count was short.',
    `reason ${row?.correction_reason}`);
}

/* ── 23-26 · sending it ──────────────────────────────────────────────────── */
{
  await moveStart(M_A, DAY_M, 15);
  const stale = await rpc(A.token, 'send_distribution', { p_distribution_id: M_REPL });
  const still = await lineageOf(M_REPL);
  check('23. a correction whose inputs moved since it was calculated cannot be sent',
    !stale.ok && still?.status === 'draft', `HTTP ${stale.status}, still ${still?.status}`);

  const recalced = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: MGR.distId, p_reason: 'hours', p_note: NOTE });
  M_REPL = typeof recalced.body === 'string' ? recalced.body : M_REPL;
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: M_REPL });
  const orig = await lineageOf(MGR.distId);
  const repl = await lineageOf(M_REPL);
  check('24. sending publishes the correction and retires the original in one act',
    sent.ok && repl?.status === 'sent' && orig?.status === 'cancelled' &&
      /eplaced/.test(String((await get(A.token,
        `tip_distributions?select=cancel_reason&id=eq.${MGR.distId}`)).rows?.[0]?.cancel_reason ?? '')),
    `correction ${repl?.status}, original ${orig?.status}`);

  const live = await livePayouts(MGR.poolId);
  check('25. …leaving the pool with exactly one live payout',
    live.length === 1, `${live.length} live: ${live.map((d) => d.id).join(', ')}`);

  const src = await poolSources({ reportId: MGR.reportId });
  check('26. …and the report that funded it still funds exactly one pool',
    src.status === 200 && src.rows.length === 1 && src.rows[0].pool_id === MGR.poolId,
    `HTTP ${src.status}; ${src.rows.length} source row(s)`);
}

/* ── 27-29 · what the employee gets ──────────────────────────────────────── */
{
  const entries = await get(A.token,
    `tip_distribution_entries?select=ack_status,acknowledged_at&distribution_id=eq.${M_REPL}`);
  check('27. a correction nobody asked for still asks everybody to confirm it afresh',
    (entries.rows ?? []).length > 0 &&
      (entries.rows ?? []).every((e) => e.ack_status === 'pending' && e.acknowledged_at === null),
    (entries.rows ?? []).map((e) => e.ack_status).join(','));

  const seen = await get(B.token,
    `member_distributions?select=id,supersedes_id,superseded_by,correction_reason,correction_note` +
    `&id=eq.${M_REPL}`);
  const row = seen.rows?.[0] ?? null;
  const cols = row ? Object.keys(row) : [];
  const actorLeak = await get(B.token, `member_distributions?select=initiated_by&id=eq.${M_REPL}`);
  check('28. the employee is told why it was corrected, and never by whom',
    row?.correction_reason === 'hours' && row?.correction_note === NOTE &&
      !cols.includes('initiated_by') && actorLeak.status >= 400,
    `columns ${cols.join(',')}; asking for the actor answered HTTP ${actorLeak.status}`);

  const ack = await rpc(B.token, 'acknowledge_distribution',
    { p_distribution_id: MGR.distId, p_status: 'acknowledged' });
  const ask = await rpc(B.token, 'query_distribution',
    { p_distribution_id: MGR.distId, p_note: 'One more thing.' });
  check('29. the replaced original accepts neither a confirmation nor a question',
    !ack.ok && !ask.ok, `confirm ${ack.status}, query ${ask.status}`);
}

/* ── 30 · lineage cannot be bent ─────────────────────────────────────────── */
{
  const self = await patch(A.token, `tip_distributions?id=eq.${M_REPL}`, { supersedes_id: M_REPL });
  const loop = await patch(A.token, `tip_distributions?id=eq.${MGR.distId}`, { supersedes_id: M_REPL });
  const byHand = await post(A.token, 'tip_distributions', {
    workplace_id: WP, tip_pool_id: MGR.poolId, supersedes_id: MGR.distId,
    correction_reason: 'other', correction_note: 'by hand' });
  const row = await lineageOf(M_REPL);
  check('30. lineage cannot supersede itself, loop, or be forged by hand',
    refused(self) && refused(loop) && refused(byHand) && row?.supersedes_id === MGR.distId,
    `self ${self.status}, loop ${loop.status}, insert ${byHand.status}`);
}

/* ── 31-33 · the employee route, unchanged ───────────────────────────────── */
{
  const early = await rpc(A.token, 'create_replacement_distribution', { p_original_id: EMP.distId });
  check('31. with no reason and no question, there is still nothing to correct',
    !early.ok, `HTTP ${early.status}`);

  const asked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: EMP.distId, p_note: 'My start time is wrong on this.' });
  const q = (await queriesOn(EMP.distId))[0] ?? null;
  const resolved = q
    ? await rpc(A.token, 'resolve_query',
        { p_query_id: q.id, p_outcome: 'correction_required', p_response: 'You are right.' })
    : { ok: false, status: 0 };

  const withNote = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: EMP.distId, p_note: 'Let me add my own reason too.' });
  check('32. a correction the question already explains refuses a second reason',
    !withNote.ok, `HTTP ${withNote.status}`);

  await moveStart(M_B, DAY_E, 14);
  const made = await rpc(A.token, 'create_replacement_distribution', { p_original_id: EMP.distId });
  const E_REPL = typeof made.body === 'string' ? made.body : null;
  const row = E_REPL ? await lineageOf(E_REPL) : null;
  check('33. …and the Phase 3J route still works, by its own door, with its own reason',
    asked.ok && resolved.ok && made.ok && row?.status === 'draft' &&
      row?.trigger_query_id === q?.id && row?.correction_reason === null &&
      row?.correction_note === null && row?.initiated_by === M_A,
    `question ${q?.id}; trigger ${row?.trigger_query_id}; ` +
      `reason ${row?.correction_reason}; note ${row?.correction_note}; actor ${row?.initiated_by}`);

  console.log(`\n  both doors, side by side:`);
  for (const d of [await lineageOf(M_REPL), row]) {
    if (!d) continue;
    console.log(`    ${d.id}  query ${d.trigger_query_id ?? '—'}  ` +
      `reason ${d.correction_reason ?? '—'}  actor ${d.initiated_by ?? '—'}`);
  }
  const both = (await get(A.token,
    `tip_distributions?select=id&workplace_id=eq.${WP}` +
    `&trigger_query_id=not.is.null&correction_reason=not.is.null`)).rows ?? [];
  console.log(`    rows claiming both doors at once: ${both.length}`);
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test    ${WP}`);
console.log(`    rival workplace         ${WP_OTHER}`);
console.log(`    manager-door pool       ${MGR.poolId}`);
console.log(`    manager-door original   ${MGR.distId}`);
console.log(`    manager-door correction ${M_REPL}`);
console.log(`    employee-door pool      ${EMP.poolId}`);
console.log(`    employee-door original  ${EMP.distId}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
