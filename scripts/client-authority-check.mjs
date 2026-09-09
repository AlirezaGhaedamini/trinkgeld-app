/**
 * Live verification of the client's Phase 3R-B assumptions.
 *
 * The screens now lean on the hardened backend in specific ways: the business
 * day is the server's answer, a pool is found and opened for exactly that
 * day, the pool step reads a locked pool's situation off three queries (its
 * live distribution, its published history, the unfinished pools before it),
 * and three retries are recovered by reloading the exact record. This proves
 * each of those reads and sequences over PostgREST, with the anon key and two
 * test accounts, exactly as the browser issues them.
 *
 *   node scripts/client-authority-check.mjs
 *
 * REQUIRES MIGRATION 33 on the project.
 *
 * WHAT IT WRITES. Three workplaces per run, tagged with the run's timestamp,
 * six nights, one void, one cancellation, one extra invitation. Point it at a
 * development project.
 *
 * Nothing secret is printed: no password, no JWT, no invitation token.
 *
 * Exit 0 = every check passed.
 */

import { createHash } from 'node:crypto';
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

/** `${date}T${hh}:${mm}:00Z` — UTC instants, so the server derives the business day. */
const isoAt = (d, hh, mm = 0) =>
  new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`).toISOString();
/** Plain calendar arithmetic on an ISO date, no timezone involved. */
function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

console.log(`\n  TipCrew — live client-authority verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Authority ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status} ${createdWp.raw}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Authority Rival ${STAMP}` });
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
const A_SERVICE = areas0.rows?.find((a) => a.key === 'service')?.id ?? null;
const roles0 = await get(A.token, `workplace_roles?select=id,key&workplace_id=eq.${WP}`);
const R_SERVER = roles0.rows?.find((r) => r.key === 'server')?.id ?? null;
if (!A_SERVICE || !R_SERVER) die('could not resolve the seeded service area or server role');
await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
{
  const draftId = (await get(A.token,
    `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows?.[0]?.id;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${draftId}`,
    { method: 'hours_points', min_overlap_minutes: 15, acknowledgement_required: true });
  const activated = await rpc(A.token, 'activate_rule', { p_rule_id: draftId });
  if (!activated.ok) die(`activate_rule failed: HTTP ${activated.status} ${activated.raw}`);
}

/* The exact reads the pool step and the wizard hook issue. */
const openPool = async (day) =>
  (await get(A.token,
    `tip_pools?select=id,status,period_start,total_cents&workplace_id=eq.${WP}&period_start=eq.${day}&period_end=eq.${day}&status=in.(open,locked)&limit=1`)).rows?.[0] ?? null;
const liveDist = async (poolId) =>
  (await get(A.token,
    `tip_distributions?select=id,status&workplace_id=eq.${WP}&tip_pool_id=eq.${poolId}&status=in.(draft,sent,confirmed)&limit=1`)).rows?.[0] ?? null;
const publishedId = async (poolId) =>
  (await get(A.token,
    `tip_distributions?select=id,sent_at&workplace_id=eq.${WP}&tip_pool_id=eq.${poolId}&sent_at=not.is.null&order=sent_at.desc&limit=1`)).rows?.[0]?.id ?? null;
const unfinished = async () =>
  (await get(A.token,
    `tip_pools?select=id,status,period_start,total_cents&workplace_id=eq.${WP}&status=in.(open,locked)&order=period_start.desc&limit=5`)).rows ?? [];
const distRow = async (id) =>
  (await get(A.token, `tip_distributions?select=id,status,sent_at&id=eq.${id}`)).rows?.[0] ?? null;

/** One night: a report by the person who worked it, an approved shift, a pool, a draft. */
async function night(day, reporter = M_A) {
  const report = await post(reporter === M_B ? B.token : A.token, 'tip_reports', {
    workplace_id: WP, member_id: reporter, work_date: day, cash_cents: 50000, card_cents: 0 });
  if (!report.rows?.[0]?.id) die(`tip_reports insert failed for ${day}: HTTP ${report.status} ${report.raw}`);
  const s = await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, starts_at: isoAt(day, 16), ends_at: isoAt(day, 22),
    break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
  if (!s.ok) die(`shift insert failed for ${day}: ${s.raw}`);
  const pooled = await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: day, p_period_end: day });
  const poolId = typeof pooled.body === 'string' ? pooled.body : null;
  if (!poolId) die(`create_pool_from_reports failed for ${day}: ${pooled.raw}`);
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: poolId });
  const distId = typeof calc.body === 'string' ? calc.body : null;
  if (!distId) die(`calculate_distribution failed for ${day}: ${calc.raw}`);
  return { day, poolId, distId, reportId: report.rows[0].id };
}

/* ── 1 · the business day is the server's ───────────────────────────────── */
const boss = await rpc(A.token, 'current_business_day', { p_workplace_id: WP });
const BD = typeof boss.body === 'string' ? boss.body : null;
if (!BD) die(`current_business_day failed: HTTP ${boss.status} ${boss.raw}`);
{
  const staff = await rpc(B.token, 'current_business_day', { p_workplace_id: WP });
  check('1. the manager receives the server\'s business date', /^\d{4}-\d{2}-\d{2}$/.test(BD), BD);
  check('2. the employee receives the same date', staff.ok && staff.body === BD, `HTTP ${staff.status} ${staff.raw}`);
  const dash = await rpc(A.token, 'manager_dashboard', { p_workplace_id: WP });
  check('3. …the date the dashboard reasons with', dash.ok && dash.body?.business_date === BD,
    `dashboard ${dash.body?.business_date}`);
  const wrong = await rpc(A.token, 'current_business_day', { p_workplace_id: WP_OTHER });
  check('4. a member of another workplace is refused, so a switch can never inherit a date',
    !wrong.ok, `HTTP ${wrong.status}`);
}

/* ── 2 · a pool is found and opened for exactly that day ────────────────── */
const N1 = await night(BD, M_B);
{
  const pool = await openPool(BD);
  check('5. the report the employee files under the server date is what the pool is built from',
    pool?.id === N1.poolId && Number(pool?.total_cents) === 50000, JSON.stringify(pool));
  const sources = await get(A.token, `tip_pool_sources?select=tip_report_id&pool_id=eq.${N1.poolId}`);
  check('6. …and the pool records that very report', sources.rows?.some((r) => r.tip_report_id === N1.reportId),
    `${sources.rows?.length ?? 0} source(s)`);
  const dash = await rpc(A.token, 'manager_dashboard', { p_workplace_id: WP });
  check('7. the dashboard\'s tonight is the same pool', dash.body?.tonight?.pool?.id === N1.poolId,
    JSON.stringify(dash.body?.tonight?.pool ?? null));
  const live = await liveDist(N1.poolId);
  check('8. the pool step sees the calculated draft on the locked pool',
    pool?.status === 'locked' && live?.id === N1.distId && live?.status === 'draft', JSON.stringify(live));
}

/* ── 3 · discard, void, pool again ───────────────────────────────────────── */
{
  const discarded = await del(A.token, `tip_distributions?id=eq.${N1.distId}&status=eq.draft`);
  check('9. the draft is discarded', discarded.ok && discarded.rows?.length === 1, `HTTP ${discarded.status}`);
  const still = await openPool(BD);
  const pub = await publishedId(N1.poolId);
  const live = await liveDist(N1.poolId);
  check('10. …the locked pool is still the day\'s pool, with nothing standing on it — the void action is offered',
    still?.id === N1.poolId && still?.status === 'locked' && live === null && pub === null,
    JSON.stringify({ still, live, pub }));
  const voided = await rpc(A.token, 'void_pool', { p_pool_id: N1.poolId, p_reason: 'Wrong total.' });
  const gone = await openPool(BD);
  const list = await unfinished();
  check('11. after voiding, the day has no pool to find and the list of unfinished nights forgets it',
    voided.ok && gone === null && !list.some((p) => p.id === N1.poolId),
    `HTTP ${voided.status}, open ${JSON.stringify(gone)}`);
  const again = await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: BD, p_period_end: BD });
  const POOL_1B = typeof again.body === 'string' ? again.body : null;
  const calc = POOL_1B ? await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL_1B }) : { ok: false };
  const found = await openPool(BD);
  check('12. the same report funds a fresh pool for the same day, which calculates again',
    Boolean(POOL_1B) && calc.ok && found?.id === POOL_1B && Number(found?.total_cents) === 50000,
    `pool HTTP ${again.status}, calc HTTP ${calc.status}`);
  N1.poolId2 = POOL_1B;
  N1.distId2 = typeof calc.body === 'string' ? calc.body : null;
}

/* ── 4 · an unfinished earlier night, and a published one ────────────────── */
const N2 = await night(addDays(BD, -3));
const N3 = await night(addDays(BD, -2));
{
  const list = await unfinished();
  check('13. the pool step is told about the unfinished pool of an earlier night',
    list.some((p) => p.id === N2.poolId && p.period_start === N2.day && p.status === 'locked'),
    list.map((p) => `${p.period_start}:${p.status}`).join(' '));
  const continued = await openPool(N2.day);
  check('14. …and continuing that night finds exactly that pool', continued?.id === N2.poolId, JSON.stringify(continued));

  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: N3.distId });
  const pub = await publishedId(N3.poolId);
  const voided = await rpc(A.token, 'void_pool', { p_pool_id: N3.poolId, p_reason: 'x' });
  check('15. a pool whose distribution was sent shows as published, and the server refuses to void it',
    sent.ok && pub === N3.distId && !voided.ok, `sent HTTP ${sent.status}, published ${pub}, void HTTP ${voided.status}`);
  const cancelled = await rpc(A.token, 'cancel_distribution', { p_distribution_id: N3.distId, p_reason: 'Redo.' });
  const stillPub = await publishedId(N3.poolId);
  const live = await liveDist(N3.poolId);
  const backOpen = await openPool(N3.day);
  check('16. cancelled after sending: the pool is locked again, nothing live on it, and it still reads as published',
    cancelled.ok && backOpen?.status === 'locked' && live === null && stillPub === N3.distId,
    JSON.stringify({ backOpen, live, stillPub }));
}

/* ── 5 · retries after a lost response ───────────────────────────────────── */
const N4 = await night(addDays(BD, -4));
{
  const first = await rpc(A.token, 'send_distribution', { p_distribution_id: N4.distId });
  const second = await rpc(A.token, 'send_distribution', { p_distribution_id: N4.distId });
  const row = await distRow(N4.distId);
  check('17. a second send is refused as "only a draft can be sent"',
    first.ok && !second.ok && /only a draft can be sent/i.test(second.raw), `HTTP ${second.status} ${second.raw}`);
  check('18. …and the exact record reads sent, which is what turns the refusal into a success',
    row?.status === 'sent' && typeof row?.sent_at === 'string', JSON.stringify(row));
}
const N5 = await night(addDays(BD, -5));
{
  const first = await del(A.token, `tip_distributions?id=eq.${N5.distId}&status=eq.draft`);
  const second = await del(A.token, `tip_distributions?id=eq.${N5.distId}&status=eq.draft`);
  const row = await distRow(N5.distId);
  check('19. a second discard matches nothing and errors nowhere',
    first.rows?.length === 1 && second.ok && (second.rows?.length ?? 0) === 0, `HTTP ${second.status}`);
  check('20. …and the exact record is gone, which is what turns the empty result into a success',
    row === null, JSON.stringify(row));
}
{
  const wp2 = await rpc(A.token, 'create_workplace', { p_name: `Authority Two ${STAMP}` });
  const WP2 = typeof wp2.body === 'string' ? wp2.body : null;
  if (!WP2) die(`the second create_workplace failed: HTTP ${wp2.status}`);
  const inv = await rpc(A.token, 'create_invitation', {
    p_workplace_id: WP2, p_email: B.email, p_display_name: `Staff Two ${STAMP}`, p_role: 'employee',
  });
  const token = (Array.isArray(inv.body) ? inv.body[0] : inv.body)?.token;
  if (!token) die(`the second create_invitation failed: HTTP ${inv.status}`);
  const first = await rpc(B.token, 'accept_invitation', { p_token: token });
  const second = await rpc(B.token, 'accept_invitation', { p_token: token });
  check('21. a second acceptance is refused as already used',
    first.ok && !second.ok && /already been used/i.test(second.raw), `HTTP ${second.status} ${second.raw}`);
  const outcome = await get(B.token,
    `invitations?select=workplace_id,status,accepted_by&token_hash=eq.${sha256Hex(token)}&limit=1`);
  const row = outcome.rows?.[0] ?? null;
  check('22. …and the invitee can read the row by the token\'s hash: accepted, by this account',
    row?.status === 'accepted' && row?.accepted_by === B.userId && row?.workplace_id === WP2,
    JSON.stringify(row ? { status: row.status, mine: row.accepted_by === B.userId } : outcome.raw));
  const mine = await get(B.token, `workplace_members?select=workplace_id&user_id=eq.${B.userId}&workplace_id=eq.${WP2}`);
  check('23. …and the membership is there to reload', (mine.rows?.length ?? 0) === 1, `${mine.rows?.length ?? 0} row(s)`);
  const other = await get(A.token,
    `invitations?select=status,accepted_by&token_hash=eq.${sha256Hex(token)}&limit=1`);
  check('24. the manager reads the same row, and it does not name the manager as the acceptor',
    other.rows?.[0]?.accepted_by === B.userId && other.rows?.[0]?.accepted_by !== A.userId, `${other.rows?.length ?? 0} row(s)`);
}

/* ── summary ─────────────────────────────────────────────────────────────── */
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\n  Failed:');
  for (const f of failed) console.log(`   - ${f.label}${f.detail ? `  (${f.detail})` : ''}`);
  console.log('');
  process.exit(1);
}
console.log('');
