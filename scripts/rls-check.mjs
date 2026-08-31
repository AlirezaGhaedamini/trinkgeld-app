/**
 * Live RLS verification for TipCrew Phase 3A.
 *
 * Talks to the real Supabase project over HTTPS — GoTrue for the tokens,
 * PostgREST for the reads — so what is exercised is the actual
 * `profiles_select_own` policy on the actual database, not the UI and not a
 * stub. No Supabase SDK is involved either: plain fetch, so nothing an SDK
 * might cache or rewrite can flatter the result.
 *
 * Usage (from the project root):
 *
 *   node scripts/rls-check.mjs
 *
 * Reads the project URL and anon key from .env.local, and the two test
 * accounts from .env.test.local. Both files are gitignored. Nothing is
 * written, nothing is printed that could be replayed: no keys, no tokens.
 *
 * Exit code 0 = every check passed. 1 = at least one failed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── environment ─────────────────────────────────────────────────────────── */

function readEnvFile(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
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
if (!local) die('.env.local is missing.', 'Copy .env.example to .env.local and fill in the two values.');

const URL_BASE = (local.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = local.VITE_SUPABASE_ANON_KEY || '';
if (!URL_BASE || !ANON) die('.env.local is missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
if (/service[_-]?role/i.test(ANON) || /^sb_secret_/.test(ANON)) {
  die('That looks like a service-role / secret key.', 'This test must run with the anon (publishable) key — the whole point is that RLS applies.');
}

const test = readEnvFile('.env.test.local');
if (!test) {
  die(
    '.env.test.local is missing.',
    'Create it in the project root with the two test accounts:\n\n' +
      '    TEST_A_EMAIL=...\n    TEST_A_PASSWORD=...\n    TEST_B_EMAIL=...\n    TEST_B_PASSWORD=...\n\n' +
      '  It is gitignored. Do not paste these anywhere else.',
  );
}
for (const key of ['TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD']) {
  if (!test[key]) die(`.env.test.local is missing ${key}.`);
}

/* ── tiny assertion harness ──────────────────────────────────────────────── */

let pass = 0;
let fail = 0;
const results = [];

function check(label, condition, detail = '') {
  if (condition) pass += 1;
  else fail += 1;
  results.push({ label, ok: condition, detail });
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
}

/* ── the two calls this test is made of ──────────────────────────────────── */

async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reason = body.error_description || body.msg || body.error || `HTTP ${res.status}`;
    die(`Could not sign in as ${email}: ${reason}`, 'Check the credentials, and whether the account still needs to confirm its email.');
  }
  return { token: body.access_token, userId: body.user?.id ?? null, email: body.user?.email ?? email };
}

/** A raw PostgREST select on public.profiles as a given user (or anonymously). */
async function selectProfiles(token, query) {
  const headers = { apikey: ANON, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${URL_BASE}/rest/v1/profiles?${query}`, { headers });
  const text = await res.text();
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = null;
  }
  return { status: res.status, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 200) };
}

/** An update attempt, used to prove the write side of the policy too. */
async function updateProfile(token, id, payload) {
  const res = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = null;
  }
  return { status: res.status, rows: Array.isArray(rows) ? rows : null, raw: text.slice(0, 200) };
}

/* ── the run ─────────────────────────────────────────────────────────────── */

console.log(`\n  TipCrew — live RLS verification`);
console.log(`  project: ${URL_BASE}`);
console.log(`  path:    GoTrue /auth/v1/token  →  PostgREST /rest/v1/profiles  (real RLS)\n`);

const A = await signIn(test.TEST_A_EMAIL, test.TEST_A_PASSWORD);
const B = await signIn(test.TEST_B_EMAIL, test.TEST_B_PASSWORD);

console.log(`  user A: ${A.email}  id ${A.userId}`);
console.log(`  user B: ${B.email}  id ${B.userId}\n`);

if (!A.userId || !B.userId) die('Supabase did not return a user id for one of the accounts.');
if (A.userId === B.userId) die('Both test accounts resolve to the same user. Use two distinct accounts.');

/* 1 — A reads their own profile. */
{
  const own = await selectProfiles(A.token, `select=id,email,full_name,locale&id=eq.${A.userId}`);
  check(
    '1. user A can read their own profile',
    own.status === 200 && own.rows?.length === 1 && own.rows[0].id === A.userId,
    `HTTP ${own.status}, ${own.rows?.length ?? '?'} row(s)` +
      (own.rows?.[0] ? `, full_name=${JSON.stringify(own.rows[0].full_name)}` : ''),
  );
}

/* 2 — A asks for B's row, by id. */
{
  const other = await selectProfiles(A.token, `select=id,email,full_name&id=eq.${B.userId}`);
  check(
    "2. user A cannot read user B's profile",
    other.status === 200 && other.rows?.length === 0,
    `HTTP ${other.status}, ${other.rows?.length ?? '?'} row(s) returned` +
      (other.rows?.length ? ` — LEAK: ${JSON.stringify(other.rows)}` : ' (filtered away by RLS, as intended)'),
  );
}

/* 3 — B reads their own profile. */
{
  const own = await selectProfiles(B.token, `select=id,email,full_name,locale&id=eq.${B.userId}`);
  check(
    '3. user B can read their own profile',
    own.status === 200 && own.rows?.length === 1 && own.rows[0].id === B.userId,
    `HTTP ${own.status}, ${own.rows?.length ?? '?'} row(s)` +
      (own.rows?.[0] ? `, full_name=${JSON.stringify(own.rows[0].full_name)}` : ''),
  );
}

/* 4 — B asks for A's row, by id. */
{
  const other = await selectProfiles(B.token, `select=id,email,full_name&id=eq.${A.userId}`);
  check(
    "4. user B cannot read user A's profile",
    other.status === 200 && other.rows?.length === 0,
    `HTTP ${other.status}, ${other.rows?.length ?? '?'} row(s) returned` +
      (other.rows?.length ? ` — LEAK: ${JSON.stringify(other.rows)}` : ' (filtered away by RLS, as intended)'),
  );
}

/* 5 — the stronger form: an unfiltered scan must still return only yourself.
       A filtered query returning nothing could be a coincidence of the filter;
       a full table scan returning exactly one row is the policy working. */
{
  const all = await selectProfiles(A.token, 'select=id');
  const ids = (all.rows ?? []).map((r) => r.id);
  check(
    '5. an unfiltered scan of profiles returns only the caller (user A)',
    all.status === 200 && ids.length === 1 && ids[0] === A.userId,
    `HTTP ${all.status}, ${ids.length} row(s)` + (ids.length > 1 ? ` — LEAK: ${ids.join(', ')}` : ''),
  );
}
{
  const all = await selectProfiles(B.token, 'select=id');
  const ids = (all.rows ?? []).map((r) => r.id);
  check(
    '6. an unfiltered scan of profiles returns only the caller (user B)',
    all.status === 200 && ids.length === 1 && ids[0] === B.userId,
    `HTTP ${all.status}, ${ids.length} row(s)` + (ids.length > 1 ? ` — LEAK: ${ids.join(', ')}` : ''),
  );
}

/* 7 — no session at all: the anon role has no grant on profiles. */
{
  const anon = await selectProfiles(null, 'select=id');
  const blocked = anon.status === 401 || anon.status === 403 || anon.rows?.length === 0;
  check(
    '7. with no session, profiles is unreadable',
    blocked,
    `HTTP ${anon.status}` + (anon.rows ? `, ${anon.rows.length} row(s)` : `, body: ${anon.raw}`),
  );
}

/* 8 — the write side. profiles_update_own has both USING and WITH CHECK, so
       A patching B's row must change nothing. */
{
  const before = await selectProfiles(B.token, `select=locale&id=eq.${B.userId}`);
  const originalLocale = before.rows?.[0]?.locale ?? null;
  const attempt = await updateProfile(A.token, B.userId, { locale: originalLocale === 'de' ? 'en' : 'de' });
  const after = await selectProfiles(B.token, `select=locale&id=eq.${B.userId}`);
  const unchanged = (after.rows?.[0]?.locale ?? null) === originalLocale;
  check(
    "8. user A cannot modify user B's profile",
    (attempt.rows?.length ?? 0) === 0 && unchanged,
    `PATCH HTTP ${attempt.status}, ${attempt.rows?.length ?? '?'} row(s) affected; ` +
      `B.locale ${originalLocale} → ${after.rows?.[0]?.locale ?? '?'}`,
  );
}

/* ── verdict ─────────────────────────────────────────────────────────────── */

console.log(`\n  passing: ${pass}`);
console.log(`  failing: ${fail === 0 ? 'none' : fail}`);
if (fail > 0) {
  console.log('\n  RLS PROBLEM — do not ship this. Failed checks:');
  for (const r of results.filter((r) => !r.ok)) console.log(`    · ${r.label} — ${r.detail}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
