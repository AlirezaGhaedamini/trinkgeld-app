-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 25 · a whitespace-only correction reason is not a reason
--
-- THE DEFECT, precisely. Migration 24 validated the manager's explanation with
-- the ONE-ARGUMENT form of btrim():
--
--     nullif(pg_catalog.btrim(coalesce(p_note, '')), '')
--
-- and the table repeated the same expression in
-- distributions_correction_reason_shape. One-argument btrim() trims a SPACE and
-- nothing else — not a tab, not a newline, not a carriage return, form feed or
-- vertical tab. So a note of E'    \n\t  ' trimmed down to E'\n\t', which is two
-- characters long, satisfied "between 1 and 500", and was accepted. The RPC then
-- did exactly what it is supposed to do for a valid request: it created a
-- replacement draft, wrote the lineage, stamped the actor and calculated the
-- entries.
--
-- Two consequences of one cause. The live Phase 3K run failed check 6 (the
-- whitespace note was accepted, HTTP 200) and check 8 (one draft left behind) —
-- and that draft was the one check 6's own request created. The blank-note and
-- 501-character requests were refused and left nothing, so nothing leaked.
--
-- WHAT THIS IS NOT. It is not an ordering bug and not an atomicity bug. The RPC
-- already validates before it calls calculate_distribution(), the whole function
-- is one transaction, and a raise rolls the entire call back. Verified: the
-- blank and oversized requests each left zero drafts. Moving validation earlier
-- would have fixed nothing, because validation was reached — it just said yes.
--
-- THE FIX. One immutable helper naming every whitespace character explicitly,
-- used by BOTH the function and the constraint, so the two can never again
-- disagree about what "blank" means. The character set is written out rather
-- than left to a regexp class: `\s` in a POSIX regular expression is
-- locale-dependent (it missed a vertical tab on this very database), and a check
-- constraint has to be immutable and give the same answer for ever.
--
-- Nothing else moves. The employee door, the fork and cycle guards, the
-- same-pool reuse, the actor derivation, the one-live-payout index and the
-- stale-input fingerprint are all untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the one definition of "blank" ──────────────────────────────────────────
create or replace function app.trimmed_note(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- ASCII space, tab, LF, CR, form feed, vertical tab; then the four invisible
  -- characters a paste from a word processor actually produces: no-break space
  -- (U+00A0), narrow no-break space (U+202F), zero-width space (U+200B),
  -- ideographic space (U+3000) and the byte-order mark (U+FEFF).
  -- nullif and coalesce are SQL grammar, not catalog functions: they need no
  -- schema qualification and cannot take one, even under an empty search_path.
  select nullif(
           pg_catalog.btrim(coalesce(p_text, ''),
                            E' \t\n\r\f\v  ​　﻿'),
           '');
$$;

revoke all on function app.trimmed_note(text) from public;
grant execute on function app.trimmed_note(text) to authenticated;

comment on function app.trimmed_note(text) is
  'Migration 25: the single definition of a blank correction note. Returns null '
  'for null, empty, or any string of whitespace only. Used by both '
  'create_replacement_distribution() and distributions_correction_reason_shape '
  'so the RPC and the table can never disagree about what counts as a reason.';

-- ── normalise what migration 24 let through ────────────────────────────────
-- The constraint below is validated against existing rows, so anything the old
-- expression admitted has to be dealt with first. Two kinds of row exist:
--
--   1. a note with real content and whitespace around it — store it trimmed;
--   2. a note that is nothing but whitespace — the request should have been
--      refused, so the draft it produced should never have existed.
--
-- Only (2) is deleted, and only where the row is still a draft: a draft has been
-- published to nobody and its entries are recalculated from scratch on the next
-- attempt, so removing one destroys no history and no money. A sent or confirmed
-- distribution is never touched here; if one existed it would be reported by the
-- assertion at the end of this migration instead of being quietly changed.
update public.tip_distributions
set correction_note = app.trimmed_note(correction_note)
where correction_note is not null
  and app.trimmed_note(correction_note) is not null
  and correction_note is distinct from app.trimmed_note(correction_note);

delete from public.tip_distributions
where status = 'draft'
  and correction_reason is not null
  and app.trimmed_note(correction_note) is null;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from public.tip_distributions
  where correction_reason is not null and app.trimmed_note(correction_note) is null;
  if v_bad > 0 then
    raise exception
      'migration 25: % published distribution(s) carry a whitespace-only correction reason; '
      'these are not drafts and will not be changed automatically — resolve them by hand', v_bad;
  end if;
end $$;

-- ── the table's own answer ─────────────────────────────────────────────────
alter table public.tip_distributions
  drop constraint if exists distributions_correction_reason_shape;

alter table public.tip_distributions
  add constraint distributions_correction_reason_shape check (
    correction_reason is null
    or (supersedes_id is not null
        and app.trimmed_note(correction_note) is not null
        and length(app.trimmed_note(correction_note)) <= 500)
  );

comment on constraint distributions_correction_reason_shape on public.tip_distributions is
  'Migration 25: a reason exists only on a row that supersedes something, and only '
  'with a note that is not blank once every whitespace character is trimmed, and no '
  'longer than 500 characters after that trim. Migration 24 trimmed spaces only.';

-- ── the RPC, with the same definition of blank ─────────────────────────────
-- Byte-for-byte the migration 24 function except for the one line that computes
-- v_note. The validation order is unchanged and is spelled out again below, so
-- that a future reader can see the refusals all happen before any write.
create or replace function public.create_replacement_distribution(
  p_original_id uuid,
  p_reason      public.correction_reason default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig  public.tip_distributions%rowtype;
  v_query uuid;
  v_note  text := app.trimmed_note(p_note);   -- migration 25: every whitespace
  v_new   uuid;
  v_actor uuid;
begin
  -- 1 · the subject must exist and be correctable, and the caller must be an
  --     active manager of it. Nothing has been written at this point.
  select * into v_orig from public.tip_distributions
  where id = p_original_id for update;

  if v_orig.id is null or not app.is_manager(v_orig.workplace_id) then
    raise exception 'distribution not found' using errcode = '42501';
  end if;
  if v_orig.status = 'draft' then
    raise exception 'a draft is corrected by recalculating it, not by replacing it'
      using errcode = '42501';
  end if;
  if v_orig.status = 'cancelled' then
    raise exception 'this distribution has already been replaced or cancelled'
      using errcode = '42501';
  end if;

  -- app.is_manager() is status-aware, so a suspended manager never reaches
  -- here; app.member_id() is the same test, and gives us the actor.
  v_actor := app.member_id(v_orig.workplace_id);

  -- 2 · the reason must be sound, by whichever door. Still nothing written.
  if p_reason is null then
    -- The employee door: a manager who has read a question and agreed with it.
    select q.id into v_query
    from public.distribution_queries q
    where q.distribution_id = p_original_id
      and q.status = 'resolved'
      and q.outcome = 'correction_required'
    order by q.resolved_at desc
    limit 1;

    if v_query is null then
      raise exception
        'say what needs correcting, or answer the question on this distribution with "a correction is needed" first'
        using errcode = '42501';
    end if;
    if v_note is not null then
      raise exception 'this correction already has its reason: the question somebody asked'
        using errcode = '22023';
    end if;
  else
    -- The manager door: their own finding, in their own words. A note of
    -- nothing but whitespace is null by now, and is refused here.
    if v_note is null then
      raise exception 'a correction needs a sentence saying what was wrong'
        using errcode = '22023';
    end if;
    if length(v_note) > 500 then
      raise exception 'that reason is too long; 500 characters is the limit'
        using errcode = '22023';
    end if;
  end if;

  -- 3 · one live correction per original. Still nothing written.
  if exists (
    select 1 from public.tip_distributions d
    where d.supersedes_id = p_original_id and d.status <> 'cancelled' and d.status <> 'draft')
  then
    raise exception 'this distribution has already been corrected' using errcode = '42501';
  end if;

  -- 4 · only now does anything get written.
  perform pg_catalog.set_config('app.replacement_for', p_original_id::text, true);
  perform pg_catalog.set_config('app.replacement_query', coalesce(v_query::text, ''), true);
  v_new := public.calculate_distribution(v_orig.tip_pool_id);
  perform pg_catalog.set_config('app.replacement_for', '', true);
  perform pg_catalog.set_config('app.replacement_query', '', true);

  -- Stamped after the engine has written the draft, in the same transaction.
  -- Doing it here rather than inside calculate_distribution() keeps the money
  -- path untouched by this phase. v_note is already normalised, so what is
  -- stored is what the constraint measures.
  update public.tip_distributions
  set correction_reason = p_reason,
      correction_note   = case when p_reason is null then null else v_note end,
      initiated_by      = v_actor,
      initiated_at      = now()
  where id = v_new;

  return v_new;
end;
$$;

revoke all on function
  public.create_replacement_distribution(uuid, public.correction_reason, text) from public;
grant execute on function
  public.create_replacement_distribution(uuid, public.correction_reason, text) to authenticated;

comment on function public.create_replacement_distribution(uuid, public.correction_reason, text) is
  'Migration 25: unchanged from migration 24 except that a blank note now means '
  'blank of any whitespace, not only of spaces. Refusals all happen before the '
  'engine is called, so a rejected correction writes nothing at all.';
