-- ============================================================
-- KBH Migration v9
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Picking a lifeline (R12):
--   Playing a lifeline and choosing one are two different beats of the
--   show. The contestant says "50:50" and the board should mark it there
--   and then — before the host has decided which two options go, before
--   the phone is dialled. Until now the badge only lit up once the
--   lifeline was already running, so that beat had nowhere to live.
--
--   `picked_at` is that beat. The host picks the lifeline from the
--   console, the medallion appears on the contestant's board, and the
--   lifeline itself is played a moment later.
--
--   Exactly one lifeline is picked at a time (pick_lifeline clears the
--   others), because the board has exactly one medallion to give — a
--   contestant playing 50:50 and then a phone call on the same question
--   just picks twice, and the badge follows.
--
--   The Audience Poll has no pick: it is started, and starting it is
--   already the announcement.
-- ============================================================

ALTER TABLE lifeline_state
  ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;

COMMENT ON COLUMN lifeline_state.picked_at IS
  'When the host picked this lifeline for lifeline_state.question_id, lighting its medallion on the contestant''s board before it is played. NULL when not the picked lifeline.';
