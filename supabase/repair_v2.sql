-- ============================================================
-- KBH Repair v2 — one-off cleanup for the current database
--
-- Run this in the Supabase SQL Editor AFTER migration_v2.sql and
-- rpcs.sql. Idempotent: running it twice is harmless.
--
-- Fixes three things found in the live database:
--   1. `seed.sql` was run twice, so every question exists twice.
--      Two rows share each (round, order_index), which is the key both
--      the client and `submit_response` address questions by — they can
--      resolve to *different* rows and every answer is rejected with
--      "Question is not current".
--   2. Both rounds were left with a `current_question_index` past the
--      end of their question list (round 1 → 9, round 2 → 7, against
--      order_index 0–4). No question matches, so participants sit on
--      "Waiting for next question…" forever.
--   3. `REVOKE SELECT (pin_hash)` in schema.sql/migration_v2.sql is a
--      no-op, so pin_hash is still readable by anon. (ISSUES 1.5)
-- ============================================================

BEGIN;

-- ─── 1. De-duplicate questions ──────────────────────────────
-- Keep the oldest row for each (round, order_index); drop the rest.
-- `responses` cascades on question delete (migration_v2), so this is
-- safe even if answers exist — but see step 2, which clears them anyway.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY round, order_index
           ORDER BY created_at, id
         ) AS rn
  FROM questions
)
DELETE FROM questions q
USING ranked r
WHERE q.id = r.id AND r.rn > 1;


-- ─── 2. Compact order_index and reset both rounds ───────────
-- renumber_questions() makes each round's order_index a gapless 0-based
-- sequence; reset_round() clears responses and points the round back at
-- its first question with status 'inactive'.
SELECT renumber_questions(1);
SELECT renumber_questions(2);

SELECT reset_round(1, true);   -- true = also delete round 1 responses
SELECT reset_round(2, true);   -- true = also delete round 2 responses

-- The hot seat may still point at a participant from the last run.
UPDATE round_state SET active_participant_id = NULL WHERE round = 2;


-- ─── 3. Actually hide pin_hash from anon (ISSUES 1.5) ───────
-- `REVOKE SELECT (col)` does nothing while the role holds table-level
-- SELECT — Postgres just warns and moves on. The working form is to drop
-- the table-level grant and re-grant the columns anon is allowed to read.
-- Every anonymous read of `participants` in the app names its columns
-- explicitly (RoundControl, LiveDashboard, Round1Results); only the admin
-- Participants tab does `select('*')`, and that runs as `authenticated`.
REVOKE SELECT ON participants FROM anon;
GRANT  SELECT (id, roll_no, name, created_at,
               network_status, network_checked_at,
               network_latency_ms, network_detail)
  ON participants TO anon;

COMMIT;


-- ─── Verify ─────────────────────────────────────────────────
-- Expect: 5 questions per round, order_index 0–4, no duplicates.
SELECT round, count(*) AS questions,
       min(order_index) AS first_index,
       max(order_index) AS last_index
FROM questions
GROUP BY round
ORDER BY round;

-- Expect: both rounds 'inactive', current_question_index = 0.
SELECT round, status, current_question_index, question_started_at,
       manual_mode, question_duration_ms, active_participant_id
FROM round_state
ORDER BY round;

-- Expect: 0.
SELECT count(*) AS remaining_responses FROM responses;

-- Expect: participants is present, so failed network checks reach the
-- admin list live rather than on refresh. (R2)
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
