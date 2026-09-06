-- ============================================================
-- KBH RPC Functions — Module 1 / Module 4
-- Run this AFTER schema.sql in Supabase SQL Editor
-- ============================================================

-- ─── submit_response ────────────────────────────────────────
-- Called by participants to submit an answer.
-- Server computes response_time_ms and scoring — no client clock trusted.
CREATE OR REPLACE FUNCTION submit_response(
  p_participant_id UUID,
  p_question_id    UUID,
  p_selected_option INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_question        RECORD;
  v_round_state     RECORD;
  v_is_correct      BOOLEAN;
  v_response_time   INT;
  v_time_points     NUMERIC;
  v_points          INT;
  v_response_id     UUID;
BEGIN
  -- 1. Look up the question
  SELECT * INTO v_question FROM questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question not found');
  END IF;

  -- 2. Look up current round state
  SELECT * INTO v_round_state FROM round_state WHERE round = v_question.round;
  IF NOT FOUND OR v_round_state.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round is not active');
  END IF;

  -- 3. Verify this question is the current one
  -- Get the question at current_question_index for this round
  DECLARE
    v_current_question_id UUID;
  BEGIN
    SELECT id INTO v_current_question_id
    FROM questions
    WHERE round = v_question.round
      AND order_index = v_round_state.current_question_index
    LIMIT 1;

    IF v_current_question_id IS NULL OR v_current_question_id != p_question_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Question is not current');
    END IF;
  END;

  -- 4. Check for duplicate submission
  IF EXISTS (
    SELECT 1 FROM responses
    WHERE participant_id = p_participant_id AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already answered');
  END IF;

  -- 5. For round 2, verify the participant is the active hot-seat participant
  IF v_question.round = 2 AND v_round_state.active_participant_id != p_participant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not the hot seat participant');
  END IF;

  -- 6. Compute response time (server-side)
  v_response_time := EXTRACT(MILLISECONDS FROM (now() - v_round_state.question_started_at))::INT;

  -- 7. Check correctness
  v_is_correct := (p_selected_option = v_question.correct_option);

  -- 8. Compute score
  --    time_points = base_points * max(0, 10000 - response_time_ms) / 10000
  --    points_awarded = is_correct ? round(base_points + time_points) : 0
  IF v_is_correct THEN
    v_time_points := v_question.base_points * GREATEST(0, 10000 - v_response_time)::NUMERIC / 10000;
    v_points := ROUND(v_question.base_points + v_time_points)::INT;
  ELSE
    v_points := 0;
  END IF;

  -- 9. Insert response
  INSERT INTO responses (participant_id, question_id, round, selected_option, is_correct, response_time_ms, points_awarded)
  VALUES (p_participant_id, p_question_id, v_question.round, p_selected_option, v_is_correct, v_response_time, v_points)
  RETURNING id INTO v_response_id;

  RETURN jsonb_build_object(
    'success', true,
    'response_id', v_response_id,
    'is_correct', v_is_correct,
    'points_awarded', v_points,
    'response_time_ms', v_response_time
  );
END;
$$;


-- ─── advance_question ───────────────────────────────────────
-- Called by any client when its local countdown hits zero.
-- Atomic WHERE clause means only the first caller actually advances.
CREATE OR REPLACE FUNCTION advance_question(p_round INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_index INT;
  v_total_questions INT;
  v_rows_updated INT;
BEGIN
  -- Get current index
  SELECT current_question_index INTO v_current_index
  FROM round_state
  WHERE round = p_round AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round not active');
  END IF;

  -- Count total questions for this round
  SELECT COUNT(*) INTO v_total_questions FROM questions WHERE round = p_round;

  -- If we're at or past the last question, mark completed
  IF v_current_index + 1 >= v_total_questions THEN
    UPDATE round_state
    SET status = 'completed', question_started_at = now()
    WHERE round = p_round AND status = 'active'
      AND current_question_index = v_current_index;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated > 0 THEN
      RETURN jsonb_build_object('success', true, 'action', 'completed', 'round', p_round);
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'No-op (already advanced by another client)');
    END IF;
  END IF;

  -- Advance to next question (atomic — only first caller succeeds)
  UPDATE round_state
  SET current_question_index = current_question_index + 1,
      question_started_at = now()
  WHERE round = p_round
    AND status = 'active'
    AND current_question_index = v_current_index;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'advanced',
      'new_index', v_current_index + 1
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'No-op (already advanced by another client)');
  END IF;
END;
$$;


-- ─── claim_or_verify_pin ────────────────────────────────────
-- Module 3 participant login.
-- If pin_hash is null → claim (hash & save), return participant_id.
-- If pin_hash exists → compare, return participant_id on match, error on mismatch.
CREATE OR REPLACE FUNCTION claim_or_verify_pin(
  p_roll_no TEXT,
  p_pin     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_participant RECORD;
  v_hash        TEXT;
BEGIN
  -- Look up participant by roll_no
  SELECT * INTO v_participant FROM participants WHERE roll_no = p_roll_no;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Roll number not found');
  END IF;

  -- Hash the provided PIN
  v_hash := crypt(p_pin, gen_salt('bf'));

  IF v_participant.pin_hash IS NULL THEN
    -- First login: claim this PIN
    UPDATE participants SET pin_hash = v_hash WHERE id = v_participant.id;
    RETURN jsonb_build_object(
      'success', true,
      'participant_id', v_participant.id,
      'name', v_participant.name,
      'action', 'claimed'
    );
  ELSE
    -- Verify existing PIN
    IF v_participant.pin_hash = crypt(p_pin, v_participant.pin_hash) THEN
      RETURN jsonb_build_object(
        'success', true,
        'participant_id', v_participant.id,
        'name', v_participant.name,
        'action', 'verified'
      );
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Incorrect PIN');
    END IF;
  END IF;
END;
$$;


-- ─── start_round ────────────────────────────────────────────
-- Called by the admin to start a round. Uses server time (now()).
CREATE OR REPLACE FUNCTION start_round(
  p_round INT,
  p_active_participant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  UPDATE round_state
  SET status = 'active',
      current_question_index = 0,
      question_started_at = now(),
      active_participant_id = p_active_participant_id
  WHERE round = p_round;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated > 0 THEN
    RETURN jsonb_build_object('success', true, 'round', p_round);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Round not found');
  END IF;
END;
$$;
