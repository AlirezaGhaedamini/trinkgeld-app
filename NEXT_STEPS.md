# TipCrew — roadmap

Where the project is and what comes next, in the order it should be built. Each
step assumes the one before it.

Current state: **step 1 is ready for your review.** The frontend is complete on
mock data; nothing is persisted.

---

## 1. Frontend validation — *do this first*

Click through both roles on a real phone before any backend work starts. Do it
twice: once on the empty state (what a new customer sees) and once with the demo
data switched on (what a working shift looks like).

- Does every screen still look like `TipCrew Prototype.html`?
- Does the employee flow make sense end to end: enter hours → report tips →
  see the share → confirm it?
- Does the manager flow: reports → pool → areas → hours → result → send?
- Is the wording right in German as well as English?
- Anything missing that the business actually needs?

Fixing wording, ordering and rules is cheap now and expensive once there is a
database schema and live data behind it.

## 2. Supabase project setup

Create the project, note the URL and anon key, put them in `.env.local`
(`.env.example` shows the names). Add `@supabase/supabase-js` and a single
client module in `src/lib/supabase.ts`. Nothing else changes yet.

## 3. Database schema

Mirror `src/types/index.ts`:

`workplaces`, `profiles`, `employees` (workplace membership + area + role +
multiplier), `roles`, `shifts`, `tip_reports`, `tip_pools`,
`distribution_rules`, `tip_distributions`, `tip_distribution_entries`.

Money in integer cents. Shift times as minutes-from-midnight plus a date, exactly
as the frontend already models them — do not switch to timestamps without
re-checking the overlap logic.

## 4. Authentication

Supabase Auth with email + password. Replace the submit handler in
`SignInPage`/`SignUpPage`; the rest of the screen stays. Add a session listener
that fills `state.session` and drop `RequireSession`'s mock check.

## 5. User profiles

`profiles` row per auth user; name, language preference, avatar later. Move the
language choice out of `localStorage` and onto the profile once it exists.

## 6. Workplace structure

Create a workplace, generate a join code, join by code, approve a request. The
join screen and the invite screen already exist for this.

## 7. Manager role

Row-level security: only a workplace's managers may write
`distribution_rules`, `employees`, and other people's `shifts`.

## 8. Employee role

Employees may read their own workplace, write their own `shifts` and
`tip_reports`, and read their own distribution entries — nothing else. Prove the
policies with a second test account, not by trusting the client guard.

## 9. Shift persistence

Employees submit hours to `shifts`; managers correct, lock and unlock. The lock
flag already drives the UI.

## 10. Working-hour calculation

Move `workedMinutes` into a generated column or a database function so the
server and the client can never disagree.

## 11. Shift-overlap engine

Port `groupByOverlap` to SQL (or a Postgres function). It is the rule people
will argue about, so it must be computed once, server-side, and stored with the
distribution.

## 12. Tip pool management

Persist `tip_reports` and `tip_pools`. The manager's "take these amounts" action
becomes a real write.

## 13. Distribution rules

Persist `distribution_rules` per workplace: area shares, method, minimum
overlap, acknowledgement required, rounding area.

## 14. Tip calculation engine

Port `calculateDistribution` server-side and store the result as
`tip_distribution_entries`, together with a **snapshot** of the hours and the
staff points used. Historical distributions must never change when someone's
role changes later — the frontend already models this with the `hours` and
`staff` snapshots on a distribution.

Decide the rounding rule explicitly here: the sum of the entries must equal the
pool to the cent, with the remainder going to the configured area.

## 15. Historical distributions

Read the stored entries instead of recalculating. Add export (CSV) — the profile
screen already offers it.

## 16. Manager analytics

Weekly and monthly totals, per-area and per-person trends, unconfirmed shares.
The overview and history screens have the shapes already.

## 17. Testing

- Unit tests for `lib/time.ts` and `lib/distribution.ts` — the overlap edge
  cases and the units maths are the highest-value tests in the project.
- A parity test that the SQL engine and the TypeScript engine agree on the same
  inputs.
- Component tests for the wizard.
- End-to-end: sign in as each role and walk the two main flows.

Vitest + Testing Library, or Playwright for the end-to-end pass.

## 18. Capacitor setup

`@capacitor/core`, `@capacitor/cli`, `npx cap init`, `npx cap add ios android`.
The web build should work unchanged; check safe areas, the keyboard, and that
hash routing behaves inside the WebView.

## 19. iOS build

Xcode, signing, app icon from `src/assets/brand/tipcrew-logo.svg`, splash
screen, TestFlight.

## 20. Android build

Android Studio, signing key, Play Console internal testing track.

## 21. Production deployment

Web on a static host (Netlify, Vercel, Cloudflare Pages). Supabase production
project separate from development. Backups, and a migration process for the
schema.

---

## Known gaps in the empty state

Two things a real first-run needs that the prototype never had a screen for, so
they are not built yet — both belong with the backend rather than ahead of it:

- **Naming the workplace.** A manager who sets one up cannot give it a name; the
  screens say "Your workplace" until then. Needs one field, either on the set-up
  card or in a workplace-settings screen.
- **Adding a team member directly.** Today the only route in is the invite code,
  which needs a backend to resolve. Until then a manager starting from empty
  cannot build a roster, so the full distribution flow can only be exercised with
  the demo data loaded.

## Open product questions

Worth deciding before step 3, because they change the schema:

- **Rounding.** Who gets the leftover cents? The UI says Service; confirm.
- **Management.** Excluded from the pool by default — always, or configurable
  per workplace?
- **Overlap anchor.** Today the anchor is the longest shift of the night. Should
  overlap instead be measured pairwise, or against a fixed service window?
- **Time zones and dates.** A shift that ends at 03:00 belongs to the previous
  day. Confirm the cut-off hour with a real venue.
- **Payout.** "With salary" is a label today. Does TipCrew ever need to record
  that a payout happened, and who confirms it?
- **Retention.** The profile screen promises seven years. Confirm against the
  actual legal requirement in each market.
- **Legal.** Tip distribution is regulated differently per country (Germany,
  Netherlands, Austria). Worth checking before selling into a second market.
