import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.ts';
import { createClaudeExtractor, createClaudeGenerate } from '../src/extractors/claude.ts';
import { createOllamaExtractor, createOllamaGenerate } from '../src/extractors/ollama.ts';
import { ExtractorError } from '../src/extractors/types.ts';
import { EXTRACTION_PROMPT } from '../src/prompt.ts';

/*
 * The route tests stub the extractor, so until now nothing exercised the engines
 * themselves. These pin the request each one actually sends, so moving them onto
 * a shared generate() — and any later change — is checked against the wire
 * format rather than assumed.
 */

const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg', name: 'note1.jpg' };

type Call = { url: string; init: RequestInit };

function stubFetch(
  t: { after: (fn: () => void) => void },
  respond: () => Response | Promise<Response>,
): Call[] {
  const original = globalThis.fetch;
  const calls: Call[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function sentBody(calls: Call[]): Record<string, any> {
  return JSON.parse(String(calls[0]?.init.body));
}

function isEngineError(kind: ExtractorError['kind']) {
  return (error: unknown) => error instanceof ExtractorError && error.kind === kind;
}

/* --- Ollama --- */

test('ollama extraction sends the image, the schema, and the filename', async (t) => {
  const calls = stubFetch(t, () => Response.json({ response: '{"source_image":"note1.jpg"}' }));

  const result = await createOllamaExtractor(loadConfig({}))(image);

  assert.deepEqual(result, { source_image: 'note1.jpg' });
  assert.equal(calls[0]?.url, 'http://localhost:11434/api/generate');

  const body = sentBody(calls);
  assert.equal(body.model, 'qwen2.5vl:7b');
  assert.deepEqual(body.images, [Buffer.from(image.bytes).toString('base64')]);
  assert.equal(body.format.type, 'object');
  assert.ok(body.prompt.startsWith(EXTRACTION_PROMPT));
  assert.match(body.prompt, /Filename: note1\.jpg$/);
  assert.equal(body.stream, false);
});

test('ollama text-only generation sends no images and no schema unless asked', async (t) => {
  const calls = stubFetch(t, () => Response.json({ response: '{"ok":true}' }));

  const result = await createOllamaGenerate(loadConfig({}))({ prompt: 'merge these pages' });

  assert.deepEqual(result, { ok: true });
  const body = sentBody(calls);
  assert.equal(body.prompt, 'merge these pages');
  assert.equal('images' in body, false);
  assert.equal('format' in body, false);
});

test('ollama maps a failed response to an upstream error', async (t) => {
  stubFetch(t, () => new Response('model not found', { status: 404 }));

  await assert.rejects(createOllamaGenerate(loadConfig({}))({ prompt: 'x' }), isEngineError('upstream'));
});

test('ollama maps a network failure to unreachable', async (t) => {
  stubFetch(t, () => {
    throw new TypeError('fetch failed');
  });

  await assert.rejects(createOllamaGenerate(loadConfig({}))({ prompt: 'x' }), isEngineError('unreachable'));
});

/* --- Claude --- */

function claudeConfig() {
  return loadConfig({ EXTRACTOR: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test-key' });
}

function claudeReply(text: string, stopReason = 'end_turn') {
  return Response.json({ content: [{ type: 'text', text }], stop_reason: stopReason });
}

test('claude extraction sends the image before the instructions', async (t) => {
  const calls = stubFetch(t, () => claudeReply('{"source_image":"note1.jpg"}'));

  const result = await createClaudeExtractor(claudeConfig())(image);

  assert.deepEqual(result, { source_image: 'note1.jpg' });
  assert.equal(calls[0]?.url, 'https://api.anthropic.com/v1/messages');

  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'sk-ant-test-key');
  assert.equal(headers['anthropic-version'], '2023-06-01');

  const content = sentBody(calls).messages[0].content;
  assert.equal(content.length, 2);
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[1].type, 'text');
  assert.ok(content[1].text.startsWith(EXTRACTION_PROMPT));
});

test('claude text-only generation sends only the prompt', async (t) => {
  const calls = stubFetch(t, () => claudeReply('{"ok":true}'));

  await createClaudeGenerate(claudeConfig())({ prompt: 'merge these pages' });

  const content = sentBody(calls).messages[0].content;
  assert.deepEqual(content, [{ type: 'text', text: 'merge these pages' }]);
});

test('claude surfaces a refusal as refused rather than reading the content', async (t) => {
  stubFetch(t, () => claudeReply('', 'refusal'));

  await assert.rejects(createClaudeGenerate(claudeConfig())({ prompt: 'x' }), isEngineError('refused'));
});

test('claude never puts the API key into an error', async (t) => {
  stubFetch(t, () =>
    Response.json(
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      { status: 401 },
    ),
  );

  await assert.rejects(
    createClaudeGenerate(claudeConfig())({ prompt: 'x' }),
    (error: unknown) =>
      error instanceof ExtractorError && error.kind === 'upstream' && !error.message.includes('sk-ant'),
  );
});
