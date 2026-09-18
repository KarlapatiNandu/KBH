-- ============================================================
-- KBH Migration v8
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Audience Poll, with a result (R11):
--   The poll used to be an indicator and nothing more — the vote ran
--   elsewhere and never came back on screen. Now the host tallies the
--   room and types the count for each option into the console, and
--   ending the poll puts the bar chart up on the contestant's board
--   (assets and references/Audience_pole_Display.png).
--
--   Raw counts are stored, not percentages: the chart works out the
--   split, so a miscounted option can be corrected on air without the
--   host having to re-do the arithmetic for all four.
--
--   The poll also holds the question clock, the way the phone lifelines
--   do — from the moment it goes live until the host hides the chart
--   again. `poll_hidden_at` is that closing stamp: it takes the chart off
--   the contestant's board and lets the countdown pick up where it froze.
-- ============================================================

ALTER TABLE lifeline_state
  ADD COLUMN IF NOT EXISTS poll_votes JSONB;

ALTER TABLE lifeline_state
  ADD COLUMN IF NOT EXISTS poll_hidden_at TIMESTAMPTZ;

COMMENT ON COLUMN lifeline_state.poll_votes IS
  'audience_poll only: one raw vote count per option, in option order. NULL until the host enters the tally.';

COMMENT ON COLUMN lifeline_state.poll_hidden_at IS
  'audience_poll only: when the host took the chart back off the contestant''s board, releasing the question clock. NULL while the poll still holds it.';
