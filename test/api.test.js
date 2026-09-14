import test from 'node:test';
import assert from 'node:assert/strict';

import { API_BASE, extractImage } from '../public/lib/api.js';

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
  assert.match(outcome.message, /took too long/);
  assert.ok(!outcome.message.includes('npm start'));
});

test('reports an aborted request without blaming the backend', async (t) => {
  const stub = stubFetch(() => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });
  t.after(stub.restore);

  const outcome = await extractImage(jpeg());

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /cancelled/);
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
