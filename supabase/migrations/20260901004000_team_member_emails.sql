-- ─────────────────────────────────────────────────────────────────────────────
-- 40 · Phase 3S-C · a manager can see their team's email addresses
--
-- ── WHY THIS NEEDS A MIGRATION ────────────────────────────────────────────
-- The manager smoke asked for each member's email in the Team area. The
-- existing schema cannot give it to them, and that is deliberate:
--
--   · workplace_members has no email. It carries user_id, pointing at a profile.
--   · public.profiles has exactly ONE read policy, profiles_select_own
--     (migration 04): `using (id = auth.uid())`. Everyone reads their own
--     profile and nobody else's. A manager's JWT therefore cannot select a
--     member's email, directly or through any existing view or function.
--
-- ── WHY NOT A POLICY ──────────────────────────────────────────────────────
-- The obvious alternative — a second SELECT policy on profiles for "managers of
-- a workplace this person belongs to" — was rejected. RLS decides ROWS, not
-- columns, and authenticated holds SELECT on the whole table. A policy would
-- hand the manager the entire profile, including last_workplace_id: which OTHER
-- workplace that person last worked in. That is cross-workplace information,
-- exactly what this change must not expose.
--
-- ── WHY NOT THE INVITATION EMAIL ──────────────────────────────────────────
-- Managers can already read invitations.email, and the Team screen shows it for
-- PENDING invites — correctly, because until someone joins it is the only
-- address there is. It is the wrong answer for a MEMBER: accept_invitation()
-- binds a seat to whoever holds the token without checking the address, people
-- who joined with the workplace code have no invitation at all, and the
-- founding manager has none either. Showing the invited address as "the
-- member's email" would sometimes show an address that is not theirs.
--
-- ── THE SHAPE ─────────────────────────────────────────────────────────────
-- One SECURITY DEFINER read function, on the pattern pending_join_requests()
-- (migration 20) already established for exactly this situation — a manager
-- needing one field of a profile they may not select:
--
--   · refused unless the caller is an ACTIVE manager of that workplace.
--     app.is_manager() tests status = 'active' and role = 'manager', so a
--     suspended manager, an employee and a peer are all refused. It raises
--     rather than returning nothing, because "no emails" and "you may not look"
--     are different answers.
--   · returns (member_id, email) and NOTHING else from the profile.
--   · only for members of THAT workplace — the join is scoped by workplace_id,
--     so no person from any other workplace can appear.
--   · members with no account (a roster placeholder) have no profile, and a
--     profile with no email (migration 39's collision fallback) returns no row;
--     the client shows nothing rather than inventing an address.
--
-- ── WHAT DOES NOT CHANGE ──────────────────────────────────────────────────
--   · profiles_select_own is untouched; nobody can select anyone else's profile.
--   · migration 39's identity guard is untouched; profiles.email is still not
--     editable by anyone, manager included. This function only reads.
--   · no table, column, grant on a table, or policy is added.
--
-- ── TWO HARDENINGS FROM ITS PRE-PUSH SECURITY AUDIT ─────────────────────────
--   1 · EXECUTE IS REVOKED FROM anon EXPLICITLY. `revoke … from public` is not
--       enough on Supabase: the platform's default privileges grant EXECUTE on
--       every new function in `public` straight to anon, authenticated and
--       service_role, and revoking PUBLIC does not touch a grant made to anon by
--       name. Proven on the hosted project against pending_join_requests() and
--       manager_dashboard(), which use the same revoke/grant pair: an anon call
--       gets the function's own "only a manager" error rather than "permission
--       denied", i.e. it reached the body. The internal app.is_manager() check
--       still refused it and nothing leaked, but the only thing standing between
--       an unauthenticated caller and this function would have been its body.
--       Now anon is stopped at the privilege layer before the body runs.
--   2 · THE CAST IS SCHEMA-QUALIFIED: `::pg_catalog.text`. With
--       `search_path = ''`, PostgreSQL still searches the session's pg_temp
--       schema FIRST for type names, and authenticated holds TEMPORARY. A
--       `pg_temp.text` type was shown to capture an unqualified `::text` inside a
--       search_path='' SECURITY DEFINER function. Every other name here was
--       already qualified; functions and operators are never looked up in
--       pg_temp. Not reachable through PostgREST, which cannot run CREATE TYPE,
--       but a definer function should not depend on who can reach it.
--
-- Both patterns exist in migrations 1–39 as well. Those are historical and are
-- left as they are; this function simply does not repeat them.
--
-- Migrations 1–39 are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.team_member_emails(p_workplace_id uuid)
returns table (
  member_id uuid,
  email     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may read its team''s email addresses'
      using errcode = '42501';
  end if;

  return query
  select m.id, pr.email::pg_catalog.text
  from public.workplace_members m
  join public.profiles pr on pr.id = m.user_id
  where m.workplace_id = p_workplace_id
    and pr.email is not null;
end;
$$;

revoke all on function public.team_member_emails(uuid) from public;
-- Explicit, because Supabase's default privileges grant anon EXECUTE on every new
-- public function by name, and revoking PUBLIC does not remove that. See header.
revoke execute on function public.team_member_emails(uuid) from anon;
grant execute on function public.team_member_emails(uuid) to authenticated;

comment on function public.team_member_emails(uuid) is
  'Migration 40: manager-only. The email address of each member of one workplace who has '
  'an account, and nothing else from their profile. Refused for anyone who is not an active '
  'manager of that workplace. Read-only: profiles.email stays uneditable (migration 39).';
