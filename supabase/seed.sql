-- ============================================================
-- KBH Seed Data — Module 1 (v1 Testing)
-- Run this AFTER schema.sql and rpcs.sql
-- ============================================================

-- ─── Participants (30 students) ─────────────────────────────
INSERT INTO participants (roll_no, name) VALUES
  ('CS001', 'Aarav Sharma'),
  ('CS002', 'Bhavya Patel'),
  ('CS003', 'Chirag Mehta'),
  ('CS004', 'Diya Nair'),
  ('CS005', 'Eshan Gupta'),
  ('CS006', 'Falguni Desai'),
  ('CS007', 'Gaurav Singh'),
  ('CS008', 'Harini Rao'),
  ('CS009', 'Ishaan Verma'),
  ('CS010', 'Jhanvi Kapoor'),
  ('CS011', 'Kartik Joshi'),
  ('CS012', 'Lakshmi Iyer'),
  ('CS013', 'Manav Reddy'),
  ('CS014', 'Nithya Kumar'),
  ('CS015', 'Omkar Bhatt'),
  ('CS016', 'Priya Menon'),
  ('CS017', 'Quasar Ali'),
  ('CS018', 'Roshni Das'),
  ('CS019', 'Siddharth Yadav'),
  ('CS020', 'Tanvi Kulkarni'),
  ('CS021', 'Ujjwal Pandey'),
  ('CS022', 'Vidya Srinivasan'),
  ('CS023', 'Waqar Khan'),
  ('CS024', 'Xena George'),
  ('CS025', 'Yash Tiwari'),
  ('CS026', 'Zara Ansari'),
  ('CS027', 'Aditya Choudhury'),
  ('CS028', 'Bhumika Saxena'),
  ('CS029', 'Chetan Naik'),
  ('CS030', 'Deepa Pillai')
ON CONFLICT (roll_no) DO NOTHING;


-- ─── Round 1 Questions (5) ──────────────────────────────────
-- Guarded on "this round already has questions" rather than ON CONFLICT:
-- (round, order_index) has no unique index, and it can't have one while
-- QuestionManager reorders by swapping the two rows' order_index in
-- separate statements. Without the guard a second run of this file
-- duplicates every question, and because both the client and
-- submit_response address the live question by order_index, the two
-- copies can resolve differently and every answer is rejected with
-- "Question is not current".
INSERT INTO questions (round, text, options, correct_option, base_points, order_index)
SELECT * FROM (VALUES
  (1, 'Which planet is known as the Red Planet?',
     '["Venus", "Mars", "Jupiter", "Saturn"]'::jsonb, 1, 100, 0),
  (1, 'What is the chemical symbol for Gold?',
     '["Ag", "Fe", "Au", "Cu"]'::jsonb, 2, 100, 1),
  (1, 'Who wrote "Romeo and Juliet"?',
     '["Charles Dickens", "Mark Twain", "William Shakespeare", "Jane Austen"]'::jsonb, 2, 100, 2),
  (1, 'What is the largest ocean on Earth?',
     '["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"]'::jsonb, 3, 100, 3),
  (1, 'In which year did India gain independence?',
     '["1942", "1945", "1947", "1950"]'::jsonb, 2, 100, 4)
) AS v(round, text, options, correct_option, base_points, order_index)
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.round = 1);


-- ─── Round 2 Questions (5) ──────────────────────────────────
-- Filed onto the bottom three rungs of the ladder rather than one per rung,
-- so a fresh database shows what `ladder_level` is for (R16): rungs 1 and 2
-- are pools of two, and the host picks which one the contestant gets.
INSERT INTO questions (round, text, options, correct_option, base_points, order_index, ladder_level)
SELECT * FROM (VALUES
  (2, 'What is the currency of Japan?',
     '["Won", "Yuan", "Yen", "Ringgit"]'::jsonb, 2, 100, 0, 1),
  (2, 'Which element has atomic number 1?',
     '["Helium", "Hydrogen", "Lithium", "Carbon"]'::jsonb, 1, 100, 1, 1),
  (2, 'Who painted the Mona Lisa?',
     '["Michelangelo", "Raphael", "Leonardo da Vinci", "Donatello"]'::jsonb, 2, 100, 2, 2),
  (2, 'What is the tallest mountain in the world?',
     '["K2", "Kangchenjunga", "Mount Everest", "Lhotse"]'::jsonb, 2, 100, 3, 2),
  (2, 'Which country hosted the 2016 Summer Olympics?',
     '["China", "UK", "Brazil", "Japan"]'::jsonb, 2, 100, 4, 3)
) AS v(round, text, options, correct_option, base_points, order_index, ladder_level)
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.round = 2);


-- ─── Round State (both rounds inactive) ─────────────────────
INSERT INTO round_state (round, status, current_question_index) VALUES
  (1, 'inactive', 0),
  (2, 'inactive', 0)
ON CONFLICT (round) DO NOTHING;


-- ─── Sample Responses for Round 1 ──────────────────────────
-- We'll generate ~50 responses: 10 participants answering all 5 round-1 questions
-- Using subqueries to get IDs dynamically

-- Helper: create a temp table with participant IDs for the first 10
DO $$
DECLARE
  v_participants UUID[];
  v_questions    UUID[];
  v_pid          UUID;
  v_qid          UUID;
  v_correct_opt  INT;
  v_selected     INT;
  v_is_correct   BOOLEAN;
  v_response_ms  INT;
  v_time_pts     NUMERIC;
  v_points       INT;
  i              INT;
  j              INT;
BEGIN
  -- Get first 10 participant IDs
  SELECT array_agg(id ORDER BY roll_no)
  INTO v_participants
  FROM (SELECT id, roll_no FROM participants ORDER BY roll_no LIMIT 10) sub;

  -- Get round 1 question IDs in order
  SELECT array_agg(id ORDER BY order_index)
  INTO v_questions
  FROM questions WHERE round = 1;

  -- For each participant, answer each question
  FOR i IN 1..array_length(v_participants, 1) LOOP
    v_pid := v_participants[i];

    FOR j IN 1..array_length(v_questions, 1) LOOP
      v_qid := v_questions[j];

      -- Get correct option for this question
      SELECT correct_option INTO v_correct_opt FROM questions WHERE id = v_qid;

      -- Randomize: ~70% chance of correct answer
      IF random() < 0.7 THEN
        v_selected := v_correct_opt;
        v_is_correct := true;
      ELSE
        -- Pick a wrong option (0-3, excluding correct)
        v_selected := (v_correct_opt + 1 + floor(random() * 3)::int) % 4;
        v_is_correct := false;
      END IF;

      -- Random response time between 1500ms and 9500ms
      v_response_ms := 1500 + floor(random() * 8000)::int;

      -- Compute points
      IF v_is_correct THEN
        v_time_pts := 100 * GREATEST(0, 10000 - v_response_ms)::NUMERIC / 10000;
        v_points := ROUND(100 + v_time_pts)::INT;
      ELSE
        v_points := 0;
      END IF;

      INSERT INTO responses (participant_id, question_id, round, selected_option, is_correct, response_time_ms, points_awarded)
      VALUES (v_pid, v_qid, 1, v_selected, v_is_correct, v_response_ms, v_points)
      ON CONFLICT (participant_id, question_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- ─── Sample Responses for Round 2 (Hot Seat) ────────────────
-- We'll pick one participant and generate 5 responses for Round 2.
DO $$
DECLARE
  v_pid          UUID;
  v_questions    UUID[];
  v_qid          UUID;
  v_correct_opt  INT;
  v_selected     INT;
  v_is_correct   BOOLEAN;
  v_response_ms  INT;
  v_time_pts     NUMERIC;
  v_points       INT;
  j              INT;
BEGIN
  -- Select the first participant as our mock hot-seat player
  SELECT id INTO v_pid FROM participants ORDER BY roll_no LIMIT 1;

  -- Set this participant as active in round 2
  UPDATE round_state SET active_participant_id = v_pid WHERE round = 2;

  -- Get round 2 question IDs in order
  SELECT array_agg(id ORDER BY order_index)
  INTO v_questions
  FROM questions WHERE round = 2;

  -- Answer each question
  FOR j IN 1..array_length(v_questions, 1) LOOP
    v_qid := v_questions[j];
    SELECT correct_option INTO v_correct_opt FROM questions WHERE id = v_qid;

    IF random() < 0.6 THEN
      v_selected := v_correct_opt;
      v_is_correct := true;
    ELSE
      v_selected := (v_correct_opt + 1 + floor(random() * 3)::int) % 4;
      v_is_correct := false;
    END IF;

    v_response_ms := 2000 + floor(random() * 7000)::int;

    IF v_is_correct THEN
      v_time_pts := 100 * GREATEST(0, 10000 - v_response_ms)::NUMERIC / 10000;
      v_points := ROUND(100 + v_time_pts)::INT;
    ELSE
      v_points := 0;
    END IF;

    INSERT INTO responses (participant_id, question_id, round, selected_option, is_correct, response_time_ms, points_awarded)
    VALUES (v_pid, v_qid, 2, v_selected, v_is_correct, v_response_ms, v_points)
    ON CONFLICT (participant_id, question_id) DO NOTHING;
  END LOOP;
END;
$$;
