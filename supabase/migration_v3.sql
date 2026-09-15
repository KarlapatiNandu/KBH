-- ============================================================
-- KBH Migration v3
-- Safe to run against an existing v1/v2 database. Idempotent.
-- Run this FIRST, then re-run rpcs.sql.
--
-- Changes:
--   * pin_hash (bcrypt) → pin (raw text). Simplifies claim_or_verify_pin
--     and drops the pgcrypto hashing step — accepted tradeoff for a
--     hobby project where the admin needs to read PINs back to help
--     participants who forget them.
--   * Existing pin_hash values are bcrypt hashes, not valid raw PINs, so
--     they're cleared — everyone reclaims a PIN on their next login.
-- ============================================================

ALTER TABLE participants RENAME COLUMN pin_hash TO pin;
UPDATE participants SET pin = NULL WHERE pin IS NOT NULL;

-- ─── Hide pin from anonymous clients (ISSUES 1.5), same as before ───
-- `authenticated` (the admin) keeps full access.
REVOKE SELECT ON participants FROM anon;
GRANT  SELECT (id, roll_no, name, created_at,
               network_status, network_checked_at,
               network_latency_ms, network_detail)
  ON participants TO anon;
