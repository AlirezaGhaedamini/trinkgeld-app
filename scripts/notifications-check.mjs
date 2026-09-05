/**
 * Live notification verification for TipCrew Phase 3O.
 *
 * Six events, one personal inbox each. What this proves that the SQL suite
 * cannot: the PRIVILEGE layer over PostgREST. `member_notifications` grants
 * SELECT and nothing else, so a direct POST, PATCH or DELETE is refused before
 * RLS is even consulted — and that is only observable across the real REST path.
 *
 *   node scripts/notifications-check.mjs
 *
 * THESE CHECKS FAIL UNTIL MIGRATIONS 30 AND 31 ARE PUSHED. That is expected:
 * they assert behaviour that does not exist on a project still at 29.
 *
 * WHAT IT WRITES. Two workplaces per run, tagged with the run's timestamp, plus
 * three nights, a three-link correction chain, four payouts and a reversal.
 * Point it at a development project.
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
/** Refused means the server said no, or RLS filtered the row so nothing moved. */
const refused = (r) => !r.ok || (r.rows?.length ?? 0) === 0;
const iso = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

console.log(`\n  TipCrew — live notification verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── setup ───────────────────────────────────────────────────────────────── */

const createdWp = await rpc(A.token, 'create_workplace', { p_name: `Notify Test ${STAMP}` });
const WP = typeof createdWp.body === 'string' ? createdWp.body : null;
if (!WP) die(`create_workplace failed: HTTP ${createdWp.status} ${createdWp.raw}`);

const rival = await rpc(B.token, 'create_workplace', { p_name: `Notify Rival ${STAMP}` });
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

await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });

{
  const draftId = (await get(A.token,
    `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`)).rows?.[0]?.id;
  // One area at 100%, so every correction moves the split between exactly the
  // two real accounts this script has.
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${draftId}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token,
    `distribution_rule_areas?rule_id=eq.${draftId}&area_id=not.in.(${A_SERVICE})`, { percentage: 0 });
  await patch(A.token, `distribution_rules?id=eq.${draftId}`,
    { method: 'hours_points', min_overlap_minutes: 15, acknowledgement_required: true });
  const activated = await rpc(A.token, 'activate_rule', { p_rule_id: draftId });
  if (!activated.ok) die(`activate_rule failed: HTTP ${activated.status} ${activated.raw}`);
}

/** One night. `withStaff: false` leaves B off the roster, so B is a non-participant. */
async function night(day, cashCents, { withStaff = true } = {}) {
  const report = await post(A.token, 'tip_reports', {
    workplace_id: WP, member_id: M_A, work_date: day, cash_cents: cashCents, card_cents: 0 });
  if (!report.rows?.[0]?.id) die(`tip_reports insert failed for ${day}: HTTP ${report.status}`);
  await post(A.token, 'shifts', {
    workplace_id: WP, member_id: M_A, work_date: day, starts_at: iso(day, 16), ends_at: iso(day, 23),
    break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
  if (withStaff) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: M_B, work_date: day, starts_at: iso(day, 16), ends_at: iso(day, 20),
      break_minutes: 0, status: 'approved', area_id: A_SERVICE, workplace_role_id: R_SERVER });
  }
  const pooled = await rpc(A.token, 'create_pool_from_reports',
    { p_workplace_id: WP, p_period_start: day, p_period_end: day });
  const poolId = typeof pooled.body === 'string' ? pooled.body : null;
  if (!poolId) die(`create_pool_from_reports failed for ${day}: ${pooled.raw}`);
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: poolId });
  const distId = typeof calc.body === 'string' ? calc.body : null;
  if (!distId) die(`calculate_distribution failed for ${day}: ${calc.raw}`);
  return { day, distId };
}
async function send(distId) {
  const sent = await rpc(A.token, 'send_distribution', { p_distribution_id: distId });
  if (!sent.ok) die(`send_distribution failed: ${sent.raw}`);
  return distId;
}
async function moveStaff(day, hour) {
  const shift = (await get(A.token,
    `shifts?select=id&member_id=eq.${M_B}&work_date=eq.${day}`)).rows?.[0];
  await patch(A.token, `shifts?id=eq.${shift?.id}`, { locked: false });
  return patch(A.token, `shifts?id=eq.${shift?.id}`, { starts_at: iso(day, hour) });
}
async function correctAndSend(originalId, note) {
  const made = await rpc(A.token, 'create_replacement_distribution',
    { p_original_id: originalId, p_reason: 'hours', p_note: note });
  const id = typeof made.body === 'string' ? made.body : null;
  if (!id) die(`create_replacement_distribution failed: ${made.raw}`);
  return send(id);
}
async function payFor(distId, method) {
  const made = await rpc(A.token, 'record_distribution_payout',
    { p_distribution_id: distId, p_method: method });
  const id = typeof made.body === 'string' ? made.body : null;
  if (!id) die(`record_distribution_payout failed: ${made.raw}`);
  return id;
}
const NOTIF_COLS = 'id,workplace_id,member_id,type,distribution_id,query_id,payout_id,reversal_id,payload,created_at,read_at';
const inboxOf = (token, wp = WP) =>
  get(token, `member_notifications?select=${NOTIF_COLS}&workplace_id=eq.${wp}&order=created_at.desc`);

/* ── 1 · a draft tells nobody ────────────────────────────────────────────── */

const N1 = await night('2018-04-03', 90000);
{
  const before = await inboxOf(B.token);
  check('1. a distribution that has only been calculated notifies nobody',
    (before.rows?.length ?? 0) === 0, `${before.rows?.length ?? 0} row(s), HTTP ${before.status}`);
}

/* ── 2 · sending it tells the people in it ───────────────────────────────── */
await send(N1.distId);
{
  const mine = await inboxOf(B.token);
  const sent = (mine.rows ?? []).filter((n) => n.type === 'distribution_sent' && n.distribution_id === N1.distId);
  check('2. sending it notifies the employee who has an entry',
    sent.length === 1, `${sent.length} row(s)`);
  check('3. …unread, and addressed to their own membership',
    sent[0]?.read_at === null && sent[0]?.member_id === M_B,
    `read_at ${sent[0]?.read_at}, member ${sent[0]?.member_id === M_B}`);
  const mgr = await inboxOf(A.token);
  check('4. …and the manager, who also has an entry, is told about their own share',
    (mgr.rows ?? []).some((n) => n.type === 'distribution_sent' && n.distribution_id === N1.distId),
    `${mgr.rows?.length ?? 0} manager row(s)`);

  const text = JSON.stringify(mine.rows ?? []);
  check('5. no payload carries an amount, a pool, an auth id or an address',
    !/cents|amount|pool_/i.test(JSON.stringify((mine.rows ?? []).map((n) => n.payload))) &&
      !text.includes(A.userId) && !text.includes(B.userId) &&
      !text.includes(A.email) && !text.includes(B.email),
    'payload stays neutral');
}

/* ── 3 · a first payout reaches whoever it moves ─────────────────────────── */
const P1 = await payFor(N1.distId, 'cash');
{
  const mine = await inboxOf(B.token);
  check('6. a first payout notifies the member, because their whole share moved',
    (mine.rows ?? []).some((n) => n.type === 'payout_recorded' && n.payout_id === P1),
    `payout ${P1}`);
}

/* ── 4 · the correction ──────────────────────────────────────────────────── */
await moveStaff(N1.day, 14);
const D2 = await correctAndSend(N1.distId, 'The start time was two hours out.');
{
  const mine = await inboxOf(B.token);
  check('7. a correction is announced as a correction, not as a first send',
    (mine.rows ?? []).some((n) => n.type === 'distribution_corrected' && n.distribution_id === D2) &&
      !(mine.rows ?? []).some((n) => n.type === 'distribution_sent' && n.distribution_id === D2),
    `corrected row for ${D2}`);
}

const P2 = await payFor(D2, 'payroll');
{
  const mine = await inboxOf(B.token);
  const row = (await get(A.token, `distribution_payouts?select=amount_cents&id=eq.${P2}`)).rows?.[0];
  check('8. paying a corrected version settles a zero delta at workplace level',
    row?.amount_cents === 0, `amount ${row?.amount_cents}`);
  check('9. …yet the member whose OWN share moved is still told',
    (mine.rows ?? []).some((n) => n.type === 'payout_recorded' && n.payout_id === P2),
    'per-member delta, not the workplace total');
}

/* ── 5 · reversal reaches exactly that payment's recipients ──────────────── */
const rev = await rpc(A.token, 'reverse_distribution_payout',
  { p_payout_id: P2, p_reason: 'payment_not_completed', p_note: 'The run did not go out.' });
const REV = typeof rev.body === 'string' ? rev.body : null;
{
  const mineB = await inboxOf(B.token);
  const mineA = await inboxOf(A.token);
  const toldOfPayout = new Set([
    ...(mineB.rows ?? []).filter((n) => n.payout_id === P2 && n.type === 'payout_recorded').map(() => M_B),
    ...(mineA.rows ?? []).filter((n) => n.payout_id === P2 && n.type === 'payout_recorded').map(() => M_A),
  ]);
  const toldOfReversal = new Set([
    ...(mineB.rows ?? []).filter((n) => n.reversal_id === REV).map(() => M_B),
    ...(mineA.rows ?? []).filter((n) => n.reversal_id === REV).map(() => M_A),
  ]);
  check('10. a reversal reaches exactly the set that was told about that payment',
    toldOfPayout.size > 0 && toldOfPayout.size === toldOfReversal.size &&
      [...toldOfPayout].every((m) => toldOfReversal.has(m)),
    `${toldOfPayout.size} told of payout, ${toldOfReversal.size} told of reversal`);
}

/* ── 6 · payout → reversal → repayout stays two events ───────────────────── */
const P3 = await payFor(D2, 'cash');
{
  const mine = await inboxOf(B.token);
  const recorded = (mine.rows ?? []).filter((n) => n.type === 'payout_recorded' && n.distribution_id === D2);
  check('11. a repayment after a reversal is a SECOND notification, not a collapsed one',
    recorded.length === 2, `${recorded.length} payout_recorded row(s) on ${D2}`);
  check('12. …distinguished by the payout each came from',
    new Set(recorded.map((n) => n.payout_id)).size === 2 &&
      recorded.some((n) => n.payout_id === P2) && recorded.some((n) => n.payout_id === P3),
    `payouts ${[...new Set(recorded.map((n) => n.payout_id))].length}`);
}

/* ── 7 · a correction that moves nobody notifies nobody ──────────────────── */
/* No hours change, so the recalculated version is identical and every member's
   own delta is zero. Nobody should be told they were paid. */
const D3 = await correctAndSend(D2, 'Re-run with no change, to prove the delta rule.');
const P4 = await payFor(D3, 'payroll');
{
  const mineB = await inboxOf(B.token);
  const mineA = await inboxOf(A.token);
  check('13. a payout whose per-member delta is zero notifies nobody at all',
    !(mineB.rows ?? []).some((n) => n.payout_id === P4) &&
      !(mineA.rows ?? []).some((n) => n.payout_id === P4),
    'nobody is told "paid" when their own share did not move');
  check('14. …while the corrected version itself was still announced',
    (mineB.rows ?? []).some((n) => n.type === 'distribution_corrected' && n.distribution_id === D3),
    'the correction is news; a zero settlement is not');
}

/* ── 8 · migration 31 · the chain stays traversable ──────────────────────── */
{
  const mine = await get(B.token,
    `member_distributions?select=id,supersedes_id,superseded_by,status&order=period_start.desc`);
  const byId = new Map((mine.rows ?? []).map((d) => [d.id, d]));
  check('15. the original still points at the version that replaced it',
    byId.get(N1.distId)?.superseded_by === D2,
    `${N1.distId} -> ${byId.get(N1.distId)?.superseded_by}`);
  check('16. …and the retired middle version points at the current head',
    byId.get(D2)?.superseded_by === D3 && byId.get(D2)?.status === 'cancelled',
    `${D2} -> ${byId.get(D2)?.superseded_by}, status ${byId.get(D2)?.status}`);
  check('17. …so A <- B <- C is walkable to the head, which points nowhere',
    byId.get(D3)?.superseded_by === null,
    `head ${D3} -> ${byId.get(D3)?.superseded_by}`);
}

/* ── 9 · questions ───────────────────────────────────────────────────────── */
const NQ = await night('2018-04-05', 50000);
await send(NQ.distId);
{
  const asked = await rpc(B.token, 'query_distribution',
    { p_distribution_id: NQ.distId, p_note: 'My hours look short on this night.' });
  const mgr = await inboxOf(A.token);
  const emp = await inboxOf(B.token);
  check('18. a question reaches the manager',
    asked.ok && (mgr.rows ?? []).some((n) => n.type === 'query_raised' && n.distribution_id === NQ.distId),
    `HTTP ${asked.status}`);
  check('19. …and reaches no employee, not even the one who asked',
    !(emp.rows ?? []).some((n) => n.type === 'query_raised'),
    'query_raised is manager-only');

  const q1 = (await get(A.token,
    `distribution_queries?select=id&distribution_id=eq.${NQ.distId}&status=eq.open`)).rows?.[0];
  await rpc(A.token, 'resolve_query',
    { p_query_id: q1?.id, p_outcome: 'no_correction', p_response: 'The roster is right.' });
  await rpc(B.token, 'query_distribution',
    { p_distribution_id: NQ.distId, p_note: 'Still looks short to me.' });
  const q2 = (await get(A.token,
    `distribution_queries?select=id&distribution_id=eq.${NQ.distId}&status=eq.open`)).rows?.[0];
  await rpc(A.token, 'resolve_query',
    { p_query_id: q2?.id, p_outcome: 'no_correction', p_response: 'Checked again.' });

  const after = await inboxOf(B.token);
  const resolved = (after.rows ?? []).filter((n) => n.type === 'query_resolved');
  check('20. two questions answered are two notifications, not one collapsed',
    resolved.length === 2, `${resolved.length} query_resolved row(s)`);
  check('21. …distinguished by the question each one answers',
    new Set(resolved.map((n) => n.query_id)).size === 2,
    `${new Set(resolved.map((n) => n.query_id)).size} distinct question(s)`);
}

/* ── 10 · whose inbox is it ──────────────────────────────────────────────── */
{
  const emp = await inboxOf(B.token);
  /* `every()` on an empty array is true, so both checks first insist the inbox
     has rows: an empty inbox would otherwise pass this for the wrong reason. */
  check('22. an employee reads no row addressed to anybody else',
    (emp.rows?.length ?? 0) > 0 && emp.rows.every((n) => n.member_id === M_B),
    `${emp.rows?.length ?? 0} row(s), ${(emp.rows ?? []).filter((n) => n.member_id !== M_B).length} foreign`);
  const mgr = await inboxOf(A.token);
  check("23. a manager has no privileged view of an employee's inbox either",
    (mgr.rows?.length ?? 0) > 0 && mgr.rows.every((n) => n.member_id === M_A),
    `${mgr.rows?.length ?? 0} row(s), ${(mgr.rows ?? []).filter((n) => n.member_id !== M_A).length} foreign`);
  const anon = await get(null, `member_notifications?select=id&workplace_id=eq.${WP}`);
  check('24. an unauthenticated caller reads none',
    (anon.rows?.length ?? 0) === 0, `HTTP ${anon.status}, ${anon.rows?.length ?? 0} row(s)`);
  const other = await inboxOf(B.token, WP_OTHER);
  check('25. the second workplace is a separate, empty inbox',
    (other.rows?.length ?? 0) === 0, `${other.rows?.length ?? 0} row(s) in the rival workplace`);
}

/* ── 11 · the table is not writable, at the privilege layer ──────────────── */
{
  const row = (await inboxOf(B.token)).rows?.[0];
  const forged = await post(B.token, 'member_notifications', {
    workplace_id: WP, member_id: M_B, type: 'distribution_sent', distribution_id: N1.distId });
  check('26. a notification cannot be written directly',
    refused(forged), `HTTP ${forged.status} ${forged.raw}`);
  const readPatch = await patch(B.token, `member_notifications?id=eq.${row?.id}`,
    { read_at: new Date().toISOString() });
  check('27. …read_at cannot be PATCHed directly, only through the RPC',
    refused(readPatch), `HTTP ${readPatch.status} ${readPatch.raw}`);
  const typePatch = await patch(B.token, `member_notifications?id=eq.${row?.id}`,
    { type: 'payout_recorded' });
  check('28. …nor the type',
    refused(typePatch), `HTTP ${typePatch.status} ${typePatch.raw}`);
  const ownerPatch = await patch(B.token, `member_notifications?id=eq.${row?.id}`,
    { member_id: M_A });
  check('29. …nor who it is addressed to',
    refused(ownerPatch), `HTTP ${ownerPatch.status} ${ownerPatch.raw}`);
  const payloadPatch = await patch(B.token, `member_notifications?id=eq.${row?.id}`,
    { payload: { amount_cents: 9999 } });
  check('30. …nor the payload, so an amount cannot be injected into it',
    refused(payloadPatch), `HTTP ${payloadPatch.status} ${payloadPatch.raw}`);
  const removed = await del(B.token, `member_notifications?id=eq.${row?.id}`);
  check('31. …and it cannot be deleted',
    refused(removed), `HTTP ${removed.status} ${removed.raw}`);
}

/* ── 12 · read state ─────────────────────────────────────────────────────── */
{
  const row = (await inboxOf(B.token)).rows?.find((n) => n.read_at === null);
  const first = await rpc(B.token, 'mark_notification_read', { p_notification_id: row?.id });
  const afterOne = (await inboxOf(B.token)).rows?.find((n) => n.id === row?.id);
  check('32. mark_notification_read marks it read',
    first.ok && typeof afterOne?.read_at === 'string', `HTTP ${first.status} ${first.raw}`);

  await rpc(B.token, 'mark_notification_read', { p_notification_id: row?.id });
  const afterTwo = (await inboxOf(B.token)).rows?.find((n) => n.id === row?.id);
  check('33. …and reading it again does not move when it was first read',
    afterTwo?.read_at === afterOne?.read_at, `${afterOne?.read_at} -> ${afterTwo?.read_at}`);

  const stolen = await rpc(A.token, 'mark_notification_read', { p_notification_id: row?.id });
  check("34. somebody else's notification cannot be marked read, not even by a manager",
    stolen.status >= 400, `HTTP ${stolen.status} ${stolen.raw}`);

  const managerUnreadBefore = (await inboxOf(A.token)).rows?.filter((n) => n.read_at === null).length ?? 0;
  const all = await rpc(B.token, 'mark_all_notifications_read', { p_workplace_id: WP });
  const empLeft = (await inboxOf(B.token)).rows?.filter((n) => n.read_at === null).length ?? 0;
  const managerUnreadAfter = (await inboxOf(A.token)).rows?.filter((n) => n.read_at === null).length ?? 0;
  check("35. mark_all_notifications_read clears this workplace's own inbox",
    all.ok && empLeft === 0, `HTTP ${all.status}, ${empLeft} unread left`);
  check("36. …and touches nobody else's",
    managerUnreadAfter === managerUnreadBefore,
    `manager unread ${managerUnreadBefore} -> ${managerUnreadAfter}`);
}

/* ── 13 · who is NOT told ────────────────────────────────────────────────── */
/* Two cases the pre-push review asked for. A member with an account who simply
   was not on that night, and a member who WAS on the night until the manager
   rejected their hours and corrected it — the one person whose share fell to
   nothing, and who must still be told, without gaining any access. */
{
  const solo = await night('2018-04-07', 30000, { withStaff: false });
  await send(solo.distId);
  const emp = await inboxOf(B.token);
  const mgr = await inboxOf(A.token);
  check('37. a member with an account but no entry in a night is told nothing about it',
    !(emp.rows ?? []).some((n) => n.distribution_id === solo.distId) &&
      (mgr.rows ?? []).some((n) => n.distribution_id === solo.distId),
    'the only person in it is the only person told');

  /* The dropped member. B is in this night and is told and paid, then the
     manager rejects B's hours and corrects. */
  const drop = await night('2018-04-09', 60000);
  await send(drop.distId);
  const P_DROP = await payFor(drop.distId, 'cash');
  const told = (await inboxOf(B.token)).rows ?? [];
  check('38. before the correction she was in it, told of it and told it was paid',
    told.some((n) => n.type === 'distribution_sent' && n.distribution_id === drop.distId) &&
      told.some((n) => n.type === 'payout_recorded' && n.payout_id === P_DROP),
    'the setup really put her in the night');

  const shift = (await get(A.token,
    `shifts?select=id&member_id=eq.${M_B}&work_date=eq.${drop.day}`)).rows?.[0];
  await patch(A.token, `shifts?id=eq.${shift?.id}`, { locked: false });
  const rejected = await patch(A.token, `shifts?id=eq.${shift?.id}`, { status: 'rejected' });
  if (!rejected.ok) die(`could not reject the shift: ${rejected.raw}`);
  const DROP2 = await correctAndSend(drop.distId, 'Those hours were not worked.');

  const entries = await get(A.token,
    `tip_distribution_entries?select=member_id&distribution_id=eq.${DROP2}`);
  check('39. the fixture really dropped her: no entry on the replacement',
    (entries.rows ?? []).length > 0 && !(entries.rows ?? []).some((e) => e.member_id === M_B),
    `${(entries.rows ?? []).length} entr(ies), none hers`);

  const after = (await inboxOf(B.token)).rows ?? [];
  const corrected = after.filter((n) => n.type === 'distribution_corrected' && n.distribution_id === DROP2);
  check('40. …and she is still told, exactly once, that the night was corrected',
    corrected.length === 1, `${corrected.length} distribution_corrected row(s) for ${DROP2}`);
  check('41. …the notification names the replacement, not the version she was in',
    corrected[0]?.distribution_id === DROP2 && corrected[0]?.distribution_id !== drop.distId,
    `names ${corrected[0]?.distribution_id}`);

  const P_DROP2 = await payFor(DROP2, 'payroll');
  const afterPay = (await inboxOf(B.token)).rows ?? [];
  check('42. paying the replacement does not tell her she was paid: she has no share on it',
    !afterPay.some((n) => n.payout_id === P_DROP2),
    'a zero-entitlement member gets no "paid" notice');
  check('43. …while the person whose share actually moved is told',
    ((await inboxOf(A.token)).rows ?? []).some((n) => n.payout_id === P_DROP2),
    `payout ${P_DROP2}`);

  /* What she can follow, and what she cannot. The notification names DROP2,
     which she is not in; the screen falls back to the version she was in, whose
     superseded_by (migration 31) points forward at DROP2. Nothing widened. */
  const seesRepl = await get(B.token, `member_distributions?select=id&id=eq.${DROP2}`);
  const seesOrig = await get(B.token,
    `member_distributions?select=id,superseded_by&id=eq.${drop.distId}`);
  const replEntries = await get(B.token,
    `tip_distribution_entries?select=id&distribution_id=eq.${DROP2}`);
  check('44. the replacement she is not in stays invisible to her',
    (seesRepl.rows?.length ?? 0) === 0, `${seesRepl.rows?.length ?? 0} row(s) visible`);
  check('45. …but the version she was in still points at it, so the screen can land her there',
    seesOrig.rows?.[0]?.superseded_by === DROP2,
    `${drop.distId} -> ${seesOrig.rows?.[0]?.superseded_by}`);
  check('46. …and she reads none of the replacement\'s entries, so nothing was widened',
    (replEntries.rows?.length ?? 0) === 0, `${replEntries.rows?.length ?? 0} entr(ies) readable`);

  globalThis.DROP = { orig: drop.distId, repl: DROP2 };
}

console.log(`\n  created for this run:`);
console.log(`    workplace under test  ${WP}`);
console.log(`    rival workplace       ${WP_OTHER}`);
console.log(`    chain                 ${N1.distId} -> ${D2} -> ${D3}`);
console.log(`    payouts               ${P1} ${P2} (reversed ${REV}) ${P3} ${P4}`);
console.log(`    dropped-member chain  ${globalThis.DROP?.orig} -> ${globalThis.DROP?.repl}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
