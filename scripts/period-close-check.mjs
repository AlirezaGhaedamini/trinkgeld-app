/**
 * Live period-close and export verification for TipCrew Phase 3N.
 *
 * A close records that a manager reviewed and closed a period. It deletes
 * nothing, recalculates nothing, moves no money and freezes nothing — a mistake
 * found in October about a September shift is still a mistake, and correcting it
 * is still allowed. What a close buys is a marker: every record that arrives
 * afterwards is labelled, so nobody is left believing the closed figures already
 * contained it.
 *
 * The export is one read-only dataset with exactly one definition per total. The
 * rule that matters most: an original and the correction that replaced it are
 * never added together, or a corrected week reads as though the workplace owed
 * it twice.
 *
 *   node scripts/period-close-check.mjs
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp: the
 * one under test and a rival one the other test user manages. Inside the first it
 * builds three nights of one week, corrects one of them, records and reverses
 * payments, closes the week and then keeps working inside it. Point it at a
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
/**
 * A write is refused if the server rejected it, or if RLS silently filtered the
 * row so that nothing was touched. Both are the same answer to the caller: you
 * did not change that. Never infer either one from a table-wide count.
 */
const refused = (r) => !r.ok || (r.rows?.length ?? 0) === 0;

const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();


console.log(`\n  TipCrew — live period-close and export verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Close Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Close Rival ${STAMP}` });
const WP_OTHER = typeof rival.body === 'string' ? rival.body : null;
if (!WP_OTHER) die(`the rival create_workplace failed: HTTP ${rival.status}`);

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
 *
 * create_pool_from_reports builds a temp table `on commit drop`, so each night
 * is its own request — two calls in one transaction collide on it.
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
  return { day, poolId, distId };
}
async function send(distId) {
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: distId });
  if (!sent.ok) die(`send_distribution failed: HTTP ${sent.status} ${sent.raw}`);
  return distId;
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
  return send(id);
}
async function payFor(distId, method, note) {
  const made = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: distId, p_method: method, p_note: note });
  const id = typeof made.body === 'string' ? made.body : null;
  if (!id) die(`record_distribution_payout failed: HTTP ${made.status} ${made.raw}`);
  return id;
}

/* ── readers ─────────────────────────────────────────────────────────────── */

const readiness = (token, start, end, wp = WP) =>
  rpc(token, 'financial_period_readiness',
    { p_workplace_id: wp, p_period_start: start, p_period_end: end });
const exportPeriod = (token, start, end, wp = WP) =>
  rpc(token, 'financial_period_export',
    { p_workplace_id: wp, p_period_start: start, p_period_end: end });
const closePeriod = (token, start, end, note, wp = WP) =>
  rpc(token, 'close_financial_period', {
    p_workplace_id: wp, p_period_start: start, p_period_end: end,
    ...(note === undefined ? {} : { p_note: note }),
  });
const CLOSE_COLS = 'id,workplace_id,period_start,period_end,note,closed_at,closed_by,created_at';
const closeRows = (token = A.token, wp = WP) =>
  get(token, `financial_period_closes?select=${CLOSE_COLS}&workplace_id=eq.${wp}&order=period_start`);

/**
 * The week under test, and the days either side of it.
 *
 * These are BUSINESS dates: work_date is written by app.shifts_before_write()
 * from the workplace's timezone and its business_day_start_hour, so a night is
 * on the day the workplace says it is on. Nothing here recomputes one.
 */
const WEEK_START = '2017-03-06';
const WEEK_END = '2017-03-12';
const NEXT_START = '2017-03-13';
const NEXT_END = '2017-03-19';

const N1 = await night('2017-03-07', 90000);   // paid in full, left alone
const N2 = await night('2017-03-09', 60000);   // corrected, then paid
const N3 = await night('2017-03-16', 40000);   // the NEXT week, to prove the boundary
await send(N1.distId);
await send(N2.distId);
await send(N3.distId);

console.log(`  week under test: ${WEEK_START} … ${WEEK_END}`);
console.log(`  nights: ${N1.day} ${N1.distId}`);
console.log(`          ${N2.day} ${N2.distId}`);
console.log(`  next week: ${N3.day} ${N3.distId}\n`);
/* ── 1 · who may ask, and who may not ────────────────────────────────────── */
{
  const staff = await readiness(B.token, WEEK_START, WEEK_END);
  check('1. an employee cannot read the readiness of the workplace they work in',
    staff.status >= 400, `HTTP ${staff.status} ${staff.raw}`);

  const staffExport = await exportPeriod(B.token, WEEK_START, WEEK_END);
  check('2. …and cannot export it',
    staffExport.status >= 400, `HTTP ${staffExport.status} ${staffExport.raw}`);

  const staffClose = await closePeriod(B.token, WEEK_START, WEEK_END, 'let me in');
  check('3. …and cannot close it',
    staffClose.status >= 400, `HTTP ${staffClose.status} ${staffClose.raw}`);

  /* B manages a workplace — just not this one. Being a manager somewhere is
     not being a manager here, and the id in the request does not decide it. */
  const rivalRead = await readiness(B.token, WEEK_START, WEEK_END);
  const rivalExport = await exportPeriod(B.token, WEEK_START, WEEK_END);
  const rivalClose = await closePeriod(B.token, WEEK_START, WEEK_END, 'mine now');
  check('4. a manager of another workplace is refused all three, naming this one',
    rivalRead.status >= 400 && rivalExport.status >= 400 && rivalClose.status >= 400,
    `readiness ${rivalRead.status}, export ${rivalExport.status}, close ${rivalClose.status}`);

  const anonRead = await rpc(null, 'financial_period_readiness',
    { p_workplace_id: WP, p_period_start: WEEK_START, p_period_end: WEEK_END });
  const anonExport = await rpc(null, 'financial_period_export',
    { p_workplace_id: WP, p_period_start: WEEK_START, p_period_end: WEEK_END });
  const anonClose = await rpc(null, 'close_financial_period',
    { p_workplace_id: WP, p_period_start: WEEK_START, p_period_end: WEEK_END });
  check('5. an unauthenticated caller is refused all three',
    anonRead.status >= 400 && anonExport.status >= 400 && anonClose.status >= 400,
    `readiness ${anonRead.status}, export ${anonExport.status}, close ${anonClose.status}`);

  const mine = await readiness(A.token, WEEK_START, WEEK_END);
  check('6. the manager of this workplace is answered',
    mine.ok && typeof mine.body?.can_close === 'boolean', `HTTP ${mine.status} ${mine.raw}`);
}

/* ── 2 · the dates are taken as given, and checked ───────────────────────── */
{
  const backwards = await readiness(A.token, WEEK_END, WEEK_START);
  check('7. a period that ends before it starts is refused',
    backwards.status >= 400 && /ends before it starts/i.test(backwards.raw),
    `HTTP ${backwards.status} ${backwards.raw}`);

  const nullish = await rpc(A.token, 'financial_period_readiness',
    { p_workplace_id: WP, p_period_start: null, p_period_end: WEEK_END });
  check('8. …and so is a period with no start',
    nullish.status >= 400, `HTTP ${nullish.status} ${nullish.raw}`);

  const backwardsClose = await closePeriod(A.token, WEEK_END, WEEK_START, null);
  check('9. the close refuses the same shape rather than storing it',
    backwardsClose.status >= 400, `HTTP ${backwardsClose.status} ${backwardsClose.raw}`);

  /* The boundary is inclusive at both ends, so a night ON the last day is in
     the period and a night the day after is not. */
  const week = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const ids = (week.body?.distributions ?? []).map((d) => d.id);
  check('10. a night in the week is in the period',
    ids.includes(N1.distId) && ids.includes(N2.distId), `${ids.length} distribution(s)`);
  check('11. …and a night in the following week is not',
    !ids.includes(N3.distId), `next week's ${N3.distId} ${ids.includes(N3.distId) ? 'leaked in' : 'stayed out'}`);

  const edge = await exportPeriod(A.token, N1.day, N1.day);
  const edgeIds = (edge.body?.distributions ?? []).map((d) => d.id);
  check('12. a single-day period is the one day, inclusive at both ends',
    edgeIds.length === 1 && edgeIds[0] === N1.distId, `${edgeIds.length} distribution(s)`);
}

/* ── 3 · what blocks a close, and what merely gets said ──────────────────── */
{
  const before = await readiness(A.token, WEEK_START, WEEK_END);
  check('13. a week whose work is finished is ready to close',
    before.body?.can_close === true, JSON.stringify(before.body?.blocking ?? {}));
  check('14. …counting both nights',
    before.body?.distributions === 2, `${before.body?.distributions}`);
  check('15. unpaid distributions are a warning, not a blocker',
    before.body?.warnings?.unpaid_distributions === 2 && before.body?.can_close === true,
    `${before.body?.warnings?.unpaid_distributions} unpaid, can_close ${before.body?.can_close}`);
  check('16. …and so are shares nobody has confirmed',
    (before.body?.warnings?.unacknowledged_shares ?? 0) > 0 && before.body?.can_close === true,
    `${before.body?.warnings?.unacknowledged_shares} unconfirmed`);

  /* A draft: calculated, never sent. The week's result is undecided. */
  const spare = await night('2017-03-11', 20000);
  const withDraft = await readiness(A.token, WEEK_START, WEEK_END);
  check('17. a distribution calculated and never sent blocks the close',
    withDraft.body?.can_close === false && withDraft.body?.blocking?.draft_distributions === 1,
    `drafts ${withDraft.body?.blocking?.draft_distributions}, can_close ${withDraft.body?.can_close}`);

  const blocked = await closePeriod(A.token, WEEK_START, WEEK_END, null);
  check('18. …and the close refuses, saying what is unfinished',
    blocked.status >= 400 && /draft distribution/i.test(blocked.raw),
    `HTTP ${blocked.status} ${blocked.raw}`);
  check('19. …recording nothing while it refuses',
    ((await closeRows()).rows ?? []).length === 0,
    `${((await closeRows()).rows ?? []).length} close row(s)`);

  await send(spare.distId);
  const cleared = await readiness(A.token, WEEK_START, WEEK_END);
  check('20. sending it clears the blocker',
    cleared.body?.can_close === true && cleared.body?.blocking?.draft_distributions === 0,
    `can_close ${cleared.body?.can_close}`);

  /* A question nobody has answered. */
  const entry = (await get(B.token,
    `tip_distribution_entries?select=id&distribution_id=eq.${spare.distId}&member_id=eq.${M_B}`)).rows?.[0];
  const asked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: spare.distId, p_note: 'My hours look short on this night.' });
  check('21. an employee can raise a question on a sent distribution',
    asked.ok, `HTTP ${asked.status} ${asked.raw} (entry ${entry?.id ?? 'none'})`);
  const withQuestion = await readiness(A.token, WEEK_START, WEEK_END);
  check('22. an unanswered question blocks the close',
    withQuestion.body?.can_close === false && withQuestion.body?.blocking?.open_questions === 1,
    `open ${withQuestion.body?.blocking?.open_questions}, can_close ${withQuestion.body?.can_close}`);

  const query = (await get(A.token,
    `distribution_queries?select=id&distribution_id=eq.${spare.distId}`)).rows?.[0];
  const agreed = await rpc(A.token, 'resolve_query',
    { p_query_id: query?.id, p_outcome: 'correction_required', p_response: 'You are right.' });
  check('23. the manager can agree the figure was wrong',
    agreed.ok, `HTTP ${agreed.status} ${agreed.raw}`);
  const withAgreement = await readiness(A.token, WEEK_START, WEEK_END);
  check('24. …and an agreed correction with nothing sent still blocks the close',
    withAgreement.body?.can_close === false &&
      withAgreement.body?.blocking?.agreed_corrections_not_sent === 1 &&
      withAgreement.body?.blocking?.open_questions === 0,
    `agreed ${withAgreement.body?.blocking?.agreed_corrections_not_sent}, open ${withAgreement.body?.blocking?.open_questions}`);

  /* Preparing the correction without sending it is not finishing it either. */
  const draftCorrection = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: spare.distId });
  const draftCorrectionId = typeof draftCorrection.body === 'string' ? draftCorrection.body : null;
  check('25. a correction prepared and never sent blocks the close in its own right',
    (await readiness(A.token, WEEK_START, WEEK_END)).body?.blocking?.draft_corrections === 1,
    `draft correction ${draftCorrectionId ?? draftCorrection.raw}`);

  await moveService(M_B, spare.day, 15);
  const remade = await rpc(A.token, 'create_replacement_distribution', { p_original_id: spare.distId });
  const remadeId = typeof remade.body === 'string' ? remade.body : null;
  await send(remadeId ?? draftCorrectionId);
  const done = await readiness(A.token, WEEK_START, WEEK_END);
  check('26. sending the correction clears every blocker at once',
    done.body?.can_close === true, JSON.stringify(done.body?.blocking ?? {}));
  globalThis.SPARE = { ...spare, correctionId: remadeId ?? draftCorrectionId };
}

/* ── 4 · the correction, and the total that must not double ──────────────── */
{
  const beforeCorr = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const owedBefore = beforeCorr.body?.summary?.current_entitlement_cents ?? 0;

  await moveService(M_B, N2.day, 15);
  const correctionId = await correctAndSend(N2.distId, 'hours',
    'The start time on the service shift was an hour out.');
  globalThis.N2_CORRECTION = correctionId;

  const after = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const s = after.body?.summary ?? {};
  const rows = after.body?.distributions ?? [];
  const original = rows.find((d) => d.id === N2.distId);
  const replacement = rows.find((d) => d.id === correctionId);

  check('27. a correction leaves both versions in the export, not one',
    !!original && !!replacement, `original ${!!original}, replacement ${!!replacement}`);
  check('28. …the replaced version marked as no longer current',
    original?.is_current === false && original?.status === 'cancelled',
    `is_current ${original?.is_current}, status ${original?.status}`);
  check('29. …the replacement marked as current and as a correction',
    replacement?.is_current === true && replacement?.is_correction === true &&
      replacement?.supersedes_id === N2.distId,
    `current ${replacement?.is_current}, correction ${replacement?.is_correction}`);
  check('30. …carrying who started it and why, in the words it was given in',
    replacement?.correction_source === 'manager' &&
      replacement?.correction_reason === 'hours' &&
      /an hour out/.test(replacement?.correction_note ?? ''),
    `source ${replacement?.correction_source}, reason ${replacement?.correction_reason}`);

  /* THE assertion of this phase. A replacement reuses the pool, and the engine
     refuses entries that do not sum to it, so the two versions are the same
     money seen twice. Adding them is the failure mode. */
  const both = (original?.entitlement_cents ?? 0) + (replacement?.entitlement_cents ?? 0);
  check('31. what the week owes counts the corrected night once, not twice',
    s.current_entitlement_cents === owedBefore &&
      s.current_entitlement_cents !== both,
    `owed ${s.current_entitlement_cents}, unchanged from ${owedBefore}, and not ${both}`);
  /* Both totals are PERIOD-WIDE aggregates over every non-draft version, not
     facts about one lineage: the export sums `entries_total_cents` across the
     whole scope, split only by status. This week legitimately holds more than
     one corrected night, so the expectations below are derived from the rows
     the export actually returned rather than from one hardcoded pair. */
  const sumOf = (xs) => xs.reduce((t, d) => t + d.entitlement_cents, 0);
  const currentRows = rows.filter((d) => d.is_current);
  const replacedRows = rows.filter((d) => !d.is_current);

  check('32. …with every superseded version reported separately, and none omitted',
    s.replaced_entitlement_cents === sumOf(replacedRows) &&
      s.distributions_replaced === replacedRows.length &&
      replacedRows.some((d) => d.id === N2.distId),
    `replaced ${s.replaced_entitlement_cents} over ${replacedRows.length} row(s), N2 among them: ${replacedRows.some((d) => d.id === N2.distId)}`);
  check('33. …and never added into what the period owes',
    s.current_entitlement_cents === sumOf(currentRows) &&
      s.replaced_entitlement_cents === sumOf(replacedRows) &&
      s.current_entitlement_cents + s.replaced_entitlement_cents === sumOf(rows) &&
      s.current_entitlement_cents < sumOf(rows),
    `current ${s.current_entitlement_cents} + replaced ${s.replaced_entitlement_cents} = every version ${sumOf(rows)}`);
  /* The structural fact both of the above rest on: a replacement reuses the
     original's pool, app.guard_pool_amounts() freezes a distributed pool, and
     the engine refuses entries that do not sum to it — so a lineage's total
     cannot move. Lettered rather than renumbered, as the SQL suites do. */
  check('33b. a correction carries the same total as the version it replaces',
    typeof original?.entitlement_cents === 'number' &&
      original.entitlement_cents === replacement?.entitlement_cents &&
      replacement?.supersedes_id === original.id,
    `${original?.entitlement_cents} → ${replacement?.entitlement_cents}`);
  check('34. the counts agree with the rows',
    s.distributions_current === rows.filter((d) => d.is_current).length &&
      s.distributions_replaced === rows.filter((d) => !d.is_current).length &&
      s.corrections === rows.filter((d) => d.is_correction).length,
    `current ${s.distributions_current}, replaced ${s.distributions_replaced}, corrections ${s.corrections}`);

  /* A draft is not a fact about the week yet, so it is not in the export at
     all — while readiness counts it, because it is what stops the close. */
  const spare2 = await night('2017-03-10', 15000);
  const withDraft = await exportPeriod(A.token, WEEK_START, WEEK_END);
  check('35. a draft never appears in the export',
    !(withDraft.body?.distributions ?? []).some((d) => d.id === spare2.distId),
    `draft ${spare2.distId}`);
  check('36. …while readiness still counts it, because it is what blocks the close',
    (await readiness(A.token, WEEK_START, WEEK_END)).body?.blocking?.draft_distributions === 1,
    'readiness and export answer different questions on purpose');
  await send(spare2.distId);
  globalThis.SPARE2 = spare2;
}

/* ── 5 · money moving, and money taken back ──────────────────────────────── */
{
  const P1 = await payFor(N1.distId, 'cash', 'Paid out on the night.');
  const P2 = await payFor(globalThis.N2_CORRECTION, 'bank_transfer', 'Sent with the March run.');
  globalThis.P1 = P1;
  globalThis.P2 = P2;

  const paid = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const s = paid.body?.summary ?? {};
  check('37. a payout appears as a settlement event on its distribution',
    (paid.body?.distributions ?? []).find((d) => d.id === N1.distId)?.settlement
      ?.some((e) => e.kind === 'payout' && e.payout_id === P1),
    `payout ${P1}`);
  check('38. …with the method, the note and the manager who recorded it',
    (() => {
      const e = (paid.body?.distributions ?? []).find((d) => d.id === N1.distId)
        ?.settlement?.find((x) => x.payout_id === P1);
      return e?.method === 'cash' && /on the night/.test(e?.note ?? '') && !!e?.actor_name;
    })(), 'method, note and actor name');
  check('39. what still counts is what has actually been paid',
    s.effective_settled_cents === s.payout_total_cents && s.payout_events === 2,
    `settled ${s.effective_settled_cents}, gross ${s.payout_total_cents}, events ${s.payout_events}`);
  check('40. …and outstanding is what is owed minus that, by arithmetic',
    s.outstanding_cents === s.current_entitlement_cents - s.effective_settled_cents,
    `${s.current_entitlement_cents} - ${s.effective_settled_cents} = ${s.outstanding_cents}`);

  const reversed = await rpc(A.token, 'reverse_distribution_payout',
    { p_payout_id: P2, p_reason: 'payment_not_completed', p_note: 'The transfer bounced.' });
  check('41. a payout can be taken back',
    reversed.ok, `HTTP ${reversed.status} ${reversed.raw}`);

  const after = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const t = after.body?.summary ?? {};
  check('42. the reversed payout is still reported as an event that happened',
    t.payout_events === 2 && t.payout_total_cents === s.payout_total_cents,
    `events ${t.payout_events}, gross ${t.payout_total_cents}`);
  check('43. …with the reversal beside it, as its own event',
    t.reversal_events === 1 && t.reversal_total_cents > 0,
    `reversals ${t.reversal_events}, ${t.reversal_total_cents}`);
  check('44. …and the money that still counts is gross minus reversed',
    t.effective_settled_cents === t.payout_total_cents - t.reversal_total_cents,
    `${t.payout_total_cents} - ${t.reversal_total_cents} = ${t.effective_settled_cents}`);
  check('45. …so the reversed amount is outstanding again',
    t.outstanding_cents === t.current_entitlement_cents - t.effective_settled_cents &&
      t.outstanding_cents > s.outstanding_cents,
    `outstanding ${s.outstanding_cents} → ${t.outstanding_cents}`);
  check('46. the reversed payout no longer counts, but is not deleted',
    (() => {
      const evs = (after.body?.distributions ?? [])
        .find((d) => d.id === globalThis.N2_CORRECTION)?.settlement ?? [];
      const p = evs.find((e) => e.payout_id === P2 && e.kind === 'payout');
      const r = evs.find((e) => e.payout_id === P2 && e.kind === 'reversal');
      return p?.still_counts === false && !!r && r.amount_cents === -p.amount_cents;
    })(), 'the payout stands as history, marked as not counting');

  /* Pay it again, properly. */
  globalThis.P3 = await payFor(globalThis.N2_CORRECTION, 'cash', 'Paid in cash instead.');
  const settled = (await exportPeriod(A.token, WEEK_START, WEEK_END)).body?.summary ?? {};
  check('47. paying again settles it, and the totals close',
    settled.payout_events === 3 && settled.reversal_events === 1 &&
      settled.effective_settled_cents === settled.payout_total_cents - settled.reversal_total_cents,
    `events ${settled.payout_events}, settled ${settled.effective_settled_cents}`);
}

/* ── 6 · closing it ──────────────────────────────────────────────────────── */
{
  const ready = await readiness(A.token, WEEK_START, WEEK_END);
  if (ready.body?.can_close !== true) {
    die(`the week is not closeable before the close checks: ${JSON.stringify(ready.body?.blocking)}`);
  }

  const tooLong = await closePeriod(A.token, WEEK_START, WEEK_END, 'x'.repeat(501));
  check('48. a note longer than the limit is refused',
    tooLong.status >= 400 && /too long/i.test(tooLong.raw), `HTTP ${tooLong.status} ${tooLong.raw}`);
  check('49. …and the refusal records nothing',
    ((await closeRows()).rows ?? []).length === 0,
    `${((await closeRows()).rows ?? []).length} close row(s)`);

  const closed = await closePeriod(A.token, WEEK_START, WEEK_END, '  Reviewed with the March run.  ');
  const CLOSE_ID = typeof closed.body === 'string' ? closed.body : null;
  globalThis.CLOSE_ID = CLOSE_ID;
  check('50. the week closes, and the close has an id',
    closed.ok && !!CLOSE_ID, `HTTP ${closed.status} ${closed.raw}`);

  const rows = (await closeRows()).rows ?? [];
  const row = rows.find((r) => r.id === CLOSE_ID);
  check('51. …recorded once, over the dates that were asked for',
    rows.length === 1 && row?.period_start === WEEK_START && row?.period_end === WEEK_END,
    `${rows.length} row(s), ${row?.period_start}…${row?.period_end}`);
  check('52. …with the actor derived from the session, never sent by the caller',
    row?.closed_by === M_A, `closed_by ${row?.closed_by}, manager membership ${M_A}`);
  check('53. …and the time put on it by the server',
    typeof row?.closed_at === 'string' && Math.abs(Date.now() - Date.parse(row.closed_at)) < 10 * 60 * 1000,
    `closed_at ${row?.closed_at}`);
  check('54. …the note stored trimmed',
    row?.note === 'Reviewed with the March run.', JSON.stringify(row?.note));

  /* Migration 25's definition of blank, on an optional field: a note that is
     only whitespace is no note, not a note made of whitespace. */
  const blankNote = await closePeriod(A.token, NEXT_START, NEXT_END, '  \n\t ​ ');
  const blankId = typeof blankNote.body === 'string' ? blankNote.body : null;
  const blankRow = ((await closeRows()).rows ?? []).find((r) => r.id === blankId);
  check('55. a whitespace-only note is stored as no note at all',
    blankNote.ok && blankRow?.note === null, `HTTP ${blankNote.status}, note ${JSON.stringify(blankRow?.note)}`);
  check('56. …and the neighbouring week closes, because the boundary is inclusive',
    blankNote.ok && blankRow?.period_start === NEXT_START,
    `${blankRow?.period_start}…${blankRow?.period_end} follows ${WEEK_END}`);

  const again = await closePeriod(A.token, WEEK_START, WEEK_END, null);
  check('57. closing the same week twice is refused',
    again.status >= 400 && /already been closed/i.test(again.raw),
    `HTTP ${again.status} ${again.raw}`);
  const straddle = await closePeriod(A.token, '2017-03-08', '2017-03-15', null);
  check('58. …and so is a period that straddles two closed ones',
    straddle.status >= 400 && /already been closed/i.test(straddle.raw),
    `HTTP ${straddle.status} ${straddle.raw}`);
  const inside = await closePeriod(A.token, '2017-03-08', '2017-03-09', null);
  check('59. …and one that sits entirely inside a closed one',
    inside.status >= 400, `HTTP ${inside.status} ${inside.raw}`);
  check('60. …leaving exactly the two real closes behind',
    ((await closeRows()).rows ?? []).length === 2,
    `${((await closeRows()).rows ?? []).length} close row(s)`);

  const separate = await closePeriod(A.token, '2017-04-03', '2017-04-09', null);
  check('61. a week that overlaps nothing still closes',
    separate.ok, `HTTP ${separate.status} ${separate.raw}`);
}

/* ── 7 · a close is a record of a decision ───────────────────────────────── */
{
  const CLOSE_ID = globalThis.CLOSE_ID;
  const edited = await patch(A.token, `financial_period_closes?id=eq.${CLOSE_ID}`,
    { note: 'actually, something else' });
  check('62. a close cannot be edited, even by the manager who made it',
    refused(edited), `HTTP ${edited.status} ${edited.raw}`);
  const moved = await patch(A.token, `financial_period_closes?id=eq.${CLOSE_ID}`,
    { period_end: '2017-03-20' });
  check('63. …and its dates cannot be moved',
    refused(moved), `HTTP ${moved.status} ${moved.raw}`);
  const removed = await del(A.token, `financial_period_closes?id=eq.${CLOSE_ID}`);
  check('64. …and it cannot be deleted',
    refused(removed), `HTTP ${removed.status} ${removed.raw}`);

  const still = ((await closeRows()).rows ?? []).find((r) => r.id === CLOSE_ID);
  check('65. …so the close is exactly as it was recorded',
    still?.note === 'Reviewed with the March run.' && still?.period_end === WEEK_END,
    `note ${JSON.stringify(still?.note)}, end ${still?.period_end}`);

  /* The RPC is the only door: there is no insert policy at all. */
  const forged = await post(A.token, 'financial_period_closes', {
    workplace_id: WP, period_start: '2017-05-01', period_end: '2017-05-07',
    closed_by: M_A, note: 'straight in' });
  check('66. a close cannot be written directly, only through the RPC',
    refused(forged), `HTTP ${forged.status} ${forged.raw}`);

  const staffSees = await get(B.token, `financial_period_closes?select=id&workplace_id=eq.${WP}`);
  check('67. an employee cannot read the closes of the workplace they work in',
    (staffSees.rows?.length ?? 0) === 0, `${staffSees.rows?.length ?? 0} row(s) visible`);
  const anonSees = await get(null, `financial_period_closes?select=id&workplace_id=eq.${WP}`);
  check('68. …and an unauthenticated caller sees none either',
    (anonSees.rows?.length ?? 0) === 0, `HTTP ${anonSees.status}, ${anonSees.rows?.length ?? 0} row(s)`);

  const trail = await get(A.token,
    `audit_log?select=record_id,action,actor_member_id,after&workplace_id=eq.${WP}` +
    `&table_name=eq.financial_period_closes&order=created_at`);
  const rows = trail.rows ?? [];
  check('69. every close is on the audit trail, one insert each',
    rows.length === 3 && rows.every((r) => r.action === 'insert'),
    `${rows.length} audit row(s)`);
  check('70. …naming the manager and the period',
    (() => {
      const first = rows.find((r) => r.record_id === CLOSE_ID);
      return first?.actor_member_id === M_A && first?.after?.period_start === WEEK_START;
    })(), 'actor and period on the audit row');
}

/* ── 8 · a close freezes nothing ─────────────────────────────────────────── */
{
  const before = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const closedAt = before.body?.period?.close?.closed_at;
  check('71. the export names the close covering exactly this period',
    before.body?.period?.close?.id === globalThis.CLOSE_ID && !!closedAt,
    `close ${before.body?.period?.close?.id}`);
  check('72. …with who closed it and the note they left',
    !!before.body?.period?.close?.closed_by_name &&
      before.body?.period?.close?.note === 'Reviewed with the March run.',
    `${before.body?.period?.close?.closed_by_name}`);
  check('73. …and nothing yet arrived after it',
    before.body?.summary?.records_after_close === 0,
    `${before.body?.summary?.records_after_close} record(s) after the close`);

  const partial = await exportPeriod(A.token, WEEK_START, '2017-03-11');
  check('74. a period that is not exactly the closed one shows no close',
    partial.body?.period?.close === null,
    'a partial overlap is not this period\'s close and is not shown as one');

  /* THE point of the phase. October's mistake about a March shift is still a
     mistake, and this product fixes one by replacing the version. */
  await moveService(M_B, N1.day, 17);
  const lateCorrection = await correctAndSend(N1.distId, 'hours',
    'Found in the payroll review, after the close.');
  check('75. a correction is still allowed inside a closed period',
    !!lateCorrection, `correction ${lateCorrection}`);

  const afterCorr = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const still = ((await closeRows()).rows ?? []).find((r) => r.id === globalThis.CLOSE_ID);
  check('76. …and the close is not rewritten to accommodate it',
    still?.closed_at === closedAt && still?.note === 'Reviewed with the March run.',
    `closed_at unchanged: ${still?.closed_at === closedAt}`);
  check('77. …the correction is marked as having arrived after the close',
    (afterCorr.body?.distributions ?? []).find((d) => d.id === lateCorrection)?.after_close === true,
    'after_close on the replacement');
  check('78. …and the versions that were there before are not',
    (afterCorr.body?.distributions ?? []).find((d) => d.id === N2.distId)?.after_close === false,
    'after_close false on a record that predates the close');
  check('79. …counted, so nobody believes the closed figures contained it',
    (afterCorr.body?.summary?.records_after_close ?? 0) >= 1,
    `${afterCorr.body?.summary?.records_after_close} record(s) after the close`);

  /* The lineage total cannot move, so the correction settles a delta. Paying
     it after the close is money moving inside a closed period, which is
     exactly what a payroll run does. */
  const latePayout = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: lateCorrection, p_method: 'payroll', p_note: 'April payroll.' });
  check('80. a payment can still be recorded inside a closed period',
    latePayout.ok, `HTTP ${latePayout.status} ${latePayout.raw}`);

  const afterPay = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const late = (afterPay.body?.distributions ?? []).find((d) => d.id === lateCorrection);
  check('81. …and it is marked as after the close too',
    late?.settlement?.some((e) => e.kind === 'payout' && e.after_close === true),
    'after_close on the settlement event');
  check('82. …and counted in the same tally',
    (afterPay.body?.summary?.records_after_close ?? 0) >
      (afterCorr.body?.summary?.records_after_close ?? 0),
    `${afterCorr.body?.summary?.records_after_close} → ${afterPay.body?.summary?.records_after_close}`);

  /* A payment recorded in April for a March night is March's money. The export
     follows the distribution, never the date the payment was entered. */
  /* A new payout event does NOT imply more money settled, and this is the case
     that proves it. The late correction reuses N1's pool, so it is worth exactly
     what N1 was worth, and N1's payout still counts — so app.settled_entitlement()
     returns the full amount and record_distribution_payout() derives a delta of
     ZERO. The event is real, belongs to this period, and adds nothing, which is
     precisely the Phase 3L/3M guarantee that a corrected night is never paid
     twice. Asserting an increase here would contradict the design. */
  const lateEvent = (late?.settlement ?? []).find((e) => e.kind === 'payout' && e.after_close);
  check('83. a payment entered later belongs to the period it settles, and settles a delta of zero',
    late?.period_start >= WEEK_START && late?.period_start <= WEEK_END &&
      !!lateEvent && lateEvent.amount_cents === 0 &&
      (afterPay.body?.summary?.effective_settled_cents ?? -1) ===
        (afterCorr.body?.summary?.effective_settled_cents ?? -2),
    `night ${late?.period_start}, delta ${lateEvent?.amount_cents}, settled unchanged at ${afterPay.body?.summary?.effective_settled_cents}`);

  const s = afterPay.body?.summary ?? {};
  check('84. and the totals still close after all of it',
    s.effective_settled_cents === s.payout_total_cents - s.reversal_total_cents &&
      s.outstanding_cents === s.current_entitlement_cents - s.effective_settled_cents,
    `${s.payout_total_cents} - ${s.reversal_total_cents} = ${s.effective_settled_cents}; owed ${s.current_entitlement_cents}, outstanding ${s.outstanding_cents}`);
  check('85. …with the corrected night still counted exactly once',
    s.current_entitlement_cents ===
      (afterPay.body?.distributions ?? []).filter((d) => d.is_current)
        .reduce((t, d) => t + d.entitlement_cents, 0),
    `owed ${s.current_entitlement_cents}`);
  globalThis.LATE = lateCorrection;
}

/* ── 9 · the basis is named, and it is not a snapshot ────────────────────── */
{
  const e = await exportPeriod(A.token, WEEK_START, WEEK_END);
  check('86. the export says which basis its figures are on, in the data',
    e.body?.period?.basis === 'current', `basis ${e.body?.period?.basis}`);
  check('87. …and carries the workplace context a spreadsheet needs to be read',
    !!e.body?.period?.workplace_name && !!e.body?.period?.currency &&
      !!e.body?.period?.timezone && typeof e.body?.period?.business_day_start_hour === 'number',
    `${e.body?.period?.workplace_name}, ${e.body?.period?.currency}, ${e.body?.period?.timezone}, from ${e.body?.period?.business_day_start_hour}:00`);
  check('88. …and when it was produced',
    typeof e.body?.period?.generated_at === 'string' &&
      Math.abs(Date.now() - Date.parse(e.body.period.generated_at)) < 10 * 60 * 1000,
    `generated_at ${e.body?.period?.generated_at}`);
}

/* ── 10 · what the export must never carry ───────────────────────────────── */
{
  const e = await exportPeriod(A.token, WEEK_START, WEEK_END);
  const text = JSON.stringify(e.body);

  check('89. no email address is in the export',
    !text.includes(A.email) && !text.includes(B.email) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(text),
    'no address anywhere in the dataset');
  check('90. no authentication id is in the export',
    !text.includes(A.userId) && !text.includes(B.userId),
    'neither user id appears');
  check('91. no token, key or secret is in the export',
    !text.includes(ANON) && !/service[_-]?role/i.test(text) && !/eyJ[A-Za-z0-9_-]{10,}/.test(text),
    'no key material');
  check('92. no join code is in the export',
    await (async () => {
      const code = (await get(A.token, `workplaces?select=join_code&id=eq.${WP}`)).rows?.[0]?.join_code;
      return !!code && !text.includes(code);
    })(), 'the workplace join code stays out');

  const people = (e.body?.distributions ?? []).flatMap((d) => d.members ?? []);
  check('93. people appear under the name frozen when the night was calculated',
    people.length > 0 && people.every((m) => typeof m.member_name === 'string' && m.member_name.length > 0),
    `${people.length} share row(s)`);
  check('94. …and carry no member id, user id or profile field',
    people.every((m) => !('member_id' in m) && !('user_id' in m) && !('email' in m) &&
      !('employee_number' in m) && !('avatar_url' in m)),
    'only the snapshot the distribution froze');
  check('95. …with the working figures a share is explained by',
    people.every((m) => typeof m.worked_minutes === 'number' && typeof m.units === 'number' &&
      typeof m.amount_cents === 'number' && typeof m.ack_status === 'string'),
    'hours, units, amount and acknowledgement');
  check('96. the shares of a distribution sum to what it says it is worth',
    (e.body?.distributions ?? []).every((d) =>
      (d.members ?? []).reduce((t, m) => t + m.amount_cents, 0) === d.entitlement_cents),
    'every version balances against its own entries');

  /* The rival workplace exists and has none of this in it. */
  const rivalExport = await exportPeriod(B.token, WEEK_START, WEEK_END, WP_OTHER);
  check('97. another workplace exports its own emptiness, not this one\'s figures',
    rivalExport.ok && (rivalExport.body?.distributions ?? []).length === 0 &&
      rivalExport.body?.summary?.current_entitlement_cents === 0,
    `HTTP ${rivalExport.status}, ${(rivalExport.body?.distributions ?? []).length} distribution(s)`);
  check('98. …and this workplace\'s export contains only its own nights',
    (e.body?.distributions ?? []).every((d) => typeof d.id === 'string') &&
      e.body?.period?.workplace_id === WP,
    `workplace ${e.body?.period?.workplace_id}`);
}

/* ── 11 · a correction that was published stays published ────────────────── */
/**
 * The regression for migration 29.
 *
 * Down a chain A <- B <- C, sending C cancels B, and B was the only row
 * superseding A. If readiness asks whether A's replacement is still LIVE rather
 * than whether it was ever SENT, A's long-since-answered question re-arms
 * `agreed_corrections_not_sent` and the period can never be closed again.
 *
 * THESE CHECKS FAIL UNTIL MIGRATION 29 IS PUSHED. Checks 101 and 102 assert the
 * fixed behaviour, so against a project still on migration 28 they report the
 * defect rather than a regression in the test.
 *
 * Run over the first week of May, which nothing else in this script closes, so
 * `overlapping_close` cannot mask the result.
 */
{
  const CHAIN_START = '2017-05-01';
  const CHAIN_END = '2017-05-07';

  const chainA = await night('2017-05-03', 70000);
  await send(chainA.distId);

  const asked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: chainA.distId, p_note: 'My hours look short on this night.' });
  const q = (await get(A.token,
    `distribution_queries?select=id&distribution_id=eq.${chainA.distId}&status=eq.open`)).rows?.[0];
  const agreed = await rpc(A.token, 'resolve_query',
    { p_query_id: q?.id, p_outcome: 'correction_required', p_response: 'You are right.' });
  const armed = await readiness(A.token, CHAIN_START, CHAIN_END);
  check('99. an agreed correction with nothing sent arms the blocker',
    asked.ok && agreed.ok &&
      armed.body?.blocking?.agreed_corrections_not_sent === 1 &&
      armed.body?.can_close === false,
    `agreed ${armed.body?.blocking?.agreed_corrections_not_sent}, can_close ${armed.body?.can_close}`);

  /* B: the correction the question asked for. Employee door, so no reason. */
  const madeB = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: chainA.distId });
  const B_ID = typeof madeB.body === 'string' ? madeB.body : null;
  await send(B_ID);
  const cleared = await readiness(A.token, CHAIN_START, CHAIN_END);
  check('100. publishing the correction clears it, and the period is closeable',
    cleared.body?.blocking?.agreed_corrections_not_sent === 0 &&
      cleared.body?.can_close === true,
    `agreed ${cleared.body?.blocking?.agreed_corrections_not_sent}, can_close ${cleared.body?.can_close}`);

  /* C: a second correction on the same night. B carries no question of its
     own, so this is the manager door. Sending it retires B. */
  const C_ID = await correctAndSend(B_ID, 'other', 'A second correction on the same night.');
  const after = await readiness(A.token, CHAIN_START, CHAIN_END);
  check('101. correcting the correction does not re-arm a question already answered',
    after.body?.blocking?.agreed_corrections_not_sent === 0,
    `agreed ${after.body?.blocking?.agreed_corrections_not_sent} (needs migration 29)`);
  check('102. …and the period stays closeable down a two-step chain',
    after.body?.can_close === true,
    `can_close ${after.body?.can_close}, blocking ${JSON.stringify(after.body?.blocking ?? {})}`);

  const retired = (await get(A.token,
    `tip_distributions?select=id,status,sent_at&id=eq.${B_ID}`)).rows?.[0];
  check('103. …because the retired correction still records that it was published',
    retired?.status === 'cancelled' && typeof retired?.sent_at === 'string',
    `status ${retired?.status}, sent_at ${retired?.sent_at}`);

  const closedChain = await closePeriod(A.token, CHAIN_START, CHAIN_END, null);
  check('104. …so the week can actually be closed',
    closedChain.ok, `HTTP ${closedChain.status} ${closedChain.raw}`);

  globalThis.CHAIN = { a: chainA.distId, b: B_ID, c: C_ID };
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    week closed           ${WEEK_START} … ${WEEK_END}  (${globalThis.CLOSE_ID})`);
console.log(`    corrected night       ${N2.distId} → ${globalThis.N2_CORRECTION}`);
console.log(`    corrected after close ${N1.distId} → ${globalThis.LATE}`);
console.log(`    two-step chain        ${globalThis.CHAIN?.a} → ${globalThis.CHAIN?.b} → ${globalThis.CHAIN?.c}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
