-- Migration 009: User API key encrypted backups
-- Keys are encrypted client-side with AES-256-GCM before upload.
-- The server only stores the opaque encrypted blob; no plaintext is ever transmitted.

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id    TEXT PRIMARY KEY,
  encrypted  TEXT NOT NULL,   -- JSON string: {salt, iv, ciphertext} all hex-encoded
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);
