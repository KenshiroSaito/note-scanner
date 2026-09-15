import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { MAX_MERGE_PAGES, createMergeRoutes } from '../src/merge-route.ts';
import { note1, note2, note3, note4 } from './fixtures/lecture-pages.ts';
import { note5, note6 } from './fixtures/shortest-paths-pages.ts';

/*
 * Hono's app.request() drives the route in-process. Pass 2 involves no engine,
 * so there is nothing to stub: these run the real merge on the real pages.
 */

type Body = {
  merged?: boolean;
  reason?: string;
  error?: string;
  blocks?: Array<{ text?: string; note?: string; page: number }>;
  dropped?: number;
  superseded?: number;
  joined?: number;
  rejected?: number;
};

function app() {
  return new Hono().route('/', createMergeRoutes());
}

function post(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('merges the real lecture pages and reports what it removed', async () => {
  const response = await app().request('/merge', post({ pages: [note2, note3, note4, note1] }));
  const body = (await response.json()) as Body;

  assert.equal(response.status, 200);
  assert.equal(body.merged, true);
  assert.equal(body.dropped, 2);
  assert.equal(body.superseded, 0);
  assert.equal(body.rejected, 0);

  // The MST definition's opening sentence now appears once, not twice.
  const openings = body.blocks?.filter((block) => block.text?.startsWith('weight of a tree')) ?? [];
  assert.equal(openings.length, 1);

  // Blocks carry their page, so the browser can place failure markers.
  assert.equal(body.blocks?.find((block) => block.text === "Prim's Algorithm")?.page, 1);
});

test('completes the Notation section from the later photo and invents nothing', async () => {
  const response = await app().request('/merge', post({ pages: [note5, note6] }));
  const body = (await response.json()) as Body;

  assert.equal(response.status, 200);
  assert.equal(body.superseded, 1);
  assert.equal(body.dropped, 0);
  assert.equal(body.rejected, 0);
  assert.equal('joined' in body, false, 'joins no longer exist');

  const texts = body.blocks?.map((block) => block.text ?? '') ?? [];
  assert.equal(texts.filter((text) => text.includes('d[v] should indicate the cost of')).length, 1);
  assert.ok(!texts.some((text) => /Notation array|cost of array/.test(text)));
});

test('still answers merged: true when nothing repeats', async () => {
  const response = await app().request('/merge', post({ pages: [note2, note1] }));
  const body = (await response.json()) as Body;

  assert.equal(body.merged, true);
  assert.equal(body.dropped, 0);
  assert.equal(body.superseded, 0);
  assert.equal(body.blocks?.length, note2.blocks.length + note1.blocks.length);
});

test('declines a single page without an error', async () => {
  const response = await app().request('/merge', post({ pages: [note2] }));
  const body = (await response.json()) as Body;

  assert.equal(response.status, 200);
  assert.equal(body.merged, false);
  assert.match(body.reason ?? '', /two pages/);
});

test('rejects a body that is not JSON', async () => {
  const response = await app().request('/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  });

  assert.equal(response.status, 400);
});

test('rejects a body without pages', async () => {
  const response = await app().request('/merge', post({ results: [note2, note3] }));

  assert.equal(response.status, 400);
});

test('rejects a page that is not a valid extraction result', async () => {
  const invalid = { source_image: 'bad.jpg', confidence: 'high', blocks: [{ type: 'unreadable' }] };

  const response = await app().request('/merge', post({ pages: [note2, invalid] }));

  assert.equal(response.status, 400);
});

test('rejects more pages than one run can hold', async () => {
  const pages = Array.from({ length: MAX_MERGE_PAGES + 1 }, () => note2);

  const response = await app().request('/merge', post({ pages }));

  assert.equal(response.status, 400);
});
