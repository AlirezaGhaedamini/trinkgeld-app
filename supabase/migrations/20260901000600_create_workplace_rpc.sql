-- ═════════════════════════════════════════════════════════════════════════════
-- 06 · create_workplace()
--
-- Direct INSERT on public.workplaces is denied to clients — there is no INSERT
-- policy. A workplace can therefore only come into existence through this
-- function, which creates it together with the caller's manager membership and
-- a usable set of areas and roles, in one transaction. There is no window in
-- which a workplace exists without a manager.
--
-- Migration 09 replaces this function with a version that also seeds a draft
-- rule, once distribution_rules exists.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.generate_join_code()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  -- No I, O, 0 or 1: this gets read out over the phone in a loud room.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_try integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.workplaces w
      where upper(w.join_code) = v_code and w.archived_at is null
    );

    v_try := v_try + 1;
    if v_try > 20 then
      raise exception 'could not allocate a unique join code';
    end if;
  end loop;
  return v_code;
end;
$$;

revoke all on function app.generate_join_code() from public;

-- The default configuration a new venue starts with. Managers rename, reorder,
-- archive and add to these; nothing here is hard-coded anywhere else.
create or replace function app.seed_workplace_defaults(p_workplace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area record;
  v_area_id uuid;
begin
  for v_area in
    select * from (values
      ('service',    'Service',    10, true),
      ('bar',        'Bar',        20, true),
      ('kitchen',    'Kitchen',    30, true),
      ('runner',     'Runner',     40, true),
      ('reception',  'Reception',  50, true),
      ('management', 'Management', 60, false)
    ) as t(key, name, sort_order, poolable)
  loop
    insert into public.workplace_areas (workplace_id, key, name, sort_order, is_pool_eligible)
    values (p_workplace_id, v_area.key, v_area.name, v_area.sort_order, v_area.poolable)
    returning id into v_area_id;

    insert into public.workplace_roles (workplace_id, area_id, key, name, points, sort_order)
    select p_workplace_id, v_area_id, r.key, r.name, r.points, r.sort_order
    from (values
      ('service',    'senior_server', 'Senior server', 1.20, 10),
      ('service',    'server',        'Server',        1.00, 20),
      ('service',    'trainee',       'Trainee',       0.50, 30),
      ('bar',        'bartender',     'Bartender',     1.00, 10),
      ('bar',        'barback',       'Barback',       0.70, 20),
      ('kitchen',    'head_chef',     'Head chef',     1.20, 10),
      ('kitchen',    'cook',          'Cook',          1.00, 20),
      ('kitchen',    'dishwash',      'Dishwash',      0.80, 30),
      ('runner',     'runner',        'Runner',        1.00, 10),
      ('reception',  'host',          'Host',          0.90, 10),
      ('management', 'manager',       'Manager',       1.00, 10)
    ) as r(area_key, key, name, points, sort_order)
    where r.area_key = v_area.key;
  end loop;
end;
$$;

revoke all on function app.seed_workplace_defaults(uuid) from public;

-- ── the public entry point ──────────────────────────────────────────────────
create or replace function public.create_workplace(
  p_name         text,
  p_city         text default null,
  p_timezone     text default 'Europe/Berlin',
  p_country_code char(2) default 'DE',
  p_currency     char(3) default 'EUR',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_workplace uuid;
  v_mgmt_area uuid;
  v_mgmt_role uuid;
  v_name      text;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a workplace needs a name' using errcode = '22023';
  end if;

  -- The profile trigger normally created this already; be defensive.
  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;

  insert into public.workplaces (name, city, timezone, country_code, currency, join_code, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_city, '')), ''), p_timezone,
          upper(p_country_code), upper(p_currency), app.generate_join_code(), v_user)
  returning id into v_workplace;

  perform app.seed_workplace_defaults(v_workplace);

  select a.id into v_mgmt_area
  from public.workplace_areas a
  where a.workplace_id = v_workplace and a.key = 'management';

  select r.id into v_mgmt_role
  from public.workplace_roles r
  where r.workplace_id = v_workplace and r.key = 'manager';

  select coalesce(nullif(btrim(coalesce(p_display_name, '')), ''),
                  nullif(btrim(coalesce(pr.full_name, '')), ''),
                  split_part(coalesce(pr.email::text, 'manager'), '@', 1))
  into v_name
  from public.profiles pr
  where pr.id = v_user;

  insert into public.workplace_members
    (workplace_id, user_id, display_name, role, area_id, workplace_role_id, status, joined_at)
  values
    (v_workplace, v_user, coalesce(v_name, 'Manager'), 'manager', v_mgmt_area, v_mgmt_role, 'active', now());

  update public.profiles set last_workplace_id = v_workplace where id = v_user;

  return v_workplace;
end;
$$;

revoke all on function public.create_workplace(text, text, text, char, char, text) from public;
grant execute on function public.create_workplace(text, text, text, char, char, text) to authenticated;
