-- ─────────────────────────────────────────────────────────────────────────────
-- 41 · invitation-aware onboarding · an invitee may read their invitation
--      before they have an account, and only that invitee may accept it
--
-- ── WHY THIS NEEDS A MIGRATION ────────────────────────────────────────────
-- Two gaps, one subject: the invitation link.
--
--   1 · NOTHING CAN BE READ BEFORE SIGN-UP. A manager invites a named person:
--       create_invitation() (migration 07) stores the name on the roster row
--       (workplace_members.display_name, 'invited'), the address on the
--       invitation, the area and the workplace role on the roster row, and
--       only the SHA-256 of the token. All four facts the sign-up screen wants
--       to show are therefore ALREADY persisted — nothing new is stored here.
--       What does not exist is a way to read them without a session:
--       public.invitations grants nothing to anon, and workplaces,
--       workplace_members, workplace_areas and workplace_roles are likewise
--       closed to anon. So the sign-up screen could not say "you've been
--       invited to Cafe Test", could not prefill the name and could not fix
--       the address, and the person typed again what the manager had entered.
--
--   2 · THE SEAT IS NOT BOUND TO THE ADDRESS. accept_invitation() binds the
--       roster row to whoever holds the token. Migration 40's header says so
--       in as many words, and no client checks it either. A forwarded link,
--       or the invitee signing up under a different address, consumed the
--       invitation for an account the manager never named — and the Team
--       screen then showed the manager an address that was not the one they
--       invited. The invitation names an address; it is now accepted only by
--       the account that owns that address.
--
-- ── THE PREVIEW ───────────────────────────────────────────────────────────
-- One SECURITY DEFINER read function on the pattern of team_member_emails()
-- (migration 40): a fixed, empty search_path, schema-qualified casts, and a
-- result that names exactly the fields a person is shown and nothing else.
--
--   · keyed by the token's hash, exactly as accept_invitation() is. The token
--     is 32 random bytes; holding it is the credential, and the email that
--     carried it already said all of this. No id, no hash, no who-invited, no
--     join code and nothing about any other invitation ever leaves.
--   · an unknown, empty or malformed token returns NO ROW and no error: the
--     function does not confirm whether a token exists.
--   · the status is reported truthfully — pending, accepted, revoked,
--     declined, or `expired` COMPUTED from expires_at — so the screen can say
--     why a link no longer works. It does not flip the row to expired; that
--     stays accept_invitation()'s job, so this function writes nothing.
--   · ONLY AN OPEN INVITATION SAYS WHAT IT SAYS. Pending and unexpired: the
--     workplace name, invited name, address, area, role, proposed role and
--     expiry. Anything else — accepted, revoked, declined, expired — returns
--     the status and NULL in every other column. A link outlives its
--     invitation in browser history; a dead one must not keep naming the
--     person, their address or their workplace to whoever finds it.
--   · EXECUTE is granted to anon ON PURPOSE. This is the one function in the
--     schema that must serve a visitor with no account.
--
-- ── THE ADDRESS BINDING ───────────────────────────────────────────────────
-- accept_invitation() is migration 07's function — no later migration
-- redefines it — with exactly one check added: the caller's account address
-- must be the invited address. The address is read from auth.users via
-- auth.uid() — the address the person signed up with — and NOT from
-- profiles.email, because migration 39 lets a profile exist without one, and
-- that person must still be able to accept an invitation sent to them.
--
-- Both addresses are trimmed with app.trimmed_note() (migration 25, the one
-- definition of blank in this schema). If EITHER is missing or blank the
-- caller is refused: two absent addresses must never compare equal, and a
-- manager may edit an invitation row. Then they are compared ignoring case
-- and nothing else — person+work@x and person@x are different addresses.
-- The row must also be an invite (not a join request) with an address.
--
-- The check sits AFTER the status and expiry checks, so a used, withdrawn or
-- expired link still says exactly what it said before, and BEFORE anything is
-- written, so a refused caller changes nothing. The refusal is 42501, like
-- every other refusal here, with its own message so the client can word it.
--
-- ── WHAT DOES NOT CHANGE, AND WHY THE NAME NEEDS NO BACKEND ───────────────
--   · profiles are untouched. A BRAND-NEW account gets its initial full_name
--     from the sign-up metadata that app.handle_new_user() (migrations 02/39)
--     already reads — the invitation-aware sign-up screen fills that metadata
--     from this preview. An EXISTING account's full_name is never written by
--     any invitation path: accept_invitation() sets last_workplace_id and
--     nothing else on the profile, and migration 39's guard plus
--     profiles_update_own keep every manager of every workplace out of a
--     person's identity. The manager's name for the person lives on the
--     roster row, where it always did.
--   · the role still comes from the invitation, never from an argument; the
--     one-time token, the hash-only storage, expiry and revocation are as
--     migration 07 wrote them.
--   · no table, column, grant on a table or policy is added.
--
-- ── PRIVILEGES, DETERMINISTICALLY ─────────────────────────────────────────
-- Supabase's default privileges grant EXECUTE on new functions in public to
-- anon, authenticated and service_role BY NAME, and `revoke … from public`
-- does not touch those (migration 40 found this live). So both functions
-- revoke by name and grant by name:
--   accept_invitation   authenticated only — anon, service_role, PUBLIC revoked
--   invitation_preview  anon and authenticated — service_role, PUBLIC revoked
-- Nothing server-side calls either function; send-invitation does not.
--
-- Migrations 1–40 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.invitation_preview(p_token text)
returns table (
  workplace_name text,
  invited_name   text,
  email          text,
  area_name      text,
  role_name      text,
  proposed_role  public.member_role,
  status         text,
  expires_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Only an OPEN invitation — pending and not past its expiry — shows what it
  -- says. A used, withdrawn, declined or expired one returns its status and
  -- nothing else: its link outlives it in browser history, and a dead link
  -- has no business naming the person, the address or the workplace.
  return query
  select
    case when s.is_open then w.name::pg_catalog.text end,
    case when s.is_open then m.display_name::pg_catalog.text end,
    case when s.is_open then i.email::pg_catalog.text end,
    case when s.is_open then a.name::pg_catalog.text end,
    case when s.is_open then r.name::pg_catalog.text end,
    case when s.is_open then i.proposed_role end,
    s.state,
    case when s.is_open then i.expires_at end
  from public.invitations i
  cross join lateral (
    select
      (i.status = 'pending' and i.expires_at > pg_catalog.now()) as is_open,
      (case
         when i.status = 'pending' and i.expires_at <= pg_catalog.now() then 'expired'
         else i.status::pg_catalog.text
       end)::pg_catalog.text as state
  ) s
  join public.workplaces w on w.id = i.workplace_id
  left join public.workplace_members m on m.id = i.member_id
  left join public.workplace_areas   a on a.id = coalesce(m.area_id, i.proposed_area_id)
  left join public.workplace_roles   r on r.id = m.workplace_role_id
  where i.kind = 'invite'
    and i.token_hash = pg_catalog.encode(
          extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
end;
$$;

-- Deterministic, whatever the project's default privileges handed out.
-- anon is granted ON PURPOSE (the invitee has no account yet; see header);
-- PUBLIC and service_role are revoked by name — nothing server-side reads it.
revoke all on function public.invitation_preview(text) from public;
revoke execute on function public.invitation_preview(text) from service_role;
grant execute on function public.invitation_preview(text) to anon, authenticated;

comment on function public.invitation_preview(text) is
  'Migration 41: what an invitation link shows before sign-up — workplace name, invited '
  'name, address, area, role, proposed role and a truthful status — looked up by the '
  'token''s hash and nothing else. Read-only; callable without an account on purpose; '
  'an unknown token returns no row.';

-- ── the invitee accepts — and only the invitee ──────────────────────────────
-- Migration 07's function, unchanged except for the address check marked below.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_inv   public.invitations%rowtype;
  -- qualified: a planted pg_temp.text must not stand in for any of these
  v_email   pg_catalog.text;
  v_account pg_catalog.text;
  v_invited pg_catalog.text;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_inv
  from public.invitations
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;

  if v_inv.id is null then
    raise exception 'invitation not found' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'this invitation has already been used or withdrawn' using errcode = '42501';
  end if;
  if v_inv.expires_at <= now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'this invitation has expired' using errcode = '42501';
  end if;

  -- Migration 41: the invitation names an address, and only the account that
  -- owns it may take the seat. Read from the auth identity, not the profile.
  -- Both sides are trimmed by app.trimmed_note() (migration 25, the schema's
  -- one definition of blank) and a blank side is refused outright: two
  -- missing addresses must never compare equal. Case is the only thing
  -- ignored — no alias, dot or plus-tag folding.
  select u.email::pg_catalog.text into v_email from auth.users u where u.id = v_user;
  v_account := pg_catalog.lower(app.trimmed_note(v_email));
  v_invited := pg_catalog.lower(app.trimmed_note(v_inv.email::pg_catalog.text));
  if v_inv.kind <> 'invite'
     or v_invited is null
     or v_account is null
     or v_account <> v_invited then
    raise exception 'this invitation was sent to a different address' using errcode = '42501';
  end if;

  if exists (select 1 from public.workplace_members m
             where m.workplace_id = v_inv.workplace_id and m.user_id = v_user) then
    raise exception 'you are already in this workplace' using errcode = '23505';
  end if;

  -- The role comes from the invitation, never from an argument.
  update public.workplace_members
  set user_id   = v_user,
      role      = v_inv.proposed_role,
      status    = 'active',
      joined_at = coalesce(joined_at, now())
  where id = v_inv.member_id;

  update public.invitations
  set status = 'accepted', accepted_by = v_user, accepted_at = now()
  where id = v_inv.id;

  update public.profiles set last_workplace_id = v_inv.workplace_id where id = v_user;

  return v_inv.member_id;
end;
$$;

-- Deterministic, whatever the project's default privileges handed out: only a
-- signed-in account may call it. anon and service_role are revoked BY NAME,
-- because on Supabase they hold their own grants that `from public` does not
-- touch (see migration 40). Nothing server-side accepts invitations.
revoke all on function public.accept_invitation(text) from public;
revoke execute on function public.accept_invitation(text) from anon, service_role;
grant execute on function public.accept_invitation(text) to authenticated;

comment on function public.accept_invitation(text) is
  'Migration 41: accepts an invitation by its token for the account whose address it was '
  'sent to — any other account is refused before anything is written. The role comes from '
  'the invitation. Writes last_workplace_id and nothing else on the profile.';
