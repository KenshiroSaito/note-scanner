import test from 'node:test';
import assert from 'node:assert/strict';

import { API_BASE, mergePages } from '../public/lib/api.js';

/*
 * fetch, Response, and friends are Node globals, so the merge client is tested
 * against a stubbed fetch with no server.
 */

const pages = [
  { source_image: 'a.jpg', confidence: 'high', blocks: [{ type: 'heading', text: 'Cuts' }] },
  { source_image: 'b.jpg', confidence: 'high', blocks: [{ type: 'heading', text: 'Cuts' }] },
];

function stubFetch(t, handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };

  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test('posts the pages as JSON to /merge', async (t) => {
  const calls = stubFetch(t, () => Response.json({ merged: false, reason: 'nothing to do' }));

  await mergePages(pages);

  assert.equal(calls[0].url, `${API_BASE}/merge`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { pages });
});

test('returns the merged document with what was done', async (t) => {
  const blocks = [{ type: 'heading', text: 'Cuts', page: 0 }];
  stubFetch(t, () => Response.json({ merged: true, blocks, dropped: 1, joined: 0, rejected: 2 }));

  const outcome = await mergePages(pages);

  assert.deepEqual(outcome, { ok: true, merged: true, blocks, dropped: 1, joined: 0, rejected: 2 });
});

test('treats a declined merge as a normal outcome with its reason', async (t) => {
  stubFetch(t, () => Response.json({ merged: false, reason: 'Merging needs at least two pages.' }));

  const outcome = await mergePages(pages);

  assert.deepEqual(outcome, { ok: true, merged: false, reason: 'Merging needs at least two pages.' });
});

test('surfaces the backend error message for an engine failure', async (t) => {
  stubFetch(t, () => Response.json({ error: 'Ollama returned 404' }, { status: 502 }));

  const outcome = await mergePages(pages);

  assert.deepEqual(outcome, { ok: false, message: 'Ollama returned 404' });
});

test('flags a stopped merge as cancelled', async (t) => {
  stubFetch(t, () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });

  const outcome = await mergePages(pages);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.cancelled, true);
});

test('tells the user to start the backend when it is unreachable', async (t) => {
  stubFetch(t, () => {
    throw new TypeError('fetch failed');
  });

  const outcome = await mergePages(pages);

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /npm start/);
});

test('rejects a success response that is not a merge result', async (t) => {
  stubFetch(t, () => Response.json({ hello: 'world' }));

  const outcome = await mergePages(pages);

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /unexpected/);
});
