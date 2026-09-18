-- ============================================================
-- KBH Migration v7
-- Safe to run against an existing database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Round 2 lifelines (R10):
--   * lifeline_state     — one row per lifeline, per round. Round 2 only
--     today, but keyed by round so a future round can have its own set
--     without a schema change.
--   * lifeline_contacts  — the phone book shown by Call an Expert and
--     Phone a Friend. Editable from the admin console while the lifeline
--     is on screen, so the host can fix a name mid-show and the
--     contestant sees it through realtime.
--
-- The four lifelines and how each one behaves:
--   audience_poll — the poll itself runs on WhatsApp. Here it is only an
--     indicator on the contestant's screen; the host ends it by hand.
--   fifty_fifty   — the host picks the two wrong options to strike out;
--     they are stored in removed_options and hidden on the contestant's
--     screen for that question only.
--   call_expert / phone_friend — the question countdown freezes, the
--     phone comes up with the contact list, and a separate countdown of
--     its own (started_at + duration_ms) runs in its place.
-- ============================================================

-- ─── lifeline_state ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifeline_state (
  round           INT  NOT NULL CHECK (round IN (1, 2)),
  key             TEXT NOT NULL CHECK (key IN ('audience_poll', 'fifty_fifty', 'call_expert', 'phone_friend')),
  -- available → never used; active → running on screen now; used → spent.
  status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'active', 'used')),
  -- The question this lifeline was played on. Everything the contestant's
  -- screen draws from this row is scoped to it, so a 50:50 struck on Q3
  -- cannot grey out options on Q4 and an overlay cannot outlive its serve.
  question_id     UUID REFERENCES questions(id) ON DELETE SET NULL,
  -- fifty_fifty only: the two 0-based option indices to hide.
  removed_options JSONB,
  -- call_expert / phone_friend: anchor + length of the replacement
  -- countdown. NULL duration falls back to the client default (30s).
  started_at      TIMESTAMPTZ,
  duration_ms     INT CHECK (duration_ms IS NULL OR duration_ms > 0),
  activated_at    TIMESTAMPTZ,
  PRIMARY KEY (round, key)
);

-- Seed round 2's four lifelines. ON CONFLICT so a re-run never resets a
-- lifeline that is mid-show.
INSERT INTO lifeline_state (round, key)
VALUES (2, 'audience_poll'), (2, 'fifty_fifty'), (2, 'call_expert'), (2, 'phone_friend')
ON CONFLICT (round, key) DO NOTHING;

-- ─── lifeline_contacts ──────────────────────────────────────
-- kind splits the two phone lifelines' address books: the expert panel
-- and the contestant's own friends are different lists on the show.
CREATE TABLE IF NOT EXISTS lifeline_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('expert', 'friend')),
  name        TEXT NOT NULL,
  detail      TEXT,            -- subtitle, e.g. "Physics · IIT-B"
  avatar_url  TEXT,            -- optional photo; falls back to an initial
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lifeline_contacts_kind ON lifeline_contacts (kind, sort_order);

-- ─── RLS ────────────────────────────────────────────────────
-- Same posture as questions/round_state: open to anon, because the admin
-- console has no database identity of its own (see migration_v4). Reads
-- have to be open for the contestant's screen either way; writes to
-- lifeline_state all go through the SECURITY DEFINER RPCs below, and the
-- contacts list is edited straight from the console.
ALTER TABLE lifeline_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeline_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Open access on lifeline_state" ON lifeline_state;
CREATE POLICY "Open access on lifeline_state" ON lifeline_state
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Open access on lifeline_contacts" ON lifeline_contacts;
CREATE POLICY "Open access on lifeline_contacts" ON lifeline_contacts
  FOR ALL USING (true) WITH CHECK (true);

-- ─── Realtime ───────────────────────────────────────────────
-- The contestant's screen reacts to both: a lifeline going live, and the
-- host correcting a contact while the phone is already up.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE lifeline_state;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE lifeline_contacts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
