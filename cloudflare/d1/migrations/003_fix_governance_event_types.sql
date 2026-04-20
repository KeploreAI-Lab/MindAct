-- Migration 003: Fix governance_events CHECK constraint
-- The original CHECK only allowed: submitted, reviewed, approved, rejected, revoked, forked
-- Worker now also writes: status_changed, imported_from_github
-- SQLite cannot ALTER a CHECK constraint — must recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS governance_events_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dd_id       TEXT NOT NULL,
  version     TEXT,
  event_type  TEXT NOT NULL,   -- no CHECK — application layer validates
  actor       TEXT NOT NULL,
  note        TEXT,
  occurred_at TEXT NOT NULL
);

INSERT INTO governance_events_v2 (id, dd_id, version, event_type, actor, note, occurred_at)
  SELECT id, dd_id, version, event_type, actor, note, occurred_at
  FROM governance_events;

DROP TABLE governance_events;

ALTER TABLE governance_events_v2 RENAME TO governance_events;

CREATE INDEX IF NOT EXISTS idx_gov_dd ON governance_events(dd_id);

PRAGMA foreign_keys = ON;
