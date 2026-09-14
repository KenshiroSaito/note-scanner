import test from 'node:test';
import assert from 'node:assert/strict';

import { MERGE_PROMPT } from '../src/prompt.ts';

/*
 * The code verifies every operation, so a sloppy prompt cannot lose text — but
 * it can make the merge useless by producing operations that all get refused.
 * These pin the instructions the verification in src/merge.ts relies on.
 */

test('allows only the two operations, pointed at blocks by ID', () => {
  assert.match(MERGE_PROMPT, /"op": "drop_duplicate"/);
  assert.match(MERGE_PROMPT, /"op": "join"/);
  assert.match(MERGE_PROMPT, /\[p2\.b3\] for page 2, block 3/);
});

test('forbids rewriting and reordering', () => {
  assert.match(MERGE_PROMPT, /Never rewrite, summarise, shorten, or correct any text/);
  assert.match(MERGE_PROMPT, /Never reorder blocks/);
});

test('keeps a later block that adds anything', () => {
  // The same rule the code enforces with its missing-word limit.
  assert.match(MERGE_PROMPT, /If the later\s+block adds anything, keep it/);
});

test('says duplicates come from earlier pages, never the same page', () => {
  // The same rule the code enforces: a page repeating itself is content.
  assert.match(MERGE_PROMPT, /"duplicate_of" must be on an earlier page/);
  assert.match(MERGE_PROMPT, /repeated on\s+the same page is not a duplicate/);
});

test('asks for IDs without the listing brackets', () => {
  // The first real run copied "[p1.b5]" into every operation.
  assert.match(MERGE_PROMPT, /write its ID without the brackets: "p2\.b3"/);
});

test('says different subjects are not duplicates', () => {
  // note1 is another course; sharing a word must not tie it to CSC 226.
  assert.match(MERGE_PROMPT, /Pages about different subjects are not duplicates/);
});

test('asks for JSON only and allows merging nothing', () => {
  assert.match(MERGE_PROMPT, /Return JSON only/);
  assert.match(MERGE_PROMPT, /\{ "operations": \[\] \}/);
});
