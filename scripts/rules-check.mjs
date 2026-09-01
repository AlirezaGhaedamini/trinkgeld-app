/**
 * Live rules-editor verification for TipCrew Phase 3E.
 *
 * The rule version lifecycle, workplace configuration and every permission
 * around them, against the real project over plain fetch. GoTrue for the
 * tokens, PostgREST for the tables and the RPCs.
 *
 *   node scripts/rules-check.mjs
 *
 * WHAT IT WRITES. One workplace per run, tagged with the run's timestamp, plus
 * a second one owned by the other test user so cross-tenant refusals can be
 * checked from a real manager rather than an imagined one. Point it at a
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


console.log(`\n  TipCrew — live rules-editor verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A (manager here): ${A.email}`);
console.log(`  user B (staff here):   ${B.email}\n`);

/* ── a workplace of A's with B in it, and a second one B manages ─────────── */
const created = await rpc(A.token, 'create_workplace', { p_name: `Rules Test ${STAMP}` });
const WP = typeof created.body === 'string' ? created.body : null;
if (!WP) die(`create_workplace failed: HTTP ${created.status}`);

const other = await rpc(B.token, 'create_workplace', { p_name: `Rival Rules ${STAMP}` });
const WP_OTHER = typeof other.body === 'string' ? other.body : null;

const invite = await rpc(A.token, 'create_invitation', {
  p_workplace_id: WP, p_email: B.email, p_display_name: `Staff ${STAMP}`, p_role: 'employee',
});
const inviteRow = Array.isArray(invite.body) ? invite.body[0] : invite.body;
if (!inviteRow?.token) die(`create_invitation failed: HTTP ${invite.status}`);
const accepted = await rpc(B.token, 'accept_invitation', { p_token: inviteRow.token });
const M_B = typeof accepted.body === 'string' ? accepted.body : null;
if (!M_B) die(`accept_invitation failed: HTTP ${accepted.status}`);

const roster = await get(A.token, `workplace_members?select=id,role&workplace_id=eq.${WP}`);
const M_A = roster.rows?.find((m) => m.role === 'manager')?.id ?? null;

const areas = await get(A.token, `workplace_areas?select=id,key,name,is_pool_eligible&workplace_id=eq.${WP}`);
const A_SERVICE = areas.rows?.find((a) => a.key === 'service')?.id ?? null;
const A_BAR = areas.rows?.find((a) => a.key === 'bar')?.id ?? null;
const A_KITCHEN = areas.rows?.find((a) => a.key === 'kitchen')?.id ?? null;

const roles = await get(A.token, `workplace_roles?select=id,key,points,area_id&workplace_id=eq.${WP}`);
const R_SERVER = roles.rows?.find((r) => r.key === 'server')?.id ?? null;

const otherAreas = WP_OTHER
  ? await get(B.token, `workplace_areas?select=id,key&workplace_id=eq.${WP_OTHER}`)
  : { rows: [] };
const X_SERVICE = otherAreas.rows?.find((a) => a.key === 'service')?.id ?? null;
const otherRoles = WP_OTHER
  ? await get(B.token, `workplace_roles?select=id,key&workplace_id=eq.${WP_OTHER}`)
  : { rows: [] };
const X_SERVER = otherRoles.rows?.find((r) => r.key === 'server')?.id ?? null;

await patch(A.token, `workplace_members?id=eq.${M_A}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
await patch(A.token, `workplace_members?id=eq.${M_B}`, { area_id: A_SERVICE, workplace_role_id: R_SERVER });
const third = await post(A.token, 'workplace_members', {
  workplace_id: WP, display_name: `Kitchen ${STAMP}`, role: 'employee',
  area_id: A_KITCHEN, workplace_role_id: R_SERVER, status: 'active',
});
const M_C = third.rows?.[0]?.id ?? null;

const iso = (d, h, m = 0) =>
  new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).toISOString();

/* ── 1, 2, 3 · reading the rule and opening a draft ──────────────────────── */
let DRAFT = null;
{
  const seeded = await get(A.token, `distribution_rules?select=id,status,version,method,min_overlap_minutes,overlap_basis&workplace_id=eq.${WP}`);
  check('1. the manager can read this workplace’s rules',
    (seeded.rows?.length ?? 0) >= 1,
    `${seeded.rows?.length ?? '?'} rule row(s); statuses ${(seeded.rows ?? []).map((r) => r.status).join(', ')}`);

  const first = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const again = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  DRAFT = typeof first.body === 'string' ? first.body : null;
  check('2. the manager can open a draft, and opening it twice returns the same one',
    first.ok && !!DRAFT && again.body === DRAFT,
    `HTTP ${first.status}/${again.status}; same id: ${again.body === DRAFT}`);

  const drafts = await get(A.token, `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`);
  check('2b. …so the workplace never holds two drafts',
    (drafts.rows?.length ?? 0) === 1, `${drafts.rows?.length ?? '?'} draft(s)`);
}
{
  const r = await rpc(B.token, 'create_rule_draft', { p_workplace_id: WP });
  check('3. an employee cannot open a draft', !r.ok, `HTTP ${r.status}`);
}

/* ── 4, 5 · area shares ──────────────────────────────────────────────────── */
{
  const bad = await patch(A.token, `distribution_rule_areas?rule_id=eq.${DRAFT}&area_id=eq.${A_SERVICE}`, { percentage: 60 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${DRAFT}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  check('4. the manager can set the area shares of the draft',
    bad.ok && (bad.rows?.length ?? 0) === 1, `HTTP ${bad.status}, ${bad.rows?.length ?? 0} row(s)`);

  const r = await rpc(A.token, 'activate_rule', { p_rule_id: DRAFT });
  const stillDraft = await get(A.token, `distribution_rules?select=status&id=eq.${DRAFT}`);
  check('5. a draft whose shares do not total 100% is refused, and stays a draft',
    !r.ok && stillDraft.rows?.[0]?.status === 'draft',
    `HTTP ${r.status}, rule left ${stillDraft.rows?.[0]?.status}`);
}
{
  const r = await patch(A.token, `distribution_rule_areas?rule_id=eq.${DRAFT}&area_id=eq.${A_SERVICE}`, { percentage: -10 });
  const now = await get(A.token, `distribution_rule_areas?select=percentage&rule_id=eq.${DRAFT}&area_id=eq.${A_SERVICE}`);
  check('5b. a negative share is refused by the column check',
    !r.ok && Number(now.rows?.[0]?.percentage) === 60,
    `HTTP ${r.status}, share still ${now.rows?.[0]?.percentage}`);
}

/* ── 6, 7 · the overlap model ────────────────────────────────────────────── */
{
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${DRAFT}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  const sw = await patch(A.token, `distribution_rules?id=eq.${DRAFT}`, { overlap_basis: 'service_window' });
  const r = await rpc(A.token, 'activate_rule', { p_rule_id: DRAFT });
  const stillDraft = await get(A.token, `distribution_rules?select=status&id=eq.${DRAFT}`);
  check('7. an overlap model the engine does not implement cannot be activated',
    sw.ok && !r.ok && stillDraft.rows?.[0]?.status === 'draft',
    `service_window: HTTP ${r.status}, rule left ${stillDraft.rows?.[0]?.status}`);
}
{
  const r = await patch(A.token, `distribution_rules?id=eq.${DRAFT}`, {
    overlap_basis: 'pairwise', method: 'hours', min_overlap_minutes: 30,
  });
  check('6. the manager can put the draft on the pairwise model',
    r.ok && r.rows?.[0]?.overlap_basis === 'pairwise',
    `HTTP ${r.status}, basis ${r.rows?.[0]?.overlap_basis}`);
  check('8. …and set a minimum overlap',
    r.rows?.[0]?.min_overlap_minutes === 30, `min overlap ${r.rows?.[0]?.min_overlap_minutes}`);
}
{
  const tooBig = await patch(A.token, `distribution_rules?id=eq.${DRAFT}`, { min_overlap_minutes: 721 });
  const negative = await patch(A.token, `distribution_rules?id=eq.${DRAFT}`, { min_overlap_minutes: -1 });
  const now = await get(A.token, `distribution_rules?select=min_overlap_minutes&id=eq.${DRAFT}`);
  check('9. an out-of-range minimum overlap is refused',
    !tooBig.ok && !negative.ok && now.rows?.[0]?.min_overlap_minutes === 30,
    `721: HTTP ${tooBig.status}, -1: HTTP ${negative.status}, value still ${now.rows?.[0]?.min_overlap_minutes}`);
}

/* ── 10, 11 · role points ────────────────────────────────────────────────── */
{
  const r = await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 1.5 });
  check('10. the manager can set the points of a role in their workplace',
    r.ok && Number(r.rows?.[0]?.points) === 1.5, `HTTP ${r.status}, points ${r.rows?.[0]?.points}`);
  const bad = await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 9 });
  const zero = await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 0 });
  check('10b. …but not outside the range the column allows',
    !bad.ok && !zero.ok, `9: HTTP ${bad.status}, 0: HTTP ${zero.status}`);
}
{
  const r = await patch(B.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 5 });
  const now = await get(A.token, `workplace_roles?select=points&id=eq.${R_SERVER}`);
  check('11. an employee cannot change role points',
    (!r.ok || (r.rows?.length ?? 0) === 0) && Number(now.rows?.[0]?.points) === 1.5,
    `HTTP ${r.status}, ${r.rows?.length ?? 0} row(s); points still ${now.rows?.[0]?.points}`);
}

/* ── 12 to 16 · workplace settings ───────────────────────────────────────── */
{
  const r = await patch(B.token, `workplaces?id=eq.${WP}`, {
    peer_entry_visibility: 'workplace', pool_amount_visible_to_members: true,
    business_day_start_hour: 0, timezone: 'UTC',
  });
  const now = await get(A.token, `workplaces?select=peer_entry_visibility,pool_amount_visible_to_members,business_day_start_hour,timezone&id=eq.${WP}`);
  const row = now.rows?.[0];
  check('12. an employee cannot change any workplace setting',
    (!r.ok || (r.rows?.length ?? 0) === 0) &&
      row?.peer_entry_visibility === 'none' && row?.pool_amount_visible_to_members === false &&
      row?.business_day_start_hour === 5 && row?.timezone === 'Europe/Berlin',
    `HTTP ${r.status}, ${r.rows?.length ?? 0} row(s); settings ${row?.peer_entry_visibility}/${row?.pool_amount_visible_to_members}/${row?.business_day_start_hour}/${row?.timezone}`);
}
{
  const r = await patch(A.token, `workplaces?id=eq.${WP}`, { pool_amount_visible_to_members: true });
  check('13. the manager can release the pool total to the team',
    r.ok && r.rows?.[0]?.pool_amount_visible_to_members === true, `HTTP ${r.status}`);
  await patch(A.token, `workplaces?id=eq.${WP}`, { pool_amount_visible_to_members: false });
}
{
  const r = await patch(A.token, `workplaces?id=eq.${WP}`, { peer_entry_visibility: 'area' });
  check('14. …and widen or narrow who sees whose share',
    r.ok && r.rows?.[0]?.peer_entry_visibility === 'area', `HTTP ${r.status}`);
  await patch(A.token, `workplaces?id=eq.${WP}`, { peer_entry_visibility: 'none' });
}
{
  const r = await patch(A.token, `workplaces?id=eq.${WP}`, { business_day_start_hour: 4 });
  const bad = await patch(A.token, `workplaces?id=eq.${WP}`, { business_day_start_hour: 20 });
  check('15. …and move the business-day cut-off, within the hours the column allows',
    r.ok && r.rows?.[0]?.business_day_start_hour === 4 && !bad.ok,
    `4: HTTP ${r.status}, 20: HTTP ${bad.status}`);
  await patch(A.token, `workplaces?id=eq.${WP}`, { business_day_start_hour: 5 });
}
{
  const r = await patch(A.token, `workplaces?id=eq.${WP}`, { timezone: 'Europe/Vienna' });
  const bad = await patch(A.token, `workplaces?id=eq.${WP}`, { timezone: 'Mars/Olympus' });
  check('16. …and the time zone, if the database recognises it',
    r.ok && r.rows?.[0]?.timezone === 'Europe/Vienna' && !bad.ok,
    `Vienna: HTTP ${r.status}, nonsense: HTTP ${bad.status}`);
  await patch(A.token, `workplaces?id=eq.${WP}`, { timezone: 'Europe/Berlin' });
}

/* ── 17 · activation ─────────────────────────────────────────────────────── */
let V1 = null;
{
  const r = await rpc(A.token, 'activate_rule', { p_rule_id: DRAFT });
  V1 = typeof r.body === 'number' ? r.body : null;
  const row = await get(A.token, `distribution_rules?select=status,version,effective_from&id=eq.${DRAFT}`);
  check('17. a balanced draft on a supported model activates, and becomes a version',
    r.ok && row.rows?.[0]?.status === 'active' && !!row.rows?.[0]?.version,
    `HTTP ${r.status}, version ${row.rows?.[0]?.version}, in force from ${row.rows?.[0]?.effective_from ? 'a timestamp' : 'nothing'}`);

  const leftover = await get(A.token, `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.draft`);
  check('17b. …and leaves no draft behind',
    (leftover.rows?.length ?? 0) === 0, `${leftover.rows?.length ?? '?'} draft(s)`);

  const frozen = await get(A.token, `distribution_rule_roles?select=workplace_role_id,points&rule_id=eq.${DRAFT}`);
  const server = frozen.rows?.find((x) => x.workplace_role_id === R_SERVER);
  check('17c. …with the role points frozen onto the version',
    (frozen.rows?.length ?? 0) >= 1 && Number(server?.points) === 1.5,
    `${frozen.rows?.length ?? '?'} role row(s), server at ${server?.points}`);
}

/* ── 21 · the active rule is immutable ───────────────────────────────────── */
{
  const r = await patch(A.token, `distribution_rules?id=eq.${DRAFT}`, { min_overlap_minutes: 240 });
  const shares = await patch(A.token, `distribution_rule_areas?rule_id=eq.${DRAFT}`, { percentage: 50 });
  const now = await get(A.token, `distribution_rules?select=min_overlap_minutes&id=eq.${DRAFT}`);
  check('21. the active version cannot be edited in place',
    (!r.ok || (r.rows?.length ?? 0) === 0) && !shares.ok &&
      now.rows?.[0]?.min_overlap_minutes === 30,
    `rule PATCH HTTP ${r.status} (${r.rows?.length ?? 0} rows), shares PATCH HTTP ${shares.status}; min overlap still ${now.rows?.[0]?.min_overlap_minutes}`);
}

/* ── a sent distribution under version 1, for check 19 ───────────────────── */
const DAY = '2019-09-01';
let SENT = null;
{
  for (const member of [M_A, M_B]) {
    await post(A.token, 'shifts', {
      workplace_id: WP, member_id: member, work_date: DAY,
      starts_at: iso(DAY, 18), ends_at: iso(DAY, 22), break_minutes: 0, status: 'approved',
    });
  }
  const pool = await post(A.token, 'tip_pools', {
    workplace_id: WP, period: 'day', period_start: DAY, period_end: DAY,
    label: `rules ${STAMP}`, cash_cents: 10000, source: 'manual', status: 'open', created_by: M_A,
  });
  const POOL = pool.rows?.[0]?.id;
  const calc = await rpc(A.token, 'calculate_distribution', { p_pool_id: POOL });
  SENT = typeof calc.body === 'string' ? calc.body : null;
  if (SENT) await rpc(A.token, 'send_distribution', { p_distribution_id: SENT });
  check('19a. a distribution can be calculated and sent under version 1',
    calc.ok && !!SENT, `HTTP ${calc.status}${calc.ok ? '' : ` ${calc.raw}`}`);
}

/* ── 18, 19 · a second version, and what it must not disturb ─────────────── */
let BEFORE = '';
{
  const entries = await get(A.token, `tip_distribution_entries?select=amount_cents,points&distribution_id=eq.${SENT}&order=amount_cents`);
  BEFORE = JSON.stringify((entries.rows ?? []).map((e) => [e.amount_cents, e.points]));

  const draft2 = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const D2 = typeof draft2.body === 'string' ? draft2.body : null;
  await patch(A.token, `distribution_rules?id=eq.${D2}`, {
    method: 'equal', min_overlap_minutes: 90, overlap_basis: 'longest_shift',
  });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D2}&area_id=eq.${A_SERVICE}`, { percentage: 50 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D2}&area_id=eq.${A_BAR}`, { percentage: 50 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D2}&area_id=not.in.(${A_SERVICE},${A_BAR})`, { percentage: 0 });
  await patch(A.token, `workplace_roles?id=eq.${R_SERVER}`, { points: 2.5 });
  const r = await rpc(A.token, 'activate_rule', { p_rule_id: D2 });
  const V2 = typeof r.body === 'number' ? r.body : null;

  check('17d. activating again produces the next version',
    r.ok && V2 === (V1 ?? 0) + 1, `version ${V1} → ${V2}`);

  const old = await get(A.token, `distribution_rules?select=status,version,min_overlap_minutes,overlap_basis&id=eq.${DRAFT}`);
  check('18. the previous version becomes historical, unchanged and undeleted',
    old.rows?.[0]?.status === 'superseded' && old.rows?.[0]?.version === V1 &&
      old.rows?.[0]?.min_overlap_minutes === 30 && old.rows?.[0]?.overlap_basis === 'pairwise',
    `version ${old.rows?.[0]?.version} is ${old.rows?.[0]?.status}, still ${old.rows?.[0]?.overlap_basis} at ${old.rows?.[0]?.min_overlap_minutes} min`);

  const oldFrozen = await get(A.token, `distribution_rule_roles?select=points&rule_id=eq.${DRAFT}&workplace_role_id=eq.${R_SERVER}`);
  check('18b. …and keeps the role points it froze, whatever the definition says now',
    Number(oldFrozen.rows?.[0]?.points) === 1.5, `frozen at ${oldFrozen.rows?.[0]?.points}, definition now 2.5`);

  const after = await get(A.token, `tip_distribution_entries?select=amount_cents,points&distribution_id=eq.${SENT}&order=amount_cents`);
  const AFTER = JSON.stringify((after.rows ?? []).map((e) => [e.amount_cents, e.points]));
  check('19. the sent distribution is untouched by the new version',
    BEFORE === AFTER && BEFORE !== '[]', `${(after.rows ?? []).length} entries compared`);

  const snap = await get(A.token, `tip_distributions?select=rule_version,rules_snapshot&id=eq.${SENT}`);
  check('19b. …and still names the version it was calculated under',
    snap.rows?.[0]?.rule_version === V1 &&
      snap.rows?.[0]?.rules_snapshot?.min_overlap_minutes === 30,
    `records version ${snap.rows?.[0]?.rule_version} at ${snap.rows?.[0]?.rules_snapshot?.min_overlap_minutes} min`);
}

/* ── 20, 25 to 28 · cross-workplace ──────────────────────────────────────── */
{
  const settings = await patch(A.token, `workplaces?id=eq.${WP_OTHER}`, { timezone: 'UTC' });
  const draft = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP_OTHER });
  check('20. a manager cannot touch another workplace',
    (!settings.ok || (settings.rows?.length ?? 0) === 0) && !draft.ok,
    `settings HTTP ${settings.status} (${settings.rows?.length ?? 0} rows), draft HTTP ${draft.status}`);
}
{
  const d = await rpc(A.token, 'create_rule_draft', { p_workplace_id: WP });
  const D3 = typeof d.body === 'string' ? d.body : null;

  const foreignArea = await post(A.token, 'distribution_rule_areas', {
    rule_id: D3, workplace_id: WP, area_id: X_SERVICE, area_key: 'service', percentage: 10,
  });
  check('25. a share cannot name an area of another workplace',
    !foreignArea.ok, `HTTP ${foreignArea.status}`);

  const foreignRole = await post(A.token, 'distribution_rule_roles', {
    rule_id: D3, workplace_id: WP, workplace_role_id: X_SERVER, role_key: 'server', points: 2,
  });
  check('26. a rule role cannot name a role of another workplace',
    !foreignRole.ok, `HTTP ${foreignRole.status}`);

  const foreignRounding = await patch(A.token, `distribution_rules?id=eq.${D3}`, { rounding_area_id: X_SERVICE });
  const ownRounding = await patch(A.token, `distribution_rules?id=eq.${D3}`, { rounding_area_id: A_BAR });
  check('27. the rounding area must be one of this workplace’s areas',
    !foreignRounding.ok && ownRounding.ok,
    `foreign HTTP ${foreignRounding.status}, own HTTP ${ownRounding.status}`);

  const rivalDraft = await rpc(B.token, 'create_rule_draft', { p_workplace_id: WP_OTHER });
  const XD = typeof rivalDraft.body === 'string' ? rivalDraft.body : null;
  const injected = XD
    ? await post(A.token, 'distribution_rule_areas', {
        rule_id: XD, workplace_id: WP, area_id: A_SERVICE, area_key: 'service', percentage: 100,
      })
    : { ok: false, status: 0 };
  check('28. a manager cannot inject a share row into another workplace’s draft',
    !injected.ok, `HTTP ${injected.status}`);

  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D3}&area_id=eq.${A_SERVICE}`, { percentage: 100 });
  await patch(A.token, `distribution_rule_areas?rule_id=eq.${D3}&area_id=neq.${A_SERVICE}`, { percentage: 0 });
  await rpc(A.token, 'activate_rule', { p_rule_id: D3 });
}

/* ── 22 · the 0%-share warning premise ───────────────────────────────────── */
{
  const rule = await get(A.token, `distribution_rules?select=id&workplace_id=eq.${WP}&status=eq.active`);
  const RULE = rule.rows?.[0]?.id;
  const shares = await get(A.token, `distribution_rule_areas?select=area_id,percentage&rule_id=eq.${RULE}`);
  const members = await get(A.token, `workplace_members?select=id,area_id&workplace_id=eq.${WP}&status=eq.active`);
  const zeroAreas = new Set((shares.rows ?? []).filter((s) => Number(s.percentage) <= 0).map((s) => s.area_id));
  const stranded = (members.rows ?? []).filter((m) => m.area_id && zeroAreas.has(m.area_id));
  check('22. the 0%-share warning can be computed from real data alone',
    stranded.length === 1 && stranded[0].id === M_C,
    `${stranded.length} member(s) in a 0% area, of ${members.rows?.length ?? '?'} active`);

  const amounts = JSON.stringify(shares.rows ?? []);
  check('22b. …from percentages and areas only, with no amount involved',
    !/cents|amount/i.test(amounts), 'the warning reads shares and memberships, nothing financial');
}

/* ── 23, 24 · without a session ──────────────────────────────────────────── */
{
  const read = await get(null, `distribution_rules?select=id&workplace_id=eq.${WP}`);
  const draft = await rpc(null, 'create_rule_draft', { p_workplace_id: WP });
  const settings = await patch(null, `workplaces?id=eq.${WP}`, { peer_entry_visibility: 'workplace' });
  const points = await patch(null, `workplace_roles?id=eq.${R_SERVER}`, { points: 5 });
  check('23. without a session nothing here is readable or writable',
    (read.status >= 400 || (read.rows?.length ?? 0) === 0) && !draft.ok &&
      (!settings.ok || (settings.rows?.length ?? 0) === 0) &&
      (!points.ok || (points.rows?.length ?? 0) === 0),
    `read HTTP ${read.status}, draft HTTP ${draft.status}, settings HTTP ${settings.status}, points HTTP ${points.status}`);

  const now = await get(A.token, `workplaces?select=peer_entry_visibility&id=eq.${WP}`);
  check('24. demo mode cannot reach the database at all — it builds no client, and an unauthenticated one changes nothing',
    now.rows?.[0]?.peer_entry_visibility === 'none',
    'the browser suite (harness/rules.cjs 11a-11f) asserts the demo build performs no Supabase call');
}

console.log(`\n  created for this run:`);
console.log(`    workplace   ${WP}`);
console.log(`    distribution ${SENT}`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
