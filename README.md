# TipCrew

**Pooled tips, divided the way your team agreed. Everyone sees the same arithmetic.**

TipCrew is a mobile-first app for restaurants, cafés, bars and hotels. A manager
enters the tips a shift collected; the app knows who worked, for how long, in
which area and under which role, and works out what each person gets — and shows
every employee exactly how their share was calculated.

The product is not a payment tool. It never holds or moves money. It automates
the *fair distribution* of tips inside a hospitality team.

---

## Project status

**Phase 1 — frontend. Complete.** The whole app runs on mock data and local
state. Every screen from the original prototype is a real route, every
interaction works, and the tip calculation is live: change the pool, the hours,
the percentages or the rules and the numbers update.

**Phase 2 — backend. Complete, not yet connected.** The full Supabase schema
lives in `supabase/migrations/` — 16 tables, 16 enums, 44 RLS policies, the
distribution engine as PostgreSQL functions, and a member read layer that keeps
employees out of manager-only tables. It has been applied and exercised against
a real PostgreSQL 16 instance (`supabase/tests/rebuild.sh --test`, now 534
assertions across the phases below). See **[`docs/BACKEND.md`](docs/BACKEND.md)**.

**Phase 3A — authentication. Complete.** Sign-in, registration, session
persistence, logout and route protection run on Supabase Auth. Profiles are
created by the database trigger; the browser only reads them.

**Phase 3B — workplaces and membership. Complete.** Creating a workplace,
joining one, and the app's role all come from the database now. `src/workplace/`
is the whole data layer: memberships are loaded after sign-in, the active
workplace is resolved from them, and the manager/employee split is read from the
active `workplace_members` row — never from local state, local storage or a
query string.

**Phase 3C — shifts, hours review and tip reports. Complete.** An employee
submits real shifts (overnight included, in the workplace's own timezone), sees
their real status, and files real tip reports in integer cents. A manager
reviews, corrects and approves them. `src/shifts/` and `src/tips/` are the data
layers; every worked minute and business date is computed by the database.

**Phase 3D — pools, distributions and history. Complete.** The pool is summed
by the database from the team's reports, the split is calculated by
`calculate_distribution()`, finalised by `send_distribution()` and read back
from the stored record. The client-side engine is a preview only: on €10 split
three ways it loses a cent, which is exactly why the database is authoritative.

**Phase 3E — rules editor and workplace settings. Complete.** A rule is edited
as a draft and published by `activate_rule()`, which freezes the areas, roles and
points it used; a distribution that has been sent keeps pointing at the version
it was calculated under. Area shares, the weighting method, the minimum overlap,
the overlap basis and the rounding area are all set here, with a warning before
publishing anything that would leave someone at zero.

**Phase 3F — areas and roles. Complete.** Creating, renaming, reordering,
archiving and restoring the vocabulary a workplace divides tips by. Archiving is
refused while anything live points at it and the manager is told what to move
first; renaming never disturbs history, because every distribution stores the
names and points it used.

**Phase 3G — the team. Complete.** The roster, the member editor, join-request
approval and invitations. A default area and role are written together so the
pair is always coherent, the weighting is bounded by the database, removal is a
standing rather than a deletion so the financial trail keeps pointing at
somebody, and a workplace can never lose its last active manager.

**Phase 3H — acknowledgement. Complete.** The employee confirms they have seen
their share, and the manager sees who still owes an answer. One action answers
every entry a person holds in a distribution, so somebody who worked two areas
is never half-confirmed; the requirement is the one frozen into the distribution
when it was sent; and a confirmation, once given, cannot be quietly withdrawn.
It is a product-level confirmation of receipt, not a payment record.

**Phase 3I — questions. Complete.** An employee who thinks something is wrong
says so in a sentence, and it reaches the manager attached to the distribution
it is about. A question is an open state, not an answer: it stops the
distribution closing, and it shows in the manager's tally separately from
confirmed and pending. The manager either answers it — which hands the
confirmation back to the employee, never confirming on their behalf — or agrees
a correction is needed, which leaves the share unconfirmed and the sent
distribution untouched. What was asked can never be edited afterwards.

**Phase 3J — corrections. Complete.** When the manager agrees a payout is wrong,
the fix is a replacement, not an edit. The original keeps every cent it had and
becomes history, marked "Replaced"; a corrected version is calculated fresh from
the fixed hours, linked back to what it replaces and to the question that caused
it, and confirmed from scratch. The correction reuses the original's pool, so a
tip report can never fund two payouts — and a pool that has paid out cannot be
distributed again except as an explicit replacement.

**Phase 3K — the manager finds it first. Complete.** A manager who spots the
error themselves opens the same correction flow, without waiting for anybody to
ask a question and without one being invented on their behalf. They say what was
wrong — a category and a sentence — and TipCrew creates the corrected version
exactly as it does after a question: same engine, same pool, same lineage, same
fresh confirmation. The two routes are mutually exclusive on the record, so a
correction always says plainly whether it followed a question or the manager's
own finding. The employee is told why their payout was corrected; who touched it
is manager-side audit and stays there.

The first live run of this phase found a real defect: the backend rejected a
blank explanation using PostgreSQL's one-argument `btrim()`, which trims spaces
and nothing else, so a note of tabs and newlines was accepted as a reason.
Migration 25 gives the function and the table constraint one shared definition
of "blank" that names every whitespace character explicitly.

**Phase 3L — payout. Complete.** TipCrew records whether a distribution was
actually handed over: who marked it paid, when, and how — cash, with the
payslip, by transfer, or another way. It moves no money and talks to no bank.
Confirming and paying stay separate, because a place may pay in cash on the
night and ask for the tap afterwards.

The part that matters is what happens when a paid distribution is corrected. A
replacement reuses the original's pool and a distributed pool is frozen, so a
lineage's **total never changes** — the workplace can never be asked to hand
over a second full amount. What a correction moves is money **between people**,
and that is what the screens show: who is up, who is down, and by how much. Each
person sees their own corrected share beside what was already settled for them,
and the difference, so nobody expects a whole second payout.

**Phase 3M — reversing a payout record. Complete.** A payment logged by mistake
is never edited and never deleted. A second event says it should no longer
count, and both stay on the record: paid, reversed, paid again — with the
reversal shown as a negative so the column adds up to what actually still
counts. The wording is careful everywhere, because a reversal changes TipCrew's
record and not a bank transfer, a cash payment or a payslip.

Two rules keep the money honest. A distribution may have at most one payment
that still counts, held by a row lock and a trigger rather than by a disabled
button. And a payment that a later corrected version was already settled
against cannot be reversed at all — unwind the later one first — because
otherwise that later settlement would describe money nobody handed over.

**Phase 3N — closing a period, and taking the figures away. Complete.** A
manager can close a week or a month once they have reviewed it, and download the
result as a spreadsheet. A close records a decision and nothing more: it deletes
nothing, recalculates nothing and moves no money.

It also does not freeze anything, and that is deliberate. A mistake found in
October about a September shift is still a mistake, and correcting it is how
this product fixes one — so corrections stay allowed inside a closed period, the
close stays exactly as it was, and the export marks every record that arrived
afterwards. The alternative would either stop managers ever closing, or push a
real correction somewhere TipCrew cannot see it.

What blocks a close is work that leaves the period's result undecided: a night
never sent, a correction never published, a question nobody answered. What does
not block it is money that has not moved yet — a workplace closes the
calculation for a week and pays it with the monthly payroll run, and refusing
that would make the feature useless to exactly the businesses it is for. Unpaid
work is said out loud instead, on the screen and again in the confirmation.

The figures come from one dataset with one definition per total, and the
spreadsheet is formatted from it and nothing else, so a number on a screen and a
number in Excel cannot disagree. The rule that matters most: a corrected night
is counted **once**. The original and the replacement are the same money seen
twice, and adding them would show a corrected week as owed double. The file is
written for German Excel — UTF-8 BOM, semicolons, CRLF — with every amount
present twice, as integer cents and in the decimal form a person reads.

The design reference is `TipCrew Prototype.html` in this repository — the
original clickable prototype. It is kept as-is, unmodified, and the React app
reproduces its layout, colours, spacing, typography and interactions.

---

## Technology

| Layer      | Choice                                                       |
| ---------- | ------------------------------------------------------------ |
| Framework  | React 18 + TypeScript                                        |
| Build      | Vite 5                                                       |
| Routing    | React Router 6 (`HashRouter`)                                |
| Styling    | Plain CSS — design tokens as CSS variables + CSS Modules      |
| Icons      | Phosphor Icons, vendored as a local webfont subset            |
| Type       | Inter, vendored locally (latin + latin-ext)                   |
| State      | React context + `useReducer`, one typed action union          |

No UI framework, no CSS-in-JS, no state library. Fonts and icons ship inside the
repository, so the app makes **no external requests** — which is what a Capacitor
build needs.

`HashRouter` is deliberate: it works from a static host, from a sub-path, and
inside a Capacitor WebView without server rewrites. Swap it for `BrowserRouter`
in `src/App.tsx` if the app ever gets its own domain with a catch-all rewrite.

---

## Setup

Requires Node 18+.

```bash
npm install       # install dependencies
npm run dev       # development server on http://localhost:5173
npm run build     # type-check, then production build into dist/
npm run preview   # serve the production build locally
npm run typecheck # TypeScript only
```

`npm install` must be run once before anything else — `node_modules/` is not
committed.

---

## Folder structure

```
src/
  assets/          fonts (Inter, Phosphor) and the brand logo
  components/
    brand/         the TipCrew mark
    domain/        TipCrew-specific composites (history row, area result block)
    layout/        app chrome: Screen, BottomNav, AppLayout, DemoBar, guards
    ui/            the component library (Button, Card, ListRow, Keypad, …)
  data/            mock data: roster, areas, roles, distributions, workplace
  hooks/           useAppState, useI18n, useToast, useDistributionRows
  i18n/            English/German dictionaries and the locale provider
  lib/             pure logic: time, money, overlap, the distribution engine
  pages/
    auth/          sign in, sign up, join a workplace
    employee/      home, hours, history, payout, report tips, profile
    manager/       overview, the four-step wizard, team, rules, distributions
  state/           reducer, context, selectors
  styles/          tokens.css, base.css, fonts.css, phosphor.css
  types/           the domain model + database.ts (generated from the schema)
supabase/
  migrations/      13 ordered SQL migrations — the whole backend
  tests/           local PostgreSQL harness and the security assertion suite
docs/
  BACKEND.md       schema, RLS model, engine, migration workflow
```

Rules of thumb: `lib/` is pure and testable, `data/` is replaceable by Supabase
queries, `components/ui` knows nothing about tips, `components/domain` does.

---

## Routes

| Route | Who | Screen |
| ----- | --- | ------ |
| `/signin` | anyone | Sign in |
| `/signup` | anyone | Create an account |
| `/join` | anyone | Join a workplace by code, or set one up |
| `/home` | employee | Last shift, tonight's report, hours, recent payouts |
| `/hours` | employee | Enter start, end and break for a shift |
| `/history` | employee | Everything paid this month |
| `/payout/:distributionId` | employee | The four-step breakdown of one share |
| `/report` | employee | Report the tips collected on a shift |
| `/profile` | employee | Personal settings |
| `/profile/language` | employee | English / Deutsch |
| `/manager` | manager | Overview: what needs doing, the week, shortcuts |
| `/manager/new/pool` | manager | Wizard 1 — how much came in |
| `/manager/new/areas` | manager | Wizard 2 — the area split (must total 100%) |
| `/manager/new/hours` | manager | Wizard 3 — review hours worked |
| `/manager/new/result` | manager | Wizard 4 — the result, then confirm and send |
| `/manager/sent` | manager | Sent confirmation |
| `/manager/hours` | manager | Review, correct, lock and unlock submitted hours |
| `/manager/overlap` | manager | Who worked together, and who the rule excludes |
| `/manager/reports` | manager | Staff tip reports; take them into the pool |
| `/manager/team` | manager | The roster by area |
| `/manager/team/:employeeId` | manager | Area, role and personal multiplier |
| `/manager/invite` | manager | Workplace code and pending invites |
| `/manager/distributions` | manager | All distributions, filterable |
| `/manager/distributions/:id` | manager | One distribution in full |
| `/manager/rules` | manager | Areas, method, minimum shared time |

Manager routes are guarded (`src/components/layout/guards.tsx`). An employee who
lands on one is sent back to their own home with a "Managers only" message. When
Supabase arrives, the same boundary is enforced again server-side with row-level
security — the client guard is convenience, not security.

---

## How the calculation works

`src/lib/distribution.ts`, in two steps:

1. **Eligibility.** Everyone is measured against the night's *anchor* — the
   longest effective shift. Anyone who shares less than the workplace's minimum
   overlap with it is out of the pool. That is what keeps a lunch shift from
   drawing on the evening's tips.
2. **Division.** The pool is split between areas by percentage, then each area's
   pot is split between its eligible people by *units*:
   - `mPoints` — hours × role points × personal multiplier (default)
   - `mHours` — hours only
   - `mEqual` — one unit each, hours ignored

Times are stored as **minutes from midnight of the shift's calendar day**, so a
shift ending at 01:30 the next morning is `1530`. Overlap is then plain integer
arithmetic with no timezone traps (`src/lib/time.ts`). Money typed on the keypad
is held in **cents** and only converted for display (`src/lib/money.ts`).

The engine is pure and dependency-free, so it can move to a Supabase edge
function or a Postgres function unchanged.

---

## Empty by default, demo data on request

The app has two starting points, both defined in `src/state/createState.ts`.

### The empty state — what you get on a normal start

A fresh install has nothing in it:

- no team beyond the account holder, no shifts, no tip reports, no distributions
- no tip amounts entered, no area percentages set
- sign-in, sign-up, the join code, working hours and tip amounts all start blank
  and are typed by the user

Four settings keep sensible defaults, because they are configuration rather than
user content and an app with no rule at all is worse than one with a starting
rule: the split method (hours × role points), the minimum shared time (15 min),
whether employees must confirm, and which area absorbs rounding. All four are
editable on the Rules screen.

The account holder is created the moment you sign in. The name comes from what
you typed at sign-up, or is derived from your email address if you used the
sign-in shortcut — `aref.ghaedamini@…` becomes "Aref Ghaedamini". Nothing is
invented.

The workplace has no name until a backend can supply one, so the screens fall
back to "Your workplace" instead of showing a blank or a made-up venue.

### The demo dataset — for testing

The sample workplace (Café Alto, Rotterdam, 15 people, five distributions, two
tip reports, nine submitted shifts) still lives in `src/data/` and can be loaded
at any time:

- **On a wide screen** — the "Demo data · On / Off" switch above the phone.
- **On a phone** — open the app with `?demo=1` in the URL, e.g.
  `http://localhost:5173/?demo=1`. `?demo=0` clears it again.

The choice is remembered in `localStorage` under `tipcrew.dataMode`.

Two rows in the sample roster exist to make the overlap rule visible: **Luis
Ferro** works a day shift and shares no time with the evening anchor, and **Bea
Ruiz** leaves twenty minutes after it starts — in the pool at a 15-minute
minimum, out at 30. With the demo data loaded the signed-in employee is Lena
Mertens and the signed-in manager is Daan Visser.

The empty state is the one to judge the product by. The demo data is the one to
judge the calculation by.

---

## Language

The app ships in English and German, ported from the prototype. The choice is
stored in `localStorage` and applies everywhere, including number and currency
formatting (`€2,480.00` vs `2.480,00 €`). The dictionaries are in
`src/i18n/strings.ts`; German is typed against English, so a missing translation
is a compile error rather than a blank label.

---

## Mobile

Mobile is the primary target, not an adaptation.

- The app owns the viewport: the document never scrolls, only the screen body
  does, so the header, the call-to-action and the tab bar stay put.
- Verified with no horizontal overflow at 320, 360, 375, 390, 393, 414 and
  430 px, in both languages.
- Touch targets are at least 44 px; the primary control is 52 px.
- `env(safe-area-inset-*)` is honoured throughout, ready for the iPhone notch
  and home indicator under Capacitor.
- From 900 px up the app is presented in the prototype's device frame with the
  demo switcher above it — the way the design was reviewed. That switcher is
  scaffolding, not product.

---

## Backend

The database is in `supabase/migrations/` and documented in
[`docs/BACKEND.md`](docs/BACKEND.md). Short version:

- Money is stored as integer cents; points and percentages as `numeric`, never
  float.
- A distribution rule is a **version**. Activating one freezes the role points
  into the rule, so editing a role next month cannot change last month's payout.
- Every distribution snapshots its inputs and every entry snapshots the name,
  area, role, points and multiplier actually used.
- `tip_distribution_entries` is unique on `(distribution_id, member_id,
  area_id)` — someone who worked Bar and then Service on the same day gets two
  entries, never one blended row.
- Employees have no read access to `tip_pools` or `tip_distributions`. They read
  `member_distributions` and `member_distribution_entries`, which mask the pool
  total unless the workplace releases it.

### Connecting a project

```bash
cp .env.example .env.local     # then fill in the two values
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
supabase gen types typescript --linked > src/types/database.ts
```

Use the **anon** key in `.env.local`. The service-role key bypasses row-level
security and must never appear in this repository or in any `VITE_` variable.
`.env` and `.env.*` are git-ignored; `.env.example` is the only exception and
holds no real values.

`src/lib/supabase.ts` creates the typed client. `src/auth/` owns the session and
the profile; `src/workplace/` owns memberships, the active workplace and the
role. Screens consume them through `useAuth()`, `useWorkplace()` and
`useActiveRole()` and never query Supabase themselves.

### Where writes go

Nothing writes a membership directly. Creation and joining go through the Phase
2 RPCs, and the difference between them is the security model:

| Path | Function | What it produces |
| --- | --- | --- |
| Set up a workplace | `create_workplace()` | the workplace, its areas and roles, and the manager membership — one transaction, so a workplace with no manager cannot exist |
| Six-character join code | `request_join()` | a **pending request**. A manager still approves it; knowing the code is never enough |
| Invitation link (`#/join?token=…`) | `accept_invitation()` | the membership, with the role the *invitation* carried. There is no role argument |

### Verifying it against the real project

```bash
node scripts/rls-check.mjs         # Phase 3A: profile isolation
node scripts/workplace-check.mjs   # Phase 3B: membership, invitations, promotion attempts
node scripts/shifts-check.mjs      # Phase 3C: shifts, review columns, tip reports
node scripts/distribution-check.mjs # Phase 3D: pools, calculation, finalisation, history
node scripts/rules-check.mjs       # Phase 3E: rule versions, workplace settings, tenancy
node scripts/areas-roles-check.mjs # Phase 3F: area and role management, archive policy
node scripts/members-check.mjs     # Phase 3G: roster, assignments, suspension, join requests
node scripts/acknowledgement-check.mjs # Phase 3H: confirmation, multi-area entries, tallies
node scripts/query-check.mjs       # Phase 3I: questions, resolution, cancelled distributions
node scripts/replacement-check.mjs # Phase 3J: corrections, lineage, one payout per pool
node scripts/manager-correction-check.mjs # Phase 3K: the manager's own correction door
node scripts/payout-check.mjs      # Phase 3L: payout, settlement lineage, exactly-once
node scripts/payout-reversal-check.mjs # Phase 3M: reversal events, effective settlement
node scripts/period-close-check.mjs # Phase 3N: period close, lineage-aware export totals
```

Both read `.env.local` and a gitignored `.env.test.local` holding two test
accounts. `workplace-check.mjs` creates a workplace and an invitation, so point
it at a development project.

## Future: Capacitor

The build is deliberately Capacitor-friendly: relative `base`, hash routing, no
external requests, safe-area padding, no browser-only APIs beyond
`localStorage`. Adding `@capacitor/core` and the iOS/Android platforms should
not require reworking the frontend.

---

## Brand assets

`TipCrew_logo.svg`, `Logo.png`, `Logo.pdf` and `logo (2).png` at the repository
root are the original brand files and are untouched. The illustrated jar logo is
copied to `src/assets/brand/tipcrew-logo.svg` for future app-icon work. In the
app itself the mark is the prototype's three bars, drawn inline in
`src/components/brand/BrandMark.tsx`, with a matching `public/favicon.svg`.

---

## Licences of vendored assets

- Inter — SIL Open Font License 1.1
- Phosphor Icons — MIT

Both live in `src/assets/fonts/`. Inter is subsetted to latin and latin-ext.
The Phosphor **webfont is complete** — it is the *stylesheet* that is the
subset: `src/styles/phosphor.css` declares only the icons the app uses, instead
of the full ~9,000-rule original. Adding an icon is therefore two lines of CSS
and one line in `src/lib/icons.ts`, and never a change to a font binary.
