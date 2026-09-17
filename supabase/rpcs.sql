-- ============================================================
-- KBH RPC Functions
-- Run this AFTER schema.sql (fresh setup) or AFTER migration_v2.sql
-- (existing database). Re-runnable.
--
-- Every function pins `search_path` — a mutable search_path on a
-- SECURITY DEFINER function is the standard Postgres privilege-escalation
-- vector, and `crypt()`/`gen_salt()` live in the `extensions` schema on
-- Supabase, not `public`.  (ISSUES 1.6)
-- ============================================================

-- Signatures changed in v2 — drop the old ones so we replace rather than
-- overload them.
DROP FUNCTION IF EXISTS submit_response(UUID, UUID, INT);

-- ─── network_ping ───────────────────────────────────────────
-- Cheapest possible authenticated-free round trip. Used by the
-- participant network check (R2) to measure latency.
CREATE OR REPLACE FUNCTION network_ping()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object('ok', true, 'server_time', now());
$$;


-- ─── record_network_check ───────────────────────────────────
-- Participants are anonymous clients and cannot write to `participants`
-- under RLS, so the network-check verdict comes back through here. (R2)
CREATE OR REPLACE FUNCTION record_network_check(
  p_participant_id UUID,
  p_passed         BOOLEAN,
  p_latency_ms     INT  DEFAULT NULL,
  p_detail         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  UPDATE participants
  SET network_status     = CASE WHEN p_passed THEN 'passed' ELSE 'failed' END,
      network_checked_at = now(),
      network_latency_ms = p_latency_ms,
      network_detail     = p_detail
  WHERE id = p_participant_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Participant not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'network_status', CASE WHEN p_passed THEN 'passed' ELSE 'failed' END
  );
END;
$$;


-- ─── submit_response ────────────────────────────────────────
-- Called by participants to submit an answer.
--
-- v2: response time is measured CLIENT-side and passed in as
-- p_response_time_ms — every participant gets the full question duration
-- from the moment the question renders on their device, rather than from
-- the server's question_started_at (which punishes slow realtime delivery).
-- The server clamps the supplied value to [0, question_duration_ms] and
-- falls back to its own clock if the client sends nothing.
-- The server still owns correctness, duplicate rejection and scoring.
CREATE OR REPLACE FUNCTION submit_response(
  p_participant_id  UUID,
  p_question_id     UUID,
  p_selected_option INT,
  p_response_time_ms INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_question        RECORD;
  v_round_state     RECORD;
  v_is_correct      BOOLEAN;
  v_response_time   INT;
  v_duration        INT;
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

  v_duration := COALESCE(v_round_state.question_duration_ms, 10000);

  -- 3. Verify this question is the current one (matched by order_index)
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

  -- 5. Round 2 answers are entered by the host, never by the contestant:
  --    the hot seat says their answer out loud and the host locks it in
  --    through host_submit_answer, which sets this transaction-local flag
  --    before calling in here. (R7)
  IF v_question.round = 2
     AND COALESCE(current_setting('kbh.host_submit', true), '') <> 'on' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round 2 answers are entered by the host');
  END IF;

  IF v_question.round = 2
     AND v_round_state.active_participant_id IS DISTINCT FROM p_participant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not the hot seat participant');
  END IF;

  -- 6. Resolve response time.
  IF p_response_time_ms IS NOT NULL THEN
    -- Client-measured (v2 default path). Clamp to the legal window.
    v_response_time := LEAST(GREATEST(p_response_time_ms, 0), v_duration);
  ELSIF v_round_state.question_started_at IS NULL THEN
    -- Server fallback needs a start stamp. (ISSUES 1.7)
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Question has no start time — ask the host to re-serve this question'
    );
  ELSE
    -- Server fallback. EXTRACT(EPOCH …), not EXTRACT(MILLISECONDS …),
    -- which returns only the seconds field × 1000 and wraps every 60 s.
    -- (ISSUES 1.1)
    v_response_time := LEAST(
      GREATEST(
        (EXTRACT(EPOCH FROM (now() - v_round_state.question_started_at)) * 1000)::INT,
        0
      ),
      v_duration
    );
  END IF;

  -- 7. Check correctness
  v_is_correct := (p_selected_option = v_question.correct_option);

  -- 8. Compute score
  --    time_points = base_points * max(0, duration - response_time_ms) / duration
  --    points_awarded = is_correct ? round(base_points + time_points) : 0
  IF v_is_correct THEN
    v_time_points := v_question.base_points
                     * GREATEST(0, v_duration - v_response_time)::NUMERIC
                     / NULLIF(v_duration, 0);
    v_points := ROUND(v_question.base_points + COALESCE(v_time_points, 0))::INT;
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


-- ─── host_submit_answer ─────────────────────────────────────
-- The host locks in the hot seat's answer on their behalf. (R7)
-- Resolves the live Round 2 question and the active participant
-- server-side, so the admin console only needs to send the option.
-- Response time is measured from question_started_at on the server
-- (submit_response's fallback path) — the contestant's own device is
-- not involved.
CREATE OR REPLACE FUNCTION host_submit_answer(p_selected_option INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_round_state RECORD;
  v_question_id UUID;
BEGIN
  SELECT * INTO v_round_state FROM round_state WHERE round = 2;
  IF NOT FOUND OR v_round_state.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round 2 is not active');
  END IF;

  IF v_round_state.active_participant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No hot seat participant nominated');
  END IF;

  SELECT id INTO v_question_id
  FROM questions
  WHERE round = 2 AND order_index = v_round_state.current_question_index
  LIMIT 1;

  IF v_question_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No live question');
  END IF;

  IF p_selected_option IS NULL OR p_selected_option < 0 OR p_selected_option > 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Option must be 0–3');
  END IF;

  -- Transaction-local: submit_response reads this to allow the round 2 write.
  PERFORM set_config('kbh.host_submit', 'on', true);

  RETURN submit_response(
    v_round_state.active_participant_id,
    v_question_id,
    p_selected_option,
    NULL
  ) || jsonb_build_object(
    'participant_id', v_round_state.active_participant_id,
    'question_id', v_question_id,
    'selected_option', p_selected_option
  );
END;
$$;


-- ─── advance_question ───────────────────────────────────────
-- Called by a participant client when its local countdown hits zero.
-- Atomic WHERE clause means only the first caller actually advances.
--
-- v2: refuses to run while the round is in manual mode — the host is
-- driving question order by hand and auto-advance must not fight them.
CREATE OR REPLACE FUNCTION advance_question(p_round INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_current_index INT;
  v_manual        BOOLEAN;
  v_max_order     INT;
  v_next_order    INT;
  v_rows_updated  INT;
BEGIN
  SELECT current_question_index, manual_mode
    INTO v_current_index, v_manual
  FROM round_state
  WHERE round = p_round AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round not active');
  END IF;

  IF v_manual THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round is in manual mode — the host serves questions');
  END IF;

  -- Next question by order_index, not by array position. (ISSUES 1.4)
  SELECT MIN(order_index) INTO v_next_order
  FROM questions
  WHERE round = p_round AND order_index > v_current_index;

  SELECT MAX(order_index) INTO v_max_order
  FROM questions
  WHERE round = p_round;

  -- No questions at all, or nothing after the current one → completed.
  IF v_max_order IS NULL OR v_next_order IS NULL THEN
    UPDATE round_state
    SET status = 'completed'
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
  SET current_question_index = v_next_order,
      question_started_at = now()
  WHERE round = p_round
    AND status = 'active'
    AND current_question_index = v_current_index;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'advanced',
      'new_index', v_next_order
    );
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'No-op (already advanced by another client)');
  END IF;
END;
$$;


-- ─── serve_question ─────────────────────────────────────────
-- Admin picks any question and pushes it live, in any order, at any
-- time. (R5) Forces manual mode on so auto-advance stops competing.
--
-- p_clear_responses re-opens a question that has already been answered —
-- without it, submit_response rejects everyone with "Already answered".
-- (ISSUES 1.3)
CREATE OR REPLACE FUNCTION serve_question(
  p_round            INT,
  p_question_id      UUID,
  p_clear_responses  BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_question     RECORD;
  v_rows_updated INT;
  v_cleared      INT := 0;
BEGIN
  SELECT * INTO v_question FROM questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question not found');
  END IF;

  IF v_question.round != p_round THEN
    RETURN jsonb_build_object('success', false, 'error', 'Question belongs to a different round');
  END IF;

  IF p_clear_responses THEN
    DELETE FROM responses WHERE question_id = p_question_id;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  UPDATE round_state
  SET status                 = 'active',
      manual_mode            = true,
      current_question_index = v_question.order_index,
      question_started_at    = now()
  WHERE round = p_round;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'round', p_round,
    'question_id', p_question_id,
    'order_index', v_question.order_index,
    'cleared_responses', v_cleared
  );
END;
$$;


-- ─── set_manual_mode ────────────────────────────────────────
-- Toggle between host-driven question serving and client auto-advance. (R5)
CREATE OR REPLACE FUNCTION set_manual_mode(p_round INT, p_manual BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  UPDATE round_state SET manual_mode = p_manual WHERE round = p_round;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'round', p_round, 'manual_mode', p_manual);
END;
$$;


-- ─── nominate_hotseat ───────────────────────────────────────
-- Set (or clear, with NULL) the Round 2 hot seat without starting the
-- round. The nominee's home screen lights up via realtime. (R4)
CREATE OR REPLACE FUNCTION nominate_hotseat(p_participant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_participant  RECORD;
  v_rows_updated INT;
BEGIN
  IF p_participant_id IS NOT NULL THEN
    SELECT id, roll_no, name INTO v_participant
    FROM participants WHERE id = p_participant_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Participant not found');
    END IF;
  END IF;

  UPDATE round_state
  SET active_participant_id = p_participant_id
  WHERE round = 2;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round 2 state row not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'participant_id', p_participant_id,
    'roll_no', v_participant.roll_no,
    'name', v_participant.name
  );
END;
$$;


-- ─── reset_round ────────────────────────────────────────────
-- Puts a round back to a runnable state. Without clearing responses a
-- round cannot be re-run: the UNIQUE (participant_id, question_id)
-- constraint makes submit_response reject everyone. (ISSUES 1.3)
CREATE OR REPLACE FUNCTION reset_round(
  p_round           INT,
  p_clear_responses BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_first_index  INT;
  v_cleared      INT := 0;
  v_rows_updated INT;
BEGIN
  IF p_clear_responses THEN
    DELETE FROM responses WHERE round = p_round;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  SELECT COALESCE(MIN(order_index), 0) INTO v_first_index
  FROM questions WHERE round = p_round;

  UPDATE round_state
  SET status                 = 'inactive',
      current_question_index = v_first_index,
      question_started_at    = NULL
  WHERE round = p_round;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Round not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'round', p_round,
    'cleared_responses', v_cleared
  );
END;
$$;


-- ─── claim_or_verify_pin ────────────────────────────────────
-- Module 3 participant login.
-- If pin is null → claim (save raw), return participant_id.
-- If pin is set  → compare, return participant_id on match, error on mismatch.
CREATE OR REPLACE FUNCTION claim_or_verify_pin(
  p_roll_no TEXT,
  p_pin     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_participant RECORD;
BEGIN
  SELECT * INTO v_participant FROM participants WHERE roll_no = p_roll_no;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Roll number not found');
  END IF;

  IF v_participant.pin IS NULL THEN
    -- First login: claim this PIN
    UPDATE participants SET pin = p_pin WHERE id = v_participant.id;
    RETURN jsonb_build_object(
      'success', true,
      'participant_id', v_participant.id,
      'name', v_participant.name,
      'action', 'claimed'
    );
  ELSE
    -- Verify existing PIN
    IF v_participant.pin = p_pin THEN
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


-- ─── verify_admin ───────────────────────────────────────────
-- Custom admin login, checked against the `admins` table instead of
-- Supabase Auth. Same shape as claim_or_verify_pin: distinct errors for
-- "no such user" vs "wrong password" rather than one generic message,
-- matching the participant login's style.
CREATE OR REPLACE FUNCTION verify_admin(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  SELECT * INTO v_admin FROM admins WHERE username = p_username;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username not found');
  END IF;

  IF v_admin.password != p_password THEN
    RETURN jsonb_build_object('success', false, 'error', 'Incorrect password');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'admin_id', v_admin.id,
    'username', v_admin.username
  );
END;
$$;


-- ─── start_round ────────────────────────────────────────────
-- Called by the admin to start a round. Uses server time (now()).
-- Starts at the round's LOWEST order_index rather than a hardcoded 0,
-- so a round whose first question was deleted still starts. (ISSUES 1.4)
CREATE OR REPLACE FUNCTION start_round(
  p_round INT,
  p_active_participant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_first_index    INT;
  v_question_count INT;
  v_rows_updated   INT;
BEGIN
  SELECT COUNT(*), MIN(order_index)
    INTO v_question_count, v_first_index
  FROM questions WHERE round = p_round;

  -- Starting an empty round leaves participants on a permanent
  -- "waiting for next question" screen. (ISSUES 2.7)
  IF v_question_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Round has no questions — add questions before starting'
    );
  END IF;

  UPDATE round_state
  SET status = 'active',
      current_question_index = v_first_index,
      question_started_at = now(),
      active_participant_id = COALESCE(p_active_participant_id, active_participant_id)
  WHERE round = p_round;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated > 0 THEN
    RETURN jsonb_build_object('success', true, 'round', p_round, 'first_index', v_first_index);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Round not found');
  END IF;
END;
$$;


-- ─── renumber_questions ─────────────────────────────────────
-- Compacts order_index for a round to a gapless 0-based sequence.
-- Called after a delete so client/server addressing stays aligned
-- and Next/Previous in the host console has no holes. (ISSUES 1.4)
CREATE OR REPLACE FUNCTION renumber_questions(p_round INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY order_index, created_at) - 1 AS new_index
    FROM questions
    WHERE round = p_round
  )
  UPDATE questions q
  SET order_index = o.new_index
  FROM ordered o
  WHERE q.id = o.id AND q.order_index IS DISTINCT FROM o.new_index;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'round', p_round, 'renumbered', v_updated);
END;
$$;
