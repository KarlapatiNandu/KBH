-- ============================================================
-- KBH Migration v4
-- Safe to run against an existing v1/v2/v3 database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Replaces Supabase Auth for admin login with a plain `admins` table,
-- checked via the new verify_admin RPC. Supabase's own Auth gateway had
-- been rejecting sign-in for this project (legacy JWT anon key vs the new
-- key system, plus a weak-password policy mismatch) — simplest fix is to
-- stop depending on it for something this low-stakes.
--
-- RLS tradeoff: participants/questions/round_state open up to the anon
-- key entirely, since there's no more Supabase Auth session to gate on —
-- admin access is enforced client-side (the login screen) rather than by
-- the database. `responses` stays read-only for anon; nothing writes to
-- it directly (submit_response is SECURITY DEFINER), and opening it would
-- let anyone post themselves a perfect score via the REST API.
-- ============================================================

-- ─── admins table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy — RLS with zero permissive policies denies all
-- anon access. Only verify_admin (SECURITY DEFINER) can read this table.

-- ─── Open participants/questions/round_state to anon ─────────
DROP POLICY IF EXISTS "Admin full access on participants" ON participants;
DROP POLICY IF EXISTS "Anon read participants (own)"      ON participants;
CREATE POLICY "Open access on participants" ON participants
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin full access on questions" ON questions;
DROP POLICY IF EXISTS "Anon read questions"            ON questions;
CREATE POLICY "Open access on questions" ON questions
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin full access on round_state" ON round_state;
DROP POLICY IF EXISTS "Anon read round_state"             ON round_state;
CREATE POLICY "Open access on round_state" ON round_state
  FOR ALL USING (true) WITH CHECK (true);

-- responses: stays read-only for anon — no change needed beyond dropping
-- the now-pointless auth.role()-based policy.
DROP POLICY IF EXISTS "Admin full access on responses" ON responses;

-- ─── participants.pin: drop the old column-level restriction ──
-- The admin console's `select('*')` now runs as anon (no more
-- `authenticated` role), and Postgres errors a `SELECT *` outright if the
-- caller lacks privilege on even one column. "Open access on
-- participants" above already covers full-column SELECT, but the old
-- column-scoped GRANT from migration_v2/v3 is still narrower and would
-- shadow it — remove it so the table-level grant applies.
GRANT SELECT ON participants TO anon;

-- ─── Seed your first admin ─────────────────────────────────────
-- Edit the username/password below, then uncomment and run:
-- INSERT INTO admins (username, password) VALUES ('admin', 'change-me');
