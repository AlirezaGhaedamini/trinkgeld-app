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
| `…001500_distribution_integrity.sql` | three defects found auditing the money path — see below |
| `…001600_pairwise_overlap.sql` | the pairwise model, and no silent redistribution |
| `…001700_calc_no_unqualified_update.sql` | removes the one write with no WHERE clause — see below |
| `…001800_rule_tenancy_guard.sql` | a rule's areas, roles and rounding area must belong to its own workplace — see below |
| `…001900_area_role_management.sql` | creating, renaming, reordering, archiving and restoring areas and roles — see below |
| `…002000_member_tenancy_and_requests.sql` | a membership's area and role must be its own workplace's, and the role must belong to that area; the manager's join-request queue — see below |
| `…002100_acknowledgement.sql` | the frozen requirement on the member's view, one action per distribution, and the two doors made to refuse the same things — see below |
| `…002200_query_and_resolution.sql` | the query loop: a question is an open state, it has somewhere to go, and a cancelled distribution stops accepting answers — see below |

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

## 3a. Three defects found in the Phase 2 money path

Audited before Phase 3D connected any screen to it. All three are fixed in
migration 15.

**The engine ignored `overlap_basis`.** `public.overlap_basis` has three values
and `calculate_distribution()` implements exactly one — the longest shift of the
period as the anchor. It never read the column, but it wrote it into
`tip_distributions.overlap_basis` and into `rules_snapshot`. A rule set to
`pairwise` would have computed longest-shift and then produced a permanent
record saying otherwise. Fixed by refusing: `app.engine_supports_basis()` gates
both `activate_rule()` and a trigger on the distributions table, so an
unimplemented model cannot be activated or recorded. Implementing pairwise
overlap is a product decision, not a bug fix, and is deliberately not done here.

**`send_distribution()` finalised a stale draft.** A manager calculates, a
colleague approves another shift, the manager presses send: the new shift was
silently left out of an immutable payment record. Fixed with
`app.distribution_fingerprint()` — a digest of the pool amounts, the active rule
with its area shares and role points, and every approved shift in the period
with the member facts that weight it. Taken at calculation, re-derived at send,
and a mismatch is refused with a message telling the manager to recalculate.
This is option (B): silently including the new state would finalise numbers
nobody previewed.

**A tip report could fund two pools.** `tip_pools.source` could say
`staff_reports`, but nothing derived a pool from them and nothing recorded which
reports a pool consumed, so two pools with overlapping periods could both count
the same money. Fixed with `create_pool_from_reports()`, which sums server-side,
and `tip_pool_sources`, whose unique index on `tip_report_id` makes double
counting impossible rather than merely discouraged. Voiding a pool releases its
reports.

## 4. The distribution engine

`calculate_distribution(p_pool_id)` runs in one transaction:

1. **Collect** every non-rejected shift whose `work_date` falls in the pool
   period.
2. **Anchor** — the `longest_shift` basis picks the longest effective shift in
   the period (ties broken by earlier start, then by shift id) and measures every
   other shift's overlap against it via `app.overlap_minutes()`.
3. **Eligibility** — a shift with less overlap than `min_overlap_minutes` is
   excluded, and the reason is written into `inputs_snapshot`.

   The reasons are checked **in order**, and the first two come before the
   overlap model is consulted at all:

   | reason | when |
   | --- | --- |
   | `no_area` | the shift resolves to no area (no override, no member default) |
   | `area_not_in_pool` | the effective area's share in the active rule is `0` |
   | `sole_worker` | pairwise, and this is the only person in the period |
   | `included` | the rules below are satisfied |
   | `no_pairwise_overlap` | pairwise, and this person has no link to anyone |
   | `anchor` / `below_min_overlap` | longest_shift, measured against the anchor |

   `area_not_in_pool` is the one that surprises people: someone whose area has
   a 0% share is dropped **before** any overlap is considered, so they are not
   paid, do not appear as a zero-cent entry, and cannot keep a partner eligible.
   Move a member into a zero-share area and a two-person pairwise crew becomes a
   one-person one. That is intended — a 0% area is not part of this pool — but
   it makes member areas part of the fixture of any test that asserts who was
   paid.
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

### The overlap models

Two are implemented. `overlap_basis` on the active rule chooses, and switching is
an explicit, versioned act: a manager activates a rule that names the other
model. `longest_shift` remains the column default.

**`longest_shift`** — one anchor. The anchor is the single longest effective
shift of the whole period across every area; ties break to the earlier start,
then the shift id. Every other shift's overlap is measured against that one
shift; below `min_overlap_minutes` is out, and the anchor is always in. Its known
consequence: with A anchoring, B overlapping A, and C overlapping B but not A, C
is excluded although C did work alongside B.

**`pairwise`** — the overlap graph.

1. Candidates are the same: approved shifts in the period with
   `worked_minutes > 0`, resolved to an effective area and role.
2. For every unordered pair of distinct members, `overlap(P, Q)` is the sum of
   `|shift_p ∩ shift_q|` over every combination of their shifts, in whole
   minutes. A person's own shifts cannot overlap — the exclusion constraint
   forbids it — so this sum is exactly the time the two were both at work.
   Multiple shifts, several partial overlaps, different areas and overnight
   spans all fall out of this, because the intervals are instants rather than
   clock faces.
3. P and Q are **linked** when `overlap(P, Q) >= min_overlap_minutes`. Exactly
   at the threshold links; one minute below does not.
4. **Eligibility.** With exactly one candidate member, that member is eligible —
   somebody who worked alone has not forfeited the tips. Otherwise a member is
   eligible when they have at least one link; a member with no link is excluded
   and the snapshot records `no_pairwise_overlap`.
5. **Connectivity.** Chains are intended: A—B and B—C puts A, B and C in one
   group even though A and C never met. If the eligible members fall into two or
   more disconnected groups, the distribution is **refused** — two crews who
   never met cannot both be the crew that earned one pool, and picking one
   silently is the kind of invisible decision this product exists to remove.
6. **Weighting is unchanged**: worked time × role points × personal multiplier.
   The anchor never entered the weighting; only the membership of the pool
   changed. Each entry records that member's largest pairwise overlap, so the row
   still carries the number that justified their inclusion.

The whole graph, linked and unlinked pairs alike, is written into
`inputs_snapshot.pairs`, so a distribution can be re-argued from the record.

`service_window` remains an enum value with no implementation, and activating a
rule that names it is an error rather than a silent substitution.

### Rounding, exactly

Largest remainder, twice.

*Pool → areas*. Every area with a share above zero must have at least one
eligible person: since migration 16, one that does not **stops the distribution
and names the area**, rather than having its money absorbed by the areas that do.
No money moves without somebody deciding it should. Ties break by remainder,
then the rule's `rounding_area_id`, then percentage, then area key.

*Area → people*, ties by remainder, then units, then member id.

Then an assertion: if the assigned cents do not equal the pool, the whole
transaction raises. €10 among three is 333 / 333 / 334, and the entry that took
the extra cent records it in `rounding_adjustment_cents`.

---

## 4a. pg_safeupdate, and why the engine has no unqualified write

Supabase preloads `pg_safeupdate` into the connections PostgREST uses (it is set
on the `authenticator` role), so it is armed for the whole session. Every
`UPDATE` and `DELETE` whose plan carries no qualifier is refused with

```
SQLSTATE 21000 — UPDATE requires a WHERE clause
```

The hook does not care that the statement sits inside a `security definer`
function, and it does not care that the target is a session-local temp table.
It is a plan-level check, so a staging table gets exactly the same treatment as
a table of real money.

`calculate_distribution()` carried one such statement from migration 11 until
migration 17: `update tmp_entries set units = …` with no `where`, filling in a
column that had just been added with `alter table`. The intent was "every row
of this staging table", which is legitimate — but the only way to say that to
the planner is to say nothing, and saying nothing is what the guard forbids.
Nothing local reproduces this, because a plain PostgreSQL cluster has no such
hook; the statement can only fail on the real REST path.

Migration 17 derives `units` inside the `create temp table … as select` that
stages the rows, so the value is set at construction and there is no second
statement at all. The guard stays on, globally, for every role.

Two things follow for anything added later:

* Never turn the guard off — not with `set local safeupdate.enabled = off`, and
  not with a `where <column> is not null` tautology bolted onto an otherwise
  unqualified write. Both keep the write and merely silence the check.
* If a statement really must touch every row of a staging structure, build the
  value into the `create table … as select`, or give the write a qualifier that
  is true of the rows it is meant to touch and false of anything else.

`supabase/tests/07_no_unqualified_writes.sql` lints every `plpgsql` and `sql`
function in `public` and `app` for this shape, so the class of bug cannot come
back unnoticed on a cluster that has no `pg_safeupdate` to catch it.

---

## 4b. Rule tenancy (migration 18)

The policies on `distribution_rule_areas` and `distribution_rule_roles` authorise
on the row's **own** `workplace_id` column:

```sql
using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id))
```

That column comes from the client. Until migration 18 nothing compared it with
the parent rule, and nothing checked that `area_id` / `workplace_role_id`
belonged to that workplace. Two real consequences:

* A manager of workplace A could insert a share row carrying `workplace_id = A`
  and `rule_id = <a draft of workplace B>`. WITH CHECK passes, the immutability
  trigger passes, and a stranger's draft gains a row. Reaching it needs B's rule
  id, which RLS does not hand out — but authorisation must not rest on an id
  being hard to guess.
* A manager could point their own rule's `area_id` at another workplace's area.
  Since migration 16 refuses a distribution when an area with a share has no
  eligible staff, that workplace could permanently block its own distributions —
  and the refusal names the area, built inside a `security definer` function, so
  the message would read back a foreign workplace's area name.

`rounding_area_id` on `distribution_rules` had the same gap.

Three guards close it: `app.guard_rule_area_tenancy()`,
`app.guard_rule_role_tenancy()` and `app.guard_rule_rounding_area()`. They
compare ids and nothing else. They are `security definer` because they must read
the parent rule and the target area or role whether or not the caller can see
them — an invoker guard would report "not found" for a row that exists. They
make no decision from `current_user`, so unlike `app.guard_rule_immutable()`
(which asks `app.is_trusted_context()` and must stay invoker) definer rights
cannot weaken them, and they are not skipped for a trusted context: tenancy is
an invariant, not a permission.

---

## 4c. Areas and roles (migration 19)

The tables were built for editing from the start — `sort_order`, `archived_at`, a
per-workplace unique `key`, and `on delete restrict` on every reference — but
nothing enforced the rules that make editing safe. Migration 19 adds them.

**Delete is already safe.** Every foreign key into `workplace_areas` and
`workplace_roles` restricts (`invitations.proposed_area_id` and
`distribution_rules.rounding_area_id` are `set null`), so a referenced row cannot
be deleted whatever the client asks. `area_usage()` / `role_usage()` report a
`references` count across exactly those restricting keys: zero is the only state
in which the delete will go through, and it is the only state in which the app
offers it.

**Rename is always safe.** `tip_distribution_areas` and
`tip_distribution_entries` store `area_key`, `area_name`, `role_key`, `role_name`
and `points` as snapshots taken at calculation time, so a payslip keeps the words
it was issued with. The `key` never moves with a rename.

**Archive is the operation that needs a policy.** It is refused while the thing
is part of live operations:

| | refused while |
| --- | --- |
| an area | an active member has it as their default · an unfinished shift (draft, submitted, or approved-but-not-locked) references it · the active rule or the open draft gives it a share above 0 · a non-archived role still belongs to it |
| a role | an active member has it as their default · an unfinished shift references it |

Locked shifts, superseded rule versions and anything inside a distribution do
**not** block: they are history, they carry their own snapshot, and blocking on
them would make archiving impossible after the first month. Roles under an
archived area are neither archived automatically nor reassigned — the manager
archives them first, explicitly. A silent cascade over something carrying a pay
weight is what this product exists to avoid.

**Archived means "not offered again", enforced where the reference is written:**
triggers refuse a new or changed `area_id` / `workplace_role_id` on
`workplace_members` and `shifts`, a `distribution_rule_areas` share above 0, and
a `rounding_area_id`. Rows that already point at something since archived keep
working and keep rendering. A rule share of exactly 0 is allowed for an archived
area — that is what lets `create_rule_draft()` copy the active rule forward, and
an area can only reach `archived` while its share is already zero.

Names are unique among *live* rows only, so an archived "Bar" and a new "Bar" can
coexist; the new one takes the key `bar_2`, because archived rows keep theirs.
`app.slugify()` derives the key from the name (`Späti Küche` → `spaeti_kueche`).

---

## 4d. Memberships (migration 20)

Migration 19 made an area and a role things a manager edits. Migration 20 makes
sure the pair a membership holds is coherent, and gives the manager a way to see
who is asking to come in.

`app.guard_member_tenancy()` (BEFORE INSERT OR UPDATE, `SECURITY DEFINER`)
refuses three things by comparing ids, never names:

* an `area_id` belonging to another workplace,
* a `workplace_role_id` belonging to another workplace,
* a role that does not belong to the member's own area.

The third is why the app writes `area_id` and `workplace_role_id` in a **single**
UPDATE. Sending the area alone would leave the old role behind and be refused;
sending the role alone would be refused for the same reason. One statement moves
both, and a refusal leaves nothing half-applied.

`app.guard_member_dates()` (BEFORE UPDATE) protects `joined_at` and `left_at`
from anyone who is not a manager of that workplace. It is `SECURITY INVOKER` on
purpose: `accept_invitation()` and `approve_join_request()` stamp `joined_at`
while running as the person joining, who is not a manager, and
`app.is_trusted_context()` only reports the truth when `current_user` is the
caller rather than the table owner.

Trigger order on `workplace_members` is alphabetical, and deliberately so:

    workplace_members_dates      → dates are manager-only
    workplace_members_guard      → may you change this column at all
    workplace_members_live_refs  → is what you are pointing at archived
    workplace_members_tenancy    → is it even this workplace's, and this area's

so the manager is told the most specific true thing, in that order: not allowed,
then archived, then wrong workplace or wrong area.

`public.pending_join_requests(workplace)` returns `invitation_id`,
`requested_at`, `requester_name` and `proposed_area_id` for the pending
`join_request` rows of one workplace. It is `SECURITY DEFINER` because the
requester's name lives in `profiles`, which no manager may read; it returns the
name and nothing else — no email, no token, no user id. It **raises** for a
non-manager rather than returning an empty set, because "there is nothing" and
"you may not look" are different answers and the caller deserves the true one.

Nothing here creates a membership. `approve_join_request()` still hard-codes
`'employee'`, and `accept_invitation()` still takes the role from the invitation
row, so no value a joining person controls can produce a manager.

---

## 4e. Acknowledgement (migration 21)

The enum, the columns and `acknowledge_entry()` were all in place from Phase 2.
Migration 21 adds the four things the flow was missing.

**The requirement, where the person it binds can read it.**
`distribution_rules.acknowledgement_required` is frozen into
`tip_distributions.rules_snapshot` at calculation time, and nothing member-facing
exposed it. `member_distributions` now carries it as a column, read from the
snapshot — so a distribution keeps the requirement it was sent with, and a later
rule change does not reach back into it. The rest of `rules_snapshot`, which
holds every area's percentage, stays where it was.

**Two doors that refused different things.** The direct PostgREST path (policy
`entries_update_own_ack`) tests `app.distribution_is_published()`;
`acknowledge_entry()` is `SECURITY DEFINER` and therefore bypasses RLS, so it
had no such test and was the one way to confirm a draft. Both now refuse it.

**A moment that drifted.** Acknowledging twice moved `acknowledged_at` forward.
It is now `coalesce(acknowledged_at, now())`: re-confirming is accepted and
changes nothing.

**One action for a person, not for a row.** `calculate_distribution()` groups by
`member_id, area_id`, so somebody who worked two areas in one period holds two
entries. `acknowledge_distribution(distribution, status, note)` answers every
entry the caller owns in one statement, deciding which those are from
`auth.uid()` — the browser sends a distribution id and never a member id.

**And what the direct path could still do.** The existing column guard froze the
money but not the answer, so a member could write `ack_status` back to `pending`
after the manager had seen the tally, and could set `acknowledged_at` to any
value. `app.guard_entry_columns()` is republished here refusing both. It is
`SECURITY INVOKER`, so `app.is_trusted_context()` is true only inside the
definer RPCs — which is exactly where the timestamps are meant to be set.
Changing your mind between `acknowledged` and `queried` is still allowed;
withdrawing into silence is not.

### Who owes an answer

`public.distribution_ack_state(distribution)` returns one row per entry for a
manager — snapshot names only, no profile, no email — with `can_acknowledge`
false for a roster placeholder that has no account. That is precisely the set
the auto-confirm in both RPCs ignores, so the manager's tally and the engine's
decision to close a distribution are derived from one definition rather than
two. Counting entries instead of people would read "9 of 8 confirmed" the moment
somebody worked two areas.

---

## 4f. The query loop (migration 22)

Phase 3H gave an employee two answers and nowhere for the second to go. This
migration gives it somewhere, and corrects four things the audit found.

**A question was not counted as open.** `acknowledge_entry()` and
`acknowledge_distribution()` counted only `pending` when deciding whether a
distribution was fully answered, so one person disputing their share still let
it flip to `confirmed`. `app.open_answers()` now counts `pending` **or**
`queried`, and both RPCs and the manager's tally read it.

**An employee could answer their own question.** Nothing stopped a `queried`
entry going back to `acknowledged` by the person who raised it. Confirming is
refused while the entry is queried — keyed on the entry's own state, not on
whether a query row is open, because the two outcomes below need to differ.

**A cancelled distribution was writable.** `app.distribution_is_published()`
means "not a draft" and was answering both "may be read" and "may be answered".
`app.distribution_is_actionable()` is the second question — `sent` or
`confirmed` only — and the entries UPDATE policy is republished to use it. A
cancelled distribution stays visible and stops taking answers.

**There was nowhere to record what the manager did.** `distribution_queries`
holds one row per member per distribution — never per entry, because somebody
who worked two areas asks one question about their share. It carries the
employee's note, a snapshot of their name, and the manager's outcome, response
and timestamp. `app.guard_query_immutable()` refuses any change to the note,
the member, the distribution or the moment it was asked, and it has **no
trusted-context escape**: not even the definer functions may rewrite what
somebody asked.

### The lifecycle

    pending ──confirm──> acknowledged
    pending ──ask──────> queried ──manager: no correction──> pending ──confirm──> acknowledged
                                 └─manager: correction ────> queried (stays)

`resolve_query(query, 'no_correction', response)` puts that member's entries
back to `pending`, so they confirm for themselves — a manager never marks anybody
acknowledged. `'correction_required'` records that the manager agrees something
is wrong and deliberately leaves the entries queried: nobody should be asked to
confirm a share their manager believes is wrong, and the sent distribution is
never edited in place. Replacing it is Phase 3J.

`distribution_query_list(distribution)` is the manager's reader — snapshot names
and the amount at stake, no profile data. Employees read their own row straight
from the table through the `queries_select` policy; there is deliberately no
insert, update or delete policy, so every write goes through a definer function.

Both the queries table and updates to `tip_distribution_entries` are audited by
the existing `app.write_audit()` trigger, so asking, answering and confirming
all land in `audit_log` with actor and timestamp.

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

#### Visibility is per workplace, and follows the CURRENT membership

`app.member_id()`, `app.is_member()`, `app.is_manager()` and
`app.member_workplaces()` all require `status = 'active'`, and
`member_distributions` repeats the same test in its `WHERE` clause. So the rule
across the whole financial surface is one sentence: **current membership status
controls financial access, per workplace.**

Suspend a membership and, in that workplace, the person immediately loses their
entries, the distribution summaries, the area subtotals and the ability to
acknowledge — the records stay stored, they just stop being readable.
`app.can_see_entry()` short-circuits on `app.member_id(...) is null`, so an
inactive membership fails *before* `peer_entry_visibility` is ever consulted.

The other half of "per workplace" is the one that catches test authors out: one
person can hold memberships in several workplaces, each with its own
`workplace_members.id`. An unfiltered `select * from
member_distribution_entries` therefore spans all of them, and the rows from the
other workplaces carry *that* workplace's member id. Comparing every row's
`member_id` against one workplace's membership makes a person's own entry
elsewhere look foreign, and suspending them here does not remove it — correctly.

Two invariants, and they are different:

| question | how to ask it |
| --- | --- |
| does peer visibility hold in **this** workplace? | filter `workplace_id`, then compare `member_id` to that workplace's membership |
| is anything readable at all that is not theirs? | read unfiltered and require `is_own = true` on every row |

`supabase/tests/09_entry_visibility.sql` asserts both, along with each
`peer_entry_visibility` setting, the manager cases and the suspended case.

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

A plain cluster has no `pg_safeupdate`, so the suite cannot reproduce SQLSTATE
21000 behaviourally. `07_no_unqualified_writes.sql` stands in for it with a lint
over the installed function bodies plus the calculate-a-draft path that failed
live. `scripts/distribution-check.mjs` remains the live regression: it runs
against the real project over PostgREST, where the guard is actually armed.

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
