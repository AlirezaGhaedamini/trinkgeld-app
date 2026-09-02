/**
 * Live payout-reversal verification for TipCrew Phase 3M.
 *
 * A payout recorded by mistake is never edited and never deleted. A second
 * immutable event says it should no longer count — and the money question,
 * what does this lineage still owe, is answered from the payments that still
 * count rather than from every payment ever made.
 *
 *   node scripts/payout-reversal-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages. Inside the first
 * it builds two nights and walks a payment through being recorded, reversed,
 * recorded again, corrected and blocked. Point it at a development project.
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

console.log(`\n  TipCrew — live payout-reversal verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Rev Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Rev Rival ${STAMP}` });
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
 * longest_shift anchor overlap is measured against, and a longer service shift
 * would leave Bar touching it only at 20:00, with no eligible hours at all.
 */
async function night(day, cashCents) {
  const report = await post(A.token, 'tip_reports', {
    workplace_id: WP, member_id: M_A, work_date: day, cash_cents: cashCents, card_cents: 0 });
  if (!report.rows?.[0]?.id) die(`tip_reports insert failed for ${day}: HTTP ${report.status}`);

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
  return { day, poolId, distId };
}

/** Move the shared area's hours — the only thing that moves the split. */
async function moveService(memberId, day, hour) {
  const shift = (await get(A.token,
    `shifts?select=id&member_id=eq.${memberId}&area_id=eq.${A_SERVICE}&work_date=eq.${day}`)).rows?.[0];
  await patch(A.token, `shifts?id=eq.${shift?.id}`, { locked: false });
  return patch(A.token, `shifts?id=eq.${shift?.id}`, { starts_at: iso(day, hour) });
}

async function correctAndSend(originalId, reason, note) {
  const made = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: originalId, p_reason: reason, p_note: note });
  const id = typeof made.body === 'string' ? made.body : null;
  if (!id) die(`create_replacement_distribution failed: HTTP ${made.status} ${made.raw}`);
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: id });
  if (!sent.ok) die(`send_distribution failed for the correction: HTTP ${sent.status} ${sent.raw}`);
  return id;
}

const MAIN = await night('2017-02-10', 90000);   // paid, reversed, paid again, corrected
const CHAIN = await night('2017-02-17', 70000);  // paid, corrected, corrected settlement

console.log(`  main lineage:  pool ${MAIN.poolId}  distribution ${MAIN.distId}`);
console.log(`  chain lineage: pool ${CHAIN.poolId}  distribution ${CHAIN.distId}\n`);

/* ── readers ─────────────────────────────────────────────────────────────── */

const SETTLEMENT = 'distribution_id,entitlement_cents,settled_entitlement_cents,settlement_due_cents,payout_status,payout_id,payout_amount_cents,payout_method,paid_at,paid_by,paid_by_name,reversal_count,can_reverse';
async function settlementOf(id, token = A.token) {
  const r = await get(token, `distribution_settlement?select=${SETTLEMENT}&distribution_id=eq.${id}`);
  return { status: r.status, row: r.rows?.[0] ?? null, rows: r.rows ?? [] };
}
const REVERSAL = 'id,workplace_id,payout_id,distribution_id,reason,note,reversed_at,reversed_by';
async function reversalsFor(payoutId, token = A.token) {
  const r = await get(token, `distribution_payout_reversals?select=${REVERSAL}&payout_id=eq.${payoutId}`);
  return { status: r.status, rows: r.rows ?? [] };
}
async function allReversals(token = A.token) {
  const r = await get(token, `distribution_payout_reversals?select=${REVERSAL}&workplace_id=eq.${WP}`);
  return { status: r.status, rows: r.rows ?? [] };
}
async function payoutsFor(distributionId, token = A.token) {
  const r = await get(token,
    `distribution_payouts?select=id,distribution_id,entitlement_cents,previous_entitlement_cents,amount_cents,method,note,paid_at,paid_by&distribution_id=eq.${distributionId}`);
  return { status: r.status, rows: r.rows ?? [] };
}
async function eventsFor(distributionId, token = A.token) {
  const r = await get(token,
    `distribution_payout_events?select=distribution_id,payout_id,reversal_id,kind,event_at,amount_cents,method,reason,note,actor_name,still_counts&distribution_id=eq.${distributionId}&order=event_at`);
  return { status: r.status, rows: r.rows ?? [] };
}
async function totalOf(id) {
  const r = await get(A.token, `tip_distributions?select=entries_total_cents&id=eq.${id}`);
  return r.rows?.[0]?.entries_total_cents ?? null;
}

/* ── 1, 2 · a payout to take back ────────────────────────────────────────── */
let P1 = null;
{
  const total = await totalOf(MAIN.distId);
  const s0 = await settlementOf(MAIN.distId);
  check('1. a sent distribution exists, unpaid',
    s0.row?.payout_status === 'unpaid' && s0.row?.settlement_due_cents === total,
    `status ${s0.row?.payout_status}, due ${s0.row?.settlement_due_cents} of ${total}`);

  const made = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: MAIN.distId, p_method: 'cash', p_note: 'Paid on the night.' });
  P1 = typeof made.body === 'string' ? made.body : null;
  const s1 = await settlementOf(MAIN.distId);
  check('2. a payout is recorded',
    made.ok && !!P1 && s1.row?.payout_status === 'paid' && s1.row?.can_reverse === true,
    `HTTP ${made.status}, status ${s1.row?.payout_status}, reversible ${s1.row?.can_reverse}`);
}

/* ── 3, 4, 5 · who may not reverse it ────────────────────────────────────── */
{
  const byEmployee = await rpc(B.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'recorded_by_mistake', p_note: 'Not mine to touch.' });
  check('3. an employee cannot reverse a payout', !byEmployee.ok, `HTTP ${byEmployee.status}`);

  const byRival = await rpc(B.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: 'Nor mine.' });
  check('4. …nor a manager of another workplace',
    !byRival.ok, `HTTP ${byRival.status}; rival workplace ${WP_OTHER}`);

  const anon = await rpc(null, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: 'Nor anybody.' });
  check('5. …and without a session, nobody at all', !anon.ok, `HTTP ${anon.status}`);

  const after = await reversalsFor(P1);
  check('5b. …and none of those refusals recorded anything',
    after.rows.length === 0, `${after.rows.length} reversal(s)`);
}

/* ── 6, 7, 8 · a reversal needs a reason and a sentence ──────────────────── */
{
  const noReason = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_note: 'Something went wrong.' });
  check('6. a reversal without a category is refused', !noReason.ok, `HTTP ${noReason.status}`);

  const noNote = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other' });
  check('6b. …and one with no explanation at all', !noNote.ok, `HTTP ${noNote.status}`);

  const spaces = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: '     ' });
  check('7. …and spaces are not an explanation', !spaces.ok, `HTTP ${spaces.status}`);

  const ws = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: '  \n\t ' });
  check('7b. …nor tabs and newlines, the shape migration 25 was written for',
    !ws.ok, `HTTP ${ws.status}`);

  const invisible = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: '  ​　' });
  check('7c. …nor the invisible characters a paste from a word processor leaves',
    !invisible.ok, `HTTP ${invisible.status}`);

  const long = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: `  ${'x'.repeat(501)}\n` });
  check('8. …and 501 characters once the whitespace is gone',
    !long.ok, `HTTP ${long.status}`);

  const after = await reversalsFor(P1);
  check('8b. …and still nothing was written', after.rows.length === 0,
    `${after.rows.length} reversal(s)`);
}

/* ── 9, 10, 11, 12 · the reversal itself ─────────────────────────────────── */
let R1 = null;
{
  const before = (await payoutsFor(MAIN.distId)).rows[0];

  const made = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'payment_not_completed', p_note: '  The transfer never went out.  ' });
  R1 = typeof made.body === 'string' ? made.body : null;
  const row = (await reversalsFor(P1)).rows[0] ?? null;

  check('9. a manager reverses the payout', made.ok && !!R1, `HTTP ${made.status}`);
  check('10. …and the reversal names the payout it takes back',
    row?.payout_id === P1 && row?.distribution_id === MAIN.distId && row?.workplace_id === WP,
    `payout ${row?.payout_id === P1}, distribution ${row?.distribution_id === MAIN.distId}`);
  check('11. …with the actor and the timestamp the server derived',
    row?.reversed_by === M_A && row?.reversed_at !== null,
    `reversed_by ${row?.reversed_by} (manager membership ${M_A})`);
  check('11b. …the category chosen, and the note stored trimmed',
    row?.reason === 'payment_not_completed' && row?.note === 'The transfer never went out.',
    `reason ${row?.reason}, note ${JSON.stringify(row?.note)}`);

  const after = (await payoutsFor(MAIN.distId)).rows[0];
  check('12. …while the payout row itself is byte-for-byte what it was',
    JSON.stringify(before) === JSON.stringify(after),
    before && after ? 'identical' : 'MISSING');
}

/* ── 13, 14 · the reversal is a record too ───────────────────────────────── */
{
  const edits = await Promise.all([
    patch(A.token, `distribution_payout_reversals?id=eq.${R1}`, { note: 'something else' }),
    patch(A.token, `distribution_payout_reversals?id=eq.${R1}`, { reason: 'other' }),
    patch(A.token, `distribution_payout_reversals?id=eq.${R1}`, { reversed_by: M_B }),
    patch(A.token, `distribution_payout_reversals?id=eq.${R1}`, { reversed_at: '2000-01-01T00:00:00Z' }),
    patch(A.token, `distribution_payout_reversals?id=eq.${R1}`, { payout_id: P1 }),
  ]);
  const row = (await reversalsFor(P1)).rows[0];
  check('13. a reversal cannot be rewritten — not its note, reason, actor, time or target',
    edits.every(refused) && row?.reason === 'payment_not_completed' && row?.reversed_by === M_A,
    `HTTP ${edits.map((e) => e.status).join('/')}`);

  const gone = await del(A.token, `distribution_payout_reversals?id=eq.${R1}`);
  const still = await reversalsFor(P1);
  check('14. …and it cannot be deleted by an ordinary client',
    refused(gone) && still.rows.length === 1, `HTTP ${gone.status}`);

  const forged = await post(A.token, 'distribution_payout_reversals', {
    workplace_id: WP, payout_id: P1, distribution_id: MAIN.distId,
    reason: 'other', note: 'By hand.' });
  check('14b. …and nobody may write one by hand',
    refused(forged) && (await reversalsFor(P1)).rows.length === 1, `HTTP ${forged.status}`);
}

/* ── 15 · once, and only once ────────────────────────────────────────────── */
{
  const again = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P1, p_reason: 'other', p_note: 'Again.' });
  check('15. a payout cannot be reversed twice', !again.ok, `HTTP ${again.status}`);

  // Four at once: a double click, a refresh, two tabs.
  const burst = await Promise.all([0, 1, 2, 3].map(() =>
    rpc(A.token, 'reverse_distribution_payout',
      { p_payout_id: P1, p_reason: 'other', p_note: 'Racing.' })));
  const rows = await reversalsFor(P1);
  check('30. …and four simultaneous attempts still leave exactly one reversal',
    burst.every((r) => !r.ok) && rows.rows.length === 1,
    `${burst.map((r) => r.status).join('/')}; ${rows.rows.length} reversal(s)`);
}

/* ── 16, 17 · what the reversal does to the money question ───────────────── */
{
  const total = await totalOf(MAIN.distId);
  const s = await settlementOf(MAIN.distId);
  check('16. the distribution counts as unpaid again, and says why',
    s.row?.payout_status === 'reversed' && s.row?.settlement_due_cents === total,
    `status ${s.row?.payout_status}, due ${s.row?.settlement_due_cents} of ${total}`);
  check('16b. …with the reversal on the record and nothing left to reverse',
    s.row?.reversal_count === 1 && s.row?.can_reverse === false && s.row?.payout_id === null,
    `reversals ${s.row?.reversal_count}, reversible ${s.row?.can_reverse}`);
  check('17. …and a payment that no longer counts settles nothing',
    s.row?.settled_entitlement_cents === 0,
    `settled basis ${s.row?.settled_entitlement_cents}`);
}

/* ── 18, 19, 20 · paying it again ────────────────────────────────────────── */
let P2 = null;
{
  const total = await totalOf(MAIN.distId);
  const made = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: MAIN.distId, p_method: 'payroll', p_note: 'On the next payslip.' });
  P2 = typeof made.body === 'string' ? made.body : null;
  const row = (await payoutsFor(MAIN.distId)).rows.find((p) => p.id === P2) ?? null;

  check('18. the distribution can be paid again', made.ok && !!P2, `HTTP ${made.status}`);
  check('19. …for the full amount, because nothing in the lineage still counts',
    row?.amount_cents === total && row?.previous_entitlement_cents === 0,
    `amount ${row?.amount_cents} of ${total}`);

  const all = await payoutsFor(MAIN.distId);
  const s = await settlementOf(MAIN.distId);
  check('20. …leaving two payout rows and exactly one that still counts',
    all.rows.length === 2 && s.row?.payout_id === P2 && s.row?.payout_status === 'paid',
    `${all.rows.length} payout(s), effective ${s.row?.payout_id === P2}`);

  const third = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: MAIN.distId, p_method: 'cash' });
  check('20b. …and a third is refused while the second one stands',
    !third.ok, `HTTP ${third.status}`);

  const forged = await post(A.token, 'distribution_payouts', {
    workplace_id: WP, distribution_id: MAIN.distId, entitlement_cents: total,
    previous_entitlement_cents: 0, amount_cents: total, method: 'cash' });
  check('20c. …including one written straight into the table, past the RPC',
    refused(forged) && (await payoutsFor(MAIN.distId)).rows.length === 2,
    `HTTP ${forged.status}`);
}

/* ── 21 · the employee's view ────────────────────────────────────────────── */
{
  const mine = await get(B.token,
    `member_distributions?select=id,payout_status,payout_method,paid_at,settled_basis_id&id=eq.${MAIN.distId}`);
  const row = mine.rows?.[0] ?? null;
  const cols = row ? Object.keys(row) : [];
  check('21. the employee sees the CURRENT state, which is paid again',
    row?.payout_status === 'paid' && row?.payout_method === 'payroll',
    `${row?.payout_status} / ${row?.payout_method}`);
  check('21b. …and no amount, no actor and no reversal detail',
    !cols.some((c) => /amount|cents|reversed_by|reason/.test(c)), `columns ${cols.join(',')}`);

  const ledger = await get(B.token, `distribution_payout_reversals?select=id&workplace_id=eq.${WP}`);
  check('22b. …and cannot read the reversal ledger at all',
    (ledger.rows?.length ?? 0) === 0 || ledger.status >= 400,
    `HTTP ${ledger.status}, ${ledger.rows?.length ?? 0} row(s)`);

  const ev = await eventsFor(MAIN.distId, B.token);
  check('23b. …nor the manager event list',
    ev.rows.length === 0 || ev.status >= 400, `HTTP ${ev.status}, ${ev.rows.length} row(s)`);
}

/* ── 22 · the manager's event history ────────────────────────────────────── */
{
  const ev = await eventsFor(MAIN.distId);
  const kinds = ev.rows.map((e) => e.kind).join(' → ');
  const net = ev.rows.reduce((sum, e) => sum + e.amount_cents, 0);
  const total = await totalOf(MAIN.distId);

  console.log(`\n  the payment history of ${MAIN.distId}:`);
  for (const e of ev.rows) {
    console.log(`    ${String(e.kind).padEnd(9)} ${String(e.amount_cents).padStart(8)}` +
      `  ${e.method ?? e.reason ?? ''}${e.kind === 'payout' && !e.still_counts ? '  (no longer counts)' : ''}`);
  }
  console.log(`    ────────────────────────────────────────`);
  console.log(`    still handed over: ${net}, entitlement ${total}`);

  check('22. the manager reads every event, in order, never collapsed into one word',
    ev.rows.length === 3 && kinds === 'payout → reversal → payout',
    `${ev.rows.length} events: ${kinds}`);
  check('22c. …with the reversal shown as a negative, so the column sums to what still counts',
    net === total, `${net} against an entitlement of ${total}`);
  check('22d. …and the payout that no longer counts marked as such',
    ev.rows.filter((e) => e.kind === 'payout' && !e.still_counts).length === 1 &&
      ev.rows.filter((e) => e.kind === 'payout' && e.still_counts).length === 1,
    ev.rows.filter((e) => e.kind === 'payout').map((e) => e.still_counts).join(','));
}

/* ── 24 · a correction after a reversal settles the FULL amount ──────────── */
{
  // Reverse the standing payment, then correct the distribution.
  const rev = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P2, p_reason: 'recorded_by_mistake', p_note: 'That one was wrong too.' });
  await moveService(M_B, MAIN.day, 14);
  const b = await correctAndSend(MAIN.distId, 'hours', 'Started at 14:00.');
  const total = await totalOf(b);
  const s = await settlementOf(b);

  check('24. a correction whose lineage was paid and then reversed owes the FULL amount',
    rev.ok && s.row?.settled_entitlement_cents === 0 && s.row?.settlement_due_cents === total,
    `basis ${s.row?.settled_entitlement_cents}, due ${s.row?.settlement_due_cents} of ${total}`);
  check('24b. …and names no settled basis, so nobody is compared against money that is gone',
    (await get(B.token,
      `member_distributions?select=settled_basis_id&id=eq.${b}`)).rows?.[0]?.settled_basis_id === null,
    'settled_basis_id is null');
  MAIN.replacementId = b;
}

/* ── 25 · the same shape, ancestor still settled, still a delta ──────────── */
{
  const cp = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: CHAIN.distId, p_method: 'cash' });
  const firstTotal = await totalOf(CHAIN.distId);
  await moveService(M_B, CHAIN.day, 14);
  const b = await correctAndSend(CHAIN.distId, 'hours', 'Started at 14:00.');
  const s = await settlementOf(b);
  check('25. a correction whose ancestor IS still settled owes the difference, as in Phase 3L',
    cp.ok && s.row?.settled_entitlement_cents === firstTotal && s.row?.settlement_due_cents === 0,
    `basis ${s.row?.settled_entitlement_cents} of ${firstTotal}, due ${s.row?.settlement_due_cents}`);
  CHAIN.replacementId = b;
  CHAIN.firstPayoutId = typeof cp.body === 'string' ? cp.body : null;
}

/* ── 26 · the unsafe upstream reversal is blocked ────────────────────────── */
{
  const settled = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: CHAIN.replacementId });
  const blocked = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: CHAIN.firstPayoutId, p_reason: 'recorded_by_mistake',
      p_note: 'Undo the earlier one.' });
  const s = await settlementOf(CHAIN.distId);

  check('26. an earlier payment a later settlement stands on cannot be reversed',
    settled.ok && !blocked.ok, `settle ${settled.status}, reverse ${blocked.status}`);
  check('26b. …and the screen is told so, rather than being offered a button that fails',
    s.row?.can_reverse === false && s.row?.payout_status === 'paid',
    `reversible ${s.row?.can_reverse}, status ${s.row?.payout_status}`);
  check('26c. …and the attempt changed nothing',
    (await reversalsFor(CHAIN.firstPayoutId)).rows.length === 0,
    'no reversal was written');

  // Unwound in the right order, it is allowed.
  const downstream = (await settlementOf(CHAIN.replacementId)).row?.payout_id;
  const first = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: downstream, p_reason: 'recorded_by_mistake', p_note: 'The later one first.' });
  const then = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: CHAIN.firstPayoutId, p_reason: 'recorded_by_mistake', p_note: 'And now this one.' });
  check('26d. …but once the later settlement is reversed, the earlier one may be too',
    first.ok && then.ok, `downstream ${first.status}, upstream ${then.status}`);
  check('29. …after which the lineage has settled nothing at all',
    (await settlementOf(CHAIN.replacementId)).row?.settled_entitlement_cents === 0,
    'settled basis is zero');
}

/* ── 27, 28 · negative and zero corrections still behave ─────────────────── */
{
  // The pool cannot change, so the workplace-level difference on a correction is
  // zero and the money moves between people. Both still hold with reversals in
  // the picture: this checks the per-person differences and the zero settlement.
  const paid = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: MAIN.replacementId, p_method: 'cash' });
  await moveService(M_B, MAIN.day, 15);
  const c = await correctAndSend(MAIN.replacementId, 'hours', 'No — 15:00.');
  const s = await settlementOf(c);
  const moved = await get(A.token,
    `distribution_member_settlement?select=member_id,difference_cents&distribution_id=eq.${c}`);
  const rows = moved.rows ?? [];
  const up = rows.filter((m) => m.difference_cents > 0).length;
  const down = rows.filter((m) => m.difference_cents < 0).length;
  const net = rows.reduce((sum, m) => sum + m.difference_cents, 0);

  check('28. a correction to a settled lineage still owes nothing at workplace level',
    paid.ok && s.row?.settlement_due_cents === 0,
    `due ${s.row?.settlement_due_cents}`);
  check('27. …while per person one is up and another down, by the same amount',
    up >= 1 && down >= 1 && net === 0,
    `${up} up, ${down} down, net ${net}`);
  MAIN.thirdId = c;
}

/* ── 23, 31 · demo mode, and the ledger this run actually wrote ──────────── */
{
  const all = await allReversals();
  const byPayout = {};
  for (const r of all.rows) byPayout[r.payout_id] = (byPayout[r.payout_id] ?? 0) + 1;
  check('31. every reversal this run made is one row, and nothing else appeared',
    Object.values(byPayout).every((n) => n === 1),
    `${all.rows.length} reversal(s), at most one per payout; harness/rev.cjs Z51-Z52 asserts ` +
      'the demo build records neither a payout nor a reversal and performs no Supabase call');
}

/* ── audit ───────────────────────────────────────────────────────────────── */
{
  const trail = await get(A.token,
    `audit_log?select=record_id,action,actor_member_id,after&workplace_id=eq.${WP}` +
    `&table_name=eq.distribution_payout_reversals&order=created_at`);
  const rows = trail.rows ?? [];
  const all = await allReversals();
  const first = rows.find((r) => r.record_id === R1);
  check('23. every reversal is on the audit trail, one row each',
    rows.length === all.rows.length && rows.every((r) => r.action === 'insert'),
    `${rows.length} audit row(s) for ${all.rows.length} reversal(s)`);
  check('23c. …with the payout, the distribution, the reason and the manager',
    first?.after?.payout_id === P1 && first?.after?.distribution_id === MAIN.distId &&
      first?.after?.reason === 'payment_not_completed' && first?.actor_member_id === M_A,
    `payout ${first?.after?.payout_id === P1}, reason ${first?.after?.reason}`);

  const payTrail = await get(A.token,
    `audit_log?select=record_id&workplace_id=eq.${WP}&table_name=eq.distribution_payouts`);
  check('23d. …while the payouts keep the audit rows they always had',
    (payTrail.rows?.length ?? 0) >= 4, `${payTrail.rows?.length ?? 0} payout audit row(s)`);
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    main lineage          ${MAIN.distId} → ${MAIN.replacementId} → ${MAIN.thirdId}`);
console.log(`    chain lineage         ${CHAIN.distId} → ${CHAIN.replacementId}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
