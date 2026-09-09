/**
 * Live verification of migration 36 — a closed period is not rewritten by a
 * standalone cancellation.
 *
 * The 3R audit found this by attacking a development project from a signed-in
 * manager's position: anon key plus their own JWT, nothing else. One call,
 *
 *     POST /rest/v1/rpc/cancel_distribution   → HTTP 204
 *
 * against a distribution that was sent and paid IN FULL on a business date
 * inside an already closed week, moved that week's export by €900, drove
 * outstanding negative, and left records_after_close reading 0 — because the
 * export marks a record as after-close by comparing a CREATION time, and a
 * cancellation is a state change on a row that existed before the close.
 *
 * This script reproduces that exact attack and expects it to be refused, then
 * proves the rule kept its shape: a correction inside the closed week still
 * works and is still flagged, a payout and a reversal after the close still
 * work, and a cancellation in the NEXT week — which no close covers — still
 * works. A guard that also broke those would be the wrong guard.
 *
 *   node scripts/closed-period-cancellation-check.mjs
 *
 * WHAT IT WRITES. One workplace per run, tagged with the run's timestamp, on
 * 2018 business dates. It touches nothing that already exists. Point it at a
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
 * An RPC is refused only when the server said no.
 *
 * Worth spelling out, because getting it wrong is how the original audit run
 * mis-scored this very call: cancel_distribution() RETURNS VOID, so PostgREST
 * answers a SUCCESSFUL cancellation with HTTP 204 and an empty body. Scoring
 * "no rows came back" as "refused" reports a silent financial mutation as a
 * boundary holding.
 */
const rpcRefused = (r) => !r.ok;
/** A table write is refused if the server said no, or RLS matched no row. */
const tableRefused = (r) => !r.ok || (r.rows?.length ?? 0) === 0;

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

console.log(`\n  TipCrew — closed-period cancellation guard (migration 36)`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);

/* ── one workplace, one week that gets closed, one week beside it ────────── */

const WP = (await rpc(A.token, 'create_workplace', { p_name: `Close Guard ${STAMP}` })).body;
if (typeof WP !== 'string') die('create_workplace failed');
const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee' });
const invRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!invRow?.token) die(`create_invitation failed: ${invited.raw}`);
const M_B = (await rpc(B.token, 'accept_invitation', { p_token: invRow.token })).body;
if (typeof M_B !== 'string') die('accept_invitation failed');

const M_A = (await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`))
  .rows.find((m) => m.role === 'manager').id;
const areas = (await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP}`)).rows;
const A_SERVICE = areas.find((a) => a.key === 'service').id;
const roles = (await get(A.token, `workplace_roles?select=id,key&workplace_id=eq.${WP}`)).rows;
const R_SERVER = roles.find((r) => r.key === 'server').id;

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

/**
 * Service takes the whole pool and one person works it, so a night's
 * entitlement is exactly the cash that was reported — which makes every total
 * below readable by eye. create_pool_from_reports() keeps a temp table until
 * commit, so each night is its own request.
 */
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

const WEEK_START = '2018-04-02', WEEK_END = '2018-04-08';
const N1 = await night('2018-04-03', 90000);   // paid in full — the audit's subject
const N2 = await night('2018-04-04', 60000);   // unpaid — the correction subject
const N3 = await night('2018-04-05', 40000);   // paid — the reversal subject
const NEXT = await night('2018-04-10', 30000); // the week beside it, never closed

const PAY1 = (await rpc(A.token, 'record_distribution_payout',
  { p_distribution_id: N1.distId, p_method: 'cash', p_note: 'paid in full' })).body;
const PAY3 = (await rpc(A.token, 'record_distribution_payout',
  { p_distribution_id: N3.distId, p_method: 'cash', p_note: 'paid in full' })).body;
if (typeof PAY1 !== 'string' || typeof PAY3 !== 'string') die('record_distribution_payout failed');

const CLOSE = (await rpc(A.token, 'close_financial_period', {
  p_workplace_id: WP, p_period_start: WEEK_START, p_period_end: WEEK_END, p_note: 'reviewed' })).body;
if (typeof CLOSE !== 'string') die('close_financial_period failed');

const exportWeek = async () => (await rpc(A.token, 'financial_period_export',
  { p_workplace_id: WP, p_period_start: WEEK_START, p_period_end: WEEK_END })).body;

const before = await exportWeek();
const S0 = before.summary;
console.log(`  workplace ${WP}`);
console.log(`  week ${WEEK_START} … ${WEEK_END}, closed`);
console.log(`  baseline: owed ${eur(S0.current_entitlement_cents)}, settled ${eur(S0.effective_settled_cents)}, `
  + `outstanding ${eur(S0.outstanding_cents)}, records_after_close ${S0.records_after_close}\n`);

check('1. the closed week starts where it should',
  S0.current_entitlement_cents === 190000 && S0.effective_settled_cents === 130000
  && S0.outstanding_cents === 60000 && S0.records_after_close === 0,
  `owed ${S0.current_entitlement_cents}, settled ${S0.effective_settled_cents}, `
  + `outstanding ${S0.outstanding_cents}, after ${S0.records_after_close}`);

/* ── the attack ──────────────────────────────────────────────────────────── */

const attack = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: N1.distId, p_reason: 'take it back' });
check('2. a sent, fully paid distribution inside the closed week cannot be cancelled',
  rpcRefused(attack),
  `HTTP ${attack.status} ${attack.raw || '(empty body — a void RPC returning 204 is a SUCCESS)'}`);
if (!rpcRefused(attack)) {
  console.log('\n          ↑ this is the 3R defect reproducing. If migration 36 is in');
  console.log('            supabase/migrations but not yet applied to this project,');
  console.log('            apply it and run again.\n');
}
check('3. …and the refusal names the close and points at the correction path',
  /closed/i.test(attack.raw) && /correct/i.test(attack.raw), attack.raw);

const unpaidAttack = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: N2.distId, p_reason: 'take it back' });
check('4. an UNPAID one inside the closed week is refused too — it is the close, not the payment',
  rpcRefused(unpaidAttack), `HTTP ${unpaidAttack.status} ${unpaidAttack.raw}`);

const n1Row = (await get(A.token,
  `tip_distributions?select=status,cancelled_at,cancel_reason&id=eq.${N1.distId}`)).rows[0];
check('5. the refusal changed nothing: the distribution is still sent, uncancelled',
  n1Row?.status === 'sent' && n1Row?.cancelled_at === null && n1Row?.cancel_reason === null,
  JSON.stringify(n1Row));

const payRows = (await get(A.token,
  `distribution_payouts?select=id,amount_cents&distribution_id=eq.${N1.distId}`)).rows;
const revRows = (await get(A.token,
  `distribution_payout_reversals?select=id&payout_id=eq.${PAY1}`)).rows;
check('6. …the payout row is untouched, and unreversed',
  payRows?.length === 1 && payRows[0].amount_cents === 90000 && revRows?.length === 0,
  `${JSON.stringify(payRows)} reversals ${revRows?.length}`);

const byHand = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`, { status: 'cancelled' });
check('7. …and it cannot be cancelled by hand either, going around the RPC',
  tableRefused(byHand), `HTTP ${byHand.status} ${byHand.raw}`);

const after = await exportWeek();
const S1 = after.summary;
check('8. the closed week still owes exactly what it owed',
  S1.current_entitlement_cents === S0.current_entitlement_cents,
  `${S0.current_entitlement_cents} → ${S1.current_entitlement_cents}`);
check('9. …the settled figure has not moved',
  S1.effective_settled_cents === S0.effective_settled_cents,
  `${S0.effective_settled_cents} → ${S1.effective_settled_cents}`);
check('10. …outstanding has not moved, and is not negative',
  S1.outstanding_cents === S0.outstanding_cents && S1.outstanding_cents >= 0,
  `${S0.outstanding_cents} → ${S1.outstanding_cents}`);
check('11. …and nothing claims to have arrived after the close',
  S1.records_after_close === S0.records_after_close,
  `${S0.records_after_close} → ${S1.records_after_close}`);

const closeRow = (await get(A.token,
  `financial_period_closes?select=period_start,period_end,note&id=eq.${CLOSE}`)).rows[0];
check('12. …the close row is exactly as it was recorded',
  closeRow?.period_start === WEEK_START && closeRow?.period_end === WEEK_END && closeRow?.note === 'reviewed',
  JSON.stringify(closeRow));

/* ── the shape of the rule: what must still work ─────────────────────────── */

const nextWeek = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: NEXT.distId, p_reason: 'Different week.' });
check('13. a distribution in the NEXT week, which no close covers, can still be cancelled',
  !rpcRefused(nextWeek), `HTTP ${nextWeek.status} ${nextWeek.raw}`);

const correction = await rpc(A.token, 'create_replacement_distribution',
  { p_original_id: N2.distId, p_reason: 'hours', p_note: 'They stayed until closing.' });
check('14. a distribution inside the closed week can still be CORRECTED',
  !rpcRefused(correction), `HTTP ${correction.status} ${correction.raw}`);
const CORR = typeof correction.body === 'string' ? correction.body : null;
const published = CORR ? await rpc(A.token, 'send_distribution', { p_distribution_id: CORR }) : null;
check('15. …and publishing it retires the original, which cancel_distribution() may not do',
  published !== null && !rpcRefused(published)
  && (await get(A.token, `tip_distributions?select=status&id=eq.${N2.distId}`)).rows?.[0]?.status === 'cancelled',
  published ? `HTTP ${published.status} ${published.raw}` : 'no correction to publish');

const withCorrection = await exportWeek();
const corrRow = withCorrection.distributions.find((d) => d.id === CORR);
check('16. …and unlike a cancellation, the correction IS marked as after the close',
  corrRow?.after_close === true, JSON.stringify(corrRow?.after_close));
check('17. …and counted, so nobody believes the closed figures contained it',
  withCorrection.summary.records_after_close === S0.records_after_close + 1,
  `records_after_close ${withCorrection.summary.records_after_close}`);
check('18. …with the corrected night counted once, and the version it replaced reported beside it',
  withCorrection.summary.current_entitlement_cents === 190000
  && withCorrection.summary.replaced_entitlement_cents === 60000,
  `owed ${withCorrection.summary.current_entitlement_cents}, replaced ${withCorrection.summary.replaced_entitlement_cents}`);

const latePayout = CORR ? await rpc(A.token, 'record_distribution_payout',
  { p_distribution_id: CORR, p_method: 'bank_transfer', p_note: 'with the payroll run' }) : null;
check('19. a payout can still be recorded after the close',
  latePayout !== null && !rpcRefused(latePayout),
  latePayout ? `HTTP ${latePayout.status} ${latePayout.raw}` : 'no correction to pay');

const reversal = await rpc(A.token, 'reverse_distribution_payout',
  { p_payout_id: PAY3, p_reason: 'wrong_method', p_note: 'It went by bank.' });
check('20. …and a payout made BEFORE the close can still be reversed after it',
  !rpcRefused(reversal), `HTTP ${reversal.status} ${reversal.raw}`);

const final = await exportWeek();
const S2 = final.summary;
check('21. the settled figure follows both: €1300 + €600 paid − €400 reversed',
  S2.effective_settled_cents === 150000, `${S2.effective_settled_cents}`);
check('22. …outstanding is what is owed minus that, and stays a number a manager can act on',
  S2.outstanding_cents === 40000, `${S2.outstanding_cents}`);
check('23. …and all three post-close events are counted: the correction, the payout, the reversal',
  S2.records_after_close === S0.records_after_close + 3, `${S2.records_after_close}`);

const staffAttack = await rpc(B.token, 'cancel_distribution',
  { p_distribution_id: N3.distId, p_reason: 'mine now' });
check('24. an employee still cannot cancel anything, closed period or not',
  rpcRefused(staffAttack), `HTTP ${staffAttack.status} ${staffAttack.raw}`);

console.log(`\n  ─────────────────────────────────────────────────────────`);
console.log(`  ${pass} passed, ${fail} failed`);
for (const f of failed) console.log(`    · ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
console.log(`\n  fixture workplace: ${WP}\n`);
process.exit(fail === 0 ? 0 : 1);
