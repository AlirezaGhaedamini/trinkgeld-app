-- ─────────────────────────────────────────────────────────────────────────────
-- 34 · Phase 3R-D · `shift_rejected` joins notification_type
--
-- This migration does ONE thing on purpose. PostgreSQL lets a new enum value be
-- added inside a transaction, but refuses to let that value be USED before the
-- transaction commits — and `supabase db push` runs every migration file as
-- exactly one transaction. Everything that uses the value (the source-shape
-- constraint, the trigger, the tests) therefore lives in migration 35, which
-- runs in its own transaction after this one has committed.
--
-- The alternative the project used before — a whole new type, as with
-- payout_state beside payout_status — does not fit here: the column, the CHECK
-- constraint, the dedupe index, app.notify_members() and the client all name
-- notification_type, and swapping the type would rewrite all of them for the
-- sake of a single value.
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.notification_type add value 'shift_rejected';
