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
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return { ok: false, message: 'The request was cancelled or took too long.' };
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
