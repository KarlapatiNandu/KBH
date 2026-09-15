-- ============================================================
-- KBH Schema — Module 1
-- Run this first in Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── participants ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS participants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roll_no     TEXT UNIQUE NOT NULL,
  name        TEXT,
  pin         TEXT,                        -- null until claimed on first login; stored raw
  created_at  TIMESTAMPTZ DEFAULT now(),

  -- Network check state (R2) — set by record_network_check after login
  network_status      TEXT DEFAULT 'pending'
                        CHECK (network_status IN ('pending', 'passed', 'failed')),
  network_checked_at  TIMESTAMPTZ,
  network_latency_ms  INT,
  network_detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_participants_roll_no ON participants (roll_no);

-- ─── questions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round           INT NOT NULL CHECK (round IN (1, 2)),
  text            TEXT NOT NULL,
  options         JSONB NOT NULL,           -- e.g. ["A", "B", "C", "D"]
  correct_option  INT NOT NULL,             -- 0-based index into options
  base_points     INT NOT NULL DEFAULT 100,
  order_index     INT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_round_order ON questions (round, order_index);

-- ─── round_state ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS round_state (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round                   INT NOT NULL UNIQUE CHECK (round IN (1, 2)),
  status                  TEXT NOT NULL DEFAULT 'inactive'
                            CHECK (status IN ('inactive', 'active', 'completed')),
  current_question_index  INT NOT NULL DEFAULT 0,
  question_started_at     TIMESTAMPTZ,
  active_participant_id   UUID REFERENCES participants(id) ON DELETE SET NULL,  -- round 2 hot seat

  -- Host serves questions by hand instead of clients auto-advancing (R5)
  manual_mode             BOOLEAN NOT NULL DEFAULT false,
  -- One authoritative question duration, shared by the client timer and
  -- the server-side clamp in submit_response (ISSUES 3.4)
  question_duration_ms    INT NOT NULL DEFAULT 10000
);

-- ─── responses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  question_id       UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  round             INT NOT NULL CHECK (round IN (1, 2)),
  selected_option   INT NOT NULL,
  is_correct        BOOLEAN NOT NULL,
  response_time_ms  INT NOT NULL,           -- client-measured, server-clamped (R6)
  points_awarded    INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),

  -- Block duplicate submissions
  UNIQUE (participant_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_responses_participant ON responses (participant_id);
CREATE INDEX IF NOT EXISTS idx_responses_question    ON responses (question_id);
CREATE INDEX IF NOT EXISTS idx_responses_round       ON responses (round);

-- ─── RLS (simple for v1) ────────────────────────────────────
-- Enable RLS on all tables
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses    ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admin) full access
DROP POLICY IF EXISTS "Admin full access on participants" ON participants;
CREATE POLICY "Admin full access on participants" ON participants
  FOR ALL USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admin full access on questions" ON questions;
CREATE POLICY "Admin full access on questions" ON questions
  FOR ALL USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admin full access on round_state" ON round_state;
CREATE POLICY "Admin full access on round_state" ON round_state
  FOR ALL USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admin full access on responses" ON responses;
CREATE POLICY "Admin full access on responses" ON responses
  FOR ALL USING (auth.role() = 'authenticated');

-- Allow anonymous reads for participant-facing queries
DROP POLICY IF EXISTS "Anon read questions" ON questions;
CREATE POLICY "Anon read questions" ON questions
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anon read round_state" ON round_state;
CREATE POLICY "Anon read round_state" ON round_state
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anon read participants (own)" ON participants;
CREATE POLICY "Anon read participants (own)" ON participants
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anon read responses" ON responses;
CREATE POLICY "Anon read responses" ON responses
  FOR SELECT USING (true);

-- Hide pin from anonymous clients (ISSUES 1.5).
-- RLS is row-level; column-level grants are the tool for this.
--
-- `REVOKE SELECT (pin)` alone does NOT work: while a role still holds
-- the table-level SELECT grant, Postgres cannot subtract a single column
-- from it — it emits "no privileges could be revoked" and the column stays
-- readable. The table grant has to go first, then the allowed columns come
-- back individually.
--
-- Every anonymous read of `participants` in the app names its columns
-- explicitly; only the admin Participants tab does `select('*')`, and that
-- runs as `authenticated`, which keeps full access.
REVOKE SELECT ON participants FROM anon;
GRANT  SELECT (id, roll_no, name, created_at,
               network_status, network_checked_at,
               network_latency_ms, network_detail)
  ON participants TO anon;

-- Enable realtime for round_state, responses and participants
-- (participants so failed network checks surface live in the admin list)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE round_state;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE responses;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE participants;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
