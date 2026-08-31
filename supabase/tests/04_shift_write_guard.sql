-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 14: the columns of a shift an employee may not write.
--
-- RLS decides which ROWS. These assertions are about which COLUMNS, which is
-- the part row-level security cannot express — and the part that decides how
-- much money a shift is worth.
-- ─────────────────────────────────────────────────────────────────────────────

select id as wp_a from public.workplaces where name = 'Café Alto' \gset
select id as m_lena from public.workplace_members
  where workplace_id = :'wp_a' and display_name = 'Lena Mertens' \gset
select id as m_daan from public.workplace_members
  where workplace_id = :'wp_a' and display_name = 'Daan Visser' \gset
select id as a_service from public.workplace_areas
  where workplace_id = :'wp_a' and key = 'service' \gset

-- Two roles in the same area with different weights: the escalation this guard
-- exists to stop is picking the better-paid one for your own shift.
select id as r_server from public.workplace_roles
  where workplace_id = :'wp_a' and area_id = :'a_service' order by points asc limit 1 \gset
select id as r_senior from public.workplace_roles
  where workplace_id = :'wp_a' and area_id = :'a_service' order by points desc limit 1 \gset

select tests.ok(
  (select points from public.workplace_roles where id = :'r_senior')
  > (select points from public.workplace_roles where id = :'r_server'),
  'G0  the fixture has two service roles with different weights');

-- A fresh shift Lena has only submitted, so the row policy lets her write it
-- and the COLUMN guard is what is actually under test. Reusing an approved
-- shift would prove nothing: RLS would refuse it first, silently.
begin; select tests.as_user('a0000000-0000-0000-0000-000000000002');  -- Lena
  insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status)
  values (:'wp_a', :'m_lena', '2026-09-10 18:00+02', '2026-09-10 23:00+02', 0, 'submitted')
  returning id as s_lena \gset
commit;

select tests.ok(
  (select status from public.shifts where id = :'s_lena') = 'submitted',
  'G0b the shift under test is submitted, so the row policy allows writing it');

begin; select tests.as_user('a0000000-0000-0000-0000-000000000002');  -- Lena

select tests.denied(
  format($q$update public.shifts set workplace_role_id = %L where id = %L$q$, :'r_senior', :'s_lena'),
  'G1  an employee cannot give their own shift a better-paid role');

select tests.denied(
  format($q$update public.shifts set reviewed_by = %L, reviewed_at = now() where id = %L$q$,
         :'m_lena', :'s_lena'),
  'G2  an employee cannot write the review details on their own shift');

select tests.denied(
  format($q$update public.shifts set review_note = 'looks fine to me' where id = %L$q$, :'s_lena'),
  'G3  …nor the review note');

select tests.denied(
  format($q$update public.shifts set locked = true where id = %L$q$, :'s_lena'),
  'G4  an employee cannot lock their own shift');

select tests.denied(
  format($q$update public.shifts set source = 'manager' where id = %L$q$, :'s_lena'),
  'G5  an employee cannot claim their shift came from a manager');

select tests.denied(
  format($q$update public.shifts set member_id = %L where id = %L$q$, :'m_daan', :'s_lena'),
  'G6  an employee cannot hand their shift to someone else');

-- The same columns on INSERT, which the row policy alone left open.
select tests.denied(
  format($q$insert into public.shifts
           (workplace_id, member_id, starts_at, ends_at, status, workplace_role_id)
           values (%L, %L, '2026-08-25 18:00+02', '2026-08-25 23:00+02', 'submitted', %L)$q$,
         :'wp_a', :'m_lena', :'r_senior'),
  'G7  an employee cannot name a role when creating a shift');

select tests.denied(
  format($q$insert into public.shifts
           (workplace_id, member_id, starts_at, ends_at, status, reviewed_by, reviewed_at)
           values (%L, %L, '2026-08-26 18:00+02', '2026-08-26 23:00+02', 'submitted', %L, now())$q$,
         :'wp_a', :'m_lena', :'m_daan'),
  'G8  …nor arrive pre-reviewed');

select tests.denied(
  format($q$insert into public.shifts
           (workplace_id, member_id, starts_at, ends_at, status, locked)
           values (%L, %L, '2026-08-27 18:00+02', '2026-08-27 23:00+02', 'submitted', true)$q$,
         :'wp_a', :'m_lena'),
  'G9  …nor arrive locked');

select tests.denied(
  format($q$insert into public.shifts
           (workplace_id, member_id, starts_at, ends_at, status, source)
           values (%L, %L, '2026-08-28 18:00+02', '2026-08-28 23:00+02', 'submitted', 'import')$q$,
         :'wp_a', :'m_lena'),
  'G10 …nor claim to be an import');

-- What an employee IS allowed to do must still work.
insert into public.shifts (workplace_id, member_id, starts_at, ends_at, break_minutes, status, area_id)
values (:'wp_a', :'m_lena', '2026-09-12 18:00+02', '2026-09-13 02:00+02', 30, 'submitted', :'a_service');

select tests.ok(
  (select worked_minutes from public.shifts
   where member_id = :'m_lena' and work_date = date '2026-09-12') = 450,
  'G11 an employee can still submit an overnight shift, break deducted (450 min)');

select tests.ok(
  (select work_date from public.shifts
   where member_id = :'m_lena' and starts_at = '2026-09-12 18:00+02') = date '2026-09-12',
  'G12 …and it lands on the right business day');

commit;

-- ── a manager, on the same columns ──────────────────────────────────────────
begin; select tests.as_user('a0000000-0000-0000-0000-000000000001');  -- Daan, manager

update public.shifts
set workplace_role_id = :'r_senior', reviewed_by = :'m_daan', reviewed_at = now(),
    review_note = 'checked against the till roll', status = 'approved', locked = true
where id = :'s_lena';

select tests.ok(
  (select status = 'approved' and locked and reviewed_by = :'m_daan'
   from public.shifts where id = :'s_lena'),
  'G13 a manager can review, approve, weight and lock the same shift');

commit;

-- ── and the guard is not a workplace-blind rule ─────────────────────────────
begin; select tests.as_user('c0000000-0000-0000-0000-000000000001');  -- Marco: manager in B, staff in A
-- changes_nothing, not denied: RLS filters rather than raising, so the correct
-- outcome here is a statement that touches no rows at all.
select tests.changes_nothing(
  format($q$update public.shifts set status = 'submitted', review_note = 'mine now' where id = %L$q$,
         :'s_lena'),
  'G14 being a manager somewhere else grants nothing here');
commit;

-- ── the audit trail Phase 2 already keeps ───────────────────────────────────
select tests.ok(
  (select count(*) from public.audit_log
   where table_name = 'shifts' and record_id = :'s_lena' and action = 'update') >= 1,
  'G15 the manager correction is in the audit log, with before and after');
