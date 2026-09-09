/**
 * Live verification of migration 37 — a night whose money has gone out is not
 * abandoned.
 *
 * Migration 36 stopped a standalone cancellation rewriting a CLOSED period. The
 * same call in an OPEN period was still allowed, and the 3R audit measured what
 * it did: one week, one €900 night paid in full and one €400 night not, then
 *
 *     POST /rest/v1/rpc/cancel_distribution   → HTTP 204
 *
 *     before   owed €1300.00   settled €900.00   outstanding  €400.00
 *     after    owed  €400.00   settled €900.00   outstanding €-500.00
 *
 * The payment stayed effective — app.effective_payout() never looked at the
 * distribution's status — so the export kept counting it while the entitlement
 * it settled walked out of the figures, and the employee's own row still read
 * "paid" under a cancelled night.
 *
 * This script reproduces that in an open period and expects a refusal, then
 * proves the rule kept its shape: reversing the payment first lets the night go,
 * and the arithmetic lands coherently; a night that is BOTH closed and paid
 * still names the close, which is the more fundamental refusal; and a settled
 * distribution can still be CORRECTED, because corrections never went through
 * this function.
 *
 *   node scripts/paid-cancellation-check.mjs
 *
 * WHAT IT WRITES. One workplace per run, tagged with the run's timestamp, on
 * 2019 business dates. It touches nothing that already exists. Point it at a
 * development project.
 *
 * Exit 0 = every check passed. Exit 1 = a check failed. Exit 2 = it could not
 * get far enough to judge.
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
  die('That looks like a service-role key.', 'This test must run with the anon key — the point is that the guard applies to a real client.');
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

const headers = (token, extra = {}) =>
  token
    ? { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }
    : { apikey: ANON, 'Content-Type': 'application/json', ...extra };

async function call(method, token, path, payload, prefer = 'return=representation') {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: headers(token, method === 'GET' ? { Accept: 'application/json' } : { Prefer: prefer }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body, rows: Array.isArray(body) ? body : null, raw: text.slice(0, 220) };
}
const get = (t, p) => call('GET', t, p);
const post = (t, p, v) => call('POST', t, p, v);
const patch = (t, p, v) => call('PATCH', t, p, v);
const rpc = (t, n, a) => call('POST', t, `rpc/${n}`, a ?? {});

/**
 * An RPC is refused only when the server said no. Spelled out because getting
 * it wrong is how the original audit run mis-scored this very call:
 * cancel_distribution() RETURNS VOID, so PostgREST answers a SUCCESSFUL
 * cancellation with HTTP 204 and an empty body. Reading "no rows came back" as
 * "refused" reports a silent financial mutation as a boundary holding.
 */
const rpcRefused = (r) => !r.ok;

const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();
const eur = (c) => `€${(c / 100).toFixed(2)}`;

async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) die(`Could not sign in as ${email}: HTTP ${res.status}`);
  return { token: body.access_token, email };
}

console.log(`\n  TipCrew — paid-distribution cancellation guard (migration 37)`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);

const WP = (await rpc(A.token, 'create_workplace', { p_name: `Paid Cancel ${STAMP}` })).body;
if (typeof WP !== 'string') die('create_workplace failed');
const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee' });
const invRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!invRow?.token) die(`create_invitation failed: ${invited.raw}`);
const M_B = (await rpc(B.token, 'accept_invitation', { p_token: invRow.token })).body;
if (typeof M_B !== 'string') die('accept_invitation failed');

const M_A = (await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`))
  .rows.find((m) => m.role === 'manager').id;
const A_SERVICE = (await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP}`))
  .rows.find((a) => a.key === 'service').id;
const R_SERVER = (await get(A.token, `workplace_roles?select=id,key&workplace_id=eq.${WP}`))
  .rows.find((r) => r.key === 'server').id;

{
  const ruleId = (await get(A.token,
    `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows[0].id;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${ruleId}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${ruleId}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${ruleId}`,
    { method: 'hours_points', min_overlap_minutes: 15, acknowledgement_required: true });
  const activated = await rpc(A.token, 'activate_rule', { p_rule_id: ruleId });
  if (!activated.ok) die(`activate_rule failed: ${activated.raw}`);
}

/** Service takes the whole pool and one person works it, so a night's
 *  entitlement is exactly the cash reported — every total below reads by eye. */
async function night(day, cents) {
  const report = await post(A.token, 'tip_reports',
    { workplace_id: WP, member_id: M_A, work_date: day, cash_cents: cents, card_cents: 0 });
  if (!report.rows?.[0]?.id) die(`tip_reports ${day}: ${report.raw}`);
  await post(A.token, 'shifts', { workplace_id: WP, member_id: M_B, work_date: day,
    starts_at: iso(day, 16), ends_at: iso(day, 22), break_minutes: 0, status: 'approved',
    area_id: A_SERVICE, workplace_role_id: R_SERVER });
  const poolId = (await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: day, p_period_end: day })).body;
  if (typeof poolId !== 'string') die(`create_pool_from_reports ${day}`);
  const distId = (await rpc(A.token, 'calculate_distribution', { p_pool_id: poolId })).body;
  if (typeof distId !== 'string') die(`calculate_distribution ${day}`);
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: distId });
  if (!sent.ok) die(`send_distribution ${day}: ${sent.raw}`);
  return { day, poolId, distId };
}
const payFor = async (distId, note) => (await rpc(A.token, 'record_distribution_payout',
  { p_distribution_id: distId, p_method: 'cash', p_note: note })).body;

/* ── the open week under test, and a closed one beside it ─────────────────── */
const OPEN_START = '2019-05-06', OPEN_END = '2019-05-12';
const CLOSED_START = '2019-04-29', CLOSED_END = '2019-05-05';

const PAID = await night('2019-05-07', 90000);   // open week, paid in full
const UNPAID = await night('2019-05-08', 40000); // open week, never paid
const SETTLED = await night('2019-05-09', 30000); // open week, paid — the correction subject
const INCLOSE = await night('2019-05-01', 50000); // the week that gets closed, paid

const PAY_MAIN = await payFor(PAID.distId, 'paid in full');
const PAY_SETTLED = await payFor(SETTLED.distId, 'paid in full');
const PAY_CLOSED = await payFor(INCLOSE.distId, 'paid in full');
if ([PAY_MAIN, PAY_SETTLED, PAY_CLOSED].some((p) => typeof p !== 'string')) die('a payout failed');

const CLOSE = (await rpc(A.token, 'close_financial_period', {
  p_workplace_id: WP, p_period_start: CLOSED_START, p_period_end: CLOSED_END, p_note: 'reviewed' })).body;
if (typeof CLOSE !== 'string') die('close_financial_period failed');

const openWeek = async () => (await rpc(A.token, 'financial_period_export',
  { p_workplace_id: WP, p_period_start: OPEN_START, p_period_end: OPEN_END })).body;

const before = (await openWeek()).summary;
console.log(`  workplace ${WP}`);
console.log(`  open week ${OPEN_START} … ${OPEN_END}; a separate week ${CLOSED_START} … ${CLOSED_END} is closed`);
console.log(`  baseline: owed ${eur(before.current_entitlement_cents)}, settled ${eur(before.effective_settled_cents)}, `
  + `outstanding ${eur(before.outstanding_cents)}\n`);

check('1. the open week starts where it should',
  before.current_entitlement_cents === 160000 && before.effective_settled_cents === 120000
  && before.outstanding_cents === 40000,
  `owed ${before.current_entitlement_cents}, settled ${before.effective_settled_cents}, outstanding ${before.outstanding_cents}`);

/* ── the attack: abandon a night whose money has gone out ─────────────────── */
const attack = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: PAID.distId, p_reason: 'take it back' });
check('2. a sent, fully paid distribution in an OPEN period cannot be cancelled',
  rpcRefused(attack),
  `HTTP ${attack.status} ${attack.raw || '(empty body — a void RPC returning 204 is a SUCCESS)'}`);
if (!rpcRefused(attack)) {
  console.log('\n          ↑ this is the 3R defect reproducing. If migration 37 is in');
  console.log('            supabase/migrations but not yet applied to this project,');
  console.log('            apply it and run again.\n');
}
check('3. …and the refusal names the payment and the way through it',
  /paid/i.test(attack.raw) && /reverse the payment/i.test(attack.raw), attack.raw);

const paidRow = (await get(A.token,
  `tip_distributions?select=status,cancelled_at,cancel_reason&id=eq.${PAID.distId}`)).rows?.[0];
check('4. the refusal changed nothing: the distribution is still sent, and still current',
  paidRow?.status === 'sent' && paidRow?.cancelled_at === null && paidRow?.cancel_reason === null,
  JSON.stringify(paidRow));
const poolRow = (await get(A.token, `tip_pools?select=status&id=eq.${PAID.poolId}`)).rows?.[0];
check('5. …its pool is still distributed, not quietly returned to locked',
  poolRow?.status === 'distributed', JSON.stringify(poolRow));
const revRows = (await get(A.token,
  `distribution_payout_reversals?select=id&payout_id=eq.${PAY_MAIN}`)).rows;
check('6. …and the payment still stands, unreversed',
  revRows?.length === 0, `reversals ${revRows?.length}`);

const held = (await openWeek()).summary;
check('7. …so owed, settled and outstanding are all exactly where they were',
  held.current_entitlement_cents === before.current_entitlement_cents
  && held.effective_settled_cents === before.effective_settled_cents
  && held.outstanding_cents === before.outstanding_cents && held.outstanding_cents >= 0,
  `owed ${held.current_entitlement_cents}, settled ${held.effective_settled_cents}, outstanding ${held.outstanding_cents}`);

/* ── the way through: take the money back, then the night may go ──────────── */
const reversal = await rpc(A.token, 'reverse_distribution_payout',
  { p_payout_id: PAY_MAIN, p_reason: 'recorded_by_mistake', p_note: 'never actually paid' });
check('8. reversing the payment is allowed', !rpcRefused(reversal),
  `HTTP ${reversal.status} ${reversal.raw}`);
const second = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: PAID.distId, p_reason: 'abandon it' });
check('9. …and only then may the night be abandoned', !rpcRefused(second),
  `HTTP ${second.status} ${second.raw}`);
const gone = (await get(A.token,
  `tip_distributions?select=status&id=eq.${PAID.distId}`)).rows?.[0];
const lockedPool = (await get(A.token, `tip_pools?select=status&id=eq.${PAID.poolId}`)).rows?.[0];
check('10. …the distribution is cancelled and its pool returns to locked',
  gone?.status === 'cancelled' && lockedPool?.status === 'locked',
  `${JSON.stringify(gone)} ${JSON.stringify(lockedPool)}`);

const after = (await openWeek()).summary;
check('11. the week now owes only what is left, and has settled only what stands',
  after.current_entitlement_cents === 70000 && after.effective_settled_cents === 30000,
  `owed ${after.current_entitlement_cents}, settled ${after.effective_settled_cents}`);
check('12. …and outstanding is a positive number, never the negative one the audit measured',
  after.outstanding_cents === 40000 && after.outstanding_cents >= 0,
  `outstanding ${after.outstanding_cents}`);

/* ── closed AND paid: the close is the more fundamental refusal ───────────── */
const both = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: INCLOSE.distId, p_reason: 'take it back' });
check('13. a night that is both closed and paid is refused',
  rpcRefused(both), `HTTP ${both.status} ${both.raw}`);
check('14. …and the CLOSE is the reason it gives, not the payment',
  /period is closed/i.test(both.raw) && !/reverse the payment/i.test(both.raw), both.raw);

/* ── corrections never went through this function ─────────────────────────── */
const correction = await rpc(A.token, 'create_replacement_distribution',
  { p_original_id: SETTLED.distId, p_reason: 'hours', p_note: 'They stayed until closing.' });
check('15. a SETTLED distribution can still be corrected',
  !rpcRefused(correction), `HTTP ${correction.status} ${correction.raw}`);
const CORR = typeof correction.body === 'string' ? correction.body : null;
const published = CORR ? await rpc(A.token, 'send_distribution', { p_distribution_id: CORR }) : null;
const original = (await get(A.token,
  `tip_distributions?select=status&id=eq.${SETTLED.distId}`)).rows?.[0];
check('16. …and publishing it retires the paid original, which cancel_distribution() may not do',
  published !== null && !rpcRefused(published) && original?.status === 'cancelled',
  published ? `HTTP ${published.status}, original ${original?.status}` : 'no correction to publish');

const finalSummary = (await openWeek()).summary;
check('17. …with the corrected night counted once, and the week still adding up',
  finalSummary.current_entitlement_cents === 70000 && finalSummary.outstanding_cents >= 0,
  `owed ${finalSummary.current_entitlement_cents}, outstanding ${finalSummary.outstanding_cents}`);

const staff = await rpc(B.token, 'cancel_distribution',
  { p_distribution_id: UNPAID.distId, p_reason: 'mine now' });
check('18. an employee still cannot cancel anything, paid or not',
  rpcRefused(staff), `HTTP ${staff.status} ${staff.raw}`);

const unpaidCancel = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: UNPAID.distId, p_reason: 'never happened' });
check('19. an UNPAID night in an open period can still be abandoned, as it always could',
  !rpcRefused(unpaidCancel), `HTTP ${unpaidCancel.status} ${unpaidCancel.raw}`);

console.log(`\n  ─────────────────────────────────────────────────────────`);
console.log(`  ${pass} passed, ${fail} failed`);
for (const f of failed) console.log(`    · ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
console.log(`\n  fixture workplace: ${WP}\n`);
process.exit(fail === 0 ? 0 : 1);
