-- ═════════════════════════════════════════════════════════════════════════════
-- 13 · audit_log
--
-- Append-only. One generic trigger writes before/after row images for the
-- tables where a change has consequences: manager corrections to hours, role
-- and status changes, pool edits, rule activations, distribution lifecycle.
--
-- Nobody can UPDATE or DELETE here — no policy grants it and no privilege is
-- issued. Rows are written by a SECURITY DEFINER trigger, never by a client.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.audit_log (
  id              bigint generated always as identity primary key,
  workplace_id    uuid not null references public.workplaces (id) on delete cascade,
  table_name      text not null,
  record_id       uuid not null,
  action          text not null check (action in ('insert', 'update', 'delete')),
  actor_user_id   uuid,
  actor_member_id uuid,
  before          jsonb,
  after           jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create index audit_log_record_idx
  on public.audit_log (workplace_id, table_name, record_id, created_at desc);
create index audit_log_recent_idx
  on public.audit_log (workplace_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon;
grant select on public.audit_log to authenticated;

-- Managers see their workplace's trail; an employee sees the history of their
-- own shifts, which is how "who changed my hours, and to what" gets answered.
create policy audit_select on public.audit_log
  for select to authenticated
  using (
    app.is_manager(workplace_id)
    or (
      table_name = 'shifts'
      and exists (
        select 1 from public.shifts s
        where s.id = audit_log.record_id
          and s.member_id = app.member_id(audit_log.workplace_id)
      )
    )
  );

create or replace function app.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_wp     uuid;
  v_id     uuid;
begin
  -- Most audited tables carry workplace_id; on `workplaces` itself the id is it.
  v_wp := coalesce(
    v_after  ->> 'workplace_id',
    v_before ->> 'workplace_id',
    case when tg_table_name = 'workplaces'
         then coalesce(v_after ->> 'id', v_before ->> 'id') end
  )::uuid;
  v_id := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  if v_wp is null or v_id is null then
    return coalesce(new, old);
  end if;

  -- Nothing sensitive is stored on the audited tables, but strip anything
  -- credential-shaped defensively so a future column cannot leak in here.
  v_before := v_before - 'token_hash';
  v_after  := v_after  - 'token_hash';

  insert into public.audit_log
    (workplace_id, table_name, record_id, action, actor_user_id, actor_member_id, before, after, reason)
  values
    (v_wp, tg_table_name, v_id, lower(tg_op), auth.uid(), app.member_id(v_wp), v_before, v_after,
     nullif(current_setting('app.audit_reason', true), ''));

  return coalesce(new, old);
end;
$$;

create trigger audit_shifts
  after insert or update or delete on public.shifts
  for each row execute function app.write_audit();

create trigger audit_members
  after insert or update or delete on public.workplace_members
  for each row execute function app.write_audit();

create trigger audit_pools
  after insert or update or delete on public.tip_pools
  for each row execute function app.write_audit();

create trigger audit_rules
  after insert or update or delete on public.distribution_rules
  for each row execute function app.write_audit();

create trigger audit_distributions
  after insert or update or delete on public.tip_distributions
  for each row execute function app.write_audit();

create trigger audit_workplaces
  after update on public.workplaces
  for each row execute function app.write_audit();
