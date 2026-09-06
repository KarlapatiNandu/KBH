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
  pin_hash    TEXT,                        -- null until claimed on first login
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_participants_roll_no ON participants (roll_no);

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

CREATE INDEX idx_questions_round_order ON questions (round, order_index);

-- ─── round_state ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS round_state (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round                   INT NOT NULL UNIQUE CHECK (round IN (1, 2)),
  status                  TEXT NOT NULL DEFAULT 'inactive'
                            CHECK (status IN ('inactive', 'active', 'completed')),
  current_question_index  INT NOT NULL DEFAULT 0,
  question_started_at     TIMESTAMPTZ,
  active_participant_id   UUID REFERENCES participants(id)  -- used only for round 2
);

-- ─── responses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id),
  question_id       UUID NOT NULL REFERENCES questions(id),
  round             INT NOT NULL CHECK (round IN (1, 2)),
  selected_option   INT NOT NULL,
  is_correct        BOOLEAN NOT NULL,
  response_time_ms  INT NOT NULL,           -- computed server-side
  points_awarded    INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),

  -- Block duplicate submissions
  UNIQUE (participant_id, question_id)
);

CREATE INDEX idx_responses_participant ON responses (participant_id);
CREATE INDEX idx_responses_question    ON responses (question_id);
CREATE INDEX idx_responses_round       ON responses (round);

-- ─── RLS (simple for v1) ────────────────────────────────────
-- Enable RLS on all tables
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses    ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admin) full access
CREATE POLICY "Admin full access on participants" ON participants
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Admin full access on questions" ON questions
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Admin full access on round_state" ON round_state
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Admin full access on responses" ON responses
  FOR ALL USING (auth.role() = 'authenticated');

-- Allow anonymous reads for participant-facing queries
CREATE POLICY "Anon read questions" ON questions
  FOR SELECT USING (true);
CREATE POLICY "Anon read round_state" ON round_state
  FOR SELECT USING (true);
CREATE POLICY "Anon read participants (own)" ON participants
  FOR SELECT USING (true);
CREATE POLICY "Anon read responses" ON responses
  FOR SELECT USING (true);

-- Enable realtime for round_state and responses
ALTER PUBLICATION supabase_realtime ADD TABLE round_state;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;
