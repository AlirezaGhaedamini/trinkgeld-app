-- ═════════════════════════════════════════════════════════════════════════════
-- 07 · invitations
--
-- One table, two directions:
--   invite       — a manager invites a named person by email
--   join_request — someone with the workplace's join code asks to be let in
--
-- Both end in a manager's decision and a membership whose user_id gets filled
-- in. Clients cannot INSERT here: the token must be minted server-side and only
-- its hash is ever stored, so every path goes through an RPC.
--
-- Email delivery is deliberately out of scope. create_invitation() returns the
-- raw token exactly once; the application decides how it reaches the person.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.invitations (
  id                uuid primary key default gen_random_uuid(),
  workplace_id      uuid not null references public.workplaces (id) on delete cascade,
  kind              public.invitation_kind not null default 'invite',
  member_id         uuid references public.workplace_members (id) on delete set null,
  email             extensions.citext,
  token_hash        text,
  proposed_role     public.member_role not null default 'employee',
  proposed_area_id  uuid references public.workplace_areas (id) on delete set null,
  requested_by      uuid references public.profiles (id) on delete set null,
  invited_by        uuid references public.workplace_members (id) on delete set null,
  status            public.invitation_status not null default 'pending',
  expires_at        timestamptz not null default now() + interval '14 days',
  accepted_by       uuid references public.profiles (id) on delete set null,
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),

  constraint invitations_invite_needs_email
    check (kind <> 'invite' or email is not null),
  constraint invitations_request_is_employee
    check (kind <> 'join_request' or proposed_role = 'employee')
);

comment on column public.invitations.token_hash is
  'SHA-256 of the invitation token. The raw token is returned once and never stored.';

create unique index invitations_token_key on public.invitations (token_hash)
  where token_hash is not null;
create unique index invitations_pending_email_key on public.invitations (workplace_id, email)
  where status = 'pending' and kind = 'invite';
create unique index invitations_pending_request_key on public.invitations (workplace_id, requested_by)
  where status = 'pending' and kind = 'join_request';
create index invitations_workplace_idx on public.invitations (workplace_id, status);
create index invitations_email_idx on public.invitations (email) where status = 'pending';

alter table public.invitations enable row level security;
revoke all on public.invitations from public, anon;
grant select, update, delete on public.invitations to authenticated;
-- No INSERT grant: creation goes through create_invitation() / request_join().

create policy invitations_select on public.invitations
  for select to authenticated
  using (
    app.is_manager(workplace_id)
    or requested_by = auth.uid()
    or (email is not null and email = (select p.email from public.profiles p where p.id = auth.uid()))
  );

create policy invitations_update_manager on public.invitations
  for update to authenticated
  using (app.is_manager(workplace_id)) with check (app.is_manager(workplace_id));

create policy invitations_delete_manager on public.invitations
  for delete to authenticated using (app.is_manager(workplace_id));

-- ── manager invites a person ────────────────────────────────────────────────
create or replace function public.create_invitation(
  p_workplace_id      uuid,
  p_email             text,
  p_display_name      text,
  p_role              public.member_role default 'employee',
  p_area_id           uuid default null,
  p_workplace_role_id uuid default null
)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid;
  v_member uuid;
  v_token  text;
begin
  v_actor := app.member_id(p_workplace_id);
  if v_actor is null or not app.is_manager(p_workplace_id) then
    raise exception 'only a manager of this workplace may invite' using errcode = '42501';
  end if;

  if p_email is null or length(btrim(p_email)) = 0 then
    raise exception 'an invitation needs an email address' using errcode = '22023';
  end if;

  -- The roster entry can exist before the person does.
  insert into public.workplace_members
    (workplace_id, display_name, role, area_id, workplace_role_id, status)
  values
    (p_workplace_id, coalesce(nullif(btrim(p_display_name), ''), split_part(btrim(p_email), '@', 1)),
     p_role, p_area_id, p_workplace_role_id, 'invited')
  returning id into v_member;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invitations
    (workplace_id, kind, member_id, email, token_hash, proposed_role, proposed_area_id, invited_by)
  values
    (p_workplace_id, 'invite', v_member, btrim(p_email)::extensions.citext,
     encode(extensions.digest(v_token, 'sha256'), 'hex'),
     p_role, p_area_id, v_actor)
  returning id into invitation_id;

  token := v_token;
  return next;
end;
$$;

-- ── someone asks to join with the workplace code ────────────────────────────
create or replace function public.request_join(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_workplace uuid;
  v_id        uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select w.id into v_workplace
  from public.workplaces w
  where upper(w.join_code) = upper(btrim(p_join_code))
    and w.join_code_enabled
    and w.archived_at is null;

  if v_workplace is null then
    -- Deliberately vague: the code is short, so do not confirm which half was wrong.
    raise exception 'that code did not match an open workplace' using errcode = '22023';
  end if;

  if app.is_member(v_workplace) then
    raise exception 'you are already in this workplace' using errcode = '23505';
  end if;

  insert into public.invitations (workplace_id, kind, proposed_role, requested_by, status)
  values (v_workplace, 'join_request', 'employee', v_user, 'pending')
  on conflict (workplace_id, requested_by) where (status = 'pending' and kind = 'join_request')
  do update set created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ── the invitee accepts ─────────────────────────────────────────────────────
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inv  public.invitations%rowtype;
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

-- ── a manager approves a join request ───────────────────────────────────────
create or replace function public.approve_join_request(
  p_invitation_id     uuid,
  p_display_name      text default null,
  p_area_id           uuid default null,
  p_workplace_role_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv    public.invitations%rowtype;
  v_member uuid;
  v_name   text;
begin
  select * into v_inv from public.invitations where id = p_invitation_id for update;

  if v_inv.id is null or v_inv.kind <> 'join_request' then
    raise exception 'join request not found' using errcode = '42501';
  end if;
  if not app.is_manager(v_inv.workplace_id) then
    raise exception 'only a manager of this workplace may approve' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'this request has already been handled' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(coalesce(p_display_name, '')), ''),
                  nullif(btrim(coalesce(pr.full_name, '')), ''),
                  split_part(coalesce(pr.email::text, 'member'), '@', 1))
  into v_name from public.profiles pr where pr.id = v_inv.requested_by;

  insert into public.workplace_members
    (workplace_id, user_id, display_name, role, area_id, workplace_role_id, status, joined_at)
  values
    (v_inv.workplace_id, v_inv.requested_by, coalesce(v_name, 'Member'),
     'employee',                              -- a request can never yield a manager
     coalesce(p_area_id, v_inv.proposed_area_id), p_workplace_role_id, 'active', now())
  returning id into v_member;

  update public.invitations
  set status = 'accepted', accepted_by = v_inv.requested_by, accepted_at = now(), member_id = v_member
  where id = v_inv.id;

  return v_member;
end;
$$;

revoke all on function
  public.create_invitation(uuid, text, text, public.member_role, uuid, uuid),
  public.request_join(text),
  public.accept_invitation(text),
  public.approve_join_request(uuid, text, uuid, uuid)
from public;

grant execute on function
  public.create_invitation(uuid, text, text, public.member_role, uuid, uuid),
  public.request_join(text),
  public.accept_invitation(text),
  public.approve_join_request(uuid, text, uuid, uuid)
to authenticated;
