-- ============================================================
-- KBH Migration v5
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Per-question time and prize (R8):
--   * questions.duration_ms — countdown for this question. NULL falls back
--     to round_state.question_duration_ms, so existing questions keep the
--     round default. Used by the client timer AND the server-side clamp in
--     submit_response, so the two can never disagree.
--   * questions.prize — free-text prize shown on the Round 2 hot seat
--     screen (e.g. "₹10,000"). Text rather than a number so the host
--     controls the currency and formatting. NULL shows nothing.
-- ============================================================

ALTER TABLE questions ADD COLUMN IF NOT EXISTS duration_ms INT
  CHECK (duration_ms IS NULL OR duration_ms > 0);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS prize TEXT;
