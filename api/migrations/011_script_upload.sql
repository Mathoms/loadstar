-- Script upload ("bring your own script"): store an uploaded JMeter/k6 script
-- and best-effort version-detection notes. When uploaded_script is present, the
-- worker runs it as-is instead of generating one from the form.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS uploaded_script TEXT;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS script_warnings TEXT;
