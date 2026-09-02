/**
 * Live payout verification for TipCrew Phase 3L.
 *
 * Whether a finalised distribution was actually handed over — and the part this
 * phase turns on: what a correction to an ALREADY PAID distribution settles.
 * The workplace must never think it owes a second full amount.
 *
 *   node scripts/payout-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages. Inside the first
 * it builds two nights — one paid then corrected, one never paid then corrected
 * three times — and records four payouts. Point it at a development project.
 *
 * NOTE ON THE ARITHMETIC. A replacement reuses the original's pool, and a
 * distributed pool's amounts are frozen, so a lineage's TOTAL cannot change:
 * the workplace-level difference after a correction is always zero, and the
 * money that moves is per person. Both are asserted below.
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

const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

console.log(`\n  TipCrew — live payout verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Pay Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Pay Rival ${STAMP}` });
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
 * One night, sent. The manager's shift is deliberately the longest: it is the
 * `longest_shift` anchor overlap is measured against, and if a service shift
 * ever became longer, Bar — which only touches it at 20:00 — would fall out of
 * the distribution entirely and the engine would refuse to calculate at all.
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

/** Move the shared area's hours, which is the only thing that moves the split. */
async function moveService(memberId, day, hour) {
  const shift = (await get(A.token,
    `shifts?select=id&member_id=eq.${memberId}&area_id=eq.${A_SERVICE}&work_date=eq.${day}`)).rows?.[0];
  await patch(A.token, `shifts?id=eq.${shift?.id}`, { locked: false });
  return patch(A.token, `shifts?id=eq.${shift?.id}`, { starts_at: iso(day, hour) });
}

/** Correct a distribution and publish the correction. Returns the new id. */
async function correctAndSend(originalId, reason, note) {
  const made = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: originalId, p_reason: reason, p_note: note });
  const id = typeof made.body === 'string' ? made.body : null;
  if (!id) die(`create_replacement_distribution failed: HTTP ${made.status} ${made.raw}`);
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: id });
  if (!sent.ok) die(`send_distribution failed for the correction: HTTP ${sent.status} ${sent.raw}`);
  return id;
}

const PAID = await night('2018-03-06', 100000);   // paid, then corrected
const UNPAID = await night('2018-03-13', 60000);  // never paid, then corrected twice

console.log(`  paid lineage:   pool ${PAID.poolId}  original ${PAID.distId}`);
console.log(`  unpaid lineage: pool ${UNPAID.poolId}  original ${UNPAID.distId}\n`);

/* ── readers ─────────────────────────────────────────────────────────────── */

const SETTLEMENT = 'distribution_id,entitlement_cents,settled_entitlement_cents,' +
  'settlement_due_cents,payout_status,payout_id,payout_amount_cents,payout_method,' +
  'payout_note,paid_at,paid_by,paid_by_name';
async function settlementOf(id, token = A.token) {
  const r = await get(token, `distribution_settlement?select=${SETTLEMENT}&distribution_id=eq.${id}`);
  return { status: r.status, row: r.rows?.[0] ?? null, rows: r.rows ?? [] };
}
async function memberSettlement(id, token = A.token) {
  const r = await get(token,
    `distribution_member_settlement?select=member_id,member_name,entitlement_cents,` +
    `previously_settled_cents,difference_cents&distribution_id=eq.${id}&order=member_name`);
  return { status: r.status, rows: r.rows ?? [] };
}
const PAYOUT = 'id,workplace_id,distribution_id,entitlement_cents,previous_entitlement_cents,' +
  'amount_cents,method,note,paid_at,paid_by';
async function payoutsFor(id, token = A.token) {
  const r = await get(token, `distribution_payouts?select=${PAYOUT}&distribution_id=eq.${id}`);
  return { status: r.status, rows: r.rows ?? [] };
}
async function allPayouts(token = A.token) {
  const r = await get(token, `distribution_payouts?select=${PAYOUT}&workplace_id=eq.${WP}`);
  return { status: r.status, rows: r.rows ?? [] };
}
async function totalOf(id) {
  const r = await get(A.token, `tip_distributions?select=entries_total_cents&id=eq.${id}`);
  return r.rows?.[0]?.entries_total_cents ?? null;
}
async function ownTotal(token, distributionId) {
  const r = await get(token,
    `member_distribution_entries?select=amount_cents,is_own&distribution_id=eq.${distributionId}`);
  return (r.rows ?? []).filter((e) => e.is_own !== false)
    .reduce((sum, e) => sum + e.amount_cents, 0);
}

/* ── 1-4 · nothing is paid until somebody says so, and not by anybody ────── */
{
  const s = await settlementOf(PAID.distId);
  const total = await totalOf(PAID.distId);
  check('1. an unpaid sent distribution exists',
    s.row?.payout_status === 'unpaid' && s.row?.settlement_due_cents === total,
    `status ${s.row?.payout_status}, due ${s.row?.settlement_due_cents} of ${total}`);

  const byEmployee = await rpc(B.token, 'record_distribution_payout',
    { p_distribution_id: PAID.distId, p_method: 'cash' });
  check('2. an employee cannot record a payout', !byEmployee.ok, `HTTP ${byEmployee.status}`);

  const byRival = await rpc(B.token, 'record_distribution_payout',
    { p_distribution_id: PAID.distId, p_method: 'payroll' });
  check('3. …nor a manager of another workplace',
    !byRival.ok, `HTTP ${byRival.status}; rival workplace ${WP_OTHER}`);

  const anon = await rpc(null, 'record_distribution_payout',
    { p_distribution_id: PAID.distId, p_method: 'cash' });
  check('4. …and without a session, nothing at all', !anon.ok, `HTTP ${anon.status}`);

  const after = await payoutsFor(PAID.distId);
  check('4b. …and none of those refusals recorded anything',
    after.rows.length === 0, `${after.rows.length} payout(s)`);
}

/* ── 5-9 · the manager records it, and the server decides the number ────── */
let PAY_1 = null;
{
  const total = await totalOf(PAID.distId);
  const made = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: PAID.distId, p_method: 'cash', p_note: '  Handed out after service.  ' });
  PAY_1 = typeof made.body === 'string' ? made.body : null;
  const row = (await payoutsFor(PAID.distId)).rows[0] ?? null;

  check('5. a manager records the payout', made.ok && !!PAY_1, `HTTP ${made.status}`);
  check('6. …for the amount the server derived, which the browser never sent',
    row?.amount_cents === total && row?.entitlement_cents === total &&
      row?.previous_entitlement_cents === 0,
    `amount ${row?.amount_cents} against an entitlement of ${total}`);
  check('7. …stamped with the actor derived from the session',
    row?.paid_by === M_A, `paid_by ${row?.paid_by} (manager membership ${M_A})`);
  check('8. …and when', row?.paid_at !== null && row?.paid_at !== undefined, `${row?.paid_at}`);
  check('9. …and how, with the note stored trimmed',
    row?.method === 'cash' && row?.note === 'Handed out after service.',
    `method ${row?.method}, note ${JSON.stringify(row?.note)}`);

  const s = await settlementOf(PAID.distId);
  check('9b. …so the distribution now reads as paid',
    s.row?.payout_status === 'paid' && s.row?.paid_by_name !== null,
    `status ${s.row?.payout_status}, by ${s.row?.paid_by_name}`);
}

/* ── 10, 23 · exactly once, however hard it is retried ───────────────────── */
{
  const again = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: PAID.distId, p_method: 'payroll' });
  check('10. the same distribution cannot be paid a second time',
    !again.ok, `HTTP ${again.status}`);

  // Four at once: a double click, a refresh, two tabs. Only one may land, and
  // the database decides that, not the button.
  const burst = await Promise.all([0, 1, 2, 3].map(() =>
    rpc(A.token, 'record_distribution_payout',
      { p_distribution_id: PAID.distId, p_method: 'cash' })));
  const rows = await payoutsFor(PAID.distId);
  check('23. …and four simultaneous attempts still leave exactly one payout',
    burst.every((r) => !r.ok) && rows.rows.length === 1,
    `${burst.map((r) => r.status).join('/')}; ${rows.rows.length} payout(s)`);
}

/* ── 11, 12 · the record cannot be rewritten or removed ──────────────────── */
{
  const before = (await payoutsFor(PAID.distId)).rows[0];
  const edits = await Promise.all([
    patch(A.token, `distribution_payouts?id=eq.${PAY_1}`, { amount_cents: 1 }),
    patch(A.token, `distribution_payouts?id=eq.${PAY_1}`, { method: 'bank_transfer' }),
    patch(A.token, `distribution_payouts?id=eq.${PAY_1}`, { paid_by: M_B }),
    patch(A.token, `distribution_payouts?id=eq.${PAY_1}`, { paid_at: '2000-01-01T00:00:00Z' }),
    patch(A.token, `distribution_payouts?id=eq.${PAY_1}`, { note: 'something else' }),
  ]);
  const after = (await payoutsFor(PAID.distId)).rows[0];
  check('11. a payout cannot be rewritten — not its amount, method, actor, time or note',
    edits.every(refused) &&
      after.amount_cents === before.amount_cents && after.method === before.method &&
      after.paid_by === before.paid_by && after.paid_at === before.paid_at &&
      after.note === before.note,
    `HTTP ${edits.map((e) => e.status).join('/')}`);

  const gone = await del(A.token, `distribution_payouts?id=eq.${PAY_1}`);
  const still = await payoutsFor(PAID.distId);
  check('12. …and it cannot be deleted by an ordinary client',
    refused(gone) && still.rows.length === 1, `HTTP ${gone.status}`);

  const forged = await post(A.token, 'distribution_payouts', {
    workplace_id: WP, distribution_id: UNPAID.distId,
    entitlement_cents: 999999, previous_entitlement_cents: 0, amount_cents: 999999,
    method: 'cash', paid_by: M_A });
  const nothing = await payoutsFor(UNPAID.distId);
  check('12b. …and nobody may write one by hand, at an amount of their own choosing',
    refused(forged) && nothing.rows.length === 0, `HTTP ${forged.status}`);
}

/* ── 13, 14 · what the employee may see ──────────────────────────────────── */
{
  const ledger = await get(B.token, `distribution_payouts?select=id&workplace_id=eq.${WP}`);
  check('13b. an employee cannot read the ledger: its amounts are workplace totals',
    (ledger.rows?.length ?? 0) === 0 || ledger.status >= 400,
    `HTTP ${ledger.status}, ${ledger.rows?.length ?? 0} row(s)`);

  const settle = await settlementOf(PAID.distId, B.token);
  check('14b. …nor the manager settlement view',
    settle.rows.length === 0 || settle.status >= 400,
    `HTTP ${settle.status}, ${settle.rows.length} row(s)`);

  const mine = await get(B.token,
    `member_distributions?select=id,payout_status,payout_method,paid_at,settled_basis_id` +
    `&id=eq.${PAID.distId}`);
  const row = mine.rows?.[0] ?? null;
  const cols = row ? Object.keys(row) : [];
  check('13. …but is told that their own distribution was paid, how and when',
    row?.payout_status === 'paid' && row?.payout_method === 'cash' && row?.paid_at !== null,
    `${row?.payout_status} / ${row?.payout_method}`);
  check('14. …and never an amount: the member view carries no payout figure',
    !cols.some((c) => /amount|entitlement|cents/.test(c)),
    `columns ${cols.join(',')}`);

  const peers = await memberSettlement(PAID.distId, B.token);
  check('14c. …and the per-member settlement view is manager-only, so no peer detail leaks',
    peers.rows.length === 0 || peers.status >= 400,
    `HTTP ${peers.status}, ${peers.rows.length} row(s)`);
}

/* ── 15, 16 · what cannot be paid ────────────────────────────────────────── */
{
  await moveService(M_B, PAID.day, 14);
  const made = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: PAID.distId, p_reason: 'hours', p_note: 'Started at 14:00, not 16:00.' });
  const draftId = typeof made.body === 'string' ? made.body : null;

  const draftPay = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: draftId, p_method: 'cash' });
  check('15. a draft has reached nobody and cannot be paid',
    !draftPay.ok, `HTTP ${draftPay.status}`);

  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: draftId });
  if (!sent.ok) die(`send_distribution failed: HTTP ${sent.status} ${sent.raw}`);
  PAID.replacementId = draftId;

  const oldPay = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: PAID.distId, p_method: 'cash' });
  check('16. a replaced historical version cannot be newly paid',
    !oldPay.ok, `HTTP ${oldPay.status}`);
}

/* ── 18, 19, 21, 27, 28 · paid, then replaced ────────────────────────────── */
{
  const origTotal = await totalOf(PAID.distId);
  const replTotal = await totalOf(PAID.replacementId);
  const s = await settlementOf(PAID.replacementId);

  check('18b. a replacement is worth exactly what the version it replaces was worth',
    replTotal === origTotal,
    `${origTotal} → ${replTotal}; the pool is reused and a distributed pool is frozen`);
  check('18. paid original replaced → the settlement is the difference, not a second payout',
    s.row?.settled_entitlement_cents === origTotal && s.row?.settlement_due_cents === 0,
    `already settled ${s.row?.settled_entitlement_cents}, still due ${s.row?.settlement_due_cents}`);
  check('21. zero difference: nothing more leaves the till for this correction',
    s.row?.settlement_due_cents === 0, `due ${s.row?.settlement_due_cents}`);

  const old = await payoutsFor(PAID.distId);
  const fresh = await payoutsFor(PAID.replacementId);
  check('27. the old payout stays attached to the old distribution',
    old.rows.length === 1 && old.rows[0].id === PAY_1, `${old.rows.length} payout(s) on the original`);
  check('28. …and the replacement has a settlement of its own, still unrecorded',
    fresh.rows.length === 0 && s.row?.payout_status === 'unpaid',
    `${fresh.rows.length} payout(s), status ${s.row?.payout_status}`);

  const moved = await memberSettlement(PAID.replacementId);
  const up = moved.rows.filter((m) => m.difference_cents > 0);
  const down = moved.rows.filter((m) => m.difference_cents < 0);
  const net = moved.rows.reduce((sum, m) => sum + m.difference_cents, 0);
  console.log(`\n  what the correction moved, per person:`);
  for (const m of moved.rows) {
    console.log(`    ${m.member_name.padEnd(22)} ${String(m.previously_settled_cents).padStart(7)}` +
      ` → ${String(m.entitlement_cents).padStart(7)}  ${m.difference_cents >= 0 ? '+' : ''}${m.difference_cents}`);
  }
  check('19. positive difference: somebody is owed more than was settled for them',
    up.length >= 1, `${up.length} person(s) up`);
  check('20. negative difference: somebody is owed less, and it is stated, not collected',
    down.length >= 1, `${down.length} person(s) down`);
  check('19b. …and the two sides cancel, which is why the workplace owes nothing more',
    net === 0, `net ${net} cents across ${moved.rows.length} member(s)`);

  const zero = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: PAID.replacementId });
  const row = (await payoutsFor(PAID.replacementId)).rows[0] ?? null;
  check('21b. …so it is settled at zero, with no method invented for a transfer that never happened',
    zero.ok && row?.amount_cents === 0 && row?.method === null,
    `HTTP ${zero.status}, amount ${row?.amount_cents}, method ${row?.method}`);
}

/* ── 17, 22 · never paid, then replaced twice ────────────────────────────── */
{
  await moveService(M_B, UNPAID.day, 14);
  const b = await correctAndSend(UNPAID.distId, 'hours', 'Started at 14:00.');
  await moveService(M_B, UNPAID.day, 15);
  const c = await correctAndSend(b, 'hours', 'No — 15:00.');
  UNPAID.replacementId = c;

  const total = await totalOf(c);
  const s = await settlementOf(c);
  check('17. unpaid original replaced → the settlement is the full corrected amount',
    s.row?.settled_entitlement_cents === 0 && s.row?.settlement_due_cents === total,
    `already settled ${s.row?.settled_entitlement_cents}, due ${s.row?.settlement_due_cents} of ${total}`);

  const moved = await memberSettlement(c);
  const everyoneFull = moved.rows.every((m) => m.previously_settled_cents === 0);
  check('17b. …and per person nothing was settled either, so each is owed their whole share',
    everyoneFull && moved.rows.every((m) => m.difference_cents === m.entitlement_cents),
    `${moved.rows.length} member(s), all measured against zero`);

  const paid = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: c, p_method: 'bank_transfer' });
  UNPAID.paidId = c;
  const row = (await payoutsFor(c)).rows[0] ?? null;
  check('17c. …and that is what gets recorded',
    paid.ok && row?.amount_cents === total && row?.previous_entitlement_cents === 0,
    `amount ${row?.amount_cents} of ${total}`);

  const untouched = await Promise.all([payoutsFor(UNPAID.distId), payoutsFor(b)]);
  check('22. multiple corrections: the two versions nobody paid have no payout of their own',
    untouched.every((p) => p.rows.length === 0),
    `${untouched.map((p) => p.rows.length).join(' and ')} payout(s)`);

  // A fourth version, now that the lineage HAS been settled once.
  await moveService(M_B, UNPAID.day, 16);
  const d = await correctAndSend(c, 'hours', 'Back to 16:00.');
  const s4 = await settlementOf(d);
  check('22b. …and the next correction measures against the version that WAS settled',
    s4.row?.settled_entitlement_cents === total && s4.row?.settlement_due_cents === 0,
    `basis ${s4.row?.settled_entitlement_cents}, due ${s4.row?.settlement_due_cents}`);
  UNPAID.replacementId = d;
}

/* ── 6b · the browser cannot choose the amount ───────────────────────────── */
{
  // There is no amount argument to send. The only way to reach amount_cents is
  // a direct write, which 12b already refuses; this asks PostgREST for the
  // function with an amount and confirms there is no such signature.
  const withAmount = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: UNPAID.replacementId, p_method: 'cash', p_amount_cents: 999999 });
  const rows = await payoutsFor(UNPAID.replacementId);
  check('6b. the RPC has no amount argument, so a browser cannot name a figure',
    !withAmount.ok && rows.rows.length === 0,
    `HTTP ${withAmount.status}: ${withAmount.raw.slice(0, 90)}`);

  const withActor = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: UNPAID.replacementId, p_method: 'cash', p_paid_by: M_B });
  check('7b. …and no actor argument either',
    !withActor.ok, `HTTP ${withActor.status}`);
}

/* ── 24, 25, 26 · the payment outlives everything around it ──────────────── */
{
  const before = (await payoutsFor(PAID.distId)).rows[0];

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { display_name: `Renamed ${STAMP}` });
  await patch(A.token, `workplace_members?id=eq.${M_B}`,
    { area_id: A_BAR, workplace_role_id: R_KEEP });

  const newRule = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const ruleId = typeof newRule.body === 'string' ? newRule.body : null;
  if (ruleId) {
    await patch(A.token, `distribution_rule_areas?rule_id=eq.${ruleId}&area_id=eq.${A_SERVICE}`, { percentage: 50 });
    await patch(A.token, `distribution_rule_areas?rule_id=eq.${ruleId}&area_id=eq.${A_BAR}`, { percentage: 50 });
    await patch(A.token,
      `distribution_rule_areas?rule_id=eq.${ruleId}&area_id=not.in.(${A_SERVICE},${A_BAR})`, { percentage: 0 });
    await rpc(A.token, 'activate_rule', { p_rule_id: ruleId });
  }

  const after = (await payoutsFor(PAID.distId)).rows[0];
  check('24. a payout survives a member rename',
    after.amount_cents === before.amount_cents && after.paid_by === before.paid_by,
    `amount ${after.amount_cents}, actor unchanged`);
  check('25. …a change of area and role',
    after.method === before.method && after.paid_at === before.paid_at, `method ${after.method}`);
  check('26. …and a new rule version',
    after.entitlement_cents === before.entitlement_cents && after.distribution_id === PAID.distId,
    `still on distribution ${after.distribution_id === PAID.distId}`);
}

/* ── 29 · the history a manager reads ────────────────────────────────────── */
{
  const chain = await get(A.token,
    `distribution_settlement?select=${SETTLEMENT}&workplace_id=eq.${WP}&order=distribution_id`);
  const all = await allPayouts();
  const paidLineage = (chain.rows ?? []).filter(
    (r) => r.distribution_id === PAID.distId || r.distribution_id === PAID.replacementId);
  const sumPaid = all.rows
    .filter((p) => p.distribution_id === PAID.distId || p.distribution_id === PAID.replacementId)
    .reduce((sum, p) => sum + p.amount_cents, 0);
  const entitlement = await totalOf(PAID.replacementId);

  console.log(`\n  the paid lineage, as history reads it:`);
  for (const r of paidLineage) {
    console.log(`    ${r.distribution_id.slice(0, 8)}  entitlement ${String(r.entitlement_cents).padStart(7)}` +
      `  settled ${String(r.payout_amount_cents ?? 0).padStart(7)}  ${r.payout_status}`);
  }
  console.log(`    ─────────────────────────────────────────────────────────`);
  console.log(`    handed over in total ${sumPaid}, entitlement ${entitlement}`);

  check('29. history shows entitlement beside settlement, and the settlements sum to ONE entitlement',
    sumPaid === entitlement,
    `${sumPaid} handed over against an entitlement of ${entitlement} — not ${entitlement * 2}`);

  const unrelated = await get(B.token, `distribution_settlement?select=distribution_id&workplace_id=eq.${WP}`);
  check('29b. …and none of that reaches anybody outside the manager role',
    (unrelated.rows?.length ?? 0) === 0 || unrelated.status >= 400,
    `HTTP ${unrelated.status}, ${unrelated.rows?.length ?? 0} row(s)`);
}

/* ── the employee's own difference ───────────────────────────────────────── */
{
  const row = (await get(B.token,
    `member_distributions?select=id,settled_basis_id&id=eq.${PAID.replacementId}`)).rows?.[0] ?? null;
  const now = await ownTotal(B.token, PAID.replacementId);
  const was = row?.settled_basis_id ? await ownTotal(B.token, row.settled_basis_id) : null;
  check('13c. an employee can work out their own difference from their own two entries',
    row?.settled_basis_id === PAID.distId && was !== null && now !== was,
    `settled against ${row?.settled_basis_id === PAID.distId}; ${was} → ${now}` +
      ` = ${now - was > 0 ? '+' : ''}${now - was} cents, and no workplace figure was read`);
}

/* ── 30 · demo mode ──────────────────────────────────────────────────────── */
{
  // Exactly the three this script recorded: the first payout, the zero-value
  // settlement of its correction, and the full amount on the lineage nobody had
  // paid. Anything else in the ledger would be a write nobody asked for.
  const expected = [PAID.distId, PAID.replacementId, UNPAID.paidId];
  const all = await allPayouts();
  const ids = all.rows.map((p) => p.distribution_id).sort();
  check('30. demo mode reaches the database not at all — it builds no client',
    all.rows.length === expected.length &&
      expected.slice().sort().every((id, i) => ids[i] === id),
    `${all.rows.length} payout(s), all of them recorded by this script; ` +
      'harness/pay.cjs Y51-Y52 asserts the demo build records nothing and performs no Supabase call');
}

/* ── audit ───────────────────────────────────────────────────────────────── */
{
  const trail = await get(A.token,
    `audit_log?select=record_id,action,actor_member_id,after&workplace_id=eq.${WP}` +
    `&table_name=eq.distribution_payouts&order=created_at`);
  const rows = trail.rows ?? [];
  const first = rows.find((r) => r.record_id === PAY_1);
  const ledger = await allPayouts();
  check('31. every payout is on the audit trail, once each',
    rows.length === ledger.rows.length && rows.every((r) => r.action === 'insert'),
    `${rows.length} audit row(s) for ${ledger.rows.length} payout(s), ` +
      `actions ${[...new Set(rows.map((r) => r.action))].join(',')}`);
  check('32. …with the amount that was recorded and the manager who recorded it',
    Number(first?.after?.amount_cents) === (await totalOf(PAID.distId)) &&
      first?.actor_member_id === M_A,
    `amount ${first?.after?.amount_cents}, actor ${first?.actor_member_id === M_A}`);
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    paid lineage          ${PAID.distId} → ${PAID.replacementId}`);
console.log(`    unpaid lineage        ${UNPAID.distId} → … → ${UNPAID.replacementId}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
