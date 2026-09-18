import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { ExtractorError, type Warmup } from '../src/extractors/index.ts';
import { createWarmupRoutes } from '../src/warmup-route.ts';

function appWith(warmup: Warmup) {
  return new Hono().route('/', createWarmupRoutes({ warmup }));
}

test('reports a loaded model and how long it took', async () => {
  const response = await appWith(async () => ({ warmed: true })).request('/warmup', { method: 'POST' });
  const body = (await response.json()) as { warmed: boolean; seconds: number };

  assert.equal(response.status, 200);
  assert.equal(body.warmed, true);
  assert.equal(typeof body.seconds, 'number');
});

test('answers 200 when the engine has nothing to warm', async () => {
  const response = await appWith(async () => ({ warmed: false })).request('/warmup', { method: 'POST' });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { warmed: false });
});

test('maps an unreachable engine to 502', async () => {
  const app = appWith(async () => {
    throw new ExtractorError('unreachable', 'Could not reach Ollama at http://localhost:11434');
  });

  const response = await app.request('/warmup', { method: 'POST' });

  assert.equal(response.status, 502);
  assert.match(((await response.json()) as { error: string }).error, /Could not reach Ollama/);
});

test('maps a timeout to 504', async () => {
  const app = appWith(async () => {
    throw new ExtractorError('timeout', 'Ollama did not respond within 180000ms');
  });

  const response = await app.request('/warmup', { method: 'POST' });

  assert.equal(response.status, 504);
});
