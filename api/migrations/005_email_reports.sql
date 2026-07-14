-- Per-test email recipient for post-run AI reports (falls back to REPORT_EMAIL_TO).
ALTER TABLE tests ADD COLUMN IF NOT EXISTS notify_email TEXT;
