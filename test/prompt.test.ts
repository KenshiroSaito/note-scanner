import test from 'node:test';
import assert from 'node:assert/strict';

import { EXTRACTION_PROMPT } from '../src/prompt.ts';
import { BLOCK_TYPES } from '../src/schema.ts';

/*
 * These assertions look trivial, but the prompt is the only thing standing
 * between the app and a model that invents plausible-looking notes. A future
 * edit that drops one of these rules should fail a test, not ship.
 */

test('forbids anything other than JSON', () => {
  assert.match(EXTRACTION_PROMPT, /JSON only/i);
  assert.match(EXTRACTION_PROMPT, /code fence/i);
});

test('requires LaTeX for mathematics', () => {
  assert.match(EXTRACTION_PROMPT, /LaTeX/);
});

test('forbids guessing and offers unreadable instead', () => {
  assert.match(EXTRACTION_PROMPT, /Never guess/i);
  assert.match(EXTRACTION_PROMPT, /unreadable/);
  assert.match(EXTRACTION_PROMPT, /must always have a note/i);
});

test('tells the model to ignore page decoration', () => {
  // Deciding body text from doodles is the reason for using an LLM at all.
  for (const pattern of [/circles/i, /arrows/i, /underlines/i, /doodles/i]) {
    assert.match(EXTRACTION_PROMPT, pattern);
  }
});

test('lists every block type the schema accepts', () => {
  for (const type of BLOCK_TYPES) {
    assert.ok(EXTRACTION_PROMPT.includes(type), `prompt should mention "${type}"`);
  }
});
