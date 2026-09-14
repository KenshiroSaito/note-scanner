/**
 * Client for the extraction backend.
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

/**
 * Send one image for extraction.
 *
 * Returns an outcome object rather than throwing, so the caller has a single
 * path for "didn't work" instead of a try/catch wrapped around rendering.
 *
 * @param {File} file a normalized JPEG from the drop zone
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, result: object } | { ok: false, message: string }>}
 */
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
    // Cancelled and timed out must not be conflated: an image the user stopped
    // returns to its ready state, while a timeout is a real failure that earns a
    // retry button.
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

  if (response.ok) {
    try {
      return { ok: true, result: await response.json() };
    } catch {
      return { ok: false, message: 'The backend returned a response that was not JSON.' };
    }
  }

  // The backend writes its error messages for a human, and guarantees they carry
  // no upstream text, so they are shown as-is.
  const body_ = await response.json().catch(() => null);
  if (body_ && typeof body_.error === 'string') {
    return { ok: false, message: body_.error };
  }

  return { ok: false, message: `The backend returned HTTP ${response.status}.` };
}
