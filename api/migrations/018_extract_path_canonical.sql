-- Canonicalise response-chaining extraction on `path`.
--
-- Two conventions had diverged: the UI writes extract.path with a JSONPath value
-- ("$.token"), while tests created directly via the API used extract.expr with a
-- bare key ("token"). The k6 generator bridged them with an `expr || path` fallback;
-- the JMeter generator only ever read `path` and had no fallback at all — so an
-- expr-style test would silently fall back to "$.<var>" on JMeter and only work by
-- coincidence.
--
-- `path` wins: it is what the UI writes, what the form's placeholder teaches
-- ($.token / Set-Cookie / pattern), and what JMeter's JSONPostProcessor expects.
-- Rewrite expr -> path, adding the "$." prefix for JSON sources so the value format
-- is consistent too.
UPDATE tests
SET requests = (
  SELECT jsonb_agg(
    CASE
      WHEN r->'extract' ? 'expr' THEN
        jsonb_set(
          r,
          '{extract}',
          (r->'extract') - 'expr' || jsonb_build_object(
            'path',
            CASE
              WHEN r->'extract'->>'source' = 'json' AND (r->'extract'->>'expr') NOT LIKE '$%'
                THEN '$.' || (r->'extract'->>'expr')
              ELSE r->'extract'->>'expr'
            END
          )
        )
      ELSE r
    END
    ORDER BY idx
  )
  FROM jsonb_array_elements(requests) WITH ORDINALITY AS t(r, idx)
)
WHERE requests::text LIKE '%"expr"%';
