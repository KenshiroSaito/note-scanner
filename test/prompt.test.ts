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

/*
 * Rules added after note2.jpg (CSC 226) came back with a summation split across
 * list items instead of one formula block. Each assertion pins one rule that a
 * later edit could otherwise drop without anyone noticing until a page regresses.
 */

test('says layout is not structure, so wrapped lines are joined', () => {
  assert.match(EXTRACTION_PROMPT, /Layout is not structure/i);
  assert.match(EXTRACTION_PROMPT, /when a sentence continues\s*\n?\s*on the next line, join it into one block/i);
});

test('forbids inventing lists out of prose', () => {
  assert.match(EXTRACTION_PROMPT, /Do not invent lists/i);
  assert.match(EXTRACTION_PROMPT, /A single item is never\s*\n?\s*a list/i);
});

test('requires mathematics to use the formula block, never a list or prose', () => {
  assert.match(EXTRACTION_PROMPT, /All mathematics goes in a "formula" block as LaTeX/);
  assert.match(EXTRACTION_PROMPT, /Never put an expression in\s*\n?\s*a "list", inside "items", or in running prose/);
  assert.match(EXTRACTION_PROMPT, /A formula never goes in\s*\n?\s*"items"/);
});

test('requires sub- and superscripts to be reattached to their operator', () => {
  // The actual note2 defect: "e in A" beneath the sigma became its own bullet.
  assert.match(EXTRACTION_PROMPT, /above or below a summation, product, integral, or limit sign/i);
  assert.match(EXTRACTION_PROMPT, /reconstruct it as a subscript or superscript/i);
  assert.match(EXTRACTION_PROMPT, /A formula is one block even when it occupies several visual lines/i);
});

test('separates a sentence from the formula it runs into', () => {
  assert.match(EXTRACTION_PROMPT, /one "paragraph" block for the\s*\n?\s*sentence and one "formula" block/i);
});

test('carries a worked example showing the two-block result', () => {
  // A concrete example moved this model where prose rules alone did not.
  assert.match(EXTRACTION_PROMPT, /Worked example/);
  assert.match(EXTRACTION_PROMPT, /"type": "formula"/);
  assert.match(EXTRACTION_PROMPT, /\\\\sum_\{e \\\\in A\} w\(e\) = w\(A\)/);
});
