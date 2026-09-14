import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { ExtractorError } from '../src/extractors/types.ts';
import { MAX_MERGE_INPUT_CHARS } from '../src/merge.ts';
import { MAX_MERGE_PAGES, createMergeRoutes } from '../src/merge-route.ts';
import type { ExtractionResult } from '../src/schema.ts';

/*
 * Hono's app.request() drives the route in-process with a stub merger, so none
 * of this needs a network or a model — the same approach as the /extract tests.
 */

type Body = {
  merged?: boolean;
  reason?: string;
  error?: string;
  blocks?: Array<{ text?: string; page: number }>;
  dropped?: number;
  joined?: number;
  rejected?: number;
};

function appWith(merge: (listing: string) => Promise<unknown>) {
  return new Hono().route('/', createMergeRoutes({ merge }));
}

function post(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const pageA: ExtractionResult = {
  source_image: 'a.jpg',
  confidence: 'high',
  blocks: [
    { type: 'heading', text: "Prim's Algorithm" },
    { type: 'paragraph', text: 'among all edges where u is in S' },
  ],
};

const pageB: ExtractionResult = {
  source_image: 'b.jpg',
  confidence: 'high',
  blocks: [
    { type: 'heading', text: "Prim's Algorithm" },
    { type: 'paragraph', text: 'find the edge of min weight' },
  ],
};

const goodOperations = {
  operations: [
    { op: 'drop_duplicate', id: 'p2.b1', duplicate_of: 'p1.b1' },
    { op: 'join', first: 'p1.b2', second: 'p2.b2' },
  ],
};

test('applies verified operations and reports what it did', async () => {
  const app = appWith(async () => goodOperations);

  const response = await app.request('/merge', post({ pages: [pageA, pageB] }));
  const body = (await response.json()) as Body;

  assert.equal(response.status, 200);
  assert.equal(body.merged, true);
  assert.deepEqual(body.blocks?.map((block) => block.text), [
    "Prim's Algorithm",
    'among all edges where u is in S find the edge of min weight',
  ]);
  assert.deepEqual(body.blocks?.map((block) => block.page), [0, 0]);
  assert.equal(body.dropped, 1);
  assert.equal(body.joined, 1);
  assert.equal(body.rejected, 0);
});

test('shows the model every block by ID', async () => {
  let seen = '';
  const app = appWith(async (listing) => {
    seen = listing;
    return { operations: [] };
  });

  await app.request('/merge', post({ pages: [pageA, pageB] }));

  for (const id of ['[p1.b1]', '[p1.b2]', '[p2.b1]', '[p2.b2]']) {
    assert.ok(seen.includes(id), `listing should include ${id}`);
  }
});

test('ignores operations that fail verification but still merges', async () => {
  const app = appWith(async () => ({
    operations: [{ op: 'drop_duplicate', id: 'p2.b2', duplicate_of: 'p1.b1' }],
  }));

  const response = await app.request('/merge', post({ pages: [pageA, pageB] }));
  const body = (await response.json()) as Body;

  assert.equal(body.merged, true);
  assert.equal(body.rejected, 1);
  assert.equal(body.blocks?.length, 4, 'nothing may be removed on an unverified suggestion');
});

test('retries once when the first answer is unusable', async () => {
  let calls = 0;
  const app = appWith(async () => {
    calls += 1;
    return calls === 1 ? { summary: 'merged it for you' } : goodOperations;
  });

  const response = await app.request('/merge', post({ pages: [pageA, pageB] }));
  const body = (await response.json()) as Body;

  assert.equal(calls, 2);
  assert.equal(body.merged, true);
});

test('keeps the pages after two unusable answers, without an error', async () => {
  let calls = 0;
  const app = appWith(async () => {
    calls += 1;
    throw new Error('Response contained no JSON object');
  });

  const response = await app.request('/merge', post({ pages: [pageA, pageB] }));
  const body = (await response.json()) as Body;

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(body.merged, false);
  assert.match(body.reason ?? '', /two attempts/);
});

test('does not call the model for a single page', async () => {
  let called = false;
  const app = appWith(async () => {
    called = true;
    return goodOperations;
  });

  const response = await app.request('/merge', post({ pages: [pageA] }));
  const body = (await response.json()) as Body;

  assert.equal(body.merged, false);
  assert.equal(called, false);
});

test('declines input too long for the context window without calling the model', async () => {
  let called = false;
  const app = appWith(async () => {
    called = true;
    return goodOperations;
  });
  const huge: ExtractionResult = {
    source_image: 'long.jpg',
    confidence: 'high',
    blocks: [{ type: 'paragraph', text: 'x'.repeat(MAX_MERGE_INPUT_CHARS) }],
  };

  const response = await app.request('/merge', post({ pages: [pageA, huge] }));
  const body = (await response.json()) as Body;

  assert.equal(response.status, 200);
  assert.equal(body.merged, false);
  assert.match(body.reason ?? '', /too long/);
  assert.equal(called, false);
});

test('rejects a body that is not JSON', async () => {
  const app = appWith(async () => goodOperations);

  const response = await app.request('/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  });

  assert.equal(response.status, 400);
});

test('rejects a body without pages', async () => {
  const app = appWith(async () => goodOperations);

  const response = await app.request('/merge', post({ results: [pageA, pageB] }));

  assert.equal(response.status, 400);
});

test('rejects a page that is not a valid extraction result', async () => {
  const app = appWith(async () => goodOperations);
  const invalid = { source_image: 'bad.jpg', confidence: 'high', blocks: [{ type: 'unreadable' }] };

  const response = await app.request('/merge', post({ pages: [pageA, invalid] }));

  assert.equal(response.status, 400);
});

test('rejects more pages than one run can hold', async () => {
  const app = appWith(async () => goodOperations);
  const pages = Array.from({ length: MAX_MERGE_PAGES + 1 }, () => pageA);

  const response = await app.request('/merge', post({ pages }));

  assert.equal(response.status, 400);
});

test('maps an unreachable engine to 502 and a timeout to 504', async () => {
  const unreachable = appWith(async () => {
    throw new ExtractorError('unreachable', 'Could not reach Ollama at http://localhost:11434');
  });
  const timedOut = appWith(async () => {
    throw new ExtractorError('timeout', 'Ollama did not respond within 180000ms');
  });

  assert.equal((await unreachable.request('/merge', post({ pages: [pageA, pageB] }))).status, 502);
  assert.equal((await timedOut.request('/merge', post({ pages: [pageA, pageB] }))).status, 504);
});
