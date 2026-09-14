import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMergeOperations,
  flattenPages,
  mergeDocument,
  planMergeOperations,
  tokens,
  type MergeOutcome,
} from '../src/merge.ts';
import type { Block, ExtractionResult } from '../src/schema.ts';
import { note1, note2, note3, note4 } from './fixtures/lecture-pages.ts';

function page(sourceImage: string, blocks: Block[]): ExtractionResult {
  return { source_image: sourceImage, confidence: 'high', blocks };
}

const drop = (id: string, duplicateOf: string | string[]) => ({ op: 'drop_duplicate', id, duplicate_of: duplicateOf });
const join = (first: string, second: string) => ({ op: 'join', first, second });

function texts(outcome: MergeOutcome): string[] {
  return outcome.blocks.map((block) => block.text ?? '');
}

/**
 * The invariant this phase is built around: every string on every page survives,
 * unless its block was dropped as a verified duplicate — and then every block it
 * duplicated must itself still be present.
 */
function assertNothingLost(pages: ExtractionResult[], outcome: MergeOutcome) {
  const droppedFor = new Map(outcome.drops.map((entry) => [entry.id, entry.duplicate_of]));
  const output = outcome.blocks
    .flatMap((block) => [block.text ?? '', ...(block.items ?? []), block.note ?? ''])
    .join('\n');

  for (const entry of flattenPages(pages)) {
    const keepers = droppedFor.get(entry.id);
    if (keepers) {
      for (const keeper of keepers) {
        assert.ok(!droppedFor.has(keeper), `${entry.id} was dropped for ${keeper}, which was dropped too`);
      }
      continue;
    }
    for (const value of [entry.block.text, ...(entry.block.items ?? []), entry.block.note]) {
      if (value) assert.ok(output.includes(value.trim()), `lost "${value}" from ${entry.id}`);
    }
  }
}

const sameSentence = 'A cut is a partition of V into two non-empty sets';

/* --- the real photos --- */

test('merges the real lecture photos: the re-photographed MST definition appears once', () => {
  const pages = [note2, note3, note4, note1];

  const outcome = mergeDocument(pages);

  assert.deepEqual(outcome.drops, [
    // note3's one-block reading of note2's first two blocks...
    { id: 'p2.b1', duplicate_of: ['p1.b1', 'p1.b2'] },
    // ...and its one-block reading of note2's last three. Not ['p1.b2', 'p1.b3',
    // 'p1.b4']: note2's two formulas have identical word sets, so that run covers
    // the words equally well, and only word order places the match on the text
    // that was actually re-photographed.
    { id: 'p2.b2', duplicate_of: ['p1.b3', 'p1.b4', 'p1.b5'] },
  ]);
  assert.deepEqual(outcome.joins, []);
  assert.deepEqual(outcome.rejected, [], 'every planned operation should verify');

  // Everything else survives, in order: Prim's algorithm, the cut definitions,
  // and the other course untouched.
  assert.deepEqual(
    texts(outcome),
    [...note2.blocks, ...note3.blocks.slice(2), ...note4.blocks, ...note1.blocks].map((block) => block.text ?? ''),
  );
  assert.equal(outcome.blocks.find((block) => block.text === "Prim's Algorithm")?.page, 1);
  assert.equal(outcome.blocks.find((block) => block.text === 'Friday, Sept 11 through Teams')?.page, 3);
  assertNothingLost(pages, outcome);
});

test('keeps a short line that repeats on its own', () => {
  // note4's diagram label "S" has exactly the words of note3's "S = {s}". The
  // verifier alone would allow dropping it — only the short-line guard keeps it.
  const pages = [note3, note4];

  assert.equal(applyMergeOperations(pages, [drop('p2.b4', 'p1.b5')]).drops.length, 1);
  assert.deepEqual(planMergeOperations(pages), []);
});

test('drops short lines when they repeat as a run', () => {
  const pages = [
    page('a.jpg', [{ type: 'heading', text: "Prim's Algorithm" }, { type: 'paragraph', text: 'S = {s}' }]),
    page('b.jpg', [{ type: 'heading', text: "Prim's Algorithm" }, { type: 'paragraph', text: 'S = {s}' }]),
  ];

  const outcome = mergeDocument(pages);

  assert.deepEqual(outcome.drops, [
    { id: 'p2.b1', duplicate_of: ['p1.b1'] },
    { id: 'p2.b2', duplicate_of: ['p1.b2'] },
  ]);
  assertNothingLost(pages, outcome);
});

test('collapses a board photographed three times to its first appearance', () => {
  const pages = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => page(name, [{ type: 'paragraph', text: sameSentence }]));

  const outcome = mergeDocument(pages);

  assert.deepEqual(outcome.drops, [
    { id: 'p2.b1', duplicate_of: ['p1.b1'] },
    { id: 'p3.b1', duplicate_of: ['p1.b1'] },
  ]);
  assert.deepEqual(texts(outcome), [sameSentence]);
  assertNothingLost(pages, outcome);
});

test('never merges a different course into the lecture', () => {
  const outcome = mergeDocument([note2, note1]);

  assert.deepEqual(outcome.drops, []);
  assert.deepEqual(outcome.joins, []);
  assert.equal(outcome.blocks.length, note2.blocks.length + note1.blocks.length);
});

test('is deterministic', () => {
  const pages = [note2, note3, note4, note1];

  assert.deepEqual(mergeDocument(pages), mergeDocument(pages));
});

/* --- joins --- */

test('joins a sentence cut at a page boundary', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'among all edges (u, v) where u is in S and v is not in S' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'find the edge of minimum weight' }]),
  ];

  const outcome = mergeDocument(pages);

  assert.deepEqual(outcome.joins, [{ first: 'p1.b1', second: 'p2.b1' }]);
  assert.deepEqual(texts(outcome), [
    'among all edges (u, v) where u is in S and v is not in S find the edge of minimum weight',
  ]);
  assertNothingLost(pages, outcome);
});

test('does not join when the first page ends a sentence', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'all edge weights are distinct.' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'find the edge of minimum weight' }]),
  ];

  assert.deepEqual(mergeDocument(pages).joins, []);
});

test('does not join when the next page starts in upper case', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'e is not a crossing edge' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'Friday, Sept 11 through Teams' }]),
  ];

  assert.deepEqual(mergeDocument(pages).joins, []);
});

test('does not join anything that is not prose', () => {
  const pages = [
    page('a.jpg', [{ type: 'formula', text: 'A = \\emptyset' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'while the tree is incomplete' }]),
  ];

  assert.deepEqual(mergeDocument(pages).joins, []);
});

test('joins across a boundary once the repeated top of the next page is dropped', () => {
  const pages = [
    page('a.jpg', [
      { type: 'heading', text: "Prim's Algorithm" },
      { type: 'paragraph', text: 'among all edges where u is in S' },
    ]),
    page('b.jpg', [
      { type: 'heading', text: "Prim's Algorithm" },
      { type: 'paragraph', text: 'among all edges where u is in S' },
      { type: 'paragraph', text: 'find the edge of min weight' },
    ]),
  ];

  const outcome = mergeDocument(pages);

  assert.equal(outcome.drops.length, 2);
  assert.deepEqual(texts(outcome), ["Prim's Algorithm", 'among all edges where u is in S find the edge of min weight']);
  assertNothingLost(pages, outcome);
});

/* --- verification of individual operations --- */

test('drops a block covered by a run of earlier blocks, where no single block would do', () => {
  const pages = [note2, note3];

  // note3's first paragraph against note2's first block alone: not enough.
  assert.match(applyMergeOperations(pages, [drop('p2.b1', 'p1.b1')]).rejected[0]?.reason ?? '', /similar/);

  // Against note2's first two blocks read together: the same words.
  const outcome = applyMergeOperations(pages, [drop('p2.b1', ['p1.b1', 'p1.b2'])]);
  assert.equal(outcome.drops.length, 1, JSON.stringify(outcome.rejected));
  assertNothingLost(pages, outcome);
});

test('keeps a block wrongly named as a duplicate', () => {
  const outcome = applyMergeOperations([note2, note3], [drop('p2.b3', 'p1.b1')]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /similar/);
});

test('refuses a drop that would lose more than a stray word', () => {
  const kept = 'all edge weights in the graph are distinct so the minimum spanning tree is unique for every connected input we consider here';
  const pages = (extra: string) => [
    page('a.jpg', [{ type: 'paragraph', text: kept }]),
    page('b.jpg', [{ type: 'paragraph', text: `${kept} ${extra}` }]),
  ];

  // One extra word is a misreading and may go...
  assert.equal(applyMergeOperations(pages('always'), [drop('p2.b1', 'p1.b1')]).drops.length, 1);

  // ...but two extra words is content the kept block does not have.
  const twoWords = applyMergeOperations(pages('except loops'), [drop('p2.b1', 'p1.b1')]);
  assert.equal(twoWords.drops.length, 0);
  assert.match(twoWords.rejected[0]?.reason ?? '', /would be lost/);
  assertNothingLost(pages('except loops'), twoWords);
});

test('refuses to drop a block as a duplicate of another on the same page', () => {
  // note2's two formulas share every symbol but are different statements.
  const outcome = applyMergeOperations([note2], [drop('p1.b5', 'p1.b2')]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /same page/);
});

test('refuses a drop pointing at a later block', () => {
  const pages = [page('a.jpg', [{ type: 'paragraph', text: sameSentence }]), page('b.jpg', [{ type: 'paragraph', text: sameSentence }])];

  const outcome = applyMergeOperations(pages, [drop('p1.b1', 'p2.b1')]);

  assert.equal(outcome.blocks.length, 2);
  assert.match(outcome.rejected[0]?.reason ?? '', /before/);
});

test('refuses a run that is not consecutive, or spans pages', () => {
  const three = page('a.jpg', [
    { type: 'paragraph', text: 'A cut is a partition' },
    { type: 'paragraph', text: 'something unrelated in between' },
    { type: 'paragraph', text: 'of V into two non-empty sets' },
  ]);
  const later = page('b.jpg', [{ type: 'paragraph', text: sameSentence }]);

  const gap = applyMergeOperations([three, later], [drop('p2.b1', ['p1.b1', 'p1.b3'])]);
  assert.match(gap.rejected[0]?.reason ?? '', /consecutive/);

  const pages = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => page(name, [{ type: 'paragraph', text: sameSentence }]));
  const spanning = applyMergeOperations(pages, [drop('p3.b1', ['p1.b1', 'p2.b1'])]);
  assert.match(spanning.rejected[0]?.reason ?? '', /consecutive/);
});

test('refuses a drop naming a block that does not exist', () => {
  const outcome = applyMergeOperations([note2], [drop('p9.b9', 'p1.b1')]);

  assert.equal(outcome.blocks.length, note2.blocks.length);
  assert.match(outcome.rejected[0]?.reason ?? '', /unknown/);
});

test('refuses a drop whose duplicate was itself dropped', () => {
  const pages = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => page(name, [{ type: 'paragraph', text: sameSentence }]));

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1'), drop('p3.b1', 'p2.b1')]);

  assert.equal(outcome.drops.length, 1);
  assert.match(outcome.rejected[0]?.reason ?? '', /itself dropped/);
  assertNothingLost(pages, outcome);
});

test('refuses to drop a block another drop depends on', () => {
  const pages = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => page(name, [{ type: 'paragraph', text: sameSentence }]));

  const outcome = applyMergeOperations(pages, [drop('p3.b1', 'p2.b1'), drop('p2.b1', 'p1.b1')]);

  assert.equal(outcome.drops.length, 1);
  assert.match(outcome.rejected[0]?.reason ?? '', /depends/);
  assertNothingLost(pages, outcome);
});

test('refuses a duplicate across incompatible block types', () => {
  const pages = [page('a.jpg', [{ type: 'heading', text: 'Kruskal' }]), page('b.jpg', [{ type: 'formula', text: 'Kruskal' }])];

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1')]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /cannot duplicate/);
});

test('never drops a table or an unreadable block', () => {
  const pages = [
    page('a.jpg', [note1.blocks[1]!, { type: 'unreadable', note: 'bottom corner cut off' }]),
    page('b.jpg', [note1.blocks[1]!, { type: 'unreadable', note: 'bottom corner cut off' }]),
  ];

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1'), drop('p2.b2', 'p1.b2')]);

  assert.equal(outcome.drops.length, 0);
  assert.deepEqual(planMergeOperations(pages), []);
});

test('verifies joins: same page, non-adjacent, and non-prose are refused', () => {
  const samePage = applyMergeOperations(
    [page('a.jpg', [{ type: 'paragraph', text: 'first half' }, { type: 'paragraph', text: 'second half' }])],
    [join('p1.b1', 'p1.b2')],
  );
  assert.match(samePage.rejected[0]?.reason ?? '', /across pages/);

  const apart = applyMergeOperations(
    [
      page('a.jpg', [{ type: 'paragraph', text: 'sentence one' }, { type: 'paragraph', text: 'sentence two' }]),
      page('b.jpg', [{ type: 'paragraph', text: 'sentence three' }]),
    ],
    [join('p1.b1', 'p2.b1')],
  );
  assert.match(apart.rejected[0]?.reason ?? '', /next to each other/);

  const formula = applyMergeOperations(
    [page('a.jpg', [{ type: 'formula', text: 'A = \\emptyset' }]), page('b.jpg', [{ type: 'paragraph', text: 'while' }])],
    [join('p1.b1', 'p2.b1')],
  );
  assert.match(formula.rejected[0]?.reason ?? '', /prose/);
});

test('rejects operations that are not drop or join', () => {
  const outcome = applyMergeOperations([note2], [
    { op: 'rewrite', id: 'p1.b1', text: 'something the board never said' },
    { op: 'drop_duplicate', id: 'p1.b2' },
  ]);

  assert.equal(outcome.rejected.length, 2);
  assert.deepEqual(texts(outcome), note2.blocks.map((block) => block.text ?? ''));
});

test('with no operations, returns every page in order with its page number', () => {
  const outcome = applyMergeOperations([note2, note1], []);

  assert.deepEqual(texts(outcome), [...note2.blocks, ...note1.blocks].map((block) => block.text ?? ''));
  assert.deepEqual(outcome.blocks.map((block) => block.page), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
});

/* --- helpers --- */

test('compares LaTeX and Unicode notation as the same words', () => {
  assert.deepEqual(tokens('\\sum_{e \\in A} w(e)'), tokens('∑(e∈A) w(e)'));
  // The form qwen actually wrote on note3, against note2's.
  assert.deepEqual(tokens('∑_e∈A w(e) = w(A)'), tokens('\\sum_{e \\in A} w(e) = w(A)'));
  assert.deepEqual(tokens('x \\le y'), tokens('x ≤ y'));
});
