# TipCrew — roadmap

Where the project is and what comes next, in the order it should be built. Each
step assumes the one before it.

**Current state.** Phase 1 (frontend on mock data) and Phase 2 (the Supabase
schema) are both complete. Nothing connects them yet: the app still reads local
state, and the database has never been applied to a real Supabase project.
Phase 3 is the wiring.

---

## Done

**Phase 1 — frontend.** Every prototype screen is a real route, both roles work
end to end, the calculation is live, and the app starts empty with demo data
available on request.

**Phase 2 — backend.** `supabase/migrations/` holds 13 ordered migrations: 16
tables, 16 enums, 44 RLS policies, the distribution engine as PostgreSQL
functions, hashed invitation tokens, an append-only audit log, and a two-view
member read layer. Applied and exercised against a real PostgreSQL 16 instance
via `supabase/tests/rebuild.sh --test` — 85 assertions, including all 18 security
scenarios. Documented in [`docs/BACKEND.md`](docs/BACKEND.md).

The open product questions that used to sit at the bottom of this file were
answered during the architecture review and are now settled in the schema:
rounding goes to a configurable `rounding_area_id`; overlap is measured against
the longest shift, with the alternative strategies present in the enum; the
business day starts at a configurable hour, default 05:00, with the timezone
stored per workplace; retention is a per-workplace `retention_years`, default 7.
Payout tracking was deliberately left out of scope.

---

## Phase 3 — connect the frontend

### 1. Create the Supabase project and apply the schema

```bash
cp .env.example .env.local        # fill in URL + anon key
npm install                       # picks up @supabase/supabase-js
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
supabase gen types typescript --linked > src/types/database.ts
```

Regenerating the types is not optional — `src/types/database.ts` in the
repository was produced by introspecting the same migrations locally, and the
CLI output is the canonical form.

Then check in the dashboard that RLS is enabled on all 16 tables and that the
anon role can read nothing.

### 2. Authentication

Supabase Auth with email + password. Replace the submit handlers in
`SignInPage` / `SignUpPage`; the screens stay as they are. Add a session
listener that fills `state.session` and drop `RequireSession`'s mock check.
`app.handle_new_user()` creates the `profiles` row automatically — the client
does not insert it.

### 3. Workplace onboarding

`create_workplace()` returns the new workplace id and seeds six areas, eleven
roles and a draft rule. `request_join()` / `approve_join_request()` back the
join-code flow, `create_invitation()` / `accept_invitation()` back the invite
flow. The invitation token is returned **once** by `create_invitation()` — show
it immediately, because it is only stored hashed.

This also closes the two known gaps in the empty state: a workplace now has a
real name, and a manager can build a roster before anyone signs in, because
`workplace_members.user_id` is nullable.

### 4. Replace `src/data/` with queries

`src/data/` is the seam. Manager screens read the base tables; employee screens
read `member_distributions` and `member_distribution_entries` — never the base
distribution tables, which they have no policy for.

Keep the reducer shape. Every mutation is already one action, so it gains a
network call without touching a component.

### 5. Shifts and tip reports

Employees write their own `shifts`; managers correct and lock them. The database
rejects overlapping shifts for one person outright (an exclusion constraint), so
the client needs to surface that error rather than pre-empt it. `work_date` and
`worked_minutes` are derived server-side — do not send them.

### 6. Distribution

The manager wizard calls `calculate_distribution(pool_id)` and then
`send_distribution(distribution_id)`. The client-side
`calculateDistribution()` in `src/lib/distribution.ts` stops being the source of
truth and becomes a live preview inside the wizard.

Add a **parity test**: the same inputs through the TypeScript engine and the SQL
engine must produce identical cents. When they disagree, the database wins.

### 7. Employee confirmation

`acknowledge_entry()` handles confirm and query. Entries carry `ack_status`, so
the manager's "waiting for confirmation" count is a query, not a client tally.

### 8. Realtime

Subscribe to `tip_distribution_entries` so a sent distribution appears on an
employee's phone without a refresh.

---

## Phase 4 — hardening

### 9. Testing

- Unit tests for `lib/time.ts` and `lib/distribution.ts` — the overlap edge
  cases and the units maths are the highest-value tests in the frontend.
- The engine parity test from step 6.
- Component tests for the wizard.
- End-to-end: sign in as each role and walk both flows.

Vitest + Testing Library, Playwright for end-to-end. The SQL side already has
its own suite in `supabase/tests/`; keep adding to it whenever a policy changes.

### 10. Analytics and export

Weekly and monthly totals, per-area and per-person trends, unconfirmed shares.
CSV export from the stored entries — the profile screen already offers it.

### 11. Retention

`workplaces.retention_years` is recorded but nothing enforces it. Needs a
scheduled job (pg_cron or an Edge Function) that anonymises or removes
distributions past the horizon.

---

## Phase 5 — native and production

### 12. Capacitor

`@capacitor/core`, `@capacitor/cli`, `npx cap init`, `npx cap add ios android`.
The web build should work unchanged; check safe areas, the keyboard, and that
hash routing behaves inside the WebView.

### 13. iOS

Xcode, signing, app icon from `src/assets/brand/tipcrew-logo.svg`, splash
screen, TestFlight.

### 14. Android

Android Studio, signing key, Play Console internal testing track.

### 15. Production deployment

Web on a static host (Netlify, Vercel, Cloudflare Pages). A production Supabase
project separate from development, with the same migrations applied through
`supabase db push` — never by hand. Backups on.

---

## Still open

- **Peer visibility.** The schema supports `none` / `area` / `workplace`; the
  MVP ships `none` and no screen exposes the setting yet.
- **Multi-manager approval.** Statuses are extensible enough for a
  `pending_approval` step, but the MVP is single-manager send.
- **Payout tracking.** Out of scope by decision. If it comes back, it is a new
  table, not a column on a distribution.
- **The other overlap strategies.** `pairwise` and `service_window` exist in the
  enum and in the rule columns; neither is implemented in the engine.
