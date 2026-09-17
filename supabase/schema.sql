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

-- ─── admins ─────────────────────────────────────────────────
-- Custom admin login, checked via the verify_admin RPC — not Supabase
-- Auth. No RLS policy grants anon direct access to this table; it's only
-- reachable through the SECURITY DEFINER RPC, which bypasses RLS. That
-- keeps admin credentials off the open anon-key surface even though
-- participants/questions/round_state are fully open below.
CREATE TABLE IF NOT EXISTS admins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,                 -- stored raw, same tradeoff as participants.pin
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── questions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round           INT NOT NULL CHECK (round IN (1, 2)),
  text            TEXT NOT NULL,
  options         JSONB NOT NULL,           -- e.g. ["A", "B", "C", "D"]
  correct_option  INT NOT NULL,             -- 0-based index into options
  base_points     INT NOT NULL DEFAULT 100,
  order_index     INT NOT NULL,
  -- Per-question countdown; NULL → round_state.question_duration_ms (R8)
  duration_ms     INT CHECK (duration_ms IS NULL OR duration_ms > 0),
  -- Free-text prize shown on the Round 2 screen, e.g. "₹10,000" (R8)
  prize           TEXT,
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
ALTER TABLE admins       ENABLE ROW LEVEL SECURITY;

-- No admin login is minted via Supabase Auth anymore (verify_admin checks
-- the admins table directly), so `auth.role() = 'authenticated'` never
-- happens in this app. Admin access is instead the anon key wide open on
-- these three tables — the admin console gates itself client-side (see
-- LoginPage.jsx) rather than at the database. Fine for a hobby project,
-- but note: anyone with the anon key (visible in any browser's network
-- tab) can read/write these tables directly, login screen or not.
DROP POLICY IF EXISTS "Admin full access on participants" ON participants;
CREATE POLICY "Open access on participants" ON participants
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access on questions" ON questions;
CREATE POLICY "Open access on questions" ON questions
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin full access on round_state" ON round_state;
CREATE POLICY "Open access on round_state" ON round_state
  FOR ALL USING (true) WITH CHECK (true);

-- `responses` stays read-only for anon. Every legitimate write goes
-- through the submit_response RPC (SECURITY DEFINER, bypasses RLS
-- entirely), and no admin screen writes to this table directly — so unlike
-- the three tables above, there's no reason to open INSERT/UPDATE/DELETE
-- here. Doing so would let anyone write themselves a perfect score
-- directly via the REST API, which is a real cheating vector, not just a
-- data-access nicety like the tables above.
DROP POLICY IF EXISTS "Admin full access on responses" ON responses;
DROP POLICY IF EXISTS "Anon read responses" ON responses;
CREATE POLICY "Anon read responses" ON responses
  FOR SELECT USING (true);

-- The old per-table "Anon read ..." policies are now redundant — "Open
-- access on ..." above is FOR ALL, so it already covers SELECT. Dropped
-- rather than left in place as dead duplicates.
DROP POLICY IF EXISTS "Anon read questions" ON questions;
DROP POLICY IF EXISTS "Anon read round_state" ON round_state;
DROP POLICY IF EXISTS "Anon read participants (own)" ON participants;

-- admins: deliberately NO policy grants anon anything here. RLS with zero
-- permissive policies denies all access by default — the only way in is
-- the SECURITY DEFINER verify_admin RPC, which bypasses RLS as the
-- function owner regardless of the caller's role.

-- participants.pin no longer needs the column-level grant dance from
-- earlier — "Open access on participants" already covers full-column
-- SELECT for anon (including pin), which the admin's `select('*')` now
-- relies on since it's not running as `authenticated` anymore.

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
