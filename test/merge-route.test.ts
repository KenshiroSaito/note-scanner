import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { MAX_MERGE_PAGES, createMergeRoutes } from '../src/merge-route.ts';
import { note1, note2, note3, note4 } from './fixtures/lecture-pages.ts';

/*
 * Hono's app.request() drives the route in-process. Pass 2 involves no engine,
 * so there is nothing to stub: these run the real merge on the real pages.
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
  assert.equal(body.joined, 0);
  assert.equal(body.rejected, 0);

  // The MST definition's opening sentence now appears once, not twice.
  const openings = body.blocks?.filter((block) => block.text?.startsWith('weight of a tree')) ?? [];
  assert.equal(openings.length, 1);

  // Blocks carry their source page, so the browser can place failure markers.
  assert.equal(body.blocks?.find((block) => block.text === "Prim's Algorithm")?.page, 1);
});

test('still answers merged: true when nothing repeats', async () => {
  const response = await app().request('/merge', post({ pages: [note2, note1] }));
  const body = (await response.json()) as Body;

  assert.equal(body.merged, true);
  assert.equal(body.dropped, 0);
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
