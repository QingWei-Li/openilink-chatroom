-- Migration 0002: PKCE state for OAuth flow
CREATE TABLE IF NOT EXISTS pkce_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  hub_url       TEXT NOT NULL,
  app_id        TEXT NOT NULL,
  return_url    TEXT NOT NULL DEFAULT '',
  expires_at    INTEGER NOT NULL
);
