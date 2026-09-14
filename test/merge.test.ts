import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMergeOperations,
  describePages,
  flattenPages,
  mergeOperationsJsonSchema,
  tokens,
  type MergeOutcome,
} from '../src/merge.ts';
import type { Block, ExtractionResult } from '../src/schema.ts';

function page(sourceImage: string, blocks: Block[]): ExtractionResult {
  return { source_image: sourceImage, confidence: 'high', blocks };
}

const drop = (id: string, duplicateOf: string) => ({ op: 'drop_duplicate', id, duplicate_of: duplicateOf });
const join = (first: string, second: string) => ({ op: 'join', first, second });

function texts(outcome: MergeOutcome): string[] {
  return outcome.blocks.map((block) => block.text ?? '');
}

/**
 * The invariant this whole phase is built around: every string on every page
 * survives, unless its block was dropped as a verified duplicate — and then the
 * block it duplicated must itself still be present.
 */
function assertNothingLost(pages: ExtractionResult[], outcome: MergeOutcome) {
  const droppedFor = new Map(outcome.drops.map((entry) => [entry.id, entry.duplicate_of]));
  const output = outcome.blocks
    .flatMap((block) => [block.text ?? '', ...(block.items ?? []), block.note ?? ''])
    .join('\n');

  for (const entry of flattenPages(pages)) {
    const keeper = droppedFor.get(entry.id);
    if (keeper) {
      assert.ok(!droppedFor.has(keeper), `${entry.id} was dropped for ${keeper}, which was dropped too`);
      continue;
    }
    for (const value of [entry.block.text, ...(entry.block.items ?? []), entry.block.note]) {
      if (value) assert.ok(output.includes(value.trim()), `lost "${value}" from ${entry.id}`);
    }
  }
}

/* --- the real photos, as pass 1 reads them --- */

const note2 = page('note2.jpg', [
  { type: 'paragraph', text: 'weight of a tree A ⊆ E is defined as' },
  { type: 'formula', text: '\\sum_{e \\in A} w(e) = w(A)' },
  { type: 'paragraph', text: 'A minimum spanning tree is' },
  { type: 'paragraph', text: 'any spanning tree A that minimizes' },
  { type: 'formula', text: 'w(A) = \\sum_{e \\in A} w(e)' },
]);

// The same board photographed wider, read slightly differently, plus Prim's algorithm.
const note3 = page('note3.jpg', [
  { type: 'definition', text: 'Weight of a tree A ⊆ E is defined as' },
  { type: 'formula', text: '\\sum_{e\\in A} w(e)=w(A)' },
  { type: 'paragraph', text: 'A minimum spanning tree is' },
  { type: 'paragraph', text: 'any spanning tree A that minimizes' },
  { type: 'formula', text: 'w(A) = ∑(e∈A) w(e)' },
  { type: 'heading', text: 'Assumption' },
  { type: 'paragraph', text: 'All edge weights are distinct' },
  { type: 'heading', text: "Prim's Algorithm" },
  { type: 'formula', text: 'S = \\{s\\}' },
]);

// A different course entirely.
const note1 = page('note1.jpg', [
  { type: 'paragraph', text: 'Friday, Sept 11 through Teams' },
  { type: 'paragraph', text: 'mechanisms: interrupts' },
]);

const sameSentence = 'A cut is a partition of V';

/* --- drops --- */

test('drops an exact duplicate', () => {
  const pages = [page('a.jpg', [{ type: 'paragraph', text: sameSentence }]), page('b.jpg', [{ type: 'paragraph', text: sameSentence }])];

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1')]);

  assert.deepEqual(texts(outcome), [sameSentence]);
  assert.equal(outcome.drops.length, 1);
  assertNothingLost(pages, outcome);
});

test('drops a near-duplicate read differently from a second photo', () => {
  // Capitalisation, definition-versus-paragraph, spacing, and \sum-versus-∑.
  const pages = [note2, note3];

  const outcome = applyMergeOperations(pages, [
    drop('p2.b1', 'p1.b1'),
    drop('p2.b2', 'p1.b2'),
    drop('p2.b5', 'p1.b5'),
  ]);

  assert.equal(outcome.drops.length, 3, JSON.stringify(outcome.rejected));
  assertNothingLost(pages, outcome);
});

test('keeps a block wrongly named as a duplicate', () => {
  const pages = [note2, note3];

  const outcome = applyMergeOperations(pages, [drop('p2.b7', 'p1.b1')]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /similar/);
  assert.ok(texts(outcome).includes('All edge weights are distinct'));
});

test('refuses a drop that would lose more than a stray word', () => {
  const kept = 'all edge weights in the graph are distinct so the minimum spanning tree is unique for every connected input we consider here';
  const pages = (extra: string) => [
    page('a.jpg', [{ type: 'paragraph', text: kept }]),
    page('b.jpg', [{ type: 'paragraph', text: `${kept} ${extra}` }]),
  ];

  // One extra word is a misreading and may go...
  const oneWord = applyMergeOperations(pages('always'), [drop('p2.b1', 'p1.b1')]);
  assert.equal(oneWord.drops.length, 1);

  // ...but two extra words is content the kept block does not have.
  const twoWords = applyMergeOperations(pages('except loops'), [drop('p2.b1', 'p1.b1')]);
  assert.equal(twoWords.drops.length, 0);
  assert.match(twoWords.rejected[0]?.reason ?? '', /would be lost/);
  assertNothingLost(pages('except loops'), twoWords);
});

test('refuses a drop pointing at a later block', () => {
  const pages = [page('a.jpg', [{ type: 'paragraph', text: sameSentence }]), page('b.jpg', [{ type: 'paragraph', text: sameSentence }])];

  const outcome = applyMergeOperations(pages, [drop('p1.b1', 'p2.b1')]);

  assert.equal(outcome.blocks.length, 2);
  assert.match(outcome.rejected[0]?.reason ?? '', /before/);
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
  const pages = [
    page('a.jpg', [{ type: 'heading', text: 'Kruskal' }]),
    page('b.jpg', [{ type: 'formula', text: 'Kruskal' }]),
  ];

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1')]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /cannot duplicate/);
});

/* --- joins --- */

test('joins a sentence cut across a page boundary', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'among all edges (u, v) where u is in S and v is not in S' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'find the edge of minimum weight' }]),
  ];

  const outcome = applyMergeOperations(pages, [join('p1.b1', 'p2.b1')]);

  assert.deepEqual(texts(outcome), [
    'among all edges (u, v) where u is in S and v is not in S find the edge of minimum weight',
  ]);
  assertNothingLost(pages, outcome);
});

test('joins across a boundary once a repeated heading is dropped, whatever the listed order', () => {
  const pages = [
    page('a.jpg', [
      { type: 'heading', text: "Prim's Algorithm" },
      { type: 'paragraph', text: 'among all edges where u is in S' },
    ]),
    page('b.jpg', [
      { type: 'heading', text: "Prim's Algorithm" },
      { type: 'paragraph', text: 'find the edge of min weight' },
    ]),
  ];

  // The join is listed first on purpose: drops must still be applied before it.
  const outcome = applyMergeOperations(pages, [join('p1.b2', 'p2.b2'), drop('p2.b1', 'p1.b1')]);

  assert.deepEqual(texts(outcome), ["Prim's Algorithm", 'among all edges where u is in S find the edge of min weight']);
  assertNothingLost(pages, outcome);
});

test('refuses to join blocks on the same page', () => {
  const pages = [page('a.jpg', [{ type: 'paragraph', text: 'first half' }, { type: 'paragraph', text: 'second half' }])];

  const outcome = applyMergeOperations(pages, [join('p1.b1', 'p1.b2')]);

  assert.equal(outcome.blocks.length, 2);
  assert.match(outcome.rejected[0]?.reason ?? '', /across pages/);
});

test('refuses to join blocks that are not next to each other', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'sentence one' }, { type: 'paragraph', text: 'sentence two' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'sentence three' }]),
  ];

  const outcome = applyMergeOperations(pages, [join('p1.b1', 'p2.b1')]);

  assert.equal(outcome.blocks.length, 3);
  assert.match(outcome.rejected[0]?.reason ?? '', /next to each other/);
});

test('refuses to join anything that is not prose', () => {
  const pages = [
    page('a.jpg', [{ type: 'formula', text: 'A = \\emptyset' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'while the tree is incomplete' }]),
  ];

  const outcome = applyMergeOperations(pages, [join('p1.b1', 'p2.b1')]);

  assert.equal(outcome.blocks.length, 2);
  assert.match(outcome.rejected[0]?.reason ?? '', /prose/);
});

/* --- the whole thing --- */

test('rejects operations that are not drop or join, including rewrites', () => {
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
  assert.deepEqual(outcome.blocks.map((block) => block.page), [0, 0, 0, 0, 0, 1, 1]);
});

test('collapses the re-photographed section and keeps everything new', () => {
  const pages = [note2, note3, note1];

  const outcome = applyMergeOperations(pages, [
    drop('p2.b1', 'p1.b1'),
    drop('p2.b2', 'p1.b2'),
    drop('p2.b3', 'p1.b3'),
    drop('p2.b4', 'p1.b4'),
    drop('p2.b5', 'p1.b5'),
    // A bad suggestion tying the other course to this one: must not apply.
    drop('p3.b1', 'p2.b7'),
  ]);

  assert.deepEqual(texts(outcome), [
    'weight of a tree A ⊆ E is defined as',
    '\\sum_{e \\in A} w(e) = w(A)',
    'A minimum spanning tree is',
    'any spanning tree A that minimizes',
    'w(A) = \\sum_{e \\in A} w(e)',
    'Assumption',
    'All edge weights are distinct',
    "Prim's Algorithm",
    'S = \\{s\\}',
    'Friday, Sept 11 through Teams',
    'mechanisms: interrupts',
  ]);
  assert.equal(outcome.rejected.length, 1);
  assert.equal(outcome.blocks.find((block) => block.text === 'Friday, Sept 11 through Teams')?.page, 2);
  assertNothingLost(pages, outcome);
});

/* --- helpers --- */

test('compares LaTeX and Unicode notation as the same words', () => {
  assert.deepEqual(tokens('\\sum_{e \\in A} w(e)'), tokens('∑(e∈A) w(e)'));
  assert.deepEqual(tokens('x \\le y'), tokens('x ≤ y'));
});

test('lists every block with its ID, page, items, and note', () => {
  const listing = describePages([
    page('note2.jpg', [
      { type: 'heading', text: 'Cuts' },
      { type: 'list', text: 'Kinds', items: ['batch', 'interactive'] },
    ]),
    page('note4.jpg', [{ type: 'unreadable', note: 'corner cut off' }]),
  ]);

  assert.match(listing, /--- page 1 \(note2\.jpg\) ---/);
  assert.match(listing, /\[p1\.b1\] heading: Cuts/);
  assert.match(listing, /\[p1\.b2\] list: Kinds \| items: batch; interactive/);
  assert.match(listing, /--- page 2 \(note4\.jpg\) ---/);
  assert.match(listing, /\[p2\.b1\] unreadable: \s*\| note: corner cut off/);
});

test('exposes a JSON Schema for constrained decoding', () => {
  const schema = mergeOperationsJsonSchema();
  assert.equal(schema.type, 'object');
  assert.ok((schema.properties as Record<string, unknown>).operations);
});

/* --- found by running pass 2 on the real photos --- */

test('accepts block IDs copied with the listing brackets', () => {
  // qwen2.5vl wrote "[p1.b5]" for every ID, and every operation was refused.
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: sameSentence }]),
    page('b.jpg', [{ type: 'paragraph', text: sameSentence }]),
  ];

  const outcome = applyMergeOperations(pages, [{ op: 'drop_duplicate', id: '[p2.b1]', duplicate_of: ' [p1.b1] ' }]);

  assert.equal(outcome.drops.length, 1, JSON.stringify(outcome.rejected));
  assert.deepEqual(outcome.drops[0], { id: 'p2.b1', duplicate_of: 'p1.b1' });
  assertNothingLost(pages, outcome);
});

test('accepts bracketed IDs in a join too', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'among all edges where u is in S' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'find the edge of min weight' }]),
  ];

  const outcome = applyMergeOperations(pages, [{ op: 'join', first: '[p1.b1]', second: '[p2.b1]' }]);

  assert.deepEqual(outcome.joins, [{ first: 'p1.b1', second: 'p2.b1' }]);
});

test('refuses to drop a block as a duplicate of another on the same page', () => {
  // The model proposed exactly this on note2. Its second formula has the same
  // symbols as its first, so word overlap alone would accept it — but it is a
  // different statement, and dropping it would leave "that minimizes" hanging.
  const outcome = applyMergeOperations([note2], [{ op: 'drop_duplicate', id: '[p1.b5]', duplicate_of: '[p1.b2]' }]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /same page/);
  assert.deepEqual(texts(outcome), note2.blocks.map((block) => block.text ?? ''));
});

test('keeps a page that repeats a heading of its own', () => {
  // note4 has two "Definition" headings introducing two different definitions.
  const note4 = page('note4.jpg', [
    { type: 'heading', text: 'Definition' },
    { type: 'paragraph', text: 'A cut (S, V \\ S) is a partition of V' },
    { type: 'heading', text: 'Definition' },
    { type: 'paragraph', text: 'A crossing edge (u, v) for a cut has one vertex in S' },
  ]);

  const outcome = applyMergeOperations([note4], [drop('p1.b3', 'p1.b1')]);

  assert.equal(outcome.blocks.length, 4);
  assert.equal(outcome.drops.length, 0);
});
