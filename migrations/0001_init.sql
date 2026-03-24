-- Migration 0001: initial schema
CREATE TABLE IF NOT EXISTS installations (
  installation_id TEXT PRIMARY KEY,
  app_token       TEXT NOT NULL,
  signing_secret  TEXT NOT NULL,
  bot_id          TEXT NOT NULL,
  hub_url         TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  topic           TEXT NOT NULL DEFAULT '',
  installation_id TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS members (
  room_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  nick      TEXT NOT NULL,
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (room_id, user_id)
);
