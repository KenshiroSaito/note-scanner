import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.ts';
import { createClaudeMerger } from '../src/extractors/claude.ts';
import { createMerger } from '../src/extractors/index.ts';
import { createOllamaMerger } from '../src/extractors/ollama.ts';
import { MERGE_PROMPT } from '../src/prompt.ts';

/*
 * The merge side of each engine: what pass 2 actually sends. The route tests
 * stub the merger, so without these nothing would check the request itself.
 */

const listing = '--- page 1 (a.jpg) ---\n[p1.b1] heading: Cuts';

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

test('ollama merging sends the merge prompt, the listing, and the operations schema', async (t) => {
  const calls = stubFetch(t, () => Response.json({ response: '{"operations":[]}' }));

  const result = await createOllamaMerger(loadConfig({}))(listing);

  assert.deepEqual(result, { operations: [] });
  const body = sentBody(calls);
  assert.equal(body.prompt, `${MERGE_PROMPT}\n\n${listing}`);
  assert.ok(body.format.properties.operations, 'should constrain decoding to the operations shape');
  assert.equal('images' in body, false, 'pass 2 is text only');
});

test('claude merging sends only the prompt and the listing', async (t) => {
  const calls = stubFetch(t, () => Response.json({ content: [{ type: 'text', text: '{"operations":[]}' }], stop_reason: 'end_turn' }));

  const result = await createClaudeMerger(loadConfig({ EXTRACTOR: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test-key' }))(listing);

  assert.deepEqual(result, { operations: [] });
  assert.deepEqual(sentBody(calls).messages[0].content, [{ type: 'text', text: `${MERGE_PROMPT}\n\n${listing}` }]);
});

test('the merge engine follows the same EXTRACTOR switch as extraction', async (t) => {
  const calls = stubFetch(t, () =>
    Response.json({ response: '{"operations":[]}', content: [{ type: 'text', text: '{"operations":[]}' }] }),
  );

  await createMerger(loadConfig({}))(listing);
  await createMerger(loadConfig({ EXTRACTOR: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test-key' }))(listing);

  assert.match(calls[0]?.url ?? '', /localhost:11434/);
  assert.match(calls[1]?.url ?? '', /api\.anthropic\.com/);
});
