-- ═════════════════════════════════════════════════════════════════════════════
-- 01 · Extensions, the `app` schema, and every enumerated type.
--
-- Nothing here depends on anything else, and everything later depends on this.
-- ═════════════════════════════════════════════════════════════════════════════

-- Supabase already provides the `extensions` schema; the guard keeps these
-- migrations runnable against a plain Postgres instance too.
create schema if not exists extensions;
grant usage on schema extensions to authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;   -- digest() for invitation tokens
create extension if not exists citext with schema extensions;     -- case-insensitive email
create extension if not exists btree_gist with schema extensions; -- uuid + range exclusion constraint

-- Private schema for the security helpers the RLS policies call. Kept out of
-- `public` so PostgREST never exposes them as RPCs.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ── who a person is inside one workplace ────────────────────────────────────
create type public.member_role as enum ('manager', 'employee');
create type public.member_status as enum ('invited', 'active', 'suspended', 'left');

-- ── how much of each other's money staff can see ────────────────────────────
create type public.peer_visibility as enum ('none', 'area', 'workplace');

-- ── working time ────────────────────────────────────────────────────────────
create type public.shift_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.shift_source as enum ('employee', 'manager', 'import');

-- Whether an entry's area came from the shift override or the member default.
create type public.area_source as enum ('shift', 'member');

-- ── money in ────────────────────────────────────────────────────────────────
create type public.pool_period as enum ('shift', 'day', 'week', 'custom');
create type public.pool_status as enum ('open', 'locked', 'distributed', 'void');

-- ── the rules ───────────────────────────────────────────────────────────────
create type public.rule_status as enum ('draft', 'active', 'superseded');
create type public.rule_method as enum ('hours_points', 'hours', 'equal');
create type public.overlap_basis as enum ('longest_shift', 'pairwise', 'service_window');

-- Optional, neutral metadata. No logic depends on this value.
create type public.rule_adopted_by as enum ('employer', 'staff_agreement', 'works_council');

-- ── money out ───────────────────────────────────────────────────────────────
-- Extensible on purpose: `pending_approval` is one ALTER TYPE away.
create type public.distribution_status as enum ('draft', 'sent', 'confirmed', 'cancelled');
create type public.entry_ack_status as enum ('pending', 'acknowledged', 'queried');

-- ── joining a workplace ─────────────────────────────────────────────────────
create type public.invitation_kind as enum ('invite', 'join_request');
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'revoked', 'expired');

-- ── shared trigger: keep updated_at honest ──────────────────────────────────
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
