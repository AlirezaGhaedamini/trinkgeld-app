/**
 * Live verification of migration 38 — a paid CHAIN is not abandoned either.
 *
 * Migration 37 asked "has THIS version been paid". A correction moves the
 * money's anchor without moving the money: send_distribution() retires the
 * predecessor and the payout stays on it. So the live head of a settled chain
 * answered no, and the 3S-A audit measured what followed:
 *
 *     A sent, paid €600  →  corrected by B  →  B sent, A retired
 *         cancel_distribution(B)  →  HTTP 204
 *         owed €600 → €0 · settled €600 (unmoved) · outstanding €-600
 *
 * This script reproduces that against a real project and expects a refusal,
 * then proves the rule kept its shape: reversing the payment releases the whole
 * chain, a chain nothing was paid on still cancels, and a paid distribution can
 * still be CORRECTED — because corrections never went through this function.
 *
 *   node scripts/lineage-cancellation-check.mjs
 *
 * WHAT IT WRITES. One workplace per run, tagged with the run's timestamp, on
 * 2020 business dates. It touches nothing that already exists. Point it at a
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
  die('That looks like a service-role key.', 'This test must run with the anon key.');
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

/** cancel_distribution RETURNS VOID: a successful call is HTTP 204 with no body. */
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

console.log(`\n  TipCrew — lineage settlement cancellation guard (migration 38)`);
console.log(`  project: ${URL_BASE}\n  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);

const WP = (await rpc(A.token, 'create_workplace', { p_name: `Lineage ${STAMP}` })).body;
if (typeof WP !== 'string') die('create_workplace failed');
const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee' });
const invRow = Array.isArray(invited.body) ? invited.body[0] : invited.body;
if (!invRow?.token) die(`create_invitation failed: ${invited.raw}`);
if (typeof (await rpc(B.token, 'accept_invitation', { p_token: invRow.token })).body !== 'string') {
  die('accept_invitation failed');
}
const M_A = (await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`))
  .rows.find((m) => m.role === 'manager').id;
const M_B = (await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`))
  .rows.find((m) => m.role === 'employee').id;
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
  if (!(await rpc(A.token, 'activate_rule', { p_rule_id: ruleId })).ok) die('activate_rule failed');
}

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
  if (!(await rpc(A.token, 'send_distribution', { p_distribution_id: distId })).ok) die(`send ${day}`);
  return { day, poolId, distId };
}

const WEEK_START = '2020-02-03', WEEK_END = '2020-02-09';
const PAID = await night('2020-02-04', 60000);   // A: paid, then corrected
const CLEAN = await night('2020-02-05', 20000);  // never paid, corrected — must still cancel

const PAY = (await rpc(A.token, 'record_distribution_payout',
  { p_distribution_id: PAID.distId, p_method: 'cash', p_note: 'paid in full' })).body;
if (typeof PAY !== 'string') die('record_distribution_payout failed');

const correct = async (id, note) => {
  const made = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: id, p_reason: 'hours', p_note: note });
  if (typeof made.body !== 'string') return null;
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: made.body });
  return sent.ok ? made.body : null;
};

const B_ID = await correct(PAID.distId, 'They stayed until closing.');
check('1. a PAID distribution can still be corrected — send_distribution is untouched',
  B_ID !== null
  && (await get(A.token, `tip_distributions?select=status&id=eq.${PAID.distId}`)).rows?.[0]?.status === 'cancelled',
  `replacement ${B_ID}`);

const week = async () => (await rpc(A.token, 'financial_period_export',
  { p_workplace_id: WP, p_period_start: WEEK_START, p_period_end: WEEK_END })).body;
const before = (await week()).summary;
console.log(`  workplace ${WP}`);
console.log(`  baseline: owed ${eur(before.current_entitlement_cents)}, settled ${eur(before.effective_settled_cents)}, `
  + `outstanding ${eur(before.outstanding_cents)}\n`);
check('2. the payment stays on the retired ancestor, so the week still balances',
  before.effective_settled_cents === 60000 && before.outstanding_cents === 20000,
  `owed ${before.current_entitlement_cents}, settled ${before.effective_settled_cents}, outstanding ${before.outstanding_cents}`);

const attack = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: B_ID, p_reason: 'abandon the chain' });
check('3. the live head of a settled chain cannot be abandoned',
  rpcRefused(attack),
  `HTTP ${attack.status} ${attack.raw || '(empty body — a void RPC returning 204 is a SUCCESS)'}`);
if (!rpcRefused(attack)) {
  console.log('\n          ↑ the 3S-A defect reproducing. If migration 38 is in');
  console.log('            supabase/migrations but not applied to this project,');
  console.log('            apply it and run again.\n');
}
check('4. …and the refusal names the chain, not this version',
  /correction chain/i.test(attack.raw) && /reverse/i.test(attack.raw), attack.raw);

const held = (await week()).summary;
check('5. nothing moved: owed, settled and outstanding are where they were',
  held.current_entitlement_cents === before.current_entitlement_cents
  && held.effective_settled_cents === before.effective_settled_cents
  && held.outstanding_cents === before.outstanding_cents && held.outstanding_cents >= 0,
  `owed ${held.current_entitlement_cents}, settled ${held.effective_settled_cents}, outstanding ${held.outstanding_cents}`);
check('6. …the head is still sent and still current',
  (await get(A.token, `tip_distributions?select=status&id=eq.${B_ID}`)).rows?.[0]?.status === 'sent');
check('7. …its pool is still distributed',
  (await get(A.token, `tip_pools?select=status&id=eq.${PAID.poolId}`)).rows?.[0]?.status === 'distributed');
check('8. …and the payment still stands',
  (await get(A.token, `distribution_payout_reversals?select=id&payout_id=eq.${PAY}`)).rows?.length === 0);

// Three deep: A ← B ← C, money still on A.
const C_ID = await correct(B_ID, 'Once more.');
check('9. a chain three deep still publishes normally',
  C_ID !== null
  && (await get(A.token, `tip_distributions?select=status&id=eq.${B_ID}`)).rows?.[0]?.status === 'cancelled');
const deep = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: C_ID, p_reason: 'abandon it' });
check('10. …and the head of A←B←C cannot be abandoned either',
  rpcRefused(deep), `HTTP ${deep.status} ${deep.raw}`);

// A chain nothing was ever paid on still cancels.
const CLEAN_B = await correct(CLEAN.distId, 'Corrected, never paid.');
const cleanCancel = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: CLEAN_B, p_reason: 'never happened' });
check('11. a corrected chain with nothing paid on it anywhere still cancels',
  !rpcRefused(cleanCancel), `HTTP ${cleanCancel.status} ${cleanCancel.raw}`);

// The way through.
const reversal = await rpc(A.token, 'reverse_distribution_payout',
  { p_payout_id: PAY, p_reason: 'recorded_by_mistake', p_note: 'never actually paid' });
check('12. reversing the ancestor payment is allowed', !rpcRefused(reversal),
  `HTTP ${reversal.status} ${reversal.raw}`);
const after = await rpc(A.token, 'cancel_distribution',
  { p_distribution_id: C_ID, p_reason: 'abandon it' });
check('13. …and only then may the chain be abandoned', !rpcRefused(after),
  `HTTP ${after.status} ${after.raw}`);

const final = (await week()).summary;
check('14. the week ends coherent, and outstanding never went negative',
  final.current_entitlement_cents === 0 && final.effective_settled_cents === 0
  && final.outstanding_cents === 0,
  `owed ${final.current_entitlement_cents}, settled ${final.effective_settled_cents}, outstanding ${final.outstanding_cents}`);

// Migration 39, from a real client: identity is not a preference.
const me = (await get(A.token, 'profiles?select=id,email')).rows?.[0];
const rewrite = await patch(A.token, `profiles?id=eq.${me.id}`,
  { email: `squat-${STAMP}@tipcrew.invalid` });
check('15. a signed-in client cannot rewrite its own profile email',
  !rewrite.ok || (rewrite.rows?.length ?? 0) === 0, `HTTP ${rewrite.status} ${rewrite.raw}`);
if (rewrite.ok && (rewrite.rows?.length ?? 0) > 0) {
  // Only reachable on a project without migration 39 — which is the point of
  // the check. Put the address back rather than leaving the account unable to
  // be matched to its invitations.
  await patch(A.token, `profiles?id=eq.${me.id}`, { email: me.email });
  console.log(`          (restored ${me.email} — this project is missing migration 39)`);
}
const localeOk = await patch(A.token, `profiles?id=eq.${(await get(A.token, 'profiles?select=id')).rows[0].id}`,
  { locale: 'de' });
check('16. …but may still set its own language',
  localeOk.ok && (localeOk.rows?.length ?? 0) === 1, `HTTP ${localeOk.status} ${localeOk.raw}`);

console.log(`\n  ─────────────────────────────────────────────────────────`);
console.log(`  ${pass} passed, ${fail} failed`);
for (const f of failed) console.log(`    · ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
console.log(`\n  fixture workplace: ${WP}\n`);
process.exit(fail === 0 ? 0 : 1);
