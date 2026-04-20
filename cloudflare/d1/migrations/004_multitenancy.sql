-- MindAct Registry — Migration 004: Multi-tenancy (Users, Organizations, Ownership)
-- Run: wrangler d1 execute mindact-registry --file=cloudflare/d1/migrations/004_multitenancy.sql

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,         -- UUID v4
  email        TEXT UNIQUE NOT NULL,
  token_hash   TEXT UNIQUE NOT NULL,     -- SHA-256(mact_xxx raw token)
  token_prefix TEXT NOT NULL,            -- first 8 chars of raw token for display
  username     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_token_hash ON users(token_hash);

-- ── OTP codes (for token retrieval via email) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS email_otps (
  id         TEXT PRIMARY KEY,           -- UUID v4
  email      TEXT NOT NULL,
  otp_hash   TEXT NOT NULL,             -- SHA-256(6-digit code)
  expires_at TEXT NOT NULL,             -- 10-minute TTL from creation
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON email_otps(email);

-- ── Organizations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id           TEXT PRIMARY KEY,         -- slug, e.g. "acme-ai" (user-chosen)
  display_name TEXT NOT NULL,
  created_by   TEXT NOT NULL,            -- users.id of founder
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_active    INTEGER NOT NULL DEFAULT 1
);

-- ── Org membership ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_orgs (
  user_id   TEXT NOT NULL,
  org_id    TEXT NOT NULL,
  role      TEXT NOT NULL CHECK(role IN ('member', 'admin')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, org_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id)  REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_orgs_user ON user_orgs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_orgs_org  ON user_orgs(org_id);

-- ── Extend decision_dependencies with ownership ───────────────────────────────
-- NULL owner_user_id = legacy/admin-owned (backward compat)
ALTER TABLE decision_dependencies ADD COLUMN owner_user_id TEXT;
ALTER TABLE decision_dependencies ADD COLUMN owner_org_id  TEXT;
-- publisher TEXT column is kept for backward compat (display name / legacy actor)
-- Visibility semantics (unchanged enum, redefined scope):
--   private  → only owner_user_id can see it
--   org      → all members of owner_org_id can see it
--   public   → visible to everyone (unauthenticated or any user)

-- ── Extend governance_events with user-level actors ───────────────────────────
-- actor TEXT kept for backward compat (legacy admin token actor_id)
ALTER TABLE governance_events ADD COLUMN actor_user_id TEXT;  -- users.id (nullable)
ALTER TABLE governance_events ADD COLUMN actor_role    TEXT;  -- 'admin'|'publisher'|'org_admin'|'system'
