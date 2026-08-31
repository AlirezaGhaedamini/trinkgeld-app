-- ═════════════════════════════════════════════════════════════════════════════
-- 05 · workplace_areas and workplace_roles
--
-- Per-workplace configuration rather than global enums, so a venue can add
-- "Spa" or rename "Kitchen" to "Küche" without a migration. Neither table is
-- ever hard-deleted once referenced; they are archived.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.workplace_areas (
  id               uuid primary key default gen_random_uuid(),
  workplace_id     uuid not null references public.workplaces (id) on delete cascade,

  -- Stable slug. Survives a rename, and is what the frontend maps to a colour.
  key              text not null check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name             text not null check (length(btrim(name)) > 0),
  sort_order       smallint not null default 0,
  is_pool_eligible boolean not null default true,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index workplace_areas_key on public.workplace_areas (workplace_id, key);
create index workplace_areas_order_idx on public.workplace_areas (workplace_id, sort_order);

create trigger workplace_areas_touch_updated_at
  before update on public.workplace_areas
  for each row execute function app.touch_updated_at();

create table public.workplace_roles (
  id           uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces (id) on delete cascade,
  area_id      uuid not null references public.workplace_areas (id) on delete restrict,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name         text not null check (length(btrim(name)) > 0),

  -- How one hour of this role counts against one hour of another.
  points       numeric(4,2) not null default 1.00 check (points > 0 and points <= 5),
  sort_order   smallint not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index workplace_roles_key on public.workplace_roles (workplace_id, key);
create index workplace_roles_area_idx on public.workplace_roles (workplace_id, area_id, sort_order);

create trigger workplace_roles_touch_updated_at
  before update on public.workplace_roles
  for each row execute function app.touch_updated_at();

-- A role's area must belong to the same workplace as the role.
create or replace function app.guard_role_area_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_area_workplace uuid;
begin
  select a.workplace_id into v_area_workplace
  from public.workplace_areas a
  where a.id = new.area_id;

  if v_area_workplace is distinct from new.workplace_id then
    raise exception 'role area must belong to the same workplace' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workplace_roles_area_consistency
  before insert or update on public.workplace_roles
  for each row execute function app.guard_role_area_consistency();

-- Deferred FKs from membership, now that the targets exist.
alter table public.workplace_members
  add constraint workplace_members_area_id_fkey
    foreign key (area_id) references public.workplace_areas (id) on delete restrict,
  add constraint workplace_members_role_id_fkey
    foreign key (workplace_role_id) references public.workplace_roles (id) on delete restrict;

alter table public.workplace_areas enable row level security;
alter table public.workplace_roles enable row level security;

revoke all on public.workplace_areas from public, anon;
revoke all on public.workplace_roles from public, anon;
grant select, insert, update, delete on public.workplace_areas to authenticated;
grant select, insert, update, delete on public.workplace_roles to authenticated;

-- Members read the configuration they work under; managers change it.
create policy areas_select_member on public.workplace_areas
  for select to authenticated using (app.is_member(workplace_id));
create policy areas_write_manager on public.workplace_areas
  for insert to authenticated with check (app.is_manager(workplace_id));
create policy areas_update_manager on public.workplace_areas
  for update to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));
create policy areas_delete_manager on public.workplace_areas
  for delete to authenticated using (app.is_manager(workplace_id));

create policy roles_select_member on public.workplace_roles
  for select to authenticated using (app.is_member(workplace_id));
create policy roles_write_manager on public.workplace_roles
  for insert to authenticated with check (app.is_manager(workplace_id));
create policy roles_update_manager on public.workplace_roles
  for update to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));
create policy roles_delete_manager on public.workplace_roles
  for delete to authenticated using (app.is_manager(workplace_id));
