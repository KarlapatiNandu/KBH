-- ============================================================
-- KBH Migration v11
-- Safe to run against an existing database. Idempotent.
-- No RPC change — rpcs.sql does not need re-running.
--
-- Question tiers (R16):
--   Round 2's questions were a single queue: the host served number 1,
--   then 2, then 3, and the run was whatever order that queue happened to
--   be in. `prize_ladder` already says the run climbs rungs, and the
--   contestant's board already reads "question N is rung N" — so the
--   queue *was* the ladder, one question per rung, with no choice in it.
--
--   `ladder_level` breaks that tie. A question now says which rung it is
--   played for, and several questions can name the same rung: a pool per
--   tier the host picks from live, instead of a fixed script. Once a tier
--   has been answered the run moves up to the next one, and the rest of
--   that tier's pool is simply never asked.
--
--   NULL means "not placed on the ladder yet" rather than rung 0 — a
--   question written before the ladder was drawn up is not wrong, it is
--   unfiled, and the host's console lists those separately instead of
--   silently playing them for the bottom rung.
--
--   Backfilled by position, so a database upgrading to this migration
--   plays exactly the run it played before: question N keeps rung N.
-- ============================================================

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS ladder_level INT;

-- Added separately from the column so re-running the file does not trip
-- over a constraint that is already there.
DO $$
BEGIN
  ALTER TABLE questions
    ADD CONSTRAINT questions_ladder_level_check
    CHECK (ladder_level IS NULL OR ladder_level > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN questions.ladder_level IS
  'Round 2: which prize_ladder rung this question is played for. Several '
  'questions may share a rung — the host picks one of them live. NULL is '
  'not yet placed on the ladder.';

CREATE INDEX IF NOT EXISTS idx_questions_round_ladder
  ON questions (round, ladder_level);

-- Preserve the run an existing database already has: the queue was the
-- ladder, so question N of round 2 becomes rung N. Only rows that have no
-- tier yet, so re-running this never re-files a question the host moved.
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY order_index) AS rung
  FROM questions
  WHERE round = 2
)
UPDATE questions q
SET ladder_level = n.rung
FROM numbered n
WHERE q.id = n.id
  AND q.ladder_level IS NULL;
