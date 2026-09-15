import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_BASE,
  DEFAULT_MAX_CONCURRENCY,
  WARMUP_INTERVAL_MS,
  extractImage,
  fetchRuntimeConfig,
  warmUpModel,
} from '../public/lib/api.js';

/*
 * `fetch`, `FormData`, and `File` are all globals in Node, so the client gets
 * real coverage here with no server and no jsdom.
 */

const validResult = {
  source_image: 'note1.jpg',
  confidence: 'high',
  blocks: [{ type: 'heading', text: 'Entropy' }],
};

function jpeg(name = 'note1.jpg') {
  return new File(['jpeg-bytes'], name, { type: 'image/jpeg' });
}

/** Replaces global fetch for one test and records what it was called with. */
function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('posts the file to /extract in an "image" field', async (t) => {
  const stub = stubFetch(() => jsonResponse(validResult));
  t.after(stub.restore);

  await extractImage(jpeg());

  assert.equal(stub.calls.length, 1);
  const { url, init } = stub.calls[0];
  assert.equal(url, `${API_BASE}/extract`);
  assert.equal(init.method, 'POST');

  // The field name has to match what src/extract.ts reads.
  const sent = init.body.get('image');
  assert.ok(sent instanceof File);
  assert.equal(sent.name, 'note1.jpg');
  assert.equal(sent.type, 'image/jpeg');
});

test('returns the parsed result on success', async (t) => {
  const stub = stubFetch(() => jsonResponse(validResult));
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.deepEqual(outcome, { ok: true, result: validResult });
});

test('surfaces the backend error message for a 400', async (t) => {
  const stub = stubFetch(() =>
    jsonResponse({ error: 'Unsupported media type "application/pdf". Use JPEG or PNG.' }, 400),
  );
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /Unsupported media type/);
});

test('surfaces the backend error message for a 502', async (t) => {
  const stub = stubFetch(() =>
    jsonResponse({ source_image: 'note1.jpg', error: 'Ollama returned 404' }, 502),
  );
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, 'Ollama returned 404');
});

test('falls back to the status code when the error body is not JSON', async (t) => {
  const stub = stubFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /502/);
  // A proxy's HTML must not be shown to the user as if it were a message.
  assert.ok(!outcome.message.includes('<html>'));
});

test('tells the user to start the backend when it is unreachable', async (t) => {
  // The likeliest failure in a two-process dev setup.
  const stub = stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /Could not reach the backend/);
  assert.match(outcome.message, /npm start/);
});

test('reports a timeout distinctly from an unreachable backend', async (t) => {
  const stub = stubFetch(() => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  });
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /too long/);
  assert.ok(!outcome.message.includes('npm start'));
});

test('flags an aborted request as cancelled rather than failed', async (t) => {
  // Stop must not leave an image looking like it failed: a cancelled image
  // returns to its ready state and earns no retry button.
  const stub = stubFetch(() => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.equal(outcome.cancelled, true);
});

test('does not flag a timeout as cancelled', async (t) => {
  // A timeout is a real failure and should be retryable.
  const stub = stubFetch(() => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  });
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.ok(!outcome.cancelled);
  assert.match(outcome.message, /too long/);
});

test('reports a success response whose body is not JSON', async (t) => {
  const stub = stubFetch(() => new Response('not json', { status: 200 }));
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /not JSON/);
});

test('passes a caller-supplied abort signal through', async (t) => {
  const stub = stubFetch(() => jsonResponse(validResult));
  t.after(stub.restore);

  const controller = new AbortController();
  await extractImage(jpeg(), { signal: controller.signal });

  assert.equal(stub.calls[0].init.signal, controller.signal);
});


test('reads the concurrency limit from the backend', async (t) => {
  const stub = stubFetch(() => jsonResponse({ ok: true, extractor: 'ollama', maxConcurrency: 2 }));
  t.after(stub.restore);

  const config = await fetchRuntimeConfig();

  assert.equal(config.maxConcurrency, 2);
  assert.match(stub.calls[0].url, /\/health$/);
});

test('falls back to a safe concurrency when /health cannot be read', async (t) => {
  const stub = stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  t.after(stub.restore);

  const config = await fetchRuntimeConfig({ refresh: true });

  assert.equal(config.maxConcurrency, DEFAULT_MAX_CONCURRENCY);
});

test('ignores a nonsense concurrency value from the backend', async (t) => {
  const stub = stubFetch(() => jsonResponse({ ok: true, maxConcurrency: 'lots' }));
  t.after(stub.restore);

  const config = await fetchRuntimeConfig({ refresh: true });

  assert.equal(config.maxConcurrency, DEFAULT_MAX_CONCURRENCY);
});

/* --- warm-up --- */

/*
 * The throttle is module state, so each test uses its own point in time, far
 * enough from the others' that no earlier test can throttle a later one.
 */

test('posts one warm-up and reports the load time', async (t) => {
  const stub = stubFetch(() => jsonResponse({ warmed: true, seconds: 8.4 }));
  t.after(stub.restore);

  const outcome = await warmUpModel({ now: 1e12 });

  assert.deepEqual(outcome, { ok: true, warmed: true, seconds: 8.4 });
  assert.equal(stub.calls[0].url, `${API_BASE}/warmup`);
  assert.equal(stub.calls[0].init.method, 'POST');
});

test('sends no second warm-up inside the interval, and one after it', async (t) => {
  const stub = stubFetch(() => jsonResponse({ warmed: true, seconds: 0.1 }));
  t.after(stub.restore);

  await warmUpModel({ now: 2e12 });
  const throttled = await warmUpModel({ now: 2e12 + WARMUP_INTERVAL_MS - 1 });
  await warmUpModel({ now: 2e12 + WARMUP_INTERVAL_MS });

  assert.deepEqual(throttled, { ok: true, skipped: true });
  assert.equal(stub.calls.length, 2);
});

test('does not overlap a warm-up that is still in flight', async (t) => {
  let release;
  const stub = stubFetch(() => new Promise((resolve) => {
    release = () => resolve(jsonResponse({ warmed: true, seconds: 20 }));
  }));
  t.after(stub.restore);

  const first = warmUpModel({ now: 3e12 });
  // Well past the interval, but the first request has not answered yet.
  const second = await warmUpModel({ now: 4e12 });
  await new Promise((resolve) => setImmediate(resolve));
  release();

  assert.deepEqual(second, { ok: true, skipped: true });
  assert.equal((await first).warmed, true);
  assert.equal(stub.calls.length, 1);
});

test('never throws when the backend is down, and tries again next time', async (t) => {
  const stub = stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  t.after(stub.restore);

  const outcome = await warmUpModel({ now: 5e12 });
  await warmUpModel({ now: 5e12 + 1 });

  assert.equal(outcome.ok, false);
  assert.equal(stub.calls.length, 2, 'a failed attempt should not throttle the next one');
});

test('reports an engine error without throwing', async (t) => {
  const stub = stubFetch(() => jsonResponse({ error: 'Could not reach Ollama at http://localhost:11434' }, 502));
  t.after(stub.restore);

  const outcome = await warmUpModel({ now: 6e12 });

  assert.deepEqual(outcome, { ok: false, message: 'Could not reach Ollama at http://localhost:11434' });
});
