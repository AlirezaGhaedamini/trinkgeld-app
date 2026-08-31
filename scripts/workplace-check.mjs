/**
 * Live workplace / membership verification for TipCrew Phase 3B.
 *
 * Like scripts/rls-check.mjs, this talks to the real Supabase project over
 * HTTPS with plain fetch — GoTrue for the tokens, PostgREST for the tables and
 * the RPCs — so what is exercised is the real RLS and the real Phase 2
 * functions, not the UI and not a stub.
 *
 *   node scripts/workplace-check.mjs
 *
 * Reads .env.local for the project URL and anon key, and .env.test.local for
 * the two test accounts. Both are gitignored, and nothing that could be
 * replayed is ever printed.
 *
 * WHAT IT WRITES. This one is not read-only: it creates a workplace owned by
 * user A, invites user B into it, and has B accept. Everything it makes is
 * named with a run-specific suffix so you can find it, and the summary at the
 * end lists the ids. Point it at a development project, not production.
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
if (!test) die('.env.test.local is missing.', 'It needs TEST_A_EMAIL / TEST_A_PASSWORD / TEST_B_EMAIL / TEST_B_PASSWORD.');
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
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    die(`Could not sign in as ${email}: ${body.error_description || body.msg || `HTTP ${res.status}`}`);
  }
  return { token: body.access_token, userId: body.user?.id, email };
}

function headers(token, extra = {}) {
  return { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

async function rpc(token, name, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

async function select(token, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: headers(token, { Accept: 'application/json' }) });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 200) };
}

async function patch(token, path, payload) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'PATCH', headers: headers(token, { Prefer: 'return=representation' }), body: JSON.stringify(payload),
  });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, rows: Array.isArray(rows) ? rows : null, body: rows, raw: text.slice(0, 200) };
}

console.log(`\n  TipCrew — live workplace / membership verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  run tag: ${STAMP}   (created rows are named with it)\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);
console.log(`  user A: ${A.email}  ${A.userId}`);
console.log(`  user B: ${B.email}  ${B.userId}\n`);
if (A.userId === B.userId) die('Both accounts resolve to the same user.');

const WP_NAME = `RLS Test ${STAMP}`;
let workplaceId = null;
let memberIdA = null;
let memberIdB = null;

/* 1 — create_workplace() makes the workplace AND the manager membership. */
{
  const r = await rpc(A.token, 'create_workplace', { p_name: WP_NAME });
  workplaceId = typeof r.body === 'string' ? r.body : null;
  check('1. create_workplace() succeeds for a signed-in user', r.ok && !!workplaceId,
    `HTTP ${r.status}${workplaceId ? `, workplace ${workplaceId}` : `, body ${JSON.stringify(r.body).slice(0, 120)}`}`);
}
if (!workplaceId) die('Cannot continue without a workplace.');

{
  const rows = await select(A.token, `workplace_members?select=id,role,status,user_id&workplace_id=eq.${workplaceId}`);
  const mine = (rows.rows ?? []).filter((m) => m.user_id === A.userId);
  memberIdA = mine[0]?.id ?? null;
  check('2. the creator got an ACTIVE MANAGER membership, atomically',
    mine.length === 1 && mine[0].role === 'manager' && mine[0].status === 'active',
    `HTTP ${rows.status}, ${mine.length} row(s)` + (mine[0] ? `, role=${mine[0].role}, status=${mine[0].status}` : ''));
}
{
  const rows = await select(A.token, `workplaces?select=id,name,join_code&id=eq.${workplaceId}`);
  check('3. the manager can read their workplace', rows.rows?.length === 1 && rows.rows[0].name === WP_NAME,
    `HTTP ${rows.status}, ${rows.rows?.length ?? '?'} row(s)`);
}

/* 4 — B is a stranger to this workplace. */
{
  const wp = await select(B.token, `workplaces?select=id,name&id=eq.${workplaceId}`);
  const mem = await select(B.token, `workplace_members?select=id&workplace_id=eq.${workplaceId}`);
  check('4. a non-member sees neither the workplace nor its roster',
    wp.rows?.length === 0 && mem.rows?.length === 0,
    `workplaces ${wp.rows?.length ?? '?'} row(s), members ${mem.rows?.length ?? '?'} row(s)`);
}

/* 5 — B cannot invent a membership for themselves. */
{
  const res = await fetch(`${URL_BASE}/rest/v1/workplace_members`, {
    method: 'POST', headers: headers(B.token, { Prefer: 'return=representation' }),
    body: JSON.stringify({ workplace_id: workplaceId, display_name: 'Gatecrasher', role: 'manager', status: 'active', user_id: B.userId }),
  });
  const text = await res.text();
  const after = await select(A.token, `workplace_members?select=id&workplace_id=eq.${workplaceId}`);
  check('5. a stranger cannot INSERT themselves into a workplace',
    res.status >= 400 && after.rows?.length === 1,
    `HTTP ${res.status}, roster still ${after.rows?.length ?? '?'} row(s)` + (res.ok ? ` — LEAK: ${text.slice(0, 120)}` : ''));
}

/* 6, 7 — the invitation path. The role comes from the invitation. */
let token = null;
{
  const r = await rpc(A.token, 'create_invitation', {
    p_workplace_id: workplaceId, p_email: B.email, p_display_name: `Tester ${STAMP}`, p_role: 'employee',
  });
  const row = Array.isArray(r.body) ? r.body[0] : r.body;
  token = row?.token ?? null;
  check('6. a manager can mint an invitation (token returned once)', r.ok && !!token,
    `HTTP ${r.status}` + (token ? `, token ${token.length} chars` : `, body ${JSON.stringify(r.body).slice(0, 120)}`));
}
{
  const r = await rpc(B.token, 'create_invitation', {
    p_workplace_id: workplaceId, p_email: 'nobody@example.invalid', p_display_name: 'X', p_role: 'manager',
  });
  check('7. a non-member cannot mint an invitation', !r.ok,
    `HTTP ${r.status}` + (r.ok ? ' — LEAK: a stranger created an invitation' : ''));
}
{
  const r = await rpc(B.token, 'accept_invitation', { p_token: 'not-a-real-token' });
  check('8. an invalid token is refused', !r.ok, `HTTP ${r.status}`);
}
{
  const r = await rpc(B.token, 'accept_invitation', { p_token: token });
  memberIdB = typeof r.body === 'string' ? r.body : null;
  check('9. B accepts the invitation and becomes a member', r.ok && !!memberIdB,
    `HTTP ${r.status}${memberIdB ? `, membership ${memberIdB}` : `, body ${JSON.stringify(r.body).slice(0, 120)}`}`);
}
{
  const rows = await select(B.token, `workplace_members?select=id,role,status&user_id=eq.${B.userId}&workplace_id=eq.${workplaceId}`);
  check('10. …with the role the INVITATION carried, not one B chose',
    rows.rows?.length === 1 && rows.rows[0].role === 'employee' && rows.rows[0].status === 'active',
    `role=${rows.rows?.[0]?.role ?? '?'}, status=${rows.rows?.[0]?.status ?? '?'}`);
}
{
  const r = await rpc(B.token, 'accept_invitation', { p_token: token });
  check('11. the same invitation cannot be used twice', !r.ok, `HTTP ${r.status}`);
}

/* 12 — the promotion attempt. This is the one that matters. */
{
  const before = await select(A.token, `workplace_members?select=role&id=eq.${memberIdB}`);
  const attempt = await patch(B.token, `workplace_members?id=eq.${memberIdB}`, { role: 'manager' });
  const after = await select(A.token, `workplace_members?select=role&id=eq.${memberIdB}`);
  const unchanged = after.rows?.[0]?.role === 'employee';
  check('12. an employee CANNOT promote themselves to manager',
    unchanged && (attempt.status >= 400 || (attempt.rows?.length ?? 0) === 0),
    `PATCH HTTP ${attempt.status}; role ${before.rows?.[0]?.role} → ${after.rows?.[0]?.role}` +
      (unchanged ? '' : ' — LEAK: the employee is now a manager'));
}
{
  const attempt = await patch(B.token, `workplace_members?id=eq.${memberIdA}`, { role: 'employee' });
  const after = await select(A.token, `workplace_members?select=role&id=eq.${memberIdA}`);
  check("13. an employee cannot alter the manager's membership either",
    after.rows?.[0]?.role === 'manager' && (attempt.status >= 400 || (attempt.rows?.length ?? 0) === 0),
    `PATCH HTTP ${attempt.status}; manager role still ${after.rows?.[0]?.role ?? '?'}`);
}

/* 14 — the join code files a request, never a membership. */
{
  const wp = await select(A.token, `workplaces?select=join_code&id=eq.${workplaceId}`);
  const code = wp.rows?.[0]?.join_code ?? null;
  const r = await rpc(B.token, 'request_join', { p_join_code: code });
  check('14. request_join() by an existing member is refused', !r.ok,
    `HTTP ${r.status}` + (r.ok ? ' — LEAK: a second membership was created' : ''));
}
{
  const r = await rpc(B.token, 'request_join', { p_join_code: 'ZZZZZZ' });
  check('15. an unknown join code is refused', !r.ok, `HTTP ${r.status}`);
}

/* 16 — what each side can see of the other. */
{
  const rosterB = await select(B.token, `workplace_members?select=id,display_name,role&workplace_id=eq.${workplaceId}`);
  check('16. an employee can see the roster of their own workplace', (rosterB.rows?.length ?? 0) === 2,
    `HTTP ${rosterB.status}, ${rosterB.rows?.length ?? '?'} row(s)`);
}
{
  const all = await select(B.token, 'workplace_members?select=workplace_id');
  const foreign = new Set((all.rows ?? []).map((r) => r.workplace_id));
  foreign.delete(workplaceId);
  const mine = await select(B.token, 'workplace_members?select=workplace_id&user_id=eq.' + B.userId);
  const myIds = new Set((mine.rows ?? []).map((r) => r.workplace_id));
  const leaked = [...foreign].filter((id) => !myIds.has(id));
  check('17. an unfiltered roster scan shows only workplaces B belongs to',
    leaked.length === 0, `${leaked.length} foreign workplace(s)` + (leaked.length ? ` — LEAK: ${leaked.join(', ')}` : ''));
}

console.log(`\n  created for this run:`);
console.log(`    workplace   ${workplaceId}  "${WP_NAME}"`);
console.log(`    membership  ${memberIdA} (A, manager)`);
console.log(`    membership  ${memberIdB ?? '—'} (B, employee)`);
console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  PROBLEM — do not ship this. Failed checks:');
  for (const f of failed) console.log(`    · ${f.label} — ${f.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
