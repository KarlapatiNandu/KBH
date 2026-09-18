-- ============================================================
-- KBH Migration v10
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- The prize ladder (R14):
--   The money tree from the show (assets and references/
--   Price_list_display.png): every rung of the run, cheapest at the
--   bottom, with the milestone rungs picked out in white. The contestant
--   opens it from their board to see where they are and what is left;
--   until now the only money on screen was the single prize for the
--   question in front of them, which says nothing about the climb.
--
--   It is its own table rather than a read of `questions.prize` because
--   the ladder and the question list are not the same thing. The host
--   sets how many rungs the run has and what each one pays, and can
--   redraw it between run-throughs without touching a single question —
--   and a ladder rung exists whether or not a question has been written
--   for it yet.
--
--   `level` is the rung, counting up from 1 at the bottom, and it is what
--   ties the ladder to the run: the contestant on question 3 is standing
--   on level 3. `is_milestone` is the white rung — the guaranteed floor
--   the contestant cannot fall below, which is the one thing on the
--   ladder that has to read differently at a glance.
-- ============================================================

CREATE TABLE IF NOT EXISTS prize_ladder (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round         INT  NOT NULL DEFAULT 2 CHECK (round IN (1, 2)),
  -- The rung, counting up from 1 at the bottom. Question N of the run is
  -- played for level N.
  level         INT  NOT NULL CHECK (level > 0),
  -- Free text, exactly like questions.prize — the ladder carries "7 Crore"
  -- as happily as "₹10,000", and the host types what the show says.
  label         TEXT NOT NULL,
  -- The guaranteed floor: drawn in white on the contestant's ladder, as
  -- on the show.
  is_milestone  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  -- One rung per level: the ladder is a list, not a bag.
  UNIQUE (round, level)
);

CREATE INDEX IF NOT EXISTS idx_prize_ladder_round_level ON prize_ladder (round, level);

COMMENT ON COLUMN prize_ladder.level IS
  'The rung, counting up from 1 at the bottom. Question N of the round is played for level N.';

COMMENT ON COLUMN prize_ladder.is_milestone IS
  'The guaranteed floor — drawn in white on the contestant''s ladder, as on the show.';

-- A starting ladder, so the panel is never empty on a fresh setup. Only
-- when round 2 has no ladder at all: re-running this must not undo a host's
-- edits or resurrect a rung they deleted.
INSERT INTO prize_ladder (round, level, label, is_milestone)
SELECT 2, v.level, v.label, v.is_milestone
FROM (VALUES
  (1,  '₹1,000',    false),
  (2,  '₹2,000',    false),
  (3,  '₹3,000',    false),
  (4,  '₹5,000',    false),
  (5,  '₹10,000',   true),
  (6,  '₹20,000',   false),
  (7,  '₹40,000',   false),
  (8,  '₹80,000',   false),
  (9,  '₹1,60,000', false),
  (10, '₹3,20,000', true)
) AS v(level, label, is_milestone)
WHERE NOT EXISTS (SELECT 1 FROM prize_ladder p WHERE p.round = 2);

-- ─── RLS ────────────────────────────────────────────────────
-- Same posture as `questions`: the host edits it straight from the console
-- and the contestant's board reads it, both on the anon key.
ALTER TABLE prize_ladder ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Open access on prize_ladder" ON prize_ladder;
CREATE POLICY "Open access on prize_ladder" ON prize_ladder
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime, so a rung re-priced mid-show lands on the contestant's open
-- ladder without them closing and reopening it.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE prize_ladder;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
