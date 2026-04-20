-- Migration 002: P2 Admin Tokens + governance event type extension
-- Adds admin_tokens table for role-based access control.

CREATE TABLE IF NOT EXISTS admin_tokens (
  token_hash TEXT PRIMARY KEY,   -- SHA-256(raw_token) — raw token never stored
  actor_id   TEXT NOT NULL,      -- human-readable name / email
  role       TEXT NOT NULL CHECK(role IN ('admin', 'publisher')),
  created_at TEXT NOT NULL,
  expires_at TEXT,               -- NULL = no expiry
  note       TEXT
);

-- Extend governance event_type to include new P2 actions
-- (D1 CHECK constraints can't be altered; this is informational only)
-- New allowed values: 'imported_from_github', 'yanked', 'deprecated', 'status_changed'
-- These are accepted by the Worker logic even if the CHECK still lists old values
-- (SQLite CHECK is not enforced on existing rows; worker validates at application layer)
