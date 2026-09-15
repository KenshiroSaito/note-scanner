/**
 * Client for the backend.
 *
 * The frontend is static and holds no API key (spec section 4, decision 2); this
 * module is the only place it talks to the server.
 *
 * No DOM access, so it is testable under `node --test` with a stubbed `fetch`.
 */

/**
 * Where the backend lives.
 *
 * A constant because the frontend has no build step and no environment
 * variables. Where the backend is actually deployed is still open (spec
 * section 8), so this is the local development default and the hosting decision
 * revisits it.
 */
export const API_BASE = 'http://localhost:8787';

/**
 * Slightly above the backend's own 180s ceiling, so the server's clearer error
 * wins the race and the browser is only the backstop against a wedged request.
 */
export const CLIENT_TIMEOUT_MS = 200_000;

/** Falls back to this if /health cannot be reached. */
export const DEFAULT_MAX_CONCURRENCY = 3;

let cachedConfig = null;

/**
 * Read runtime settings from the backend.
 *
 * The page has no build step and no environment, so settings that need to be
 * tunable — the concurrency limit, which the user wants to measure — live in the
 * server's config and are fetched from here. Cached for the session.
 *
 * @param {{ refresh?: boolean }} [options] re-read instead of using the cache
 * @returns {Promise<{ maxConcurrency: number }>}
 */
export async function fetchRuntimeConfig({ refresh = false } = {}) {
  if (cachedConfig && !refresh) return cachedConfig;

  try {
    const response = await fetch(`${API_BASE}/health`);
    if (response.ok) {
      const body = await response.json();
      const limit = Number(body?.maxConcurrency);
      cachedConfig = {
        maxConcurrency: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_MAX_CONCURRENCY,
      };
      return cachedConfig;
    }
  } catch {
    // A page that cannot reach /health is about to report that anyway.
  }

  return { maxConcurrency: DEFAULT_MAX_CONCURRENCY };
}

/**
 * What a request that never got a response means for the user.
 *
 * Cancelled and timed out must not be conflated: work the user stopped goes
 * back to where it was, while a timeout is a real failure that earns a retry.
 */
function networkFailure(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') {
    return { ok: false, cancelled: true, message: 'Cancelled.' };
  }
  if (error?.name === 'TimeoutError') {
    return { ok: false, message: 'The model took too long to respond.' };
  }
  // By far the most likely failure: the dev setup is two processes and the
  // backend is the one people forget.
  return {
    ok: false,
    message: `Could not reach the backend at ${API_BASE}. Is it running? Start it with "npm start".`,
  };
}

/**
 * Send one image for extraction (pass 1).
 *
 * Returns an outcome object rather than throwing, so the caller has a single
 * path for "didn't work" instead of a try/catch wrapped around rendering.
 *
 * @param {File} file a normalized JPEG from the drop zone
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, result: object } | { ok: false, cancelled?: true, message: string }>}
 */
export async function extractImage(file, { signal } = {}) {
  const body = new FormData();
  // Field name must match what the backend reads (src/extract.ts).
  body.set('image', file, file.name);

  let response;
  try {
    response = await fetch(`${API_BASE}/extract`, {
      method: 'POST',
      body,
      signal: signal ?? AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (error) {
    return networkFailure(error, signal);
  }

  if (response.ok) {
    try {
      return { ok: true, result: await response.json() };
    } catch {
      return { ok: false, message: 'The backend returned a response that was not JSON.' };
    }
  }

  // The backend writes its error messages for a human, and guarantees they carry
  // no upstream text, so they are shown as-is.
  const errorBody = await response.json().catch(() => null);
  if (errorBody && typeof errorBody.error === 'string') {
    return { ok: false, message: errorBody.error };
  }

  return { ok: false, message: `The backend returned HTTP ${response.status}.` };
}

/**
 * Merge the pages of a run (pass 2).
 *
 * `merged: false` is a normal outcome, not a failure: the backend declined to
 * merge — too few pages, too much text, nothing usable from the model — and the
 * page-by-page document is still correct, so the caller keeps showing it.
 *
 * @param {Array<object>} pages pass-1 results, in page order
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<
 *   | { ok: true, merged: true, blocks: Array<object>, dropped: number, superseded: number, rejected: number }
 *   | { ok: true, merged: false, reason: string }
 *   | { ok: false, cancelled?: true, message: string }
 * >}
 */
export async function mergePages(pages, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pages }),
      signal: signal ?? AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (error) {
    return networkFailure(error, signal);
  }

  const body = await response.json().catch(() => null);

  if (response.ok && body?.merged === true && Array.isArray(body.blocks)) {
    return {
      ok: true,
      merged: true,
      blocks: body.blocks,
      dropped: Number(body.dropped) || 0,
      superseded: Number(body.superseded) || 0,
      rejected: Number(body.rejected) || 0,
    };
  }

  if (response.ok && body?.merged === false) {
    return { ok: true, merged: false, reason: String(body.reason ?? 'The pages were not merged.') };
  }

  if (body && typeof body.error === 'string') {
    return { ok: false, message: body.error };
  }

  return {
    ok: false,
    message: response.ok
      ? 'The backend returned an unexpected merge response.'
      : `The backend returned HTTP ${response.status}.`,
  };
}
