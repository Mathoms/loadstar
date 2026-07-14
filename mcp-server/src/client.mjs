import process from 'node:process';

const RAW_BASE = (process.env.LOADSTAR_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

// The router is mounted at /api. Tolerate a base that already includes it.
export const BASE = RAW_BASE.endsWith('/api') ? RAW_BASE : RAW_BASE + '/api';

const API_KEY = process.env.LOADSTAR_API_KEY || '';
const API_KEY_HEADER = process.env.LOADSTAR_API_KEY_HEADER || 'x-api-key';

/**
 * Thin HTTP client for the Loadstar API.
 *
 * Verify the behavior, not the label: a non-2xx ALWAYS throws, carrying the
 * real status and the real body. Loadstar returns useful errors and they must
 * reach the developer verbatim, not be flattened into "request failed".
 *
 * opts.raw returns text instead of JSON (the HTML report is not JSON).
 */
export async function loadstarRequest(method, path, body, opts = {}) {
  const url = BASE + path;
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (API_KEY) headers[API_KEY_HEADER] = API_KEY;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      'Cannot reach the Loadstar API at ' +
        url +
        ' (' +
        err.message +
        '). Is docker compose up -d running, and is LOADSTAR_API_URL correct?'
    );
  }

  const text = await res.text();

  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      if (j && j.error) detail = j.error;
    } catch {
      /* not JSON — fall back to the raw text */
    }
    if (res.status === 401 || res.status === 403) {
      detail += ' [auth: check LOADSTAR_API_KEY and LOADSTAR_API_KEY_HEADER]';
    }
    throw new Error(
      'Loadstar API ' + method + ' ' + path + ' -> HTTP ' + res.status + ': ' + detail
    );
  }

  if (opts.raw) return text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
