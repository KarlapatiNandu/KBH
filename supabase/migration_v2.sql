-- ============================================================
-- KBH Migration v2
-- Safe to run against an existing v1 database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Adds:
--   * network check columns on participants  (R2)
--   * manual_mode + question_duration_ms on round_state (R5, R6)
--   * ON DELETE behaviour on the three FKs   (ISSUES 3.1)
--   * pin_hash hidden from anon              (ISSUES 1.5)
--   * participants added to realtime         (R2 live red rows)
-- ============================================================

-- ─── participants: network check state (R2) ─────────────────
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS network_status      TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS network_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS network_latency_ms  INT,
  ADD COLUMN IF NOT EXISTS network_detail      TEXT;

DO $$
BEGIN
  ALTER TABLE participants
    ADD CONSTRAINT participants_network_status_check
    CHECK (network_status IN ('pending', 'passed', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── round_state: manual serve + configurable duration ──────
ALTER TABLE round_state
  ADD COLUMN IF NOT EXISTS manual_mode          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS question_duration_ms INT     NOT NULL DEFAULT 10000;

-- ─── FK delete behaviour (ISSUES 3.1) ───────────────────────
-- Responses die with their participant/question; a deleted participant
-- simply clears the hot seat rather than blocking the delete.
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_participant_id_fkey;
ALTER TABLE responses
  ADD CONSTRAINT responses_participant_id_fkey
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_question_id_fkey;
ALTER TABLE responses
  ADD CONSTRAINT responses_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;

ALTER TABLE round_state DROP CONSTRAINT IF EXISTS round_state_active_participant_id_fkey;
ALTER TABLE round_state
  ADD CONSTRAINT round_state_active_participant_id_fkey
  FOREIGN KEY (active_participant_id) REFERENCES participants(id) ON DELETE SET NULL;

-- ─── Hide pin_hash from anonymous clients (ISSUES 1.5) ──────
-- RLS policies are row-level; column-level grants are the tool for this.
--
-- `REVOKE SELECT (pin_hash)` alone is a no-op: while `anon` still holds the
-- table-level SELECT grant, Postgres cannot subtract one column from it —
-- it warns "no privileges could be revoked" and pin_hash stays readable.
-- Drop the table grant first, then re-grant the readable columns.
--
-- `authenticated` (the admin) keeps full access.
REVOKE SELECT ON participants FROM anon;
GRANT  SELECT (id, roll_no, name, created_at,
               network_status, network_checked_at,
               network_latency_ms, network_detail)
  ON participants TO anon;

-- ─── Realtime: participants (so failed checks show live) ────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE participants;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Backfill ───────────────────────────────────────────────
UPDATE participants SET network_status = 'pending' WHERE network_status IS NULL;
