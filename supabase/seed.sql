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


-- ─── Round 1 Questions (6) ──────────────────────────────────
-- Two of each type (R19). correct_answer is 0-based option indices: one for
-- single, the sorted set for multiple, the full sequence for order.
--
-- Guarded on "the table already has questions" rather than ON CONFLICT:
-- order_index has no unique index, and it can't have one while
-- QuestionManager reorders by swapping the two rows' order_index in
-- separate statements. Without the guard a second run of this file
-- duplicates every question, and because both the client and
-- submit_round1_response address the live question by order_index, the two
-- copies can resolve differently and every answer is rejected with
-- "Question is not current".
INSERT INTO round1_questions (question_type, text, options, correct_answer, base_points, order_index)
SELECT * FROM (VALUES
  ('single', 'Which planet is known as the Red Planet?',
     '["Venus", "Mars", "Jupiter", "Saturn"]'::jsonb, '[1]'::jsonb, 100, 0),
  ('multiple', 'Which of these are prime numbers?',
     '["2", "9", "13", "21"]'::jsonb, '[0, 2]'::jsonb, 100, 1),
  ('order', 'Arrange these planets from closest to farthest from the Sun.',
     '["Earth", "Mercury", "Mars", "Venus"]'::jsonb, '[1, 3, 0, 2]'::jsonb, 100, 2),
  ('single', 'What is the chemical symbol for Gold?',
     '["Ag", "Fe", "Au", "Cu"]'::jsonb, '[2]'::jsonb, 100, 3),
  ('multiple', 'Which of these are noble gases?',
     '["Neon", "Nitrogen", "Argon", "Helium"]'::jsonb, '[0, 2, 3]'::jsonb, 100, 4),
  ('order', 'Put these events in chronological order, earliest first.',
     '["Indian independence", "First Moon landing", "World War I begins", "Fall of the Berlin Wall"]'::jsonb,
     '[2, 0, 1, 3]'::jsonb, 100, 5)
) AS v(question_type, text, options, correct_answer, base_points, order_index)
WHERE NOT EXISTS (SELECT 1 FROM round1_questions);


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
-- ~60 responses: 10 participants answering all 6 round-1 questions.
DO $$
DECLARE
  v_participants UUID[];
  v_questions    UUID[];
  v_pid          UUID;
  v_qid          UUID;
  v_type         TEXT;
  v_correct      JSONB;
  v_answer       JSONB;
  v_is_correct   BOOLEAN;
  v_response_ms  INT;
  v_time_pts     NUMERIC;
  v_points       INT;
  i              INT;
  j              INT;
BEGIN
  SELECT array_agg(id ORDER BY roll_no)
  INTO v_participants
  FROM (SELECT id, roll_no FROM participants ORDER BY roll_no LIMIT 10) sub;

  SELECT array_agg(id ORDER BY order_index)
  INTO v_questions
  FROM round1_questions;

  FOR i IN 1..array_length(v_participants, 1) LOOP
    v_pid := v_participants[i];

    FOR j IN 1..array_length(v_questions, 1) LOOP
      v_qid := v_questions[j];
      SELECT question_type, correct_answer INTO v_type, v_correct
      FROM round1_questions WHERE id = v_qid;

      -- ~70% right. A wrong answer is the sequence reversed for order
      -- questions, and a lone other option for the rest — neither can
      -- equal the key.
      IF random() < 0.7 THEN
        v_answer := v_correct;
        v_is_correct := true;
      ELSIF v_type = 'order' THEN
        SELECT jsonb_agg(e ORDER BY ord DESC) INTO v_answer
        FROM jsonb_array_elements(v_correct) WITH ORDINALITY AS t(e, ord);
        v_is_correct := false;
      ELSE
        v_answer := jsonb_build_array(((v_correct->>0)::INT + 1) % 4);
        v_is_correct := false;
      END IF;

      v_response_ms := 1500 + floor(random() * 8000)::int;

      IF v_is_correct THEN
        v_time_pts := 100 * GREATEST(0, 10000 - v_response_ms)::NUMERIC / 10000;
        v_points := ROUND(100 + v_time_pts)::INT;
      ELSE
        v_points := 0;
      END IF;

      INSERT INTO responses (participant_id, question_id, round, selected_option, answer, is_correct, response_time_ms, points_awarded)
      VALUES (
        v_pid, v_qid, 1,
        CASE WHEN v_type = 'single' THEN (v_answer->>0)::INT END,
        v_answer, v_is_correct, v_response_ms, v_points
      )
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
