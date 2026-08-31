/**
 * Live distribution verification for TipCrew Phase 3D.
 *
 * The money path, against the real project, over plain fetch. GoTrue for the
 * tokens, PostgREST for the tables and the RPCs — no SDK, nothing that could
 * make a request look safer than it is.
 *
 *   node scripts/distribution-check.mjs
 *
 * WHAT IT WRITES. Two workplaces, members, approved shifts, tip reports, pools
 * and distributions, all tagged with the run's timestamp. Point it at a
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

console.log(`\n  TipCrew — live distribution verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── stage: a workplace of A's with B as an employee, and a second of B's ── */
const created = await rpc(A.token, 'create_workplace', { p_name: `Dist Test ${STAMP}` });
const WP = typeof created.body === 'string' ? created.body : null;
if (!WP) die(`create_workplace failed: HTTP ${created.status}`);

const other = await rpc(B.token, 'create_workplace', { p_name: `Other Dist ${STAMP}` });
const WP_OTHER = typeof other.body === 'string' ? other.body : null;

const invite = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const inviteRow = Array.isArray(invite.body) ? invite.body[0] : invite.body;
if (!inviteRow?.token) die(`create_invitation failed: HTTP ${invite.status}`);
const acceptRes = await rpc(B.token, 'accept_invitation', { p_token: inviteRow.token });
const M_B = typeof acceptRes.body === 'string' ? acceptRes.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${acceptRes.status}`);

const roster = await get(A.token, `workplace_members?select=id,role,user_id&workplace_id=eq.${WP}`);
const M_A = roster.rows?.find((m) => m.role === 'manager')?.id ?? null;

const areas = await get(A.token, `workplace_areas?select=id,key&workplace_id=eq.${WP}`);
const A_SERVICE = areas.rows?.find((a) => a.key === 'service')?.id ?? null;
const A_BAR = areas.rows?.find((a) => a.key === 'bar')?.id ?? null;

const roles = await get(A.token, `workplace_roles?select=id,key,points,area_id&workplace_id=eq.${WP}`);
const R_SERVER = roles.rows?.find((r) => r.key === 'server')?.id ?? null;
const R_SENIOR = roles.rows?.find((r) => r.key === 'senior_server')?.id ?? null;

// Give both people the same area and role, so the arithmetic is checkable.
await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });

// A third roster placeholder, so €10/3 is a real three-way split.
const third = await post(A.token, 'workplace_members', {
  workplace_id: WP, display_name: `Third ${STAMP}`, role: 'employee',
  area_id: A_SERVICE, workplace_role_id: R_SERVER, status: 'active',
});
const M_C = third.rows?.[0]?.id ?? null;

/**
 * A roster placeholder for one scenario only. Every scenario below gets its own
 * people, so nothing an earlier check does to a member can leak into a later
 * one — the class of failure that produced most of the first live run's noise.
 */
let seat = 0;
async function addMember(tag, areaId) {
  seat += 1;
  const r = await post(A.token, 'workplace_members', {
    workplace_id: WP, display_name: `${tag} ${STAMP}-${seat}`, role: 'employee',
    area_id: areaId, workplace_role_id: R_SERVER, status: 'active',
  });
  return r.rows?.[0]?.id ?? null;
}

const DAY = '2019-05-06';
const iso = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).toISOString();

/* 100% to service. */
const draft1 = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
const RULE1 = typeof draft1.body === 'string' ? draft1.body : null;
await patch(A.token, `distribution_rule_areas?rule_id=eq.${RULE1}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
await patch(A.token, `distribution_rule_areas?rule_id=eq.${RULE1}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
await patch(A.token, `distribution_rules?id=eq.${RULE1}`, { method: 'hours', min_overlap_minutes: 15 });
const act1 = await rpc(A.token, 'activate_rule', { p_rule_id: RULE1 });

check('10. area shares must reconcile to 100% before a rule can be activated',
  act1.ok, `activate_rule HTTP ${act1.status}${act1.ok ? `, version ${act1.body}` : ` ${act1.raw}`}`);

{
  const bad = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const BAD = typeof bad.body === 'string' ? bad.body : null;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${BAD}&area_id=eq.${A_SERVICE}`, { percentage: 30 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${BAD}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  const r = await rpc(A.token, 'activate_rule', { p_rule_id: BAD });
  check('9b. a rule that does not total 100% is refused', !r.ok, `HTTP ${r.status}`);
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${BAD}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  const r2 = await rpc(A.token, 'activate_rule', { p_rule_id: BAD });
  void r2;
}

/* Three identical shifts, so €10 is a clean three-way split. */
for (const [member, label] of [[M_A, 'A'], [M_B, 'B'], [M_C, 'C']]) {
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: member, work_date: DAY,
    starts_at: iso(DAY, 18), ends_at: iso(DAY, 22), break_minutes: 0, status: 'approved',
  });
  void label;
}
/* An editable shift for B, on a day no pool covers: check 8 needs a row the
   employee can actually reach, so that a refusal proves the column guard and
   not merely RLS. */
const openShift = await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_B, work_date: '2019-05-04',
  starts_at: iso('2019-05-04', 10), ends_at: iso('2019-05-04', 12),
  break_minutes: 0, status: 'submitted',
});
const B_OPEN = openShift.rows?.[0]?.id ?? null;

/* A fourth shift that is only SUBMITTED, and a fifth that is REJECTED. */
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_C, work_date: DAY,
  starts_at: iso(DAY, 10), ends_at: iso(DAY, 12), break_minutes: 0, status: 'submitted',
});
await post(A.token, 'shifts', {
  workplace_id: WP, member_id: M_C, work_date: DAY,
  starts_at: iso(DAY, 13), ends_at: iso(DAY, 15), break_minutes: 0, status: 'rejected',
});

/* ── 1, 2, 3 · pools ─────────────────────────────────────────────────────── */
let POOL = null;
{
  await post(B.token, 'tip_reports', {
    workplace_id: WP, member_id: M_B, work_date: DAY, card_cents: 600, cash_cents: 400,
  });
  const r = await rpc(A.token, 'create_pool_from_reports', {
    p_workplace_id: WP, p_period_start: DAY, p_period_end: DAY, p_label: `pool ${STAMP}`,
  });
  POOL = typeof r.body === 'string' ? r.body : null;
  const row = POOL ? await get(A.token, `tip_pools?select=total_cents,source&id=eq.${POOL}`) : null;
  check('1. a manager can open a pool for their own workplace',
    r.ok && !!POOL, `HTTP ${r.status}`);
  check('1b. the total is summed by the database from the reports, not sent by the client',
    row?.rows?.[0]?.total_cents === 1000 && row?.rows?.[0]?.source === 'staff_reports',
    `total_cents = ${row?.rows?.[0]?.total_cents}, source = ${row?.rows?.[0]?.source}`);
}
{
  const r = await rpc(A.token, 'create_pool_from_reports', {
    p_workplace_id: WP, p_period_start: DAY, p_period_end: DAY, p_label: 'again',
  });
  check('1c. the same tip reports cannot fund a second pool', !r.ok, `HTTP ${r.status}`);
}
{
  const r = await rpc(B.token, 'create_pool_from_reports', {
    p_workplace_id: WP, p_period_start: DAY, p_period_end: DAY, p_label: 'mine',
  });
  const direct = await post(B.token, 'tip_pools', {
    workplace_id: WP, period_start: DAY, period_end: DAY, cash_cents: 500000,
  });
  check('2. an employee can neither open a pool nor insert one directly',
    !r.ok && !direct.ok, `rpc HTTP ${r.status}, insert HTTP ${direct.status}`);
}
{
  const seen = await get(B.token, `tip_pools?select=id&workplace_id=eq.${WP}`);
  check('2b. …and cannot even read that pools exist',
    (seen.rows?.length ?? 0) === 0, `${seen.rows?.length ?? '?'} row(s)`);
}
{
  const r = WP_OTHER
    ? await rpc(B.token, 'create_pool_from_reports', { p_workplace_id: WP, p_period_start: DAY, p_period_end: DAY })
    : { ok: false, status: 0 };
  check('3. a manager of another workplace cannot open a pool here', !r.ok, `HTTP ${r.status}`);
}

/* ── 4–8, 14–18 · the calculation ────────────────────────────────────────── */
let DIST = null;
{
  const r = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL });
  DIST = typeof r.body === 'string' ? r.body : null;
  check('14. the manager can calculate, and it produces a draft',
    r.ok && !!DIST, `HTTP ${r.status}${DIST ? '' : ` ${r.raw}`}`);
}
if (!DIST) die('Cannot continue without a distribution.');

const entries = await get(A.token, `tip_distribution_entries?select=*&distribution_id=eq.${DIST}`);
const amounts = (entries.rows ?? []).map((e) => e.amount_cents).sort((a, b) => a - b);

check('4. only approved shifts took part',
  (entries.rows?.length ?? 0) === 3, `${entries.rows?.length ?? '?'} entries for 3 approved shifts`);
{
  const snapshot = await get(A.token, `tip_distributions?select=inputs_snapshot&id=eq.${DIST}`);
  const shifts = snapshot.rows?.[0]?.inputs_snapshot?.shifts ?? [];
  check('5. the submitted and rejected shifts are not in the calculation at all',
    shifts.length === 3, `${shifts.length} shift(s) in the snapshot`);
}
check('6. worked_minutes came from the database, not the client',
  (entries.rows ?? []).every((e) => e.worked_minutes === 240),
  `worked_minutes: ${[...new Set((entries.rows ?? []).map((e) => e.worked_minutes))].join(', ')}`);
check('7. the role points on the entries are the trusted ones',
  (entries.rows ?? []).every((e) => Number(e.points) === 1),
  `points: ${[...new Set((entries.rows ?? []).map((e) => e.points))].join(', ')}`);
check('15. the amounts reconcile exactly to the pool',
  amounts.reduce((s, a) => s + a, 0) === 1000, `${amounts.join(' + ')} = ${amounts.reduce((s, a) => s + a, 0)}`);
check('17. €10 among three is 333 / 333 / 334, with no cent lost',
  JSON.stringify(amounts) === JSON.stringify([333, 333, 334]), `${amounts.join(' / ')}`);
check('14b. every amount is an integer number of cents',
  amounts.every((a) => Number.isInteger(a)), `${amounts.join(', ')}`);
{
  const adjusted = (entries.rows ?? []).filter((e) => e.rounding_adjustment_cents === 1).length;
  check('16. exactly one entry records the rounding remainder',
    adjusted === 1, `${adjusted} entr(y|ies) adjusted by a cent`);
}

/* ── 8 · an employee trying to change the weighting ──────────────────────── */
/* Two different things have to hold, and a PATCH answering 200 does not by
   itself decide either of them. On a row the employee can reach, the column
   guard must refuse the write. On a row RLS hides, PostgREST matches nothing
   and answers 200 with an empty representation — which is a pass, not a leak.
   Both are asserted on the row afterwards, never on the status code alone. */
{
  const before = await get(A.token, `shifts?select=workplace_role_id&id=eq.${B_OPEN}`);
  const r = await patch(B.token, `shifts?id=eq.${B_OPEN}`, { workplace_role_id: R_SENIOR });
  const after = await get(A.token, `shifts?select=workplace_role_id&id=eq.${B_OPEN}`);
  check('8. an employee cannot boost the role points on a shift they can edit',
    !r.ok && after.rows?.[0]?.workplace_role_id === (before.rows?.[0]?.workplace_role_id ?? null),
    `PATCH HTTP ${r.status}, ${r.rows?.length ?? 0} row(s); role ${before.rows?.[0]?.workplace_role_id} → ${after.rows?.[0]?.workplace_role_id}`);

  /* Control: the same employee CAN make an ordinary edit to that same row, so
     the refusal above was the guard and not an unreachable row. */
  const ok = await patch(B.token, `shifts?id=eq.${B_OPEN}`, { break_minutes: 5 });
  check('8c. …on a row they demonstrably can edit',
    ok.ok && (ok.rows?.length ?? 0) === 1 && ok.rows[0].break_minutes === 5,
    `PATCH HTTP ${ok.status}, ${ok.rows?.length ?? 0} row(s)`);
}
{
  /* The locked, approved shift the calculation already used. */
  const locked = await get(A.token, `shifts?select=id,workplace_role_id,locked,status&member_id=eq.${M_B}&work_date=eq.${DAY}`);
  const row = locked.rows?.[0];
  const r = row ? await patch(B.token, `shifts?id=eq.${row.id}`, { workplace_role_id: R_SENIOR }) : null;
  const after = row ? await get(A.token, `shifts?select=workplace_role_id&id=eq.${row.id}`) : null;
  check('8d. …and a locked, approved shift is out of reach entirely — zero rows changed, whatever the status',
    !!row && row.locked === true &&
      (!r.ok || (r.rows?.length ?? 0) === 0) &&
      after?.rows?.[0]?.workplace_role_id === row.workplace_role_id,
    `locked=${row?.locked} status=${row?.status}; PATCH HTTP ${r?.status}, ${r?.rows?.length ?? 0} row(s); role ${row?.workplace_role_id} → ${after?.rows?.[0]?.workplace_role_id}`);
}
{
  const r = await patch(B.token, `workplace_members?id=eq.${M_B}`, { workplace_role_id: R_SENIOR, multiplier: 2 });
  const after = await get(A.token, `workplace_members?select=workplace_role_id,multiplier&id=eq.${M_B}`);
  check('8b. …nor on their membership',
    !r.ok && after.rows?.[0]?.workplace_role_id === R_SERVER, `PATCH HTTP ${r.status}`);
}
{
  const r = await patch(B.token, `distribution_rule_areas?rule_id=eq.${RULE1}`, { percentage: 100 });
  check('9. an employee cannot change the area shares',
    !r.ok || (r.rows?.length ?? 0) === 0, `PATCH HTTP ${r.status}, ${r.rows?.length ?? 0} row(s)`);
}

/* ── 11, 12, 13 · the overlap threshold ──────────────────────────────────── */
{
  const DAY2 = '2019-05-07';
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_A, work_date: DAY2,
    starts_at: iso(DAY2, 18), ends_at: iso(DAY2, 23), break_minutes: 0, status: 'approved',
  });
  // Exactly 15 minutes of overlap with the anchor.
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_B, work_date: DAY2,
    starts_at: iso(DAY2, 22, 45), ends_at: iso(DAY2, 23, 45), break_minutes: 0, status: 'approved',
  });
  // Fourteen.
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_C, work_date: DAY2,
    starts_at: iso(DAY2, 22, 46), ends_at: iso(DAY2, 23, 46), break_minutes: 0, status: 'approved',
  });
  const pool2 = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY2, period_end: DAY2,
    label: `overlap ${STAMP}`, cash_cents: 9000, source: 'manual', status: 'open', created_by: M_A,
  });
  const POOL2 = pool2.rows?.[0]?.id;
  const calc2 = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL2 });
  const DIST2 = typeof calc2.body === 'string' ? calc2.body : null;
  const rows2 = DIST2 ? await get(A.token, `tip_distribution_entries?select=member_id&distribution_id=eq.${DIST2}`) : null;
  const members = new Set((rows2?.rows ?? []).map((e) => e.member_id));
  check('11/12. exactly 15 minutes of overlap with the anchor is enough',
    members.has(M_B), `${members.size} member(s) included`);
  check('13. fourteen minutes is not',
    !members.has(M_C), members.has(M_C) ? 'LEAK: a below-threshold shift was paid' : 'excluded, as intended');
}

/* ── 19, 20, 21, 22, 23 · finalisation ───────────────────────────────────── */
{
  const r = await rpc(B.token, 'send_distribution', { p_distribution_id: DIST });
  check('20. an employee cannot finalise a distribution', !r.ok, `HTTP ${r.status}`);
}
{
  const r = WP_OTHER ? await rpc(B.token, 'send_distribution', { p_distribution_id: DIST }) : { ok: false, status: 0 };
  check('21. a manager of another workplace cannot finalise this one', !r.ok, `HTTP ${r.status}`);
}
{
  // 31: change the inputs after calculating, then try to send the stale draft.
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_A, work_date: DAY,
    starts_at: iso(DAY, 8), ends_at: iso(DAY, 10), break_minutes: 0, status: 'approved',
  });
  const stale = await rpc(A.token, 'send_distribution', { p_distribution_id: DIST });
  const still = await get(A.token, `tip_distributions?select=status&id=eq.${DIST}`);
  check('31. a draft whose hours changed underneath it cannot be sent',
    !stale.ok && still.rows?.[0]?.status === 'draft',
    `HTTP ${stale.status}, status is still ${still.rows?.[0]?.status}`);
}
{
  const recalc = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL });
  DIST = typeof recalc.body === 'string' ? recalc.body : DIST;
  const r = await rpc(A.token, 'send_distribution', { p_distribution_id: DIST });
  const row = await get(A.token, `tip_distributions?select=status,sent_at&id=eq.${DIST}`);
  check('19. after recalculating, the manager can finalise it',
    r.ok && row.rows?.[0]?.status === 'sent', `HTTP ${r.status}, status ${row.rows?.[0]?.status}`);
}
{
  const again = await rpc(A.token, 'send_distribution', { p_distribution_id: DIST });
  const row = await get(A.token, `tip_distributions?select=status&id=eq.${DIST}`);
  check('22. sending it a second time is refused, and changes nothing',
    !again.ok && row.rows?.[0]?.status === 'sent', `HTTP ${again.status}, status ${row.rows?.[0]?.status}`);
}
{
  const r = await patch(A.token, `tip_distributions?id=eq.${DIST}`, { pool_cents: 1 });
  const entry = await get(A.token, `tip_distribution_entries?select=id,amount_cents&distribution_id=eq.${DIST}&limit=1`);
  const entryId = entry.rows?.[0]?.id;
  const before = entry.rows?.[0]?.amount_cents;
  const r2 = entryId ? await patch(A.token, `tip_distribution_entries?id=eq.${entryId}`, { amount_cents: 99999 }) : { status: 0 };
  const after = entryId ? await get(A.token, `tip_distribution_entries?select=amount_cents&id=eq.${entryId}`) : null;
  check('23. a sent distribution and its entries cannot be rewritten',
    !r.ok && after?.rows?.[0]?.amount_cents === before,
    `distribution PATCH HTTP ${r.status}, entry PATCH HTTP ${r2.status}, amount ${before} → ${after?.rows?.[0]?.amount_cents}`);
}

/* ── 24–27, 32 · who can read what ───────────────────────────────────────── */
/* The test user is a real person who accumulates memberships: every run of this
   script invites them into a new workplace, and the entries they were paid in
   earlier runs stay readable, because their membership THERE is still active.
   That is the policy working, not a leak — so "foreign" is decided per
   workplace (member_id against this run's membership) and, across all
   workplaces, by the view's own is_own flag. */
{
  const scoped = await get(B.token,
    `member_distribution_entries?select=id,workplace_id,distribution_id,member_id,area_id,amount_cents,is_own&workplace_id=eq.${WP}`);
  const mine = (scoped.rows ?? []).filter((e) => e.member_id === M_B);
  const others = (scoped.rows ?? []).filter((e) => e.member_id !== M_B);
  check('24. the employee can read their own share', mine.length >= 1, `${mine.length} own entr(y|ies) in this workplace`);

  const wpRow = await get(A.token, `workplaces?select=peer_entry_visibility&id=eq.${WP}`);
  const meRow = await get(A.token, `workplace_members?select=status&id=eq.${M_B}`);
  const describe = (e) =>
    `distribution ${e.distribution_id}, member ${e.member_id}, area ${e.area_id}, is_own ${e.is_own}`;
  check("25. …and none of their colleagues' shares",
    others.length === 0,
    others.length
      ? `LEAK: ${others.length} foreign entr(y|ies) in this workplace — ${others.map(describe).join(' | ')}` +
        ` · caller member ${M_B}, peer_entry_visibility ${wpRow.rows?.[0]?.peer_entry_visibility}` +
        `, membership ${meRow.rows?.[0]?.status}`
      : `none, with peer_entry_visibility = ${wpRow.rows?.[0]?.peer_entry_visibility}`);

  /* Across every workplace this person belongs to, the invariant that actually
     holds under peer visibility "none" is that each row is their own. */
  const all = await get(B.token,
    'member_distribution_entries?select=id,workplace_id,distribution_id,member_id,area_id,is_own');
  const notOwn = (all.rows ?? []).filter((e) => e.is_own !== true);
  check('25d. …and every entry readable anywhere is one of their own',
    notOwn.length === 0,
    notOwn.length
      ? `LEAK: ${notOwn.length} row(s) that are not the caller's — ${notOwn.map((e) => `workplace ${e.workplace_id}, ${describe(e)}`).join(' | ')}`
      : `${all.rows?.length ?? 0} readable row(s) across ${new Set((all.rows ?? []).map((e) => e.workplace_id)).size} workplace(s), all own`);
}
{
  const dist = await get(B.token, `member_distributions?select=id,pool_cents&workplace_id=eq.${WP}`);
  const withPool = (dist.rows ?? []).filter((d) => d.pool_cents !== null);
  check('25b. the pool total is masked from the employee',
    withPool.length === 0, `${withPool.length} row(s) exposed the pool`);
  const areasSeen = await get(B.token, `tip_distribution_areas?select=id&distribution_id=eq.${DIST}`);
  check('25c. …and so are the area subtotals, which would add up to it',
    (areasSeen.rows?.length ?? 0) === 0, `${areasSeen.rows?.length ?? '?'} area row(s)`);
}
{
  const mgr = await get(A.token, `tip_distributions?select=id&workplace_id=eq.${WP}`);
  check('26. the manager can read their own workplace distributions',
    (mgr.rows?.length ?? 0) >= 1, `${mgr.rows?.length ?? '?'} row(s)`);
  const foreign = await get(B.token, `tip_distributions?select=id&workplace_id=eq.${WP}`);
  check('27. an unrelated workplace cannot read them',
    (foreign.rows?.length ?? 0) === 0, `${foreign.rows?.length ?? '?'} row(s)`);
}
{
  const anon = await get(null, `tip_distributions?select=id&workplace_id=eq.${WP}`);
  const anonEntries = await get(null, `tip_distribution_entries?select=id&distribution_id=eq.${DIST}`);
  const anonCalc = await rpc(null, 'calculate_distribution', { p_pool_id: POOL });
  check('32. without a session none of the financial data is reachable',
    (anon.status >= 400 || (anon.rows?.length ?? 0) === 0) &&
    (anonEntries.status >= 400 || (anonEntries.rows?.length ?? 0) === 0) && !anonCalc.ok,
    `read HTTP ${anon.status}, entries HTTP ${anonEntries.status}, rpc HTTP ${anonCalc.status}`);
}

/* ── 28, 29, 30 · history survives the rules changing ────────────────────── */
{
  const before = await get(A.token, `tip_distribution_entries?select=id,amount_cents,points&distribution_id=eq.${DIST}&order=amount_cents`);
  const snapshotBefore = JSON.stringify((before.rows ?? []).map((e) => [e.amount_cents, e.points]));

  await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 4.5 });
  const newDraft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const ND = typeof newDraft.body === 'string' ? newDraft.body : null;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${ND}&area_id=eq.${A_BAR}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${ND}&area_id=neq.${A_BAR}`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${ND}`, { min_overlap_minutes: 240 });
  await rpc(A.token, 'activate_rule', { p_rule_id: ND });
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_BAR });

  const after = await get(A.token, `tip_distribution_entries?select=id,amount_cents,points&distribution_id=eq.${DIST}&order=amount_cents`);
  const snapshotAfter = JSON.stringify((after.rows ?? []).map((e) => [e.amount_cents, e.points]));

  check('28/29/30. changing role points, area shares, the overlap rule and a member area leaves the sent distribution untouched',
    snapshotBefore === snapshotAfter && snapshotBefore !== '[]',
    `${(before.rows ?? []).length} entries compared`);

  const rulesSnap = await get(A.token, `tip_distributions?select=rules_snapshot,rule_version&id=eq.${DIST}`);
  check('28b. …and it still records the rule it was calculated under',
    rulesSnap.rows?.[0]?.rules_snapshot?.min_overlap_minutes === 15,
    `snapshot min_overlap_minutes = ${rulesSnap.rows?.[0]?.rules_snapshot?.min_overlap_minutes}`);

  /* Put the fixture back. This check deliberately moves a member into Bar and
     rewrites the role points to prove a sent distribution does not follow; if
     it left them that way, every later scenario would silently run against a
     roster it did not choose. */
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE });
  await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 1.0 });
  const restored = await get(A.token, `workplace_members?select=area_id&id=eq.${M_B}`);
  check('30b. …and the fixture is put back afterwards, so later scenarios start clean',
    restored.rows?.[0]?.area_id === A_SERVICE,
    `member area = ${restored.rows?.[0]?.area_id === A_SERVICE ? 'service' : restored.rows?.[0]?.area_id}`);
}

/* ── 33 · a suspended member ─────────────────────────────────────────────── */
/* Suspension is per workplace: it must close THIS workplace's financial data,
   and it says nothing about a workplace where the same person is still active.
   So everything below is scoped to this run's workplace. */
{
  const ownEntry = await get(A.token,
    `tip_distribution_entries?select=id&distribution_id=eq.${DIST}&member_id=eq.${M_B}`);
  const ENTRY_B = ownEntry.rows?.[0]?.id ?? '00000000-0000-0000-0000-000000000000';

  const beforeEntries = await get(B.token, `member_distribution_entries?select=id&workplace_id=eq.${WP}`);
  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'suspended' });
  const statusNow = await get(A.token, `workplace_members?select=status&id=eq.${M_B}`);

  const readEntries = await get(B.token, `member_distribution_entries?select=id,member_id&workplace_id=eq.${WP}`);
  const readDists = await get(B.token, `member_distributions?select=id&workplace_id=eq.${WP}`);
  const readAreas = await get(B.token, `tip_distribution_areas?select=id&workplace_id=eq.${WP}`);
  const ack = await rpc(B.token, 'acknowledge_entry', { p_entry_id: ENTRY_B, p_status: 'acknowledged' });

  check('33. a suspended member loses access to the financial data of that workplace',
    statusNow.rows?.[0]?.status === 'suspended' &&
      (beforeEntries.rows?.length ?? 0) >= 1 &&
      (readEntries.rows?.length ?? 0) === 0 &&
      (readDists.rows?.length ?? 0) === 0 &&
      (readAreas.rows?.length ?? 0) === 0 &&
      !ack.ok,
    `membership ${statusNow.rows?.[0]?.status}; entries ${beforeEntries.rows?.length ?? '?'} → ${readEntries.rows?.length ?? '?'}` +
      `, summaries ${readDists.rows?.length ?? '?'}, area rows ${readAreas.rows?.length ?? '?'}` +
      `, acknowledge HTTP ${ack.status} (on their own entry, not a made-up id)`);

  await patch(A.token, `workplace_members?id=eq.${M_B}`, { status: 'active' });
  const back = await get(B.token, `member_distribution_entries?select=id&workplace_id=eq.${WP}`);
  check('33b. …and reinstating the membership gives exactly that access back',
    (back.rows?.length ?? 0) === (beforeEntries.rows?.length ?? -1),
    `${back.rows?.length ?? '?'} entr(y|ies) again, against ${beforeEntries.rows?.length ?? '?'} before`);
}

/* ── the overlap model the engine actually implements ────────────────────── */
/* longest_shift and pairwise are both implemented as of migration 16.
   service_window is still only an enum value, so it is the one that must be
   refused — activating a rule the engine cannot honour would leave a record
   describing a calculation that never ran. */
{
  const draft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const D = typeof draft.body === 'string' ? draft.body : null;
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D}&area_id=neq.${A_SERVICE}`, { percentage: 0 });

  await patch(A.token, `distribution_rules?id=eq.${D}`, { overlap_basis: 'service_window' });
  const r = await rpc(A.token, 'activate_rule', { p_rule_id: D });
  const stillDraft = await get(A.token, `distribution_rules?select=status&id=eq.${D}`);
  check('34. a rule set to an overlap model the engine does not implement is refused',
    !r.ok && stillDraft.rows?.[0]?.status === 'draft',
    `service_window: HTTP ${r.status}, rule left ${stillDraft.rows?.[0]?.status}` +
      (r.ok ? ' — LEAK: the record would have described a calculation that never ran' : ''));

  await patch(A.token, `distribution_rules?id=eq.${D}`, { overlap_basis: 'longest_shift' });
  const ls = await rpc(A.token, 'activate_rule', { p_rule_id: D });
  check('34b. …while the two models it does implement activate',
    ls.ok, `longest_shift: HTTP ${ls.status}${ls.ok ? '' : ` ${ls.raw}`}`);
}

/* ── 35–41 · pairwise overlap and the empty-area refusal ─────────────────── */
/* Each of the three scenarios below gets its own people. They are created in
   Service and nothing else touches them, so a result here can only come from
   the shifts the scenario itself wrote. */
{
  const DAY3 = '2019-05-08';
  // A real chain: P1—P2, P2—P3, and P1 never meets P3. P4 meets nobody.
  //   P1 16:00–20:00Z   P2 19:00–23:00Z   P3 22:00–02:00Z   P4 07:00–11:00Z
  const P1 = await addMember('Chain', A_SERVICE);
  const P2 = await addMember('Chain', A_SERVICE);
  const P3 = await addMember('Chain', A_SERVICE);
  const P4 = await addMember('Chain', A_SERVICE);
  const shiftRows = [
    [P1, iso(DAY3, 16), iso(DAY3, 20)],
    [P2, iso(DAY3, 19), iso(DAY3, 23)],
    [P3, iso(DAY3, 22), iso('2019-05-09', 2)],
    [P4, iso(DAY3, 7), iso(DAY3, 11)],
  ];
  let written = 0;
  for (const [member, from, to] of shiftRows) {
    const r = await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY3,
      starts_at: from, ends_at: to, break_minutes: 0, status: 'approved',
    });
    if (r.ok) written += 1;
  }
  check('35a. the chain fixture really was created',
    written === 4, `${written} of 4 shifts inserted`);

  // Switch the workplace to pairwise, explicitly, as a manager would.
  const draft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const PW_RULE = typeof draft.body === 'string' ? draft.body : null;
  await patch(A.token, `distribution_rules?id=eq.${PW_RULE}`, {
    overlap_basis: 'pairwise', method: 'hours', min_overlap_minutes: 15,
  });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${PW_RULE}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${PW_RULE}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  const activated = await rpc(A.token, 'activate_rule', { p_rule_id: PW_RULE });
  check('35. a rule can now be activated on the pairwise model',
    activated.ok, `HTTP ${activated.status}${activated.ok ? '' : ` ${activated.raw}`}`);

  const pool3 = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY3, period_end: DAY3,
    label: `pairwise ${STAMP}`, cash_cents: 9000, source: 'manual', status: 'open', created_by: M_A,
  });
  const POOL3 = pool3.rows?.[0]?.id;
  const calc3 = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL3 });
  const DIST3 = typeof calc3.body === 'string' ? calc3.body : null;
  const rows3 = DIST3
    ? await get(A.token, `tip_distribution_entries?select=member_id,amount_cents,overlap_minutes&distribution_id=eq.${DIST3}`)
    : null;
  const included = new Set((rows3?.rows ?? []).map((e) => e.member_id));

  check('36. every link in the chain is paid, and the isolated day shift is not',
    calc3.ok && included.has(P1) && included.has(P2) && included.has(P3) && !included.has(P4),
    `HTTP ${calc3.status}; ${included.size} included of 4` +
      `${calc3.ok ? '' : ` ${calc3.raw}`}` +
      `${included.has(P4) ? ' — LEAK: the isolated worker was paid' : ''}`);

  const snap3 = DIST3 ? await get(A.token, `tip_distributions?select=inputs_snapshot,overlap_basis&id=eq.${DIST3}`) : null;
  const pairs = snap3?.rows?.[0]?.inputs_snapshot?.pairs ?? [];
  check('37. the whole overlap graph is in the permanent record',
    pairs.length === 6, `${pairs.length} pair(s) for 4 people`);
  const ends = pairs.find(
    (pr) => [pr.member_a, pr.member_b].includes(P1) && [pr.member_a, pr.member_b].includes(P3));
  check('37c. …including the two ends of the chain, recorded as a pair that never linked',
    !!ends && ends.linked === false, ends ? `${ends.minutes} minute(s), linked=${ends.linked}` : 'pair missing');
  check('37b. …and the distribution records that it used pairwise',
    snap3?.rows?.[0]?.overlap_basis === 'pairwise', `basis = ${snap3?.rows?.[0]?.overlap_basis}`);
  const shiftsSnap = snap3?.rows?.[0]?.inputs_snapshot?.shifts ?? [];
  check('38. the excluded person is recorded with the reason',
    shiftsSnap.some((sh) => sh.member_id === P4 && sh.eligibility === 'no_pairwise_overlap'),
    shiftsSnap.map((sh) => sh.eligibility).join(', '));
  check('39. and the money still reconciles exactly',
    (rows3?.rows ?? []).length > 0 &&
      (rows3.rows).reduce((sum, e) => sum + e.amount_cents, 0) === 9000,
    `sum of entries = ${(rows3?.rows ?? []).reduce((sum, e) => sum + e.amount_cents, 0)} against 9000`);
}
{
  /* Two crews who never met, in one period. A crew is two people: one lone
     worker is simply excluded, which is not the same thing and must not be
     mistaken for it — so this fixture builds two of each. */
  const DAY4 = '2019-05-09';
  const K1 = await addMember('Crew', A_SERVICE);
  const K2 = await addMember('Crew', A_SERVICE);
  const K3 = await addMember('Crew', A_SERVICE);
  const K4 = await addMember('Crew', A_SERVICE);
  for (const [member, from, to] of [
    [K1, 6, 11], [K2, 7, 11],      // morning
    [K3, 16, 21], [K4, 17, 21],    // evening
  ].map(([m, f, t]) => [m, iso(DAY4, f), iso(DAY4, t)])) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY4,
      starts_at: from, ends_at: to, break_minutes: 0, status: 'approved',
    });
  }
  const pool4 = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY4, period_end: DAY4,
    label: `crews ${STAMP}`, cash_cents: 5000, source: 'manual', status: 'open', created_by: M_A,
  });
  const POOL4 = pool4.rows?.[0]?.id;
  const beforeCount = (await get(A.token, `tip_distributions?select=id&tip_pool_id=eq.${POOL4}`)).rows?.length ?? 0;
  const calc4 = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL4 });
  const after = await get(A.token, `tip_distributions?select=id&tip_pool_id=eq.${POOL4}`);
  check('40. a period holding two crews who never met is refused, not silently split',
    !calc4.ok && beforeCount === 0 && (after.rows?.length ?? 0) === 0,
    `HTTP ${calc4.status}; distributions for this pool ${beforeCount} → ${after.rows?.length ?? '?'}` +
      `${calc4.ok ? '' : ` · ${calc4.raw}`}`);

  /* And the shape that is NOT two crews: one crew plus a lone worker. It has
     to go through, or the refusal above would be catching the wrong thing. */
  const DAY4B = '2019-05-15';
  const L1 = await addMember('Lone', A_SERVICE);
  const L2 = await addMember('Lone', A_SERVICE);
  const L3 = await addMember('Lone', A_SERVICE);
  for (const [member, from, to] of [
    [L1, 6, 11], [L2, 7, 11], [L3, 16, 21],
  ].map(([m, f, t]) => [m, iso(DAY4B, f), iso(DAY4B, t)])) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY4B,
      starts_at: from, ends_at: to, break_minutes: 0, status: 'approved',
    });
  }
  const pool4b = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY4B, period_end: DAY4B,
    label: `lone ${STAMP}`, cash_cents: 5000, source: 'manual', status: 'open', created_by: M_A,
  });
  const POOL4B = pool4b.rows?.[0]?.id;
  const calc4b = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL4B });
  const D4B = typeof calc4b.body === 'string' ? calc4b.body : null;
  const rows4b = D4B
    ? await get(A.token, `tip_distribution_entries?select=member_id&distribution_id=eq.${D4B}`) : null;
  const paid = new Set((rows4b?.rows ?? []).map((e) => e.member_id));
  check('40b. …while one crew plus a single lone worker is one group, and does go through',
    calc4b.ok && paid.has(L1) && paid.has(L2) && !paid.has(L3),
    `HTTP ${calc4b.status}; ${paid.size} paid of 3${calc4b.ok ? '' : ` ${calc4b.raw}`}`);
}
{
  /* Bar gets 40% and has nobody in it. Both people are created in Service and
     nothing moves them, so Bar is empty by construction. */
  const DAY5 = '2019-05-10';
  const E1 = await addMember('Empty', A_SERVICE);
  const E2 = await addMember('Empty', A_SERVICE);
  const draft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const R = typeof draft.body === 'string' ? draft.body : null;
  await patch(A.token, `distribution_rules?id=eq.${R}`, { overlap_basis: 'longest_shift', method: 'hours' });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${R}&area_id=eq.${A_SERVICE}`, { percentage: 60 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${R}&area_id=eq.${A_BAR}`, { percentage: 40 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${R}&area_id=not.in.(${A_SERVICE},${A_BAR})`, { percentage: 0 });
  await rpc(A.token, 'activate_rule', { p_rule_id: R });

  for (const member of [E1, E2]) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY5,
      starts_at: iso(DAY5, 18), ends_at: iso(DAY5, 22), break_minutes: 0, status: 'approved',
    });
  }
  /* Prove the premise before asserting the consequence: nobody works in Bar. */
  const inBar = await get(A.token, `workplace_members?select=id&workplace_id=eq.${WP}&area_id=eq.${A_BAR}&status=eq.active`);
  check('41a. the premise holds — nobody is in Bar at all',
    (inBar.rows?.length ?? 0) === 0, `${inBar.rows?.length ?? '?'} member(s) in Bar`);

  const pool5 = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY5, period_end: DAY5,
    label: `emptyarea ${STAMP}`, cash_cents: 10000, source: 'manual', status: 'open', created_by: M_A,
  });
  const POOL5 = pool5.rows?.[0]?.id;
  const beforeCount = (await get(A.token, `tip_distributions?select=id&tip_pool_id=eq.${POOL5}`)).rows?.length ?? 0;
  const calc5 = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL5 });
  const written = await get(A.token, `tip_distributions?select=id&tip_pool_id=eq.${POOL5}`);
  check('41. an area with a share and nobody in it stops the distribution, naming the area',
    !calc5.ok && beforeCount === 0 && (written.rows?.length ?? 0) === 0 && /Bar/i.test(calc5.raw ?? ''),
    `HTTP ${calc5.status}; distributions for this pool ${beforeCount} → ${written.rows?.length ?? '?'}; names the area: ${/Bar/i.test(calc5.raw ?? '')}`);

  const areaRows = await get(A.token,
    `tip_distribution_areas?select=area_key,total_cents&workplace_id=eq.${WP}&distribution_id=in.(${(written.rows ?? []).map((d) => d.id).join(',') || '00000000-0000-0000-0000-000000000000'})`);
  check('41b. …and no money moved into Service instead',
    (written.rows?.length ?? 0) === 0 && (areaRows.rows?.length ?? 0) === 0,
    `${written.rows?.length ?? '?'} distribution(s), ${areaRows.rows?.length ?? 0} area row(s) for this pool`);
}

console.log(`\n  created for this run:`);
console.log(`    workplace   ${WP}`);
console.log(`    pool        ${POOL}`);
console.log(`    distribution ${DIST}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
