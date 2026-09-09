/**
 * Live production-hardening verification for TipCrew Phase 3R-A.
 *
 * Migration 33 moved four invariants out of the screens and into the
 * database. This proves them over PostgREST, with the anon key and two test
 * accounts, exactly the way a browser would try: a raw PATCH on a draft is
 * refused, a raw PATCH on a pool's status is refused, a discarded draft's pool
 * can be voided and its reports pooled again, a draft cannot be cancelled,
 * an employee's history is what was actually sent, and the business day is
 * the server's answer for manager and employee alike.
 *
 *   node scripts/production-hardening-check.mjs
 *
 * THESE CHECKS FAIL UNTIL MIGRATION 33 IS PUSHED.
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp,
 * four past nights, two manual pools, one void, one cancellation. Point it at
 * a development project.
 *
 * NOT COVERED LIVE, because the script has two accounts: a member who has
 * left (the only staff account is needed active for the publication checks).
 * That case is in supabase/tests/22_production_hardening.sql.
 *
 * Nothing secret is printed: no password, no JWT, no invitation token.
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
/** A write that either errored, or matched no row at all — both are "refused". */
const refused = (r) => r.status >= 400 || (r.rows?.length ?? 0) === 0;

/** `${date}T${hh}:${mm}:00Z` — UTC instants, so the server derives the business day. */
const isoAt = (d, hh, mm = 0) =>
  new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`).toISOString();

console.log(`\n  TipCrew — live production-hardening verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Hardening ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status} ${createdWp.raw}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Hardening Rival ${STAMP}` });
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

/** One past night, calculated to a draft: the boss reports, B works service. */
async function night(day, cashCents = 50000) {
  const report = await post(A.token, 'tip_reports', {
    workplace_id: WP, member_id: M_A, work_date: day, cash_cents: cashCents, card_cents: 0 });
  if (!report.rows?.[0]?.id) die(`tip_reports insert failed for ${day}: HTTP ${report.status}`);
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
  return { day, poolId, distId };
}
const distRow = async (id) =>
  (await get(A.token, `tip_distributions?select=id,status,sent_at,tip_pool_id,pool_cents,people_count&id=eq.${id}`)).rows?.[0] ?? null;
const poolRow = async (id) =>
  (await get(A.token, `tip_pools?select=id,status,total_cents,label,locked_at&id=eq.${id}`)).rows?.[0] ?? null;
/** A manual pool the way the app opens one: open, manual, no distribution. */
async function manualPool(day, label) {
  const r = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: day, period_end: day, label,
    card_cents: 1000, cash_cents: 2000, source: 'manual', status: 'open', created_by: M_A });
  if (!r.rows?.[0]?.id) die(`manual pool insert failed: ${r.raw}`);
  return r.rows[0].id;
}

/* ── 1 · a client cannot write a distribution ────────────────────────────── */
const N1 = await night('2020-01-03');
const POOL_M = await manualPool('2020-02-01', 'by hand');
{
  const asSent = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`, { status: 'sent' });
  check('1. a manager cannot PATCH a draft to sent', refused(asSent), `HTTP ${asSent.status} ${asSent.raw}`);
  const stamped = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`, { sent_at: new Date().toISOString() });
  check('2. …nor forge sent_at', refused(stamped), `HTTP ${stamped.status}`);
  const moved = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`, { tip_pool_id: POOL_M });
  check('3. …nor move the draft onto another pool', refused(moved), `HTTP ${moved.status}`);
  const totals = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`,
    { pool_cents: 1, entries_total_cents: 1, people_count: 99 });
  check('4. …nor rewrite the calculated totals', refused(totals), `HTTP ${totals.status}`);
  const lineage = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`,
    { correction_reason: 'other', correction_note: 'forged' });
  check('5. …nor forge correction provenance', refused(lineage), `HTTP ${lineage.status}`);
  const cancelled = await patch(A.token, `tip_distributions?id=eq.${N1.distId}`, { status: 'cancelled' });
  check('6. …nor cancel it by hand', refused(cancelled), `HTTP ${cancelled.status}`);
  const staff = await patch(B.token, `tip_distributions?id=eq.${N1.distId}`,
    { status: 'sent', sent_at: new Date().toISOString() });
  check('7. an employee cannot do any of that either', refused(staff), `HTTP ${staff.status}`);
  const row = await distRow(N1.distId);
  check('8. …and the draft is exactly as the engine left it',
    row?.status === 'draft' && row?.sent_at === null && row?.tip_pool_id === N1.poolId && row?.people_count === 1,
    JSON.stringify(row));
}
{
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: N1.distId });
  const row = await distRow(N1.distId);
  const pool = await poolRow(N1.poolId);
  check('9. send_distribution() still publishes: status sent, sent_at written',
    sent.ok && row?.status === 'sent' && typeof row?.sent_at === 'string',
    `HTTP ${sent.status} ${JSON.stringify(row)}`);
  check('10. …and it is the engine that moves the pool to distributed',
    pool?.status === 'distributed', JSON.stringify(pool));
}

/* ── 2 · a client cannot move a pool ─────────────────────────────────────── */
const N2 = await night('2020-01-04');
{
  const lock = await patch(A.token, `tip_pools?id=eq.${POOL_M}`, { status: 'locked' });
  check('11. a manager cannot PATCH an open pool to locked', refused(lock), `HTTP ${lock.status} ${lock.raw}`);
  const reopen = await patch(A.token, `tip_pools?id=eq.${N2.poolId}`, { status: 'open' });
  check('12. …nor reopen a locked one', refused(reopen), `HTTP ${reopen.status}`);
  const voided = await patch(A.token, `tip_pools?id=eq.${N1.poolId}`, { status: 'void' });
  check('13. …nor void a distributed one', refused(voided), `HTTP ${voided.status}`);
  const stamped = await patch(A.token, `tip_pools?id=eq.${POOL_M}`, { locked_at: new Date().toISOString() });
  check('14. …nor forge locked_at', refused(stamped), `HTTP ${stamped.status}`);
  const amounts = await patch(A.token, `tip_pools?id=eq.${N2.poolId}`, { card_cents: 1 });
  check('15. …nor change a locked pool\'s amounts', refused(amounts), `HTTP ${amounts.status}`);
  const relabel = await patch(A.token, `tip_pools?id=eq.${N1.poolId}`, { label: 'history rewritten' });
  check('16. …nor relabel a distributed pool', refused(relabel), `HTTP ${relabel.status}`);
  const edit = await patch(A.token, `tip_pools?id=eq.${POOL_M}`, { label: 'renamed', card_cents: 1500 });
  const after = await poolRow(POOL_M);
  check('17. label and amounts of an open pool stay editable',
    edit.ok && edit.rows?.length === 1 && after?.label === 'renamed' && Number(after?.total_cents) === 3500,
    `HTTP ${edit.status} ${JSON.stringify(after)}`);
  const locked = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: '2020-02-02', period_end: '2020-02-02', label: 'x',
    card_cents: 1, cash_cents: 1, source: 'manual', status: 'locked', created_by: M_A });
  check('18. a pool cannot be opened already locked', refused(locked), `HTTP ${locked.status} ${locked.raw}`);
  const claimed = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: '2020-02-03', period_end: '2020-02-03', label: 'x',
    card_cents: 1, cash_cents: 1, source: 'staff_reports', status: 'open', created_by: M_A });
  check('19. …nor claim to be from reports without create_pool_from_reports()', refused(claimed), `HTTP ${claimed.status}`);
}

/* ── 3 · void_pool: discard the draft, void, pool again ──────────────────── */
{
  const withDraft = await rpc(A.token, 'void_pool', { p_pool_id: N2.poolId, p_reason: 'x' });
  check('20. a pool with a draft cannot be voided', !withDraft.ok, `HTTP ${withDraft.status} ${withDraft.raw}`);
  const staff = await rpc(B.token, 'void_pool', { p_pool_id: POOL_M, p_reason: 'x' });
  check('21. an employee cannot void a pool', !staff.ok, `HTTP ${staff.status}`);
  const anon = await rpc(null, 'void_pool', { p_pool_id: POOL_M, p_reason: 'x' });
  check('22. …nor an anonymous caller', !anon.ok, `HTTP ${anon.status}`);
  const distributed = await rpc(A.token, 'void_pool', { p_pool_id: N1.poolId, p_reason: 'x' });
  check('23. …and a distributed pool cannot be voided at all', !distributed.ok, `HTTP ${distributed.status}`);

  const before = await get(A.token, `tip_pool_sources?select=tip_report_id&pool_id=eq.${N2.poolId}`);
  const discarded = await del(A.token, `tip_distributions?id=eq.${N2.distId}&status=eq.draft`);
  check('24. the draft is discarded under distributions_delete_draft',
    discarded.ok && discarded.rows?.length === 1 && (await distRow(N2.distId)) === null,
    `HTTP ${discarded.status} ${discarded.rows?.length ?? 0} row(s)`);
  const voided = await rpc(A.token, 'void_pool', { p_pool_id: N2.poolId, p_reason: '  Wrong total.  ' });
  const pool = await poolRow(N2.poolId);
  check('25. …then the locked pool voids, amounts untouched',
    voided.ok && pool?.status === 'void' && Number(pool?.total_cents) === 50000,
    `HTTP ${voided.status} ${JSON.stringify(pool)}`);
  const after = await get(A.token, `tip_pool_sources?select=tip_report_id&pool_id=eq.${N2.poolId}`);
  check('26. …and its report reservation is released',
    (before.rows?.length ?? 0) === 1 && (after.rows?.length ?? 0) === 0,
    `${before.rows?.length ?? 0} before, ${after.rows?.length ?? 0} after`);
  const audit = await get(A.token,
    `audit_log?select=reason,after&table_name=eq.tip_pools&record_id=eq.${N2.poolId}&action=eq.update&order=created_at.desc&limit=1`);
  check('27. …with the trimmed reason on the audit trail',
    audit.rows?.[0]?.reason === 'Wrong total.' && audit.rows?.[0]?.after?.status === 'void',
    JSON.stringify(audit.rows?.[0] ?? audit.raw));

  const again = await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: N2.day, p_period_end: N2.day });
  const POOL_2B = typeof again.body === 'string' ? again.body : null;
  const calc = POOL_2B ? await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL_2B }) : { ok: false };
  const fresh = POOL_2B ? await poolRow(POOL_2B) : null;
  check('28. the same report funds a fresh pool, which calculates again',
    Boolean(POOL_2B) && calc.ok && Number(fresh?.total_cents) === 50000 && fresh?.status === 'locked',
    `pool HTTP ${again.status}, calc HTTP ${calc.status} ${JSON.stringify(fresh)}`);
  N2.poolId2 = POOL_2B;
  N2.distId2 = typeof calc.body === 'string' ? calc.body : null;

  const first = await rpc(A.token, 'void_pool', { p_pool_id: POOL_M });
  const second = await rpc(A.token, 'void_pool', { p_pool_id: POOL_M });
  const m = await poolRow(POOL_M);
  check('29. an open manual pool with nothing on it voids, and voiding it again is a quiet no-op',
    first.ok && second.ok && m?.status === 'void', `HTTP ${first.status}/${second.status} ${JSON.stringify(m)}`);
  const rivalPool = await manualPool('2020-02-04', 'for the rival');
  const rivalTry = await rpc(B.token, 'void_pool', { p_pool_id: rivalPool, p_reason: 'x' });
  check('30. a manager of another workplace cannot void it', !rivalTry.ok, `HTTP ${rivalTry.status}`);
}

/* ── 4 · cancel_distribution and publication ─────────────────────────────── */
const N3 = await night('2020-01-05');
{
  const draftCancel = await rpc(A.token, 'cancel_distribution',
    { p_distribution_id: N2.distId2, p_reason: 'x' });
  const still = await distRow(N2.distId2);
  check('31. a draft cannot be cancelled; it is discarded or recalculated',
    !draftCancel.ok && still?.status === 'draft', `HTTP ${draftCancel.status} ${draftCancel.raw}`);

  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: N3.distId });
  const cancelled = await rpc(A.token, 'cancel_distribution',
    { p_distribution_id: N3.distId, p_reason: `Redoing it — ${STAMP}` });
  const row = await distRow(N3.distId);
  check('32. a sent distribution can still be cancelled, and keeps sent_at',
    sent.ok && cancelled.ok && row?.status === 'cancelled' && typeof row?.sent_at === 'string',
    `HTTP ${sent.status}/${cancelled.status} ${JSON.stringify(row)}`);
  const twice = await rpc(A.token, 'cancel_distribution', { p_distribution_id: N3.distId, p_reason: 'again' });
  check('33. …and cancelling it again is a quiet no-op', twice.ok, `HTTP ${twice.status}`);

  const mine = await get(B.token, `member_distributions?select=id,status,sent_at&workplace_id=eq.${WP}`);
  const ids = new Set((mine.rows ?? []).map((r) => r.id));
  check('34. the employee sees the sent night and the cancelled-after-send night',
    ids.has(N1.distId) && ids.has(N3.distId) &&
      (mine.rows ?? []).filter((r) => ids.has(r.id)).every((r) => typeof r.sent_at === 'string'),
    `${mine.rows?.length ?? 0} row(s)`);
  check('35. …and never the draft', !ids.has(N2.distId2), `draft ${N2.distId2}`);
  const entries = await get(B.token, `member_distribution_entries?select=id&distribution_id=eq.${N2.distId2}`);
  check('36. …nor the draft\'s entries', (entries.rows?.length ?? 0) === 0, `${entries.rows?.length ?? 0} row(s)`);
}

/* ── 5 · the server's business day ──────────────────────────────────────── */
{
  const boss = await rpc(A.token, 'current_business_day', { p_workplace_id: WP });
  const staff = await rpc(B.token, 'current_business_day', { p_workplace_id: WP });
  const dateLike = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  check('37. the manager receives the server\'s business date', boss.ok && dateLike(boss.body), `HTTP ${boss.status} ${boss.raw}`);
  check('38. the employee receives the same date', staff.ok && staff.body === boss.body, `HTTP ${staff.status} ${staff.raw}`);
  const dash = await rpc(A.token, 'manager_dashboard', { p_workplace_id: WP });
  check('39. …and it is the date the dashboard reasons with',
    dash.ok && dash.body?.business_date === boss.body, `dashboard ${dash.body?.business_date}`);
  const wrong = await rpc(A.token, 'current_business_day', { p_workplace_id: WP_OTHER });
  check('40. a member of another workplace is refused', !wrong.ok, `HTTP ${wrong.status}`);
  const anon = await rpc(null, 'current_business_day', { p_workplace_id: WP });
  check('41. an anonymous caller is refused', !anon.ok, `HTTP ${anon.status}`);

  const suspend = await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });
  const paused = await rpc(B.token, 'current_business_day', { p_workplace_id: WP });
  const restore = await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'active' });
  const back = await rpc(B.token, 'current_business_day', { p_workplace_id: WP });
  check('42. a suspended member is refused, and answered again once reactivated',
    suspend.ok && !paused.ok && restore.ok && back.ok && back.body === boss.body,
    `suspended HTTP ${paused.status}, restored HTTP ${back.status}`);
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
