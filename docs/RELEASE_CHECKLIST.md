# TipCrew — release configuration checklist

Documentation for the person who deploys, not a deployment script. Every line
is a fact to verify before a production build is published. Phase 3R-C.

## 1. Supabase project

- [ ] The linked project is the **production** project, not the development one
      (`supabase projects list`, and the project ref in `.env.local` on the build machine).
- [ ] Migrations 1–35 are applied: `supabase migration list` shows every file under
      *(migration 35 is load-bearing for the client: `src/notifications/queries.ts`
      selects `member_notifications.shift_id`, and a project without that column
      answers the whole inbox with a 400 that the hook swallows — the badge and the
      notification list are then silently empty rather than visibly broken.)*
      `supabase/migrations/` as applied, nothing pending, nothing extra.
- [ ] Row Level Security is enabled on all 22 tables (`supabase/tests/02_security.sql`
      lists them; `select relname from pg_class where relrowsecurity` on the project agrees).
- [ ] PostgreSQL major version is 16 (the migrations were rebuilt and tested on 16).
- [ ] `pg_safeupdate` is active on the project (Supabase default), so an unqualified
      UPDATE/DELETE is refused with SQLSTATE 21000.

## 2. Keys and environment

- [ ] `VITE_SUPABASE_URL` is the production project URL (`https://<ref>.supabase.co`).
- [ ] `VITE_SUPABASE_ANON_KEY` is the **anon / publishable** key. `src/lib/env.ts`
      refuses a value that looks like a service-role key; do not rely on that alone.
- [ ] No service-role key exists anywhere in the repository, the build machine's
      `.env*`, or any `VITE_`-prefixed variable. It belongs only to server-side contexts
      this product does not have.
- [ ] `VITE_ALLOW_DEMO` is **unset** (or anything other than `true`). With Supabase
      configured and a production build, `?demo=1` and any remembered demo mode are
      ignored (`src/state/dataMode.ts`). Set it only on a staging deployment that is
      meant to show the sample workplace.
- [ ] `.env`, `.env.local`, `.env.test.local` are not committed (`git check-ignore -v`)
      and are not copied into the published `dist/`.

## 3. Auth

- [ ] Site URL is the production origin (Supabase → Authentication → URL configuration).
- [ ] Redirect URLs include the production origin with the hash routes the app uses:
      `https://<host>/#/join` and `https://<host>/#/signin` (HashRouter, so one origin
      entry with a wildcard path is enough on Supabase; list it explicitly).
- [ ] Email confirmation is **on**. The sign-up screen stores the return path only
      for the email-confirmation case (`src/auth/returnTo.ts`); with confirmation off
      that path is skipped and a new account lands on `/join` directly, which also works.
- [ ] Password minimum length and rate limits are set to the project's policy.
- [ ] The two test accounts from `.env.test.local` do **not** exist on the production
      project, and the live scripts are never pointed at it.

## 4. Transport and hosting

- [ ] The site is served over HTTPS only; the WebCrypto call in
      `src/workplace/queries.ts` (invitation retry recovery) requires a secure context.
- [ ] The build is `npm run build` from a clean tree at the tagged commit; `dist/` is
      what is published, with `base: './'` intact (works from a sub-path).
- [ ] No server rewrites are needed (HashRouter); if a hosting provider adds them,
      they must not rewrite `/assets/*`.

## 5. Workplace data sanity

- [ ] Each production workplace has the intended `timezone` (IANA name) and
      `business_day_start_hour` (default 05:00). Both are set on the workplace settings
      screen and decide `app.business_day()`, which every shift, report and pool is
      filed under. Changing them later changes only future derivations.
- [ ] Each workplace has one active distribution rule with area shares totalling 100.
- [ ] `pool_amount_visible_to_members` and `peer_entry_visibility` are set to what the
      workplace agreed with its staff.

## 6. Pre-release verification (all must be green at the release commit)

- [ ] `npx tsc --noEmit` and `npm run build`.
- [ ] Local SQL suite: `bash supabase/tests/rebuild.sh --test`, 22 suites, 0 failures.
- [ ] Live scripts against the **development** project, each with 0 failures:
      `production-hardening-check`, `client-authority-check`, `distribution-check`,
      `replacement-check`, `query-check`, `notifications-check`,
      `manager-dashboard-check`, `period-close-check`, `payout-check`,
      `payout-reversal-check`, `manager-correction-check`, `acknowledgement-check`,
      `members-check`, `rls-check`, `rules-check`, `shifts-check`, `workplace-check`,
      `areas-roles-check`; plus the offline `client-logic-check`.
- [ ] `npm audit` reviewed; nothing release-relevant open.
- [ ] The manager and employee smoke flows (docs/BACKEND.md §10) executed by a person
      on a phone at 320 px and 430 px, in EN and DE.

## 7. What is deliberately not configured

- No email delivery: invitation links are handed to people by the manager.
- No storage buckets, no edge functions, no cron, no external service besides Supabase.
- No PDF export: the CSV export is the record (docs/BACKEND.md §4l).
