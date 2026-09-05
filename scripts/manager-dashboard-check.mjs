/**
 * Live manager-dashboard verification for TipCrew Phase 3P.
 *
 * One RPC, and every figure in it must agree with what the tables and the
 * settlement view already say. This proves that over PostgREST: the day is
 * the server's day, a night is counted once however often it is corrected,
 * acknowledgement is tallied per person, what is owed survives a payout, a
 * reversal and a repayment, and nobody but an active manager of the workplace
 * is answered.
 *
 *   node scripts/manager-dashboard-check.mjs
 *
 * THESE CHECKS FAIL UNTIL MIGRATION 32 IS PUSHED.
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp,
 * five nights, a three-link correction chain, three payouts, a reversal and
 * two period closes. Point it at a development project.
 *
 * NOT COVERED LIVE, because the script has two accounts: a pending join
 * request (the third account it would need) and a suspended manager (the only
 * manager cannot suspend themselves). Both are covered by
 * supabase/tests/21_manager_dashboard.sql.
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

/** `${date}T${hh}:${mm}:00Z` — UTC instants, so the server derives the business day. */
const isoAt = (d, hh, mm = 0) =>
  new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`).toISOString();
/** Plain calendar arithmetic on an ISO date, no timezone involved. */
function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

console.log(`\n  TipCrew — live manager-dashboard verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Dash Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status} ${createdWp.raw}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Dash Rival ${STAMP}` });
const WP_OTHER = typeof rival.body === 'string' ? rival.body : null;
if (!WP_OTHER) die(`the rival create_workplace failed: HTTP ${rival.status}`);

const STAFF_NAME = `Staff ${STAMP}`;
const invited = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: STAFF_NAME, p_role: 'employee',
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

const dash = (token, wp = WP) => rpc(token, 'manager_dashboard', { p_workplace_id: wp });

async function shift(memberId, startsAt, endsAt, areaId, roleId, status = 'approved') {
  const r = await post(A.token, 'shifts', {
    workplace_id: WP, member_id: memberId, starts_at: startsAt, ends_at: endsAt,
    break_minutes: 0, status, area_id: areaId, workplace_role_id: roleId });
  if (!r.ok) die(`shift insert failed: ${r.raw}`);
  return r.rows?.[0]?.id;
}
/** A past night, sent: A in service, B in service AND bar — one person, two entries. */
async function night(day, cashCents) {
  const report = await post(A.token, 'tip_reports', {
    workplace_id: WP, member_id: M_A, work_date: day, cash_cents: cashCents, card_cents: 0 });
  if (!report.rows?.[0]?.id) die(`tip_reports insert failed for ${day}: HTTP ${report.status}`);
  await shift(M_A, isoAt(day, 14), isoAt(day, 21), A_SERVICE, R_SERVER);
  await shift(M_B, isoAt(day, 14), isoAt(day, 18), A_SERVICE, R_SERVER);
  await shift(M_B, isoAt(day, 18), isoAt(day, 21), A_BAR, R_KEEP);
  const pooled = await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: day, p_period_end: day });
  const poolId = typeof pooled.body === 'string' ? pooled.body : null;
  if (!poolId) die(`create_pool_from_reports failed for ${day}: ${pooled.raw}`);
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: poolId });
  const distId = typeof calc.body === 'string' ? calc.body : null;
  if (!distId) die(`calculate_distribution failed for ${day}: ${calc.raw}`);
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: distId });
  if (!sent.ok) die(`send_distribution failed for ${day}: ${sent.raw}`);
  return { day, poolId, distId };
}
async function payFor(distId, method) {
  const made = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: distId, ...(method ? { p_method: method } : {}) });
  const id = typeof made.body === 'string' ? made.body : null;
  if (!id) die(`record_distribution_payout failed: ${made.raw}`);
  return id;
}
/** The settlement view's own answer, so the RPC is checked against it rather than a number. */
async function expected() {
  const rows = (await get(A.token,
    `distribution_settlement?select=settlement_due_cents,payout_status,status&workplace_id=eq.${WP}&status=in.(sent,confirmed)`)).rows ?? [];
  return {
    unpaid: rows.filter((r) => r.payout_status !== 'paid').length,
    outstanding: rows.reduce((t, r) => t + Number(r.settlement_due_cents), 0),
  };
}

/* ── 1 · an empty workplace, and who is answered ─────────────────────────── */
{
  const empty = await dash(B.token, WP_OTHER);
  const e = empty.body ?? {};
  check('1. an empty workplace reads as empty: nothing needing attention',
    empty.ok && e.attention?.submitted_shifts === 0 && e.attention?.open_questions === 0 &&
      e.attention?.draft_distributions === 0 && e.attention?.pending_join_requests === 0,
    `HTTP ${empty.status} ${JSON.stringify(e.attention ?? empty.raw)}`);
  check('2. …no latest night, no close, no pool, no recent list, nothing owed',
    e.latest === null && e.close === null && e.tonight?.pool === null &&
      Array.isArray(e.recent) && e.recent.length === 0 &&
      e.week?.entitlement_cents === 0 && e.settlement?.outstanding_cents === 0,
    JSON.stringify({ latest: e.latest, close: e.close, recent: e.recent?.length }));

  const asEmployee = await dash(B.token, WP);
  check('3. an employee of the workplace is refused',
    asEmployee.status >= 400, `HTTP ${asEmployee.status} ${asEmployee.raw}`);
  const asOther = await dash(A.token, WP_OTHER);
  check('4. a manager of another workplace is refused',
    asOther.status >= 400, `HTTP ${asOther.status} ${asOther.raw}`);
  const anon = await rpc(null, 'manager_dashboard', { p_workplace_id: WP });
  check('5. an unauthenticated caller is refused',
    anon.status >= 400, `HTTP ${anon.status} ${anon.raw}`);
}

/* ── 2 · the day is the server's day ─────────────────────────────────────── */
const first = await dash(A.token);
if (!first.ok) die(`manager_dashboard failed: HTTP ${first.status} ${first.raw}`);
const BD = first.body.business_date;
const WEEK_START = first.body.week_start;
const WEEK_END = first.body.week_end;
{
  const dow = new Date(`${WEEK_START}T12:00:00Z`).getUTCDay(); // 1 = Monday
  check('6. the dashboard names a business date, and the week is Monday to Sunday around it',
    /^\d{4}-\d{2}-\d{2}$/.test(BD) && dow === 1 && addDays(WEEK_START, 6) === WEEK_END &&
      BD >= WEEK_START && BD <= WEEK_END,
    `business_date ${BD}, week ${WEEK_START}…${WEEK_END}`);
  check('7. the manager of this workplace is answered, with nothing in it yet',
    first.body.latest === null && first.body.recent.length === 0,
    `latest ${first.body.latest}, recent ${first.body.recent.length}`);
}

/* ── 3 · history: four past nights, so the recent list has something to cap ─ */
const H = [];
for (const day of ['2018-05-01', '2018-05-02', '2018-05-03', '2018-05-04']) {
  H.push(await night(day, 50000));
}
{
  const d = (await dash(A.token)).body;
  check('8. the latest night is the most recent one sent',
    d.latest?.id === H[3].distId, `latest ${d.latest?.id}, expected ${H[3].distId}`);
  check('9. recent is capped at four, newest first',
    d.recent.length === 4 && d.recent[0].id === H[3].distId && d.recent[3].id === H[0].distId,
    `${d.recent.length} row(s)`);
  check('10. a member with two entries is one participant',
    d.latest?.participants === 2 && d.latest?.pending_people === 2,
    `participants ${d.latest?.participants}, pending ${d.latest?.pending_people}`);
}

/* ── 4 · tonight, across the 05:00 boundary ──────────────────────────────── */
/* UTC hours chosen so the Berlin wall clock stays before 05:00 in summer and
   winter alike: A anchors 18:00Z → next day 03:00Z; B works twice after
   midnight, bar 00:00Z–01:30Z and service 01:30Z–02:30Z, and only SUBMITS an
   afternoon shift. All of it is tonight's business day. */
const NEXT = addDays(BD, 1);
await shift(M_A, isoAt(BD, 18), isoAt(NEXT, 3), A_SERVICE, R_SERVER);
await shift(M_B, isoAt(NEXT, 0), isoAt(NEXT, 1, 30), A_BAR, R_KEEP);
const B_SERVICE_SHIFT = await shift(M_B, isoAt(NEXT, 1, 30), isoAt(NEXT, 2, 30), A_SERVICE, R_SERVER);
await shift(M_B, isoAt(BD, 14), isoAt(BD, 16), A_SERVICE, R_SERVER, 'submitted');
await post(A.token, 'tip_reports', {
  workplace_id: WP, member_id: M_A, work_date: BD, cash_cents: 100000, card_cents: 0 });
{
  const shifts = (await get(A.token,
    `shifts?select=member_id,work_date,status,worked_minutes,starts_at&workplace_id=eq.${WP}&work_date=eq.${BD}`)).rows ?? [];
  const afterMidnight = shifts.filter((s) => s.starts_at.slice(0, 10) === NEXT);
  check('11. shifts starting after midnight belong to tonight\'s business day',
    afterMidnight.length === 2 && afterMidnight.every((s) => s.work_date === BD),
    `${afterMidnight.length} shift(s) on ${NEXT} filed under ${BD}`);

  const approved = shifts.filter((s) => s.status === 'approved');
  const expPeople = new Set(approved.map((s) => s.member_id)).size;
  const expMinutes = approved.reduce((t, s) => t + s.worked_minutes, 0);
  const d = (await dash(A.token)).body;
  check('12. tonight\'s approved hours are the shifts on that day, people and minutes',
    d.tonight.approved_people === expPeople && d.tonight.approved_minutes === expMinutes &&
      expPeople === 2,
    `${d.tonight.approved_people} people, ${d.tonight.approved_minutes} min (expected ${expPeople}, ${expMinutes})`);
  check('13. the submitted shift is tonight\'s one to review and the workplace\'s one to review',
    d.tonight.submitted_shifts === 1 && d.attention.submitted_shifts === 1,
    `tonight ${d.tonight.submitted_shifts}, all ${d.attention.submitted_shifts}`);
  check('14. tonight\'s report is counted and summed, and there is no pool yet',
    d.tonight.reports_count === 1 && d.tonight.reports_total_cents === 100000 && d.tonight.pool === null,
    `${d.tonight.reports_count} report(s), ${d.tonight.reports_total_cents}`);

  /* Work in the rival workplace must not appear here. */
  const rivalMember = (await get(B.token,
    `workplace_members?select=id&workplace_id=eq.${WP_OTHER}&role=eq.manager`)).rows?.[0]?.id;
  await post(B.token, 'shifts', {
    workplace_id: WP_OTHER, member_id: rivalMember, starts_at: isoAt('2018-05-01', 14),
    ends_at: isoAt('2018-05-01', 18), break_minutes: 0, status: 'submitted' });
  const again = (await dash(A.token)).body;
  check('15. another workplace\'s submitted shift does not count here',
    again.attention.submitted_shifts === 1, `${again.attention.submitted_shifts}`);
}

/* ── 5 · pool, draft, sent ───────────────────────────────────────────────── */
const pooled = await rpc(A.token, 'create_pool_from_reports',
  { p_workplace_id: WP, p_period_start: BD, p_period_end: BD });
const POOL = typeof pooled.body === 'string' ? pooled.body : null;
if (!POOL) die(`create_pool_from_reports failed: ${pooled.raw}`);
{
  const d = (await dash(A.token)).body;
  check('16. an open pool with no distribution yet',
    d.tonight.pool?.status === 'open' && d.tonight.pool?.total_cents === 100000 && d.tonight.distribution === null,
    JSON.stringify(d.tonight.pool));
}
const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL });
const DA = typeof calc.body === 'string' ? calc.body : null;
if (!DA) die(`calculate_distribution failed: ${calc.raw}`);
{
  const d = (await dash(A.token)).body;
  check('17. a draft is tonight\'s distribution and an attention item, naming itself, and is not a recent night',
    d.tonight.distribution?.status === 'draft' && d.attention.draft_distributions === 1 &&
      d.attention.draft_distribution_id === DA && !d.recent.some((r) => r.id === DA),
    `draft ${d.attention.draft_distributions}, id ${d.attention.draft_distribution_id}, recent ${d.recent.map((r) => r.id).join(',')}`);
  check('18. …but a draft is never the latest night',
    d.latest?.id === H[3].distId, `latest ${d.latest?.id}`);
}
await rpc(A.token, 'send_distribution', { p_distribution_id: DA });
const DA_TOTAL = (await get(A.token, `tip_distributions?select=entries_total_cents&id=eq.${DA}`)).rows?.[0]?.entries_total_cents;
{
  const d = (await dash(A.token)).body;
  check('19. sending it clears the draft and makes it the latest night',
    d.attention.draft_distributions === 0 && d.tonight.distribution?.status === 'sent' && d.latest?.id === DA,
    `latest ${d.latest?.id}`);
  check('20. two people owe an answer — B once, not twice for two entries',
    d.latest?.participants === 2 && d.latest?.answerable_people === 2 &&
      d.latest?.pending_people === 2 && d.latest?.confirmed_people === 0,
    JSON.stringify({ p: d.latest?.participants, pend: d.latest?.pending_people }));
}

/* ── 6 · acknowledgement per person, and a question ──────────────────────── */
await rpc(B.token, 'acknowledge_distribution', { p_distribution_id: DA, p_status: 'acknowledged' });
await rpc(A.token, 'query_distribution', { p_distribution_id: DA, p_note: 'My own share looks short.' });
{
  const r = await dash(A.token);
  const d = r.body;
  check('21. one confirmed, one queried, nobody pending',
    d.latest?.confirmed_people === 1 && d.latest?.queried_people === 1 && d.latest?.pending_people === 0,
    JSON.stringify({ c: d.latest?.confirmed_people, q: d.latest?.queried_people, p: d.latest?.pending_people }));
  check('22. the question is open on the night and on the attention list, naming the night',
    d.latest?.open_questions === 1 && d.attention.open_questions === 1 &&
      d.attention.open_question_distribution_id === DA,
    `open ${d.attention.open_questions}, id ${d.attention.open_question_distribution_id}`);
  check('23. …and the words of the question are not in the dashboard',
    !r.raw.includes('looks short') && !JSON.stringify(d).includes('looks short'),
    'no query text');
}
const q = (await get(A.token, `distribution_queries?select=id&distribution_id=eq.${DA}&status=eq.open`)).rows?.[0];
await rpc(A.token, 'resolve_query', { p_query_id: q?.id, p_outcome: 'correction_required', p_response: 'You are right.' });
{
  const d = (await dash(A.token)).body;
  check('24. an agreed correction with nothing sent is the attention item, naming the night',
    d.attention.open_questions === 0 && d.attention.agreed_corrections_not_sent === 1 &&
      d.attention.agreed_correction_distribution_id === DA,
    `agreed ${d.attention.agreed_corrections_not_sent}`);
}

/* ── 7 · money: pay, correct, reverse, repay, correct again ──────────────── */
{
  const e0 = await expected();
  const d = (await dash(A.token)).body;
  check('25. unpaid and outstanding are the settlement view\'s answer',
    d.settlement.unpaid_distributions === e0.unpaid && d.settlement.outstanding_cents === e0.outstanding,
    `rpc ${d.settlement.unpaid_distributions}/${d.settlement.outstanding_cents}, view ${e0.unpaid}/${e0.outstanding}`);
  const currentTotal = ((await get(A.token,
    `tip_distributions?select=entries_total_cents&workplace_id=eq.${WP}&status=in.(sent,confirmed)`)).rows ?? [])
    .reduce((t, r) => t + r.entries_total_cents, 0);
  check('26. …and with nothing paid yet, outstanding is every current night\'s total',
    e0.outstanding === currentTotal, `${e0.outstanding} vs ${currentTotal}`);
  globalThis.OUT0 = e0.outstanding;
  globalThis.UNPAID0 = e0.unpaid;
}
const PA = await payFor(DA, 'cash');
{
  const d = (await dash(A.token)).body;
  check('27. paying the latest night marks it paid with nothing due',
    d.latest?.payout_state === 'paid' && d.latest?.settlement_due_cents === 0,
    `${d.latest?.payout_state}, due ${d.latest?.settlement_due_cents}`);
  check('28. …outstanding falls by exactly that night, and unpaid by one',
    d.settlement.outstanding_cents === globalThis.OUT0 - DA_TOTAL &&
      d.settlement.unpaid_distributions === globalThis.UNPAID0 - 1,
    `${globalThis.OUT0} -> ${d.settlement.outstanding_cents}`);
  globalThis.OUT1 = d.settlement.outstanding_cents;
}

/* Correct A into B: same pool, so B is worth what A was; A's payment still
   counts, so B owes nothing more — yet nobody has recorded paying B. */
await patch(A.token, `shifts?id=eq.${B_SERVICE_SHIFT}`, { locked: false });
await patch(A.token, `shifts?id=eq.${B_SERVICE_SHIFT}`, { ends_at: isoAt(NEXT, 2, 0) });
const madeB = await rpc(A.token, 'create_replacement_distribution', { p_original_id: DA });
const DB = typeof madeB.body === 'string' ? madeB.body : null;
if (!DB) die(`create_replacement_distribution failed: ${madeB.raw}`);
{
  const d = (await dash(A.token)).body;
  check('29. a prepared correction is an attention item; the agreement still stands; A is still latest and the only recent version of the night',
    d.attention.draft_corrections === 1 && d.attention.draft_correction_id === DB &&
      d.attention.agreed_corrections_not_sent === 1 && d.latest?.id === DA &&
      !d.recent.some((r) => r.id === DB) && d.recent.some((r) => r.id === DA),
    `${JSON.stringify(d.attention)} recent ${d.recent.map((r) => r.id).join(',')}`);
}
await rpc(A.token, 'send_distribution', { p_distribution_id: DB });
const DB_TOTAL = (await get(A.token, `tip_distributions?select=entries_total_cents&id=eq.${DB}`)).rows?.[0]?.entries_total_cents;
{
  const d = (await dash(A.token)).body;
  const e = await expected();
  check('30. sending the correction clears both attention items',
    d.attention.draft_corrections === 0 && d.attention.agreed_corrections_not_sent === 0,
    JSON.stringify(d.attention));
  check('31. the correction is the latest night and tonight\'s distribution',
    d.latest?.id === DB && d.latest?.is_correction === true &&
      d.tonight.distribution?.id === DB && d.tonight.distribution?.is_correction === true,
    `latest ${d.latest?.id}`);
  check('32. B is unpaid yet owes nothing: A\'s payment still settles the lineage',
    d.latest?.payout_state === 'unpaid' && d.latest?.settlement_due_cents === 0 &&
      d.settlement.outstanding_cents === e.outstanding && e.outstanding === globalThis.OUT1,
    `${d.latest?.payout_state}, due ${d.latest?.settlement_due_cents}, outstanding ${d.settlement.outstanding_cents}`);
  check('33. …and a correction is confirmed from scratch',
    d.latest?.pending_people === 2 && d.latest?.confirmed_people === 0,
    `pending ${d.latest?.pending_people}`);
  check('34. a correction is worth exactly what it replaced',
    DA_TOTAL === DB_TOTAL, `${DA_TOTAL} vs ${DB_TOTAL}`);
  const weekRows = (await get(A.token,
    `tip_distributions?select=entries_total_cents&workplace_id=eq.${WP}&status=in.(sent,confirmed)&period_start=gte.${WEEK_START}&period_start=lte.${WEEK_END}`)).rows ?? [];
  const weekSum = weekRows.reduce((t, r) => t + r.entries_total_cents, 0);
  check('35. the week owes the corrected night once, never the original and the correction together',
    d.week.entitlement_cents === weekSum && d.week.entitlement_cents === DB_TOTAL && d.week.distributions === 1,
    `${d.week.entitlement_cents} vs ${weekSum}, nights ${d.week.distributions}`);
  check('36. the retired original leaves the recent list and the correction takes its place',
    !d.recent.some((r) => r.id === DA) && d.recent.some((r) => r.id === DB) && d.recent[0].id === DB,
    `${d.recent.map((r) => r.id).join(',')}`);
}

/* Reverse A's payment: allowed, nothing downstream is settled. B now owes everything. */
await rpc(A.token, 'reverse_distribution_payout',
  { p_payout_id: PA, p_reason: 'payment_not_completed', p_note: 'The cash never went out.' });
{
  const d = (await dash(A.token)).body;
  const e = await expected();
  check('37. reversing the payment upstream turns B\'s difference back into its full amount',
    d.latest?.settlement_due_cents === DB_TOTAL && d.settlement.outstanding_cents === e.outstanding &&
      e.outstanding === globalThis.OUT1 + DB_TOTAL,
    `due ${d.latest?.settlement_due_cents}, outstanding ${d.settlement.outstanding_cents}`);
}
await payFor(DB, 'payroll');
{
  const d = (await dash(A.token)).body;
  check('38. paying B brings outstanding back to where it was',
    d.latest?.payout_state === 'paid' && d.settlement.outstanding_cents === globalThis.OUT1,
    `${d.latest?.payout_state}, outstanding ${d.settlement.outstanding_cents}`);
}

/* Correct B once more into C, the manager door. */
await patch(A.token, `shifts?id=eq.${B_SERVICE_SHIFT}`, { locked: false });
await patch(A.token, `shifts?id=eq.${B_SERVICE_SHIFT}`, { ends_at: isoAt(NEXT, 1, 45) });
const madeC = await rpc(A.token, 'create_replacement_distribution',
  { p_original_id: DB, p_reason: 'hours', p_note: 'Earlier still.' });
const DC = typeof madeC.body === 'string' ? madeC.body : null;
if (!DC) die(`second create_replacement_distribution failed: ${madeC.raw}`);
await rpc(A.token, 'send_distribution', { p_distribution_id: DC });
const DC_TOTAL = (await get(A.token, `tip_distributions?select=entries_total_cents&id=eq.${DC}`)).rows?.[0]?.entries_total_cents;
{
  const r = await dash(A.token);
  const d = r.body;
  check('39. down A <- B <- C only C is current, and the week still counts the night once',
    d.latest?.id === DC && d.latest?.settlement_due_cents === 0 &&
      d.week.entitlement_cents === DC_TOTAL && d.week.distributions === 1,
    `latest ${d.latest?.id}, week ${d.week.entitlement_cents}`);
  check('40. A\'s agreed correction stays satisfied although B has been retired',
    d.attention.agreed_corrections_not_sent === 0, `${d.attention.agreed_corrections_not_sent}`);
  check('41. neither retired version is recent; C leads the list of four',
    !d.recent.some((x) => x.id === DA || x.id === DB) && d.recent[0].id === DC && d.recent.length === 4,
    `${d.recent.map((x) => x.id).join(',')}`);
  const live = (await get(A.token,
    `tip_distributions?select=id&tip_pool_id=eq.${POOL}&status=in.(sent,confirmed)`)).rows ?? [];
  check('42. the fixture holds: one live payout per pool',
    live.length === 1 && live[0].id === DC, `${live.length} live`);
  check('43. …the correction note is not in the dashboard either',
    !r.raw.includes('Earlier still') && !JSON.stringify(d).includes('Earlier still') &&
      !JSON.stringify(d).includes('You are right'),
    'no note, no answer');
}

/* ── 8 · the last close ──────────────────────────────────────────────────── */
{
  const before = (await dash(A.token)).body;
  check('44. no period has been closed', before.close === null, `${JSON.stringify(before.close)}`);
  await rpc(A.token, 'close_financial_period', { p_workplace_id: WP, p_period_start: '2020-01-01', p_period_end: '2020-01-07' });
  await rpc(A.token, 'close_financial_period', { p_workplace_id: WP, p_period_start: '2020-01-08', p_period_end: '2020-01-14' });
  const after = (await dash(A.token)).body;
  check('45. the last close is the most recent period, not the first one made',
    after.close?.period_start === '2020-01-08' && after.close?.period_end === '2020-01-14',
    JSON.stringify(after.close));
}

/* ── 9 · the team, and what the dashboard must never carry ───────────────── */
{
  const r = await dash(A.token);
  const d = r.body;
  const active = (await get(A.token,
    `workplace_members?select=id&workplace_id=eq.${WP}&status=eq.active`)).rows?.length ?? -1;
  check('46. the team count is the active roster',
    d.team.active_members === active && active === 2, `${d.team.active_members} vs ${active}`);

  const text = JSON.stringify(d);
  check('47. no email address is in the dashboard',
    !text.includes(A.email) && !text.includes(B.email) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(text),
    'no address anywhere');
  check('48. no auth user id is in the dashboard',
    !text.includes(A.userId) && !text.includes(B.userId), 'neither user id');
  check('49. nobody\'s name is in the dashboard: counts, ids, dates and amounts only',
    !text.includes(STAFF_NAME), `"${STAFF_NAME}" absent`);
  check('50. no token, key or secret is in the dashboard',
    !text.includes(ANON) && !/eyJ[A-Za-z0-9_-]{10,}/.test(text), 'no key material');
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    business date         ${BD}  (week ${WEEK_START} … ${WEEK_END})`);
console.log(`    tonight's chain       ${DA} -> ${DB} -> ${DC}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
