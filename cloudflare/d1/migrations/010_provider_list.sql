-- Migration 010: add provider_list to user_api_keys
-- Stores a JSON array of provider names (e.g. ["minimax","nvidia","custom"]) alongside the
-- encrypted blob so admins can see which providers a user has configured without ever
-- accessing the plaintext keys (zero-knowledge architecture is preserved).
ALTER TABLE user_api_keys ADD COLUMN provider_list TEXT;
