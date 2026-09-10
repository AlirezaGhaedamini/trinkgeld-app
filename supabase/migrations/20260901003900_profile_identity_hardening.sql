-- ─────────────────────────────────────────────────────────────────────────────
-- 39 · Phase 3S-B · a profile does not get to say who it is
--
-- Deliberately NOT folded into migration 38. That one is about abandoning a
-- settled tip lineage; this one is about identity. They share a release, not a
-- subject, and a migration in this project has one subject.
--
-- ── WHAT THE 3S-A AUDIT PROVED ────────────────────────────────────────────
--
-- Migration 02 grants `update` on public.profiles to authenticated, and
-- migration 04's policy narrows it to the caller's own row — but to no
-- particular COLUMN. profiles.email is therefore writable by its owner, and it
-- is not theirs to write: it mirrors auth.users.email, which the person proved
-- they control by confirming it. Two things follow, both reproduced live
-- against a local rebuild by a plain authenticated session:
--
--   1 · REGISTRATION DENIAL. profiles_email_key is unique. Claim an address
--       nobody has registered yet, and app.handle_new_user() cannot insert the
--       profile when its real owner signs up:
--
--           update profiles set email='victim@…' where id = auth.uid()  → ALLOWED
--           (victim signs up)  → duplicate key … "profiles_email_key"
--           victim_account_created = 0
--
--       `on conflict (id) do nothing` does not catch it: the collision is on
--       email, not on the primary key, so the exception escapes the AFTER
--       INSERT trigger and takes the whole signup transaction with it. Any
--       signed-in user could lock any address out of the product for good.
--
--   2 · INVITATION DISCLOSURE. invitations_select (migration 07) admits a row
--       when `email = (select p.email from profiles p where p.id = auth.uid())`.
--       Rewriting your own profile email is therefore enough to read who has
--       been invited to which workplace, in which role, and until when. It is
--       not enough to TAKE the seat: only token_hash is stored, and
--       accept_invitation() matches the hash of a raw token the manager hands
--       over. So this is disclosure, not privilege escalation.
--
-- ── THE RULE ──────────────────────────────────────────────────────────────
-- profiles.email mirrors the auth identity and is not user-editable. Nor is a
-- profile's id, nor when it was created. Everything a person legitimately owns
-- about themselves — full_name, avatar_url, locale, last_workplace_id — stays
-- exactly as editable as it was; the client writes only `locale` today
-- (src/auth/profile.ts:83) and that keeps working untouched.
--
-- SECURITY INVOKER on the guard, on purpose and for the same reason as every
-- other guard in this schema: it has to see the CALLER's effective user. As
-- DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling it. The definer
-- functions that legitimately write identity — app.handle_new_user() — run as
-- the owner and are let through by exactly that test.
--
-- ── AND THE SIGNUP PATH IS MADE UNBLOCKABLE ───────────────────────────────
-- The guard stops new squatting; it cannot un-squat a row that already exists,
-- and a release must not be able to lose an account to one. So
-- app.handle_new_user() now degrades instead of failing: if the address is
-- somehow already spoken for, the profile is created WITHOUT an email rather
-- than not created at all. The account always comes into existence. What such a
-- profile loses is the by-email convenience of seeing an invitation before
-- accepting it — and an invitation is accepted by its token, not by that
-- lookup, so the invited person still gets in by the link they were sent.
--
-- Migrations 1–38 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── identity is not a preference ───────────────────────────────────────────
-- SECURITY INVOKER on purpose — see the note above.
create or replace function app.guard_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'a profile cannot change which account it belongs to'
      using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception
      'your email address comes from your account, not from your profile; change it in your account'
      using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'a profile cannot change when it was created' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.guard_profile_identity() is
  'Migration 39: id, email and created_at on public.profiles are the account''s, not the '
  'person''s to type. full_name, avatar_url, locale and last_workplace_id stay editable. '
  'The definer path that creates a profile is recognised by app.is_trusted_context().';

create trigger profiles_identity_guard
  before update on public.profiles
  for each row execute function app.guard_profile_identity();

-- ── an account can always be created ───────────────────────────────────────
-- Byte-for-byte migration 02's function except that a taken address degrades to
-- no address instead of aborting the signup. The `on conflict (id) do nothing`
-- stays for the re-entrant case it was written for; the exception block is for
-- the one it never covered.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, email, full_name)
    values (
      new.id,
      nullif(new.email, '')::extensions.citext,
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    -- profiles_email_key. The address is spoken for by another row, which after
    -- this migration can only be a legacy one. Create the person anyway: an
    -- account that cannot be created is worse than a profile with no email on
    -- it, and the invitation they were sent is accepted by its token.
    insert into public.profiles (id, email, full_name)
    values (
      new.id,
      null,
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
    )
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

comment on function app.handle_new_user() is
  'Migration 39: gives every new auth user a profile, and never lets a taken email address '
  'stop the account existing — the profile is created without one instead.';
