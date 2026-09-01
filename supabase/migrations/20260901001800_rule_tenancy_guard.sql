-- ═════════════════════════════════════════════════════════════════════════════
-- 18 · a rule's areas, roles and rounding area must belong to its own workplace
-- ═════════════════════════════════════════════════════════════════════════════
-- Found while auditing the Phase 3E rules editor.
--
-- The policies on distribution_rule_areas and distribution_rule_roles authorise
-- on the row's OWN workplace_id column:
--
--     using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id))
--
-- That column is supplied by the client. Nothing checked it against the parent
-- rule, and nothing checked that area_id / workplace_role_id belonged to that
-- workplace either. Two consequences, neither of them theoretical:
--
--  1 · A manager of workplace A could insert a share row carrying
--      workplace_id = A and rule_id = <a draft rule of workplace B>. WITH CHECK
--      passes (they really are a manager of A) and the immutability guard
--      passes (B's rule really is a draft), so a stranger's draft gains a share
--      row. Reaching it needs B's rule id, which RLS does not hand out — but
--      authorisation must not rest on an id being hard to guess.
--
--  2 · A manager could point their own rule's area_id at another workplace's
--      area. The share then belongs to an area nobody here can ever work in,
--      so — since migration 16 refuses a distribution when an area with a share
--      has no eligible staff — the workplace could permanently block its own
--      distributions. Worse, that refusal names the area, and it builds the
--      name inside a SECURITY DEFINER function: the message would read back a
--      foreign workplace's area name.
--
-- rounding_area_id on distribution_rules had the same gap. It only breaks a
-- rounding tie, but a foreign id there is still a foreign id.
--
-- The fix is three guards that compare ids and nothing else. They are SECURITY
-- DEFINER because they must read the parent rule and the target area/role
-- whether or not the caller can see them — a manager of A cannot SELECT B's
-- rule row, so an INVOKER guard would report "not found" for a row that exists.
-- They make no decision from current_user, so unlike app.guard_rule_immutable()
-- (which asks app.is_trusted_context() and must therefore stay INVOKER) definer
-- rights cannot weaken them. They are not skipped for a trusted context either:
-- tenancy is an invariant, not a permission.
--
-- Nothing else changes. No policy, no RPC, no engine behaviour, and no already
-- applied migration.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the rule's own rounding area ────────────────────────────────────────────
create or replace function app.guard_rule_rounding_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area_workplace uuid;
begin
  if new.rounding_area_id is null then
    return new;
  end if;
  select a.workplace_id into v_area_workplace
  from public.workplace_areas a where a.id = new.rounding_area_id;
  if v_area_workplace is distinct from new.workplace_id then
    raise exception 'the rounding area must be an area of this workplace'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger rules_rounding_area_tenancy
  before insert or update on public.distribution_rules
  for each row execute function app.guard_rule_rounding_area();

-- ── area shares ─────────────────────────────────────────────────────────────
create or replace function app.guard_rule_area_tenancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_workplace uuid;
  v_area_workplace uuid;
begin
  select r.workplace_id into v_rule_workplace
  from public.distribution_rules r where r.id = new.rule_id;
  if v_rule_workplace is null then
    raise exception 'that rule does not exist' using errcode = '23503';
  end if;
  if new.workplace_id is distinct from v_rule_workplace then
    raise exception 'a rule share must carry the workplace of its own rule'
      using errcode = '42501';
  end if;

  select a.workplace_id into v_area_workplace
  from public.workplace_areas a where a.id = new.area_id;
  if v_area_workplace is distinct from v_rule_workplace then
    raise exception 'that area belongs to a different workplace'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger rule_areas_tenancy
  before insert or update on public.distribution_rule_areas
  for each row execute function app.guard_rule_area_tenancy();

-- ── role points ─────────────────────────────────────────────────────────────
create or replace function app.guard_rule_role_tenancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_workplace uuid;
  v_role_workplace uuid;
begin
  select r.workplace_id into v_rule_workplace
  from public.distribution_rules r where r.id = new.rule_id;
  if v_rule_workplace is null then
    raise exception 'that rule does not exist' using errcode = '23503';
  end if;
  if new.workplace_id is distinct from v_rule_workplace then
    raise exception 'a rule role must carry the workplace of its own rule'
      using errcode = '42501';
  end if;

  select r.workplace_id into v_role_workplace
  from public.workplace_roles r where r.id = new.workplace_role_id;
  if v_role_workplace is distinct from v_rule_workplace then
    raise exception 'that role belongs to a different workplace'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger rule_roles_tenancy
  before insert or update on public.distribution_rule_roles
  for each row execute function app.guard_rule_role_tenancy();

comment on function app.guard_rule_rounding_area() is
  'Migration 18: a rule may only round into an area of its own workplace.';
comment on function app.guard_rule_area_tenancy() is
  'Migration 18: a rule share belongs to its rule''s workplace, and names an area of it.';
comment on function app.guard_rule_role_tenancy() is
  'Migration 18: a rule role belongs to its rule''s workplace, and names a role of it.';
