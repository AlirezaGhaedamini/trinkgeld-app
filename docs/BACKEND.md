# TipCrew — Backend (Phase 2)

The database is the product. Almost every rule that decides who gets how much
lives in PostgreSQL, not in the client, because the client is untrusted and the
numbers have to survive an audit years later.

This document describes what is in `supabase/migrations/` and why. It is the
reference for anyone reviewing the schema, and the starting point for Phase 3
(connecting the existing React screens to real data).

---

## 1. Shape of the system

| Layer | Where | Responsibility |
| --- | --- | --- |
| Schema | `supabase/migrations/2026090100*.sql` | 16 tables, 16 enums, 2 views, 44 RLS policies |
| Business logic | `SECURITY DEFINER` functions in `public` | workplace creation, invitations, rule versioning, distribution calculation |
| Internal helpers | `app` schema | membership lookups, guards, audit, business-day maths |
| Read layer | `member_distributions`, `member_distribution_entries` | the only route employees have to distribution data |
| Types | `src/types/database.ts` | generated; consumed by `src/lib/supabase.ts` |

Two schemas:

- **`public`** — everything PostgREST exposes: tables, views, and the RPCs the
  app calls.
- **`app`** — helpers and triggers. Not exposed. `EXECUTE` is revoked from
  `PUBLIC` on every function; only the specific roles that need a helper are
  granted it.

---

## 2. Migration inventory

Migrations are ordered and reproducible. They are applied in filename order and
each one is independently reviewable.

| File | Contents |
| --- | --- |
| `…000100_extensions_and_enums.sql` | `extensions` schema, `pgcrypto` / `citext` / `btree_gist`, the `app` schema, all 16 enums, `app.touch_updated_at()` |
| `…000200_profiles.sql` | `profiles` (1:1 with `auth.users`), the `on auth.users` signup trigger |
| `…000300_workplaces_and_members.sql` | `workplaces`, `workplace_members`, lookup indexes |
| `…000400_rls_helpers_and_core_policies.sql` | the membership helper functions, guard triggers, and the first policies |
| `…000500_areas_and_roles.sql` | `workplace_areas`, `workplace_roles`, deferred FKs back onto members |
| `…000600_create_workplace_rpc.sql` | join-code generation, default seeding, `create_workplace()` |
| `…000700_invitations.sql` | `invitations` (hashed tokens), invite / join-request / approval RPCs |
| `…000800_shifts_and_tip_reports.sql` | `app.business_day()`, `shifts` with the overlap exclusion constraint, `tip_reports` |
| `…000900_distribution_rules.sql` | `distribution_rules` + area/role children, immutability, `activate_rule()` |
| `…001000_pools_and_distributions.sql` | `tip_pools`, `tip_distributions`, `tip_distribution_areas`, `tip_distribution_entries` and their policies |
| `…001100_distribution_engine.sql` | `calculate_distribution()`, `send_distribution()`, `cancel_distribution()`, `acknowledge_entry()` |
| `…001200_member_read_layer.sql` | the two member-facing views |
| `…001300_audit_log.sql` | `audit_log` and the generic `app.write_audit()` trigger |
| `…001400_shift_write_guard.sql` | column-level guard on `shifts` — see below |

---

## 3. Tables

### Identity

**`profiles`** — one row per `auth.users` row, same UUID, `on delete cascade`.
Created automatically by `app.handle_new_user()`, an `after insert` trigger on
`auth.users`. Holds display name, locale and avatar. **No passwords, tokens or
authentication secrets are ever copied into application tables** — those stay in
`auth`.

**`workplace_members`** — the join between a person and a workplace, and the
row every authorisation decision is made against.

- `user_id` is **nullable**: a manager can add "Sofia" to the roster and run
  distributions for her before she has ever signed in. The row is claimed later
  by `accept_invitation()`.
- `display_name` is `NOT NULL` — the roster must be readable without a profile.
- `role` (`manager` | `employee`), `status` (`invited` | `active` |
  `suspended` | `left`).
- `default_area_id`, `role_id`, `multiplier numeric(4,2)` constrained to
  0.50–2.00.
- A `DEFERRABLE INITIALLY DEFERRED` constraint trigger prevents removing or
  demoting the **last active manager** of a workplace.

### Workplace configuration

**`workplaces`** carries the settings that change how the maths works:

| Column | Default | Effect |
| --- | --- | --- |
| `timezone` | `Europe/Berlin` | IANA name; a `CHECK` rejects an invalid zone at write time |
| `business_day_start_hour` | `5` | a shift starting before 05:00 local belongs to the previous business day |
| `peer_entry_visibility` | `none` | `none` / `area` / `workplace` — how much of a distribution a colleague sees |
| `pool_amount_visible_to_members` | `false` | whether employees may see the total pool |
| `currency` | `EUR` | display only; all money is stored as integer cents |
| `retention_years` | `7` | recorded now, enforced by a future job |

**`workplace_areas`** (service, bar, kitchen, runner, reception, management —
seeded on creation) and **`workplace_roles`** (11 seeded roles, each with
`points numeric(4,2)` and an owning area).

### Work

**`shifts`** — one row per person per stretch of work.

- `during tstzrange` is a **generated stored** column, as is `worked_minutes`.
- `work_date` is derived on write by `app.shifts_before_write()` using the
  workplace timezone and `business_day_start_hour`, so an overnight shift lands
  on the right business day.
- `EXCLUDE USING gist (member_id WITH =, during WITH &&) WHERE (status <> 'rejected')`
  makes overlapping shifts for the same person impossible at the database level.
- `area_override_id` and `role_id` are validated against each other: a shift's
  role must belong to the shift's **effective** area (see §6).

**`tip_reports`** — declared cash/card tips per shift or per day, the raw input
before a pool is formed.

### Rules

**`distribution_rules`** + `distribution_rule_areas` + `distribution_rule_roles`.

- A rule is a **version**, not a setting. `status` is `draft` → `active` →
  `superseded`. Draft rows are freely editable; once active, an immutability
  trigger rejects any change other than the supersede transition.
- `activate_rule()` validates that area percentages sum to exactly 100,
  **freezes the role points into the rule's own child rows**, allocates the next
  `version` number, and supersedes the previous active rule in one transaction.
- `method` (`hours_points` | `hours` | `equal`), `overlap_basis`
  (`longest_shift` for the MVP; `pairwise` and `service_window` exist in the
  enum but are not implemented), `min_overlap_minutes`, `rounding_area_id`.

### Money

**`tip_pools`** — an amount of money for a period, `status`
`open` → `locked` → `distributed` (or `void`). A trigger freezes the amounts
once the pool leaves `open`.

**`tip_distributions`** — the result of running a pool through a rule. Holds
`pool_cents`, the `rule_version` used, the engine version, and
`inputs_snapshot jsonb`, which records **every input the calculation saw**: the
rule's areas and role points, each participating shift with its eligibility
verdict, and the settings in force. Re-running the maths years later against the
snapshot reproduces the same cents.

**`tip_distribution_areas`** — the per-area subtotal (`percentage`, `units`,
`total_cents`, `people_count`).

> This table is a deliberate departure from architecture v2, which put
> `area_total_cents` on each entry. Because the sum of the area totals *is* the
> pool, keeping those numbers on a row an employee reads would have meant hiding
> them again in a definer view. Moving them into their own table makes the pool
> total **structurally unreachable** from anything an employee is allowed to
> select, and reduced the read layer to one definer view instead of two.

**`tip_distribution_entries`** — one row per person **per area**.

`UNIQUE (distribution_id, member_id, area_id)`. Someone who worked 12:00–16:00
in Bar and 18:00–23:00 in Service on the same business day gets **two entries**.
Areas are never blended, because the historical breakdown is what makes the
result auditable.

Each entry snapshots what was actually used: `member_name`, `area_key`,
`area_name`, `area_source` (`shift` or `member`), `role_key`, `role_name`,
`points`, `multiplier`, `worked_minutes`, `overlap_minutes`, `units`,
`amount_cents`, `rounding_adjustment_cents`, and the `shift_ids` it came from.
Later renames, role changes or rule edits therefore cannot alter an old payout.

**`audit_log`** — append-only. `app.write_audit()` is attached to shifts,
members, pools, rules, distributions and workplaces, recording actor, action,
and before/after JSON.

---

## 4. The distribution engine

`calculate_distribution(p_pool_id)` runs in one transaction:

1. **Collect** every non-rejected shift whose `work_date` falls in the pool
   period.
2. **Anchor** — the `longest_shift` basis picks the longest effective shift in
   the period (ties broken by earlier start, then by shift id) and measures every
   other shift's overlap against it via `app.overlap_minutes()`.
3. **Eligibility** — a shift with less overlap than `min_overlap_minutes` is
   excluded, and the reason is written into `inputs_snapshot`.
4. **Units** — `hours_points`: `overlap_hours × role_points × member_multiplier`.
   `hours`: `overlap_hours × multiplier`. `equal`: 1 per eligible person.
5. **Split by area** — the pool is divided by the rule's area percentages, using
   largest-remainder rounding so the area totals sum to the pool exactly. Ties go
   to the rule's `rounding_area_id`.
6. **Split within area** — each area's cents are divided across its entries by
   units, again by largest remainder (ties: larger units, then member id). Each
   entry records the ±1 cent it received as `rounding_adjustment_cents`.
7. **Assert** — the function raises if the assigned cents do not equal the pool.
8. **Snapshot and write** the areas and entries.

`send_distribution()` moves it to `sent` (this is what makes it visible to
employees), `cancel_distribution()` records a reason, and `acknowledge_entry()`
lets an employee confirm or query **their own** entry.

Engine version: `app.engine_version()` → `pg-1.0.0`, stored on every
distribution.

---

## 5. Security model

### Roles

There are no database roles per person. Everyone authenticates as Supabase's
`authenticated` role; the *application* role (`manager` / `employee`) lives in
`workplace_members.role`. Authorisation is therefore entirely RLS plus the
helper functions.

### Helper functions

`app.is_member(workplace)`, `app.is_manager(workplace)`,
`app.member_id(workplace)`, `app.member_workplaces()` are `SECURITY DEFINER`,
`STABLE`, declared `set search_path = ''` with every table name fully qualified,
take no free-form SQL identifiers, and have `EXECUTE` revoked from `PUBLIC` and
granted only to `authenticated`.

They exist to break **RLS recursion**: a membership policy that queries
`workplace_members` would re-enter its own policy forever. A definer function
reads the table with RLS bypassed, returns a boolean, and the policy stays flat.

### Column-level guards

RLS decides which **rows** a person may write. It cannot say which **columns**,
and on `shifts` that difference is money.

Migration 08's policy correctly lets an employee write their own shift while it
is neither approved nor locked, and its `WITH CHECK` stops them setting
`status = 'approved'`. But six columns on that table are not theirs:
`workplace_role_id` (which the engine turns into `points`), `reviewed_by`,
`reviewed_at`, `review_note`, `locked` and `source`. An employee who could name
their own role on their own shift could pick the best-paid role in their area,
and be approved on the hours — which is what a manager actually checks.

`app.guard_shift_columns()` (migration 14) closes that, on INSERT and UPDATE,
for anyone who is not a manager of the workplace. The area override stays open:
`area_id` is the employee saying which area they actually worked, which
migration 08 designed for and which a manager reviews before approving.

`tip_reports` needs no equivalent — every column on it is the member's own
statement, and the policies already restrict rows to their own membership.

### The one thing that must not be copied

Guard triggers are **`SECURITY INVOKER`, deliberately**:

```
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
```

All seven guards were originally written as `DEFINER`, which silently disabled
every one of them — an employee could have promoted themselves to manager. The
test suite caught it. If you add a guard, make it `INVOKER`.

### The read layer

Employees have **no SELECT policy** on `tip_pools` or `tip_distributions`. Their
only route is:

- **`member_distributions`** — the schema's *single* `security_invoker = false`
  view. It takes no parameters, filters on `auth.uid()` through an existence
  test, exposes a fixed column list, and returns `pool_cents` as `NULL` unless
  the workplace has released it. Its `WHERE` clause is the security boundary and
  is asserted by the tests.
- **`member_distribution_entries`** — `security_invoker = true`, so the entries
  RLS policy (which is where `peer_entry_visibility` is applied) still runs in
  full. It adds an `is_own` flag.

Both views are revoked from `public` and `anon` and granted only to
`authenticated`.

Because employees cannot select `tip_distributions`, any policy elsewhere that
used a subquery against it evaluated to *false* for them — which silently hid
their own entries. That is why `app.distribution_is_published(uuid)` exists and
is used by the entries, areas and acknowledgement policies.

### Invitations

`invitations` stores a **hash** of the token, never the token. The raw token is
returned exactly once, from `create_invitation()`. There is no INSERT grant on
the table; every path goes through an RPC (`create_invitation`, `request_join`,
`accept_invitation`, `approve_join_request`).

### Service role

The service-role key bypasses RLS and appears nowhere in this repository or in
any `VITE_`-prefixed variable. The browser uses the anon key only.

---

## 6. Business-day, timezone and area override behaviour

**Business day.** `app.business_day(ts, workplace)`:

```sql
((p_ts at time zone w.timezone) - make_interval(hours => w.business_day_start_hour))::date
```

A shift that starts at 01:00 on Sunday in a workplace with a 05:00 cutoff has a
`work_date` of Saturday. `work_date` is stored, not computed at read time, so
changing the setting later does not silently move historical shifts.

**Effective area.**

```
effective_area = shift.area_override_id ?? workplace_member.default_area_id
```

The override determines the **whole weighting context**, not just a label. A
shift's `role_id` must belong to the effective area — enforced by
`app.guard_role_area_consistency()` — so nobody is moved into Bar while still
being paid on Service points. The entry snapshots `area_source` so a reader can
tell whether the area came from the shift or from the member's default.

---

## 7. Legal metadata

`distribution_rules` carries `adopted_by` (`employer` / `staff_agreement` /
`works_council`), `agreement_reference` and `agreement_date`.

These are **metadata only**. No validation, no branching logic, nothing in the
engine reads them. They exist because German practice around
§ 3 Nr. 51 EStG (tip tax treatment) and § 87 Abs. 1 Nr. 10 BetrVG (works-council
co-determination) makes it useful to record how a rule was adopted. Building
legal logic on them is explicitly out of scope.

---

## 8. Migration workflow

All SQL lives in version-controlled files. Nothing is applied by hand.

```bash
# one-time
supabase login
supabase link --project-ref <your-project-ref>

# apply pending migrations to the linked project
supabase db push

# after any schema change, regenerate the types
supabase gen types typescript --linked > src/types/database.ts
```

`supabase db reset` targets the **local** stack. Never run a destructive reset
against a remote project.

### Local verification

`supabase/tests/` contains a self-contained harness that runs the migrations
against a plain PostgreSQL 16 instance:

```bash
supabase/tests/rebuild.sh          # drop, recreate, apply all migrations
supabase/tests/rebuild.sh --test   # …then run the assertion suite
```

`00_local_supabase_shim.sql` is **local only** — it fakes `auth.users`,
`auth.uid()` and the three Supabase roles so the policies can be exercised
without a Supabase instance. It is not a migration and is never applied to a
real project.

---

## 9. Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | anon / publishable key — **not** service_role |

`.env` and `.env.*` are gitignored; `.env.example` is the only exception and
contains no real values. The service-role key has no place in this app.

---

## 10. What Phase 3 has to do

The schema is finished and tested; the React app still runs entirely on the
local mock state from Phase 1. Phase 3 is the wiring:

1. Auth screens against `supabase.auth` (magic link or password).
2. Replace `createEmptyState()` / `createDemoState()` reads with queries — the
   manager screens against the base tables, the employee screens against the two
   member views.
3. Move the client-side `calculateDistribution()` in `src/lib/distribution.ts`
   from "the source of truth" to "a live preview", with
   `calculate_distribution()` in the database as the authority.
4. Realtime on `tip_distribution_entries` so a sent distribution appears without
   a refresh.
