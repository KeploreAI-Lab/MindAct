-- Migration 005: Release management tables
-- Stores binary release metadata; actual files live in R2 under releases/{version}/{platform}/{filename}

CREATE TABLE IF NOT EXISTS releases (
  id           TEXT PRIMARY KEY,        -- same as version, e.g. "v1.2.3"
  version      TEXT NOT NULL UNIQUE,    -- semver string, e.g. "1.2.3"
  channel      TEXT NOT NULL DEFAULT 'stable', -- stable | beta | nightly
  release_notes TEXT,
  published_at TEXT NOT NULL,           -- ISO 8601
  published_by TEXT,                    -- actor_id from admin_tokens
  is_latest    INTEGER NOT NULL DEFAULT 0  -- 0 or 1; only one row should be 1 per channel
);

CREATE TABLE IF NOT EXISTS release_assets (
  id           TEXT PRIMARY KEY,        -- UUID
  release_id   TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,           -- macos-arm64 | macos-x64 | windows-x64 | linux-x64 | linux-arm64
  filename     TEXT NOT NULL,           -- physmind-macos-arm64.dmg
  r2_key       TEXT NOT NULL,           -- releases/v1.2.3/macos-arm64/physmind-macos-arm64.dmg
  size_bytes   INTEGER,
  sha256       TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(release_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_release_assets_release ON release_assets(release_id);
CREATE INDEX IF NOT EXISTS idx_releases_channel_latest ON releases(channel, is_latest);
