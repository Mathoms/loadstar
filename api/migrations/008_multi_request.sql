-- Multi-request tests: an ordered array of HTTP requests run in sequence.
-- Each item: {"name","method","path","headers","body"}. When null, the test
-- uses the legacy single method/target_url (full backward compatibility).
ALTER TABLE tests ADD COLUMN IF NOT EXISTS requests JSONB;
