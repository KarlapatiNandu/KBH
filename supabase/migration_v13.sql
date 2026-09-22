-- ============================================================
-- KBH Migration v13
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql (new submit_round1_response, and the
-- round lifecycle RPCs now read round 1 from its own table).
--
-- Round 1 question types (R19):
--   Fastest Finger First asks three kinds of question, not one:
--
--   * single   — one correct option, as before.
--   * multiple — every correct option has to be picked, and nothing else.
--   * order    — every option has to be put in the right sequence.
--
--   Round 1 gets its own table, `round1_questions`, instead of growing
--   columns on `questions` that Round 2 would never use — the hot seat is
--   always single-correct, and its lifelines (50:50, the audience poll) only
--   make sense for one right answer.
--
--   The answer is `correct_answer`, a JSON array of 0-based option indices:
--
--     single    [2]            — exactly one index
--     multiple  [0, 3]         — the set of correct indices, sorted
--     order     [1, 3, 0, 2]   — every index once, in the correct sequence
--
--   round1_normalize_answer() is the one definition of what a well-formed
--   answer is. The table's CHECK uses it for the key, and
--   submit_round1_response uses it on what a participant sends, so the two
--   are always compared in the same shape. Scoring is all-or-nothing: a
--   multiple-correct answer with one option missing, or an order with two
--   items swapped, is wrong.
--
--   responses.question_id now points at a question in either table, so its
--   foreign key to `questions` is replaced by delete triggers that keep the
--   old ON DELETE CASCADE behaviour for both. responses.answer carries the
--   participant's array; selected_option stays for Round 2 (and is filled
--   for single-correct Round 1 answers too).
--
--   Existing Round 1 questions move across as `single`, keeping their ids,
--   so responses already recorded against them still line up.
-- ============================================================

-- ─── round1_normalize_answer ────────────────────────────────
-- The canonical form of an answer for a question of this type with this
-- many options, or NULL if it is not a valid answer at all.
CREATE OR REPLACE FUNCTION round1_normalize_answer(
  p_type         TEXT,
  p_option_count INT,
  p_answer       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_items INT[];
  v_n     INT;
BEGIN
  IF p_answer IS NULL OR jsonb_typeof(p_answer) <> 'array' OR p_option_count IS NULL THEN
    RETURN NULL;
  END IF;

  -- Whole, non-negative numbers only — checked before anything is cast.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_answer) e
    WHERE jsonb_typeof(e) <> 'number' OR e::text !~ '^[0-9]{1,3}$'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT array_agg((t.e::text)::INT ORDER BY t.ord)
    INTO v_items
  FROM jsonb_array_elements(p_answer) WITH ORDINALITY AS t(e, ord);

  v_n := COALESCE(array_length(v_items, 1), 0);
  IF v_n = 0 THEN
    RETURN NULL;
  END IF;

  -- Every index points at an option, and none is repeated.
  IF EXISTS (SELECT 1 FROM unnest(v_items) x WHERE x >= p_option_count) THEN
    RETURN NULL;
  END IF;
  IF (SELECT COUNT(DISTINCT x) FROM unnest(v_items) x) <> v_n THEN
    RETURN NULL;
  END IF;

  IF p_type = 'single' THEN
    IF v_n <> 1 THEN RETURN NULL; END IF;
    RETURN to_jsonb(v_items);
  ELSIF p_type = 'multiple' THEN
    -- A set: the order it was picked in means nothing.
    RETURN (SELECT to_jsonb(array_agg(x ORDER BY x)) FROM unnest(v_items) x);
  ELSIF p_type = 'order' THEN
    -- A sequence of every option.
    IF v_n <> p_option_count THEN RETURN NULL; END IF;
    RETURN to_jsonb(v_items);
  END IF;

  RETURN NULL;
END;
$$;

-- ─── round1_questions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS round1_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_type   TEXT NOT NULL DEFAULT 'single'
                    CHECK (question_type IN ('single', 'multiple', 'order')),
  text            TEXT NOT NULL,
  options         JSONB NOT NULL
                    CHECK (jsonb_typeof(options) = 'array'),
  correct_answer  JSONB NOT NULL,
  base_points     INT NOT NULL DEFAULT 100,
  order_index     INT NOT NULL,
  duration_ms     INT CHECK (duration_ms IS NULL OR duration_ms > 0),
  created_at      TIMESTAMPTZ DEFAULT now(),

  -- Stored in canonical form, so submit_round1_response can compare with =.
  CONSTRAINT round1_questions_answer_check CHECK (
    COALESCE(
      correct_answer = round1_normalize_answer(
        question_type,
        CASE WHEN jsonb_typeof(options) = 'array' THEN jsonb_array_length(options) END,
        correct_answer
      ),
      false
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_round1_questions_order ON round1_questions (order_index);

ALTER TABLE round1_questions ENABLE ROW LEVEL SECURITY;

-- Same open policy as `questions` — see schema.sql for the tradeoff.
DROP POLICY IF EXISTS "Open access on round1_questions" ON round1_questions;
CREATE POLICY "Open access on round1_questions" ON round1_questions
  FOR ALL USING (true) WITH CHECK (true);

-- ─── responses: an answer that is more than one option ──────
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS answer JSONB;

ALTER TABLE responses
  ALTER COLUMN selected_option DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE responses
    ADD CONSTRAINT responses_has_answer_check
    CHECK (selected_option IS NOT NULL OR answer IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN responses.answer IS
  'Round 1: the participant''s answer as a JSON array of option indices, in '
  'round1_normalize_answer() form. NULL for Round 2, which uses selected_option.';

-- The question a response belongs to may now live in either table.
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_question_id_fkey;

-- ─── move existing Round 1 questions across ─────────────────
INSERT INTO round1_questions
  (id, question_type, text, options, correct_answer, base_points, order_index, duration_ms, created_at)
SELECT id, 'single', text, options, jsonb_build_array(correct_option),
       base_points, order_index, duration_ms, created_at
FROM questions
WHERE round = 1
ON CONFLICT (id) DO NOTHING;

UPDATE responses
SET answer = jsonb_build_array(selected_option)
WHERE round = 1 AND answer IS NULL AND selected_option IS NOT NULL;

-- Before the cleanup trigger below exists, so the responses stay.
DELETE FROM questions WHERE round = 1;

-- `questions` is Round 2's table from here on.
DO $$
BEGIN
  ALTER TABLE questions ADD CONSTRAINT questions_round2_only CHECK (round = 2);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── ON DELETE CASCADE, by trigger ──────────────────────────
-- SECURITY DEFINER because anon cannot delete from responses directly, and
-- the admin console deletes questions with the anon key.
CREATE OR REPLACE FUNCTION delete_question_responses()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM responses WHERE question_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_questions_delete_responses ON questions;
CREATE TRIGGER trg_questions_delete_responses
  AFTER DELETE ON questions
  FOR EACH ROW EXECUTE FUNCTION delete_question_responses();

DROP TRIGGER IF EXISTS trg_round1_questions_delete_responses ON round1_questions;
CREATE TRIGGER trg_round1_questions_delete_responses
  AFTER DELETE ON round1_questions
  FOR EACH ROW EXECUTE FUNCTION delete_question_responses();

-- ─── round_questions ────────────────────────────────────────
-- Both rounds' questions as one list, for the RPCs that only need to know
-- which question sits at which order_index in a round (start_round,
-- advance_question, serve_question, reset_round).
CREATE OR REPLACE VIEW round_questions AS
  SELECT id, 1 AS round, order_index, duration_ms, base_points, created_at
  FROM round1_questions
  UNION ALL
  SELECT id, round, order_index, duration_ms, base_points, created_at
  FROM questions;
