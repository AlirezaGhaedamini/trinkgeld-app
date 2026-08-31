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

**Phase 1 — frontend.** The whole app runs on mock data and local state. Every
screen from the original prototype is a real route, every interaction works, and
the tip calculation is live: change the pool, the hours, the percentages or the
rules and the numbers update. There is no backend yet; Supabase comes next (see
`NEXT_STEPS.md`).

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
  types/           the domain model
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

## Future: Supabase

Nothing is wired up yet, and no keys are in the repository. The shape is ready:

- Every type in `src/types/` is row-shaped — string `id`, `<entity>Id` foreign
  keys, ISO timestamps.
- Every mutation is an action in one reducer (`src/state/appReducer.ts`), so a
  mutation gains a network call without touching a component.
- `src/data/` is the seam: replace those modules with queries.
- Manager/employee separation already exists in the client and maps directly
  onto row-level security policies.

Copy `.env.example` to `.env.local` when the time comes. `.env*` is git-ignored.

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

Both are subsetted into `src/assets/fonts/`; `src/styles/phosphor.css` declares
only the 46 glyphs the app uses.
