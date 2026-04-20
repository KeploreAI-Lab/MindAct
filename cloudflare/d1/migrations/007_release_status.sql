-- Migration 007: Add status field to releases for revoke/restore support
-- status: 'active' (default) | 'revoked'
-- Revoked releases are hidden from public endpoints but retained in DB for audit.

ALTER TABLE releases ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Index for fast filtering of active releases
CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);
