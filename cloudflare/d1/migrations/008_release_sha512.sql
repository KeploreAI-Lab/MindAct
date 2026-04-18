-- Migration 008: Add sha512 column to release_assets
-- Required by electron-updater for update package integrity verification.
-- electron-updater uses SHA-512 (base64-encoded), while sha256 (hex) is kept for legacy/display.
ALTER TABLE release_assets ADD COLUMN sha512 TEXT;
