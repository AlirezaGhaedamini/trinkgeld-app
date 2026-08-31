-- ═════════════════════════════════════════════════════════════════════════════
-- 03 · workplaces and workplace_members
--
-- The tenant, and the join that decides permission. Tables and the triggers
-- that do not need the RLS helpers; the guard triggers and every policy land
-- in migration 04, because they call app.is_manager().
-- ═════════════════════════════════════════════════════════════════════════════

create table public.workplaces (
  id                              uuid primary key default gen_random_uuid(),
  name                            text not null check (length(btrim(name)) > 0),
  city                            text,
  country_code                    char(2) not null default 'DE',

  -- IANA name. The check rejects a bogus zone at write time rather than
  -- letting every later business-day calculation fail.
  timezone                        text not null default 'Europe/Berlin'
                                    check (now() at time zone timezone is not null),
  currency                        char(3) not null default 'EUR',

  -- A shift starting before this local hour counts toward the previous
  -- business day, so a 01:00 start on Sunday belongs to Saturday night.
  business_day_start_hour         smallint not null default 5
                                    check (business_day_start_hour between 0 and 12),

  -- MVP visibility defaults: staff see their own money and nothing else.
  peer_entry_visibility           public.peer_visibility not null default 'none',
  pool_amount_visible_to_members  boolean not null default false,

  join_code                       text check (join_code is null or length(join_code) between 4 and 12),
  join_code_enabled               boolean not null default true,
  retention_years                 smallint not null default 7 check (retention_years between 1 and 30),

  created_by                      uuid references public.profiles (id) on delete set null,
  archived_at                     timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

comment on column public.workplaces.pool_amount_visible_to_members is
  'When false (the default) employees cannot reach the pool total through any relation.';
comment on column public.workplaces.peer_entry_visibility is
  'none = own entry only. area / workplace widen it. Enforced in the entries policy.';

create unique index workplaces_join_code_key
  on public.workplaces (upper(join_code))
  where join_code is not null and archived_at is null;

create index workplaces_active_idx on public.workplaces (id) where archived_at is null;

create trigger workplaces_touch_updated_at
  before update on public.workplaces
  for each row execute function app.touch_updated_at();

alter table public.profiles
  add constraint profiles_last_workplace_id_fkey
  foreign key (last_workplace_id) references public.workplaces (id) on delete set null;

-- ── membership ──────────────────────────────────────────────────────────────
create table public.workplace_members (
  id                uuid primary key default gen_random_uuid(),
  workplace_id      uuid not null references public.workplaces (id) on delete cascade,

  -- Nullable on purpose: a manager can put someone on the roster before they
  -- have an account. Accepting an invitation fills this in.
  user_id           uuid references public.profiles (id) on delete set null,

  display_name      text not null check (length(btrim(display_name)) > 0),
  role              public.member_role not null default 'employee',

  -- Default area and role. A shift may override both; see migration 08.
  area_id           uuid,
  workplace_role_id uuid,

  multiplier        numeric(4,2) not null default 1.00
                      check (multiplier >= 0.50 and multiplier <= 2.00),
  status            public.member_status not null default 'invited',
  employee_number   text,
  joined_at         timestamptz,
  left_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.workplace_members.user_id is
  'Null for a roster placeholder who has not signed up yet.';

-- One membership per person per workplace; unlimited placeholders.
create unique index workplace_members_user_key
  on public.workplace_members (workplace_id, user_id)
  where user_id is not null;

-- The hot path: every RLS check resolves a membership from auth.uid().
create index workplace_members_lookup_idx
  on public.workplace_members (user_id, workplace_id)
  where user_id is not null;

create index workplace_members_workplace_idx
  on public.workplace_members (workplace_id, status);

create index workplace_members_area_idx
  on public.workplace_members (workplace_id, area_id)
  where area_id is not null;

create trigger workplace_members_touch_updated_at
  before update on public.workplace_members
  for each row execute function app.touch_updated_at();

alter table public.workplaces enable row level security;
alter table public.workplace_members enable row level security;

revoke all on public.workplaces from public, anon;
revoke all on public.workplace_members from public, anon;
grant select, update on public.workplaces to authenticated;
grant select, insert, update on public.workplace_members to authenticated;
