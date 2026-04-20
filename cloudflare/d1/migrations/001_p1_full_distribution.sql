-- Migration 001: P1 Full Distribution
-- Adds fields for complete package distribution: zip storage, integrity, lifecycle status.

-- ─── dependency_versions: add distribution fields ─────────────────────────────

ALTER TABLE dependency_versions ADD COLUMN r2_zip_key      TEXT;             -- R2 key: packages/{id}/v{ver}/package.zip
ALTER TABLE dependency_versions ADD COLUMN r2_skillmd_key  TEXT;             -- R2 key: packages/{id}/v{ver}/SKILL.md
ALTER TABLE dependency_versions ADD COLUMN zip_sha256      TEXT;             -- SHA-256 hex of package.zip
ALTER TABLE dependency_versions ADD COLUMN zip_size_bytes  INTEGER;          -- byte size of package.zip
ALTER TABLE dependency_versions ADD COLUMN status          TEXT NOT NULL DEFAULT 'published'
  CHECK(status IN ('pending','published','deprecated','yanked'));             -- lifecycle state
ALTER TABLE dependency_versions ADD COLUMN reviewed_by     TEXT;             -- actor_id who approved
ALTER TABLE dependency_versions ADD COLUMN reviewed_at     TEXT;             -- ISO8601 approve timestamp

-- ─── registry_installs: add client audit fields ───────────────────────────────

ALTER TABLE registry_installs ADD COLUMN zip_sha256     TEXT;               -- sha256 client verified at install time
ALTER TABLE registry_installs ADD COLUMN client_version TEXT;               -- MindAct client version

-- ─── Index: filter by status efficiently ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ver_status ON dependency_versions(status);
