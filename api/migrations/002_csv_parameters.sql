-- CSV parameterization: store uploaded CSV data with the test definition.
-- First row = column names; users reference them as ${column} in URL/headers/body.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS csv_data TEXT;
