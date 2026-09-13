import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { loadConfig } from '../src/config.ts';
import { createExtractRoutes } from '../src/extract.ts';
import { ExtractorError, type Extractor } from '../src/extractors/index.ts';

/*
 * Hono's app.request() drives the handler in-process, so none of this touches
 * the network or needs a model running.
 */

const validResult = {
  source_image: 'note1.jpg',
  confidence: 'high',
  blocks: [{ type: 'heading', text: 'Entropy' }],
};

function appWith(extract: Extractor, env: Record<string, string | undefined> = {}) {
  const config = loadConfig(env);
  return new Hono().route('/', createExtractRoutes({ config, extract }));
}

function upload(
  body: Uint8Array | string = 'jpeg-bytes',
  name = 'note1.jpg',
  type = 'image/jpeg',
) {
  const form = new FormData();
  form.set('image', new File([body], name, { type }));
  return { method: 'POST', body: form };
}

test('returns the validated result', async () => {
  const app = appWith(async () => validResult);

  const response = await app.request('/extract', upload());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), validResult);
});

test('trusts the uploaded filename over the one the model echoes', async () => {
  const app = appWith(async () => ({ ...validResult, source_image: 'hallucinated.png' }));

  const response = await app.request('/extract', upload('bytes', 'real-name.jpg'));
  const body = (await response.json()) as { source_image: string };

  assert.equal(body.source_image, 'real-name.jpg');
});

test('retries exactly once when the model returns malformed output', async () => {
  let calls = 0;
  const app = appWith(async () => {
    calls += 1;
    return calls === 1 ? { nonsense: true } : validResult;
  });

  const response = await app.request('/extract', upload());

  assert.equal(response.status, 200);
  assert.equal(calls, 2, 'should have retried once and then stopped');
  assert.deepEqual(await response.json(), validResult);
});

test('gives up with 502 after two malformed attempts, and never retries again', async () => {
  let calls = 0;
  const app = appWith(async () => {
    calls += 1;
    return { confidence: 'not-a-level' };
  });

  const response = await app.request('/extract', upload());
  const body = (await response.json()) as { source_image: string; error: string };

  assert.equal(response.status, 502);
  assert.equal(calls, 2);
  assert.equal(body.source_image, 'note1.jpg');
  assert.match(body.error, /two attempts/);
});

test('retries when the response is not JSON at all', async () => {
  let calls = 0;
  const app = appWith(async () => {
    calls += 1;
    if (calls === 1) throw new Error('Response contained no JSON object');
    return validResult;
  });

  const response = await app.request('/extract', upload());

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('maps an unreachable engine to 502 without retrying', async () => {
  let calls = 0;
  const app = appWith(async () => {
    calls += 1;
    throw new ExtractorError('unreachable', 'Could not reach Ollama at http://localhost:11434');
  });

  const response = await app.request('/extract', upload());

  assert.equal(response.status, 502);
  // The engine being down is not something a second identical call fixes.
  assert.equal(calls, 1);
});

test('maps a timeout to 504', async () => {
  const app = appWith(async () => {
    throw new ExtractorError('timeout', 'Ollama did not respond within 180000ms');
  });

  const response = await app.request('/extract', upload());
  assert.equal(response.status, 504);
});

test('maps a refusal to 502 and names it', async () => {
  const app = appWith(async () => {
    throw new ExtractorError('refused', 'Claude declined this image (cyber)');
  });

  const response = await app.request('/extract', upload());
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 502);
  assert.match(body.error, /declined/);
});

test('never forwards upstream response text to the client', async () => {
  // An upstream error body can echo request headers, which would mean the key.
  const app = appWith(async () => {
    throw new ExtractorError('upstream', 'Claude API returned 401');
  });

  const response = await app.request('/extract', upload());
  const text = await response.text();

  assert.equal(response.status, 502);
  assert.ok(!text.includes('x-api-key'));
  assert.ok(!text.includes('sk-ant'));
});

test('rejects a request with no image field', async () => {
  const app = appWith(async () => validResult);
  const form = new FormData();
  form.set('notes', 'hello');

  const response = await app.request('/extract', { method: 'POST', body: form });

  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /image/);
});

test('rejects a body that is not multipart', async () => {
  const app = appWith(async () => validResult);

  const response = await app.request('/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"image":"nope"}',
  });

  assert.equal(response.status, 400);
});

test('rejects an empty file', async () => {
  const app = appWith(async () => validResult);

  const response = await app.request('/extract', upload(''));

  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /empty/i);
});

test('rejects an upload past the size limit', async () => {
  const app = appWith(async () => validResult, { MAX_UPLOAD_BYTES: '1024' });

  const response = await app.request('/extract', upload(new Uint8Array(2048)));

  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /larger than/i);
});

test('rejects a media type the browser should never send after normalization', async () => {
  const app = appWith(async () => validResult);

  const response = await app.request('/extract', upload('bytes', 'notes.pdf', 'application/pdf'));

  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /Unsupported media type/);
});

test('accepts PNG as well as JPEG', async () => {
  const app = appWith(async () => validResult);

  const response = await app.request('/extract', upload('bytes', 'scan.png', 'image/png'));

  assert.equal(response.status, 200);
});

test('passes the image bytes and media type through to the extractor', async () => {
  let seen: { mediaType: string; name: string; length: number } | null = null;
  const app = appWith(async (image) => {
    seen = { mediaType: image.mediaType, name: image.name, length: image.bytes.length };
    return validResult;
  });

  await app.request('/extract', upload('abc', 'page.png', 'image/png'));

  assert.deepEqual(seen, { mediaType: 'image/png', name: 'page.png', length: 3 });
});
