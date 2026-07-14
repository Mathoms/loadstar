-- Response chaining. Phase A: automatic session cookies via an engine cookie manager.
-- Phase B extraction config lives inside each request object in the requests JSONB
-- (shape: { ..., extract: { var, source: 'json'|'header'|'regex', path } }).
ALTER TABLE tests ADD COLUMN IF NOT EXISTS cookie_manager BOOLEAN NOT NULL DEFAULT TRUE;
