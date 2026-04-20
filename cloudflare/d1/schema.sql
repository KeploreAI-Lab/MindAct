-- MindAct Registry — Cloudflare D1 Schema
-- Two-layer design: identity table (stable) + versions table (per-version content).
-- Never store: content blobs (→ R2), installedAt (local-only), source.path (local-only).

-- ─── Layer 1: Stable package identity ────────────────────────────────────────
-- Fields here are immutable after first publish.
-- No version-specific fields (no maturity, no manifest_json, no r2_blob_key).

CREATE TABLE IF NOT EXISTS decision_dependencies (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  type             TEXT NOT NULL CHECK(type IN ('skill','knowledge','connector','memory')),
  modes            TEXT NOT NULL DEFAULT '[]',   -- JSON array of DDMode
  tags             TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  domain           TEXT NOT NULL DEFAULT '',
  publisher        TEXT NOT NULL,
  visibility       TEXT NOT NULL CHECK(visibility IN ('public','private','org')),
  org_id           TEXT,                          -- NULL for public/private
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  installed_count  INTEGER NOT NULL DEFAULT 0
);

-- ─── Layer 2: Version-specific content ───────────────────────────────────────
-- One row per (dd_id, version). Holds everything that can change across versions.
-- manifest_json is the authoritative source for all version-specific fields.

CREATE TABLE IF NOT EXISTS dependency_versions (
  dd_id            TEXT NOT NULL,
  version          TEXT NOT NULL,
  trust            TEXT NOT NULL CHECK(trust IN ('untrusted','reviewed','org-approved')),
  maturity         TEXT NOT NULL CHECK(maturity IN ('L0','L1','L2','L3')),
  manifest_json    TEXT NOT NULL,    -- full normalized ManifestSchema JSON
  r2_blob_key      TEXT,             -- legacy: R2 key for package.zip or SKILL.md blob
  r2_zip_key       TEXT,             -- R2 key: packages/{id}/v{ver}/package.zip
  r2_skillmd_key   TEXT,             -- R2 key: packages/{id}/v{ver}/SKILL.md
  zip_sha256       TEXT,             -- SHA-256 hex of package.zip
  zip_size_bytes   INTEGER,          -- byte size of package.zip
  status           TEXT NOT NULL DEFAULT 'published'
                   CHECK(status IN ('pending','published','deprecated','yanked')),
  reviewed_by      TEXT,             -- actor_id who approved
  reviewed_at      TEXT,             -- ISO8601 approve timestamp
  changelog        TEXT,
  published_at     TEXT NOT NULL,
  is_latest        INTEGER NOT NULL DEFAULT 0,  -- 1 for current latest version
  PRIMARY KEY (dd_id, version),
  FOREIGN KEY (dd_id) REFERENCES decision_dependencies(id) ON DELETE CASCADE
);

-- ─── Install audit trail ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS registry_installs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dd_id          TEXT NOT NULL,
  version        TEXT NOT NULL,
  user_id        TEXT,
  org_id         TEXT,
  installed_at   TEXT NOT NULL,
  source_type    TEXT NOT NULL CHECK(source_type IN ('local','github','remote')),
  zip_sha256     TEXT,    -- sha256 client verified at install time
  client_version TEXT     -- MindAct client version string
);

-- ─── GitHub import sessions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS github_imports (
  import_hash     TEXT PRIMARY KEY,
  repo_url        TEXT NOT NULL,
  ref             TEXT NOT NULL,
  commit_sha      TEXT,
  status          TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','confirmed','rejected')),
  candidate_count INTEGER NOT NULL DEFAULT 0,
  imported_at     TEXT NOT NULL,
  preview_json    TEXT NOT NULL  -- full GitHubImportPreview JSON blob
);

CREATE TABLE IF NOT EXISTS github_import_candidates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  import_hash     TEXT NOT NULL,
  candidate_index INTEGER NOT NULL,
  dd_id           TEXT,             -- set after confirmation
  draft_manifest  TEXT NOT NULL,    -- DecisionDependency JSON as drafted
  confirmed       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (import_hash) REFERENCES github_imports(import_hash)
);

-- ─── Governance events ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dd_id       TEXT NOT NULL,
  version     TEXT,                      -- NULL = applies to all versions
  event_type  TEXT NOT NULL,             -- submitted|reviewed|approved|rejected|revoked|forked|status_changed|imported_from_github
  actor       TEXT NOT NULL,
  note        TEXT,
  occurred_at TEXT NOT NULL
);

-- ─── Admin tokens (role-based access) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_tokens (
  token_hash TEXT PRIMARY KEY,   -- SHA-256(raw_token) — raw token never stored
  actor_id   TEXT NOT NULL,      -- human-readable name / email
  role       TEXT NOT NULL CHECK(role IN ('admin', 'publisher')),
  created_at TEXT NOT NULL,
  expires_at TEXT,               -- NULL = no expiry
  note       TEXT
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dd_type       ON decision_dependencies(type);
CREATE INDEX IF NOT EXISTS idx_dd_visibility ON decision_dependencies(visibility);
CREATE INDEX IF NOT EXISTS idx_dd_domain     ON decision_dependencies(domain);
CREATE INDEX IF NOT EXISTS idx_dd_org        ON decision_dependencies(org_id);
CREATE INDEX IF NOT EXISTS idx_ver_latest    ON dependency_versions(dd_id, is_latest);
CREATE INDEX IF NOT EXISTS idx_ver_trust     ON dependency_versions(dd_id, trust);
CREATE INDEX IF NOT EXISTS idx_ver_status    ON dependency_versions(status);
CREATE INDEX IF NOT EXISTS idx_installs_user ON registry_installs(user_id);
CREATE INDEX IF NOT EXISTS idx_gov_dd        ON governance_events(dd_id);

-- ─── Multi-tenancy: Users, OTPs, Organizations ────────────────────────────────
-- (added in migration 004_multitenancy.sql)

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  token_hash   TEXT UNIQUE NOT NULL,
  token_prefix TEXT NOT NULL,
  username     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_token_hash ON users(token_hash);

CREATE TABLE IF NOT EXISTS email_otps (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  otp_hash   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON email_otps(email);

CREATE TABLE IF NOT EXISTS organizations (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_active    INTEGER NOT NULL DEFAULT 1
);

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

-- decision_dependencies also has: owner_user_id TEXT, owner_org_id TEXT
-- governance_events also has: actor_user_id TEXT, actor_role TEXT
-- (these columns added via ALTER TABLE in migration 004)
