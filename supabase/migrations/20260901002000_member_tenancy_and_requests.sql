-- ═════════════════════════════════════════════════════════════════════════════
-- 20 · membership tenancy, role/area coherence, and readable join requests
-- ═════════════════════════════════════════════════════════════════════════════
-- Found while auditing the Phase 3G member editor.
--
-- 1 · workplace_members.area_id and .workplace_role_id carry plain foreign keys
--     to workplace_areas and workplace_roles. The keys prove the row exists;
--     nothing proved it belonged to THIS workplace. A manager of A could set a
--     member's default area to an area of B. The engine resolves
--     `coalesce(shift.area_id, member.area_id)` and then joins that id to
--     workplace_areas inside a SECURITY DEFINER function, so a foreign area's
--     NAME would reach inputs_snapshot — and the person would silently earn
--     nothing, because a foreign area never matches a rule share.
--
-- 2 · Nothing required the default role to belong to the default area. The
--     engine already treats that pairing as meaningless — tmp_shift_rows only
--     uses the member's role when the shift's effective area equals the
--     member's own area, and otherwise falls back to the first role of the
--     effective area — so an incoherent default is a silent no-op that looks
--     like a setting. Refusing it is the honest behaviour, and it is what makes
--     "change the area, then pick a role in it" a real flow rather than a form
--     that saves something inert.
--
--     A NULL role stays legal: "no default role" is a real answer, and the
--     engine's fallback covers it.
--
-- 3 · app.guard_member_changes() lists the columns only a manager may move:
--     role, status, multiplier, area_id, workplace_role_id, employee_number.
--     joined_at and left_at were not on that list, so a member could stamp
--     their own. They are roster facts, not self-service ones.
--
-- 4 · A join request stores `requested_by`, and profiles_select_own means a
--     manager cannot read that person's profile at all. So the manager-side
--     list of pending requests had no way to show who was asking.
--     public.pending_join_requests() answers exactly that question, for exactly
--     the workplaces the caller manages, returning the requester's NAME and
--     nothing else — no email, no profile row, no widening of RLS.
--
-- Nothing here changes a policy or an already-applied migration.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.guard_member_tenancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area_workplace uuid;
  v_role_workplace uuid;
  v_role_area      uuid;
begin
  if new.area_id is not null then
    select a.workplace_id into v_area_workplace
    from public.workplace_areas a where a.id = new.area_id;
    if v_area_workplace is distinct from new.workplace_id then
      raise exception 'that area belongs to a different workplace' using errcode = '42501';
    end if;
  end if;

  if new.workplace_role_id is not null then
    select r.workplace_id, r.area_id into v_role_workplace, v_role_area
    from public.workplace_roles r where r.id = new.workplace_role_id;
    if v_role_workplace is distinct from new.workplace_id then
      raise exception 'that role belongs to a different workplace' using errcode = '42501';
    end if;
    -- Coherence. Null area with a role set would give the engine a role it can
    -- never reach, so that is refused on the same terms.
    if new.area_id is distinct from v_role_area then
      raise exception 'that role belongs to another area; pick a role from this member''s area'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Roster dates are the manager's to set, like every other roster fact.
--
-- SECURITY INVOKER on purpose, and for the same reason app.guard_member_changes()
-- is: accept_invitation() and approve_join_request() stamp joined_at while
-- running as the person joining, who is not a manager. Those functions run as
-- the table's owner, so app.is_trusted_context() lets them through — which only
-- works while current_user is the caller's, not the definer's.
create or replace function app.guard_member_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if new.joined_at is distinct from old.joined_at
     or new.left_at is distinct from old.left_at then
    if not app.is_manager(new.workplace_id) then
      raise exception 'only a manager of this workplace may change membership dates'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger workplace_members_dates
  before update on public.workplace_members
  for each row execute function app.guard_member_dates();

-- Runs after workplace_members_guard (permission) and
-- workplace_members_live_refs (archived), so the manager is told the most
-- specific true thing: not allowed, then archived, then wrong workplace or
-- wrong area.
create trigger workplace_members_tenancy
  before insert or update on public.workplace_members
  for each row execute function app.guard_member_tenancy();

comment on function app.guard_member_tenancy() is
  'Migration 20: a membership''s default area and role belong to its own workplace, and the role belongs to that area.';

-- ── who is asking to join ───────────────────────────────────────────────────
-- SECURITY DEFINER because profiles are readable only by their owner, and a
-- manager deciding who may see the workplace's money needs a name to decide on.
-- The boundary is the WHERE clause: pending join requests, for a workplace the
-- caller actually manages, and a fixed column list that carries no email and no
-- other profile field.
create or replace function public.pending_join_requests(p_workplace_id uuid)
returns table (
  invitation_id    uuid,
  requested_at     timestamptz,
  requester_name   text,
  proposed_area_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Raise rather than return nothing: an empty list and "you may not look" are
  -- different answers, and the caller deserves the true one.
  if not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may read its join requests'
      using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.created_at,
    coalesce(nullif(pg_catalog.btrim(coalesce(pr.full_name, '')), ''), 'Someone'),
    i.proposed_area_id
  from public.invitations i
  left join public.profiles pr on pr.id = i.requested_by
  where i.workplace_id = p_workplace_id
    and i.kind = 'join_request'
    and i.status = 'pending'
  order by i.created_at;
end;
$$;

revoke all on function app.guard_member_tenancy(), app.guard_member_dates() from public;
revoke all on function public.pending_join_requests(uuid) from public;
grant execute on function public.pending_join_requests(uuid) to authenticated;

comment on function public.pending_join_requests(uuid) is
  'Manager-only: the pending join requests of one workplace, with the requester''s name and nothing else.';
