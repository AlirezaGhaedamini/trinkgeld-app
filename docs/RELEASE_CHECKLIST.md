# TipCrew — release configuration checklist

Everything that has to be true before TipCrew serves a real workplace, and the
verification that proves it. Rewritten in phase 3S-B: the previous version
certified a 35-migration, 22-suite repository and pointed its only human step at
a document section that contained no smoke flows.

Nothing here is automated. Work top to bottom at the release commit.

## 1. Supabase project

- [ ] The linked project is the **production** project, not the development one
      (`supabase projects list`, and check `supabase/.temp` is not pointing elsewhere).
- [ ] **Migrations 1–39 are applied**: `supabase migration list` shows every file
      under `supabase/migrations/` as applied, with none pending and none extra.
      36 and 37 are the closed-period and paid-distribution cancellation guards,
      38 is the lineage guard and 39 is the profile identity guard — a project
      missing any of them can have its financial history rewritten.
- [ ] Row Level Security is enabled on every table (`supabase/tests/02_security.sql`
      is the proof; re-run it locally at this commit).
- [ ] PostgreSQL major version is 16. Note `supabase/config.toml` says
      `major_version = 15`; that value only affects a local `supabase start`, not
      the hosted project, and is tracked as a P2 inconsistency.
- [ ] `pg_safeupdate` is active (Supabase default), so an unqualified UPDATE or
      DELETE from a console is refused.

## 2. Keys and environment

- [ ] `VITE_SUPABASE_URL` is the production project URL (`https://<ref>.supabase.co`).
- [ ] `VITE_SUPABASE_ANON_KEY` is the **anon / publishable** key.
- [ ] No service-role key exists in the repository, on the build machine, or in
      any CI variable that the frontend build can read. The frontend never needs
      one and `src/lib/env.ts` refuses the obvious shapes.
- [ ] `VITE_ALLOW_DEMO` is **unset**, or set to anything other than `true`. With
      Supabase configured and `DEV` false, `resolveDataMode()` already ignores
      `?demo=1` and clears a remembered demo mode; this flag is the only way to
      re-enable it and belongs on staging, never on production.
- [ ] `.env`, `.env.local`, `.env.test.local` are not committed
      (`git check-ignore -v .env.local`) and are not in the deployed bundle.
- [ ] **The published bundle is actually configured.** Vite inlines
      `VITE_*` at build time, so a build run without `.env.local` produces a
      working app that shows the Phase-1 sample workplace. After deploying, load
      the site and confirm the sign-in screen has no demo role switcher and no
      demo bar.

## 3. Auth

- [ ] Site URL is the production origin (Supabase → Authentication → URL
      configuration).
- [ ] **Redirect URLs.** For `https://tipcrew.de` add BOTH of these under
      Authentication → URL Configuration → Redirect URLs:

          https://tipcrew.de
          https://tipcrew.de/**

      The wildcard entry is what covers the recovery redirect, which carries a
      query parameter: `https://tipcrew.de/?tc=recovery`.

      **A redirect for an auth callback must never contain a `#`.** GoTrue
      appends the PKCE code to whatever it is given, so a fragment in the
      redirect swallows the code and supabase-js never finds it — that was the
      3S-C password-reset failure. `AuthProvider.recoveryRedirect()` now builds
      a fragment-free URL and the app routes to the reset screen itself; the
      offline checks pin it (`client-logic-check.mjs`, checks 99–107).
      Signup confirmation passes no redirect at all and uses the Site URL.
- [ ] Email confirmation is **on**.
- [ ] **Custom SMTP is configured on the project.** Supabase's built-in sender
      is rate limited to a handful of messages an hour, which is not enough to
      onboard a team, and BOTH signup confirmation and password recovery depend
      on it. This is separate from the invitation Edge Function: deploying that
      function does NOT configure Supabase Auth mail.
      Authentication → Emails → SMTP Settings, using Resend as the SMTP relay:
      - Host `smtp.resend.com`, port `465`, username `resend`
      - Password: a Resend API key (created in Resend, pasted into Supabase,
        never into this repository)
      - Sender address on the verified domain, e.g. `no-reply@<domain>`
      - Sender name `TipCrew`
- [ ] One confirmation email and one recovery email received and followed on a
      real device before signups open.
- [ ] Password policy (minimum length, leaked-password protection, rate limits)
      is set on the project. The client does not enforce one; it reports what
      the server refuses.
- [ ] The two accounts from `.env.test.local` do **not** exist on production.

## 3b. Invitation email (Edge Function)

Invitation delivery is best effort and sits on top of a flow that already works:
`create_invitation()` mints the row and returns the raw token once, the manager
can always copy the link. If any item here is not done, invitations still work —
managers just copy links by hand, and the screen says so.

- [ ] Resend account with the **sending domain verified** (SPF and DKIM records
      published and green in Resend).
- [ ] `INVITE_FROM_ADDRESS` is on that verified domain.
- [ ] Function deployed: `supabase functions deploy send-invitation`.
- [ ] Secrets set on the project, never in the repository:
      `supabase secrets set RESEND_API_KEY=… INVITE_FROM_ADDRESS=… APP_BASE_URL=…`
      - `APP_BASE_URL` is the production origin **without** a trailing slash;
        the function appends `/#/join?token=…` itself so the browser cannot
        choose where the email points.
- [ ] `supabase secrets list` shows the three names and no others are expected.
- [ ] The function uses **no service-role key** — it authorises the caller with
      their own JWT against normal RLS. Confirm none is set for it.
- [ ] End-to-end on staging: invite a test address, the email arrives, the CTA
      opens the join screen for the right workplace, and accepting works.
- [ ] Failure path once, on purpose: unset the key or use a bad from-address and
      confirm the screen says the email could not be sent, the invitation is
      still listed as pending, and Copy invitation link still works.

## 4. Transport and hosting

- [ ] Served over HTTPS only.
- [ ] **Security headers** set at the host or CDN. No hosting configuration is
      committed here — the deployment target is not chosen in this repository —
      so these are the exact values to enter wherever the site is served from:

      Strict-Transport-Security: max-age=31536000; includeSubDomains
      X-Content-Type-Options: nosniff
      Referrer-Policy: strict-origin-when-cross-origin
      Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
      Content-Security-Policy:
        default-src 'self';
        connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co;
        img-src 'self' data:;
        style-src 'self' 'unsafe-inline';
        script-src 'self';
        font-src 'self';
        frame-ancestors 'none';
        base-uri 'self';
        form-action 'self'

      Notes that matter: `connect-src` must name the project host or PostgREST,
      Auth and the Edge Function are all blocked. `frame-ancestors 'none'`
      replaces X-Frame-Options. `style-src` needs `'unsafe-inline'` because the
      few inline styles the app uses would otherwise be dropped. Resend is
      called from the Edge Function, server to server, and needs no browser
      permission at all. Auth redirects are same-origin hash routes, so
      `form-action 'self'` does not affect them.
- [ ] Load the deployed site with devtools open and confirm no CSP violation is
      reported on sign-in, on the invite screen, and on a period export.
- [x] **Source maps: off.** `vite.config.ts` sets `build.sourcemap: false` as of
      phase 3S-C, and a release build produces no `.map` files. TipCrew ships no
      error monitoring that would consume them, so publishing them would only
      hand the readable source to anyone opening devtools. Verify with
      `ls dist/assets/*.map` — it must find nothing.
- [ ] The build is `npm run build` from a clean tree at the tagged commit.
- [ ] No server rewrites are needed (HashRouter). If the host adds them, they
      must not swallow the fragment.

## 5. Workplace data sanity

- [ ] Each production workplace has the intended `timezone` (IANA name) and
      `business_day_start_hour`. These decide which day a night's money belongs
      to; a wrong value moves money between periods.
- [ ] Each workplace has one active distribution rule with area shares totalling 100.
- [ ] `pool_amount_visible_to_members` and `peer_entry_visibility` are set to
      what the workplace actually agreed.

## 6. Backup, rollback and incident

- [ ] Point-in-time recovery is enabled on the production project, and the
      retention window is written down here: __________
- [ ] A restore has been rehearsed once, on a copy, and the person who would do
      it has done it: __________
- [ ] **Rollback of the app** is redeploying the previous tagged `dist/`. The
      frontend holds no schema, so this is safe at any time.
- [ ] **Rollback of the database is not symmetrical.** Migrations are forward
      only: there are no down-migrations, and 1–39 are historical. A bad
      migration is corrected by writing the next one, never by editing or
      reverting an applied file. Confirm whoever is on call knows this.
- [ ] Incident contact and escalation path: __________
- [ ] Where errors are seen: there is no monitoring service in V1. The error
      boundary shows a fallback and logs to the console in development only, so
      a production problem is reported by a person. Decide who they tell.

## 7. Pre-release verification (all green at the release commit)

- [ ] `npx tsc --noEmit` and `npm run build`.
- [ ] `npm audit` reviewed. Current state: 4 advisories, all dev-only —
      `vite` and `esbuild` affect the dev server, not the shipped bundle;
      `react-router` is an open-redirect that needs a user-controlled target,
      and the only dynamic one is validated and confined to the fragment.
      Nothing release-relevant open.
- [ ] Local SQL rebuild from zero: **39 migrations, 25 suites, 1150 assertions,
      0 failures.** (`bash supabase/tests/rebuild.sh --test` on a POSIX box; on
      Windows, apply the shim then every migration then every suite with
      `PGCLIENTENCODING=UTF8` and an ICU-locale cluster, or the German fixtures
      fail on `lower()`.)
- [ ] Offline client checks: `node scripts/client-logic-check.mjs`, 98 checks, 0 failures.
- [ ] Live scripts against the **development** project, each 0 failures — all 22:
      `workplace`, `areas-roles`, `rules`, `members`, `shifts`, `distribution`,
      `replacement`, `acknowledgement`, `query`, `manager-correction`, `payout`,
      `payout-reversal`, `period-close`, `notifications`, `manager-dashboard`,
      `production-hardening`, `client-authority`, `rls`, `shift-rejection`,
      `closed-period-cancellation`, `paid-cancellation`, `lineage-cancellation`.
      They create workplaces and do not clean up; never point them at production.

## 8. Manual smoke — manager

On a real phone, at 320 px and 430 px, in EN and then DE.

- [ ] Sign up, confirm by email, create a workplace.
- [ ] Rules: set area shares to 100, choose a method, activate.
- [ ] Team: invite someone, copy the link, and confirm the screen does not claim
      an email was sent.
- [ ] Review hours: approve one shift, reject another with a note.
- [ ] Pool: open a manual pool, type an amount, use backspace, clear it, retype.
- [ ] Calculate, check the split, send.
- [ ] Record a payout; reverse it; record it again.
- [ ] Correct a sent distribution and publish the correction.
- [ ] Period close: find it from Rules, check readiness, close, download the CSV.
- [ ] Open the CSV in Excel: four sections, no `#####`, umlauts intact, and each
      person appears **once** in the shares section for a corrected night.
- [ ] Sign out from Profile.

## 9. Manual smoke — employee

- [ ] Open an invitation link on a phone with no account; sign up; land in the
      workplace.
- [ ] Home shows the last shift and what it paid.
- [ ] Submit hours, including one overnight shift and one with a break.
- [ ] Receive a rejection notification, follow it to the exact shift, edit,
      resubmit.
- [ ] Report tips for the day.
- [ ] Acknowledge a share; raise a question on another; see the answer.
- [ ] History and payout state read correctly.
- [ ] Change the language and confirm the whole app follows.
- [ ] Sign out from Profile.

## 10. Manual smoke — the edges

- [ ] **Multi-workplace**: an account that manages one workplace and works in
      another. Switch both ways and confirm the shell, the tabs, the
      distributions and the notifications all follow.
- [ ] **No membership**: sign in as an account with no workplace and confirm
      there is a visible Sign out on both the join screen and the workplace
      switcher.
- [ ] **Password reset**: use Forgot password, receive the mail, set a new
      password, sign in with it. Then follow the same link a second time and
      confirm it says the link is no longer valid.
- [ ] **Wrong account on an invitation**: open an invite link signed in as
      somebody else and confirm you can sign out and try again.

## 11. What is deliberately not configured

- **Invitation email is best effort, not a dependency.** The Edge Function in
  §3b sends the link when it can; the manager can always copy it instead, and
  the screen says which happened. An invitation is never lost to a mail failure.
- **No delivery history.** Nothing records that an email was sent: there is no
  `delivered_at` column and no migration was added for one. What a manager sees
  is the outcome of the attempt they just made, in that page session.
- No storage buckets, no cron, no external service besides Supabase.
- No PDF export: the CSV is the record (`docs/BACKEND.md §4l`).
- No monitoring or error reporting service.
