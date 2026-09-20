-- ============================================================
-- KBH Migration v12
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql (serve_question gains a parameter).
--
-- Staged option reveal (R18):
--   Up to the first checkpoint the show puts the question, its four options
--   and the clock up together. Above it, the question goes up alone, the
--   host reads it, and the options and the clock appear when the host says
--   so. Two columns on round_state carry that for whichever question is live:
--
--   * options_staged      — this serve withholds the options and the clock.
--   * options_revealed_at — when the host released them (reveal_options).
--                           NULL while they are still withheld.
--
--   On round_state rather than responses because it belongs to the serve,
--   not to an answer: serve_question, advance_question, start_round and
--   reset_round all clear it, so a staged flag can never outlive its
--   question. The contestant's screen already reads this row live.
-- ============================================================

ALTER TABLE round_state
  ADD COLUMN IF NOT EXISTS options_staged      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS options_revealed_at TIMESTAMPTZ;

COMMENT ON COLUMN round_state.options_staged IS
  'Round 2: the live question was served with its options and countdown '
  'withheld until the host calls reveal_options().';
COMMENT ON COLUMN round_state.options_revealed_at IS
  'Round 2: when the host released a staged question''s options. NULL = '
  'still withheld (or the question is not staged).';

-- serve_question gains a parameter in this release; rpcs.sql drops the old
-- three-argument version itself, so re-running it is the only other step.
