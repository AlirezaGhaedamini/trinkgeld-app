-- ═════════════════════════════════════════════════════════════════════════════
-- 04 · RLS helper functions, membership guards, and the first policies.
--
-- This migration exists separately from 03 on purpose. A policy on
-- workplace_members that queries workplace_members recurses infinitely at query
-- time — not at migration time — which is the single most common way a
-- multi-tenant Supabase schema breaks. The helpers below are SECURITY DEFINER
-- and owned by the table owner, so their lookups bypass RLS and break the cycle.
--
-- Every helper is:
--   * SECURITY DEFINER   — to bypass RLS on the membership lookup
--   * STABLE             — so Postgres evaluates it once per statement, not per row
--   * SET search_path='' — so no schema can be shadowed; all names are qualified
--   * EXECUTE revoked from PUBLIC, granted only to authenticated + service_role
-- ═════════════════════════════════════════════════════════════════════════════

-- Am I running as the owner of the application tables? True inside our own
-- SECURITY DEFINER functions, false for anything a client sends directly.
-- Used by the guard triggers to let trusted RPCs through without giving
-- clients a flag they could set themselves.
create or replace function app.is_trusted_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.pg_get_userbyid(c.relowner) = current_user
  from pg_catalog.pg_class c
  where c.oid = 'public.workplace_members'::pg_catalog.regclass
$$;

-- The caller's active membership id for one workplace, or null.
create or replace function app.member_id(p_workplace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.workplace_members m
  where m.workplace_id = p_workplace_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;

create or replace function app.is_member(p_workplace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workplace_members m
    where m.workplace_id = p_workplace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function app.is_manager(p_workplace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workplace_members m
    where m.workplace_id = p_workplace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'manager'
  )
$$;

-- Every workplace the caller belongs to. Handy for list queries and for
-- policies on tables that are not scoped by a single workplace argument.
create or replace function app.member_workplaces()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workplace_id
  from public.workplace_members m
  where m.user_id = auth.uid()
    and m.status = 'active'
$$;

revoke all on function
  app.is_trusted_context(),
  app.member_id(uuid),
  app.is_member(uuid),
  app.is_manager(uuid),
  app.member_workplaces()
from public;

grant execute on function
  app.is_trusted_context(),
  app.member_id(uuid),
  app.is_member(uuid),
  app.is_manager(uuid),
  app.member_workplaces()
to authenticated, service_role;

-- ═══ guard triggers ═════════════════════════════════════════════════════════

-- An employee may edit nothing on their own membership except their display
-- name. Everything that decides authority is manager-only. This is enforced
-- here as well as in the policy, so loosening a policy by mistake still cannot
-- promote anyone.
-- SECURITY INVOKER on purpose: the guard has to see the *caller's* effective
-- user. As DEFINER, current_user would always be the table owner and
-- app.is_trusted_context() would always be true, disabling the guard.
create or replace function app.guard_member_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;

  if new.workplace_id is distinct from old.workplace_id then
    raise exception 'workplace_id is immutable' using errcode = '42501';
  end if;

  -- Linking an account is never a direct write, not even for a manager.
  if new.user_id is distinct from old.user_id then
    raise exception 'membership can only be linked to an account through an invitation'
      using errcode = '42501';
  end if;

  if (new.role            is distinct from old.role)
  or (new.status          is distinct from old.status)
  or (new.multiplier      is distinct from old.multiplier)
  or (new.area_id         is distinct from old.area_id)
  or (new.workplace_role_id is distinct from old.workplace_role_id)
  or (new.employee_number is distinct from old.employee_number)
  then
    if not app.is_manager(new.workplace_id) then
      raise exception 'only a manager of this workplace may change membership role, status, area or weighting'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger workplace_members_guard
  before update on public.workplace_members
  for each row execute function app.guard_member_changes();

-- A workplace must always have at least one active manager.
create or replace function app.guard_last_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workplace uuid := coalesce(old.workplace_id, new.workplace_id);
  v_managers  integer;
begin
  -- Skip when the whole workplace is going away.
  if not exists (select 1 from public.workplaces w where w.id = v_workplace) then
    return null;
  end if;

  select count(*) into v_managers
  from public.workplace_members m
  where m.workplace_id = v_workplace
    and m.role = 'manager'
    and m.status = 'active';

  if v_managers = 0 then
    raise exception 'a workplace must keep at least one active manager'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger workplace_members_last_manager
  after update or delete on public.workplace_members
  deferrable initially deferred
  for each row execute function app.guard_last_manager();

-- ═══ policies ═══════════════════════════════════════════════════════════════

-- ── profiles: yours and nobody else's. Peer names come from
--    workplace_members, so nothing is lost by keeping this closed.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── workplaces: members read, managers write settings.
create policy workplaces_select_member on public.workplaces
  for select to authenticated
  using (app.is_member(id));

create policy workplaces_update_manager on public.workplaces
  for update to authenticated
  using (app.is_manager(id))
  with check (app.is_manager(id));

-- ── workplace_members: the roster is visible to the team; only managers
--    write, and the guard trigger polices which columns.
create policy members_select_same_workplace on public.workplace_members
  for select to authenticated
  using (app.is_member(workplace_id));

-- A manager creates roster placeholders. Linking a placeholder to a real
-- account only ever happens inside accept_invitation() / approve_join_request(),
-- so a manager cannot attach someone's account to their workplace unilaterally.
create policy members_insert_manager on public.workplace_members
  for insert to authenticated
  with check (app.is_manager(workplace_id) and user_id is null);

create policy members_update_manager_or_self on public.workplace_members
  for update to authenticated
  using (app.is_manager(workplace_id) or user_id = auth.uid())
  with check (app.is_manager(workplace_id) or user_id = auth.uid());
