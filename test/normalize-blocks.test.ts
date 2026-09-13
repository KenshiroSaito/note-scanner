import test from 'node:test';
import assert from 'node:assert/strict';

import { containsLatex, normalizeBlocks, splitProseAndFormulas } from '../src/normalize-blocks.ts';
import type { Block, ExtractionResult } from '../src/schema.ts';

function result(blocks: Block[]): ExtractionResult {
  return { source_image: 'note2.jpg', confidence: 'high', blocks };
}

/** Every prose-bearing block must be free of LaTeX once normalized. */
function assertInvariant(normalized: ExtractionResult) {
  for (const block of normalized.blocks) {
    if (block.type === 'formula') continue;
    assert.ok(!containsLatex(block.text), `LaTeX left in ${block.type}: ${block.text}`);
    for (const item of block.items ?? []) {
      assert.ok(!containsLatex(item), `LaTeX left in ${block.type} item: ${item}`);
    }
  }
}

test('detects LaTeX markup but not ordinary punctuation', () => {
  assert.ok(containsLatex('\\sum_{e \\in A}'));
  assert.ok(containsLatex('x^{2n}'));
  assert.ok(containsLatex('$x$'));

  // These must not trigger a split, or plain prose gets fragmented.
  assert.ok(!containsLatex('the value x = 1 is fixed'));
  assert.ok(!containsLatex('w(A) = ∑ w(e)'));
  assert.ok(!containsLatex('a plain sentence'));
  assert.ok(!containsLatex(undefined));
});

test('splits the real note2 failure on the expression boundary', () => {
  const segments = splitProseAndFormulas('that minimizes w(A) = \\sum_{e \\in A} w(e)');

  assert.deepEqual(segments, [
    { kind: 'prose', text: 'that minimizes' },
    { kind: 'formula', text: 'w(A) = \\sum_{e \\in A} w(e)' },
  ]);
});

test('leaves prose containing no LaTeX completely alone', () => {
  for (const text of ['the value x = 1 is fixed', 'w(A) = ∑ w(e)', 'A minimum spanning tree is']) {
    assert.deepEqual(splitProseAndFormulas(text), [{ kind: 'prose', text }]);
  }
});

test('treats a line that is wholly a formula as one formula', () => {
  const segments = splitProseAndFormulas('\\sum_{e \\in A} w(e) = w(A)');

  assert.deepEqual(segments, [{ kind: 'formula', text: '\\sum_{e \\in A} w(e) = w(A)' }]);
});

test('handles a formula in the middle of a sentence', () => {
  const segments = splitProseAndFormulas('since \\alpha > 0 we conclude');

  assert.deepEqual(segments, [
    { kind: 'prose', text: 'since' },
    { kind: 'formula', text: '\\alpha > 0' },
    { kind: 'prose', text: 'we conclude' },
  ]);
});

test('converts a paragraph carrying a formula into paragraph plus formula', () => {
  const normalized = normalizeBlocks(
    result([{ type: 'paragraph', text: 'that minimizes w(A) = \\sum_{e \\in A} w(e)' }]),
  );

  assert.deepEqual(normalized.blocks, [
    { type: 'paragraph', text: 'that minimizes' },
    { type: 'formula', text: 'w(A) = \\sum_{e \\in A} w(e)' },
  ]);
  assertInvariant(normalized);
});

test('turns a definition that is entirely a formula into a formula block', () => {
  const normalized = normalizeBlocks(
    result([{ type: 'definition', text: '\\sum_{e \\in A} w(e) = w(A)' }]),
  );

  assert.deepEqual(normalized.blocks, [
    { type: 'formula', text: '\\sum_{e \\in A} w(e) = w(A)' },
  ]);
});

test('pulls LaTeX list items out as formula blocks after the list', () => {
  // The shape the very first note2 run produced.
  const normalized = normalizeBlocks(
    result([
      {
        type: 'definition',
        text: 'weight of a tree A ⊆ E is defined as',
        items: ['\\sum_{e \\in A} w(e) = w(A)'],
      },
    ]),
  );

  assert.deepEqual(normalized.blocks, [
    { type: 'paragraph', text: 'weight of a tree A ⊆ E is defined as' },
    { type: 'formula', text: '\\sum_{e \\in A} w(e) = w(A)' },
  ]);
  assertInvariant(normalized);
});

test('keeps non-LaTeX items in the list and moves only the formulas', () => {
  const normalized = normalizeBlocks(
    result([
      { type: 'list', text: 'Facts', items: ['heat flows hot to cold', '\\alpha > 0'] },
    ]),
  );

  assert.deepEqual(normalized.blocks, [
    { type: 'list', text: 'Facts', items: ['heat flows hot to cold'] },
    { type: 'formula', text: '\\alpha > 0' },
  ]);
  assertInvariant(normalized);
});

test('leaves blocks that need no change untouched', () => {
  const blocks: Block[] = [
    { type: 'topic', text: 'Minimum spanning trees' },
    { type: 'formula', text: '\\sum_{e \\in A} w(e)' },
    { type: 'list', text: 'Steps', items: ['sort edges', 'add if acyclic'] },
    { type: 'unreadable', note: 'corner cut off' },
    { type: 'table', text: '| a | b |' },
  ];

  assert.deepEqual(normalizeBlocks(result(blocks)).blocks, blocks);
});

test('preserves block order when splitting', () => {
  const normalized = normalizeBlocks(
    result([
      { type: 'heading', text: 'Weights' },
      { type: 'paragraph', text: 'defined as \\sum_{e \\in A} w(e)' },
      { type: 'paragraph', text: 'and nothing else' },
    ]),
  );

  assert.deepEqual(
    normalized.blocks.map((block) => [block.type, block.text]),
    [
      ['heading', 'Weights'],
      ['paragraph', 'defined as'],
      ['formula', '\\sum_{e \\in A} w(e)'],
      ['paragraph', 'and nothing else'],
    ],
  );
});

test('holds the invariant across a whole realistic page', () => {
  const normalized = normalizeBlocks(
    result([
      { type: 'paragraph', text: 'weight of a tree A ⊆ E is defined as' },
      { type: 'formula', text: '\\sum_{e \\in A} w(e) = w(A)' },
      { type: 'paragraph', text: 'A minimum spanning tree is' },
      { type: 'paragraph', text: 'any spanning tree A that minimizes w(A) = \\sum_{e \\in A} w(e)' },
      { type: 'list', text: 'See also', items: ['Kruskal', 'x^{2} + 1'] },
    ]),
  );

  assertInvariant(normalized);
  // Both summations end up as formula blocks — the point of the exercise.
  assert.equal(normalized.blocks.filter((block) => block.type === 'formula').length, 3);
});
