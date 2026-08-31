-- ═════════════════════════════════════════════════════════════════════════════
-- 02 · profiles
--
-- One row per human, keyed to auth.users. Holds identity that is true
-- regardless of workplace, and no permission of any kind — permission is a
-- property of a membership, not of a person.
--
-- Policies for this table are created in migration 04, after the RLS helper
-- functions exist.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  email             extensions.citext,
  avatar_url        text,
  locale            text not null default 'de' check (locale in ('de', 'en')),
  last_workplace_id uuid,  -- FK added in migration 03, once workplaces exists
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. Contains no role and no permission.';

create unique index profiles_email_key on public.profiles (email) where email is not null;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ── profile creation ────────────────────────────────────────────────────────
-- Runs as the definer so a brand-new user, who owns no rows yet and passes no
-- policy, still gets a profile. Nothing from the auth record is copied except
-- the email and any display name the client supplied at sign-up; no password
-- material is ever touched.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    nullif(new.email, '')::extensions.citext,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

alter table public.profiles enable row level security;

revoke all on public.profiles from public, anon;
grant select, update on public.profiles to authenticated;
