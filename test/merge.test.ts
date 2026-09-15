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
import { note5, note6 } from './fixtures/shortest-paths-pages.ts';

function page(sourceImage: string, blocks: Block[]): ExtractionResult {
  return { source_image: sourceImage, confidence: 'high', blocks };
}

const drop = (id: string, duplicateOf: string | string[]) => ({ op: 'drop_duplicate', id, duplicate_of: duplicateOf });
const supersede = (id: string, by: string | string[]) => ({ op: 'supersede', id, by });

function texts(outcome: MergeOutcome): string[] {
  return outcome.blocks.map((block) => block.text ?? '');
}

/**
 * The invariant pass 2 is built around: no board writing the model read disappears.
 *
 * - a dropped block's run must itself still be present
 * - a superseded block's board words must all appear in the output; its note is
 *   deliberately discarded, because it described the earlier photo
 * - every other string must appear verbatim
 */
function assertNothingLost(pages: ExtractionResult[], outcome: MergeOutcome) {
  const droppedFor = new Map(outcome.drops.map((entry) => [entry.id, entry.duplicate_of]));
  const supersededIds = new Set(outcome.supersedes.map((entry) => entry.id));
  const output = outcome.blocks
    .flatMap((block) => [block.text ?? '', ...(block.items ?? []), block.note ?? ''])
    .join('\n');
  const outputWords = tokens(output);

  for (const entry of flattenPages(pages)) {
    const keepers = droppedFor.get(entry.id);
    if (keepers) {
      for (const keeper of keepers) {
        assert.ok(!droppedFor.has(keeper), `${entry.id} was dropped for ${keeper}, which was dropped too`);
      }
      continue;
    }

    if (supersededIds.has(entry.id)) {
      const board = [entry.block.text, ...(entry.block.items ?? [])].filter(Boolean).join(' ');
      for (const word of tokens(board)) {
        assert.ok(outputWords.has(word), `superseded ${entry.id} lost the word "${word}"`);
      }
      continue;
    }

    for (const value of [entry.block.text, ...(entry.block.items ?? []), entry.block.note]) {
      if (value) assert.ok(output.includes(value.trim()), `lost "${value}" from ${entry.id}`);
    }
  }
}

const sameSentence = 'A cut is a partition of V into two non-empty sets';

/* --- bug 1: no join may invent a sentence --- */

test('never joins across pages: the reported invented sentence cannot be produced', () => {
  // The exact pair from the bug report: note5's unfinished line and the first line
  // pass 1 read from note6, which is from the other panel of the board.
  const pages = [
    page('note5.jpg', [{ type: 'paragraph', text: 'd[v] should indicate the cost of' }]),
    page('note6.jpg', [{ type: 'paragraph', text: 'array π "predecessor array" (of size n)' }]),
  ];

  const outcome = mergeDocument(pages);

  assert.deepEqual(texts(outcome), ['d[v] should indicate the cost of', 'array π "predecessor array" (of size n)']);
  assert.ok(!outcome.blocks.some((block) => block.text?.includes('cost of array')));
});

test('does not recognise a join operation at all', () => {
  const outcome = applyMergeOperations(
    [page('a.jpg', [{ type: 'paragraph', text: 'first half' }]), page('b.jpg', [{ type: 'paragraph', text: 'second half' }])],
    [{ op: 'join', first: 'p1.b1', second: 'p2.b1' }],
  );

  assert.match(outcome.rejected[0]?.reason ?? '', /not a recognised operation/);
  assert.deepEqual(texts(outcome), ['first half', 'second half']);
});

/* --- the real shortest-paths photos --- */

test('merges note5 and note6: one Notation section, completed, where it first appeared', () => {
  const pages = [note5, note6];

  const outcome = mergeDocument(pages);

  // note5 read the panel as one definition with four items; note6 as four
  // paragraphs, with the last line finished. note6's four lines replace note5's
  // block in place.
  assert.deepEqual(outcome.supersedes, [{ id: 'p1.b2', by: ['p2.b4', 'p2.b5', 'p2.b6', 'p2.b7'] }]);
  assert.deepEqual(outcome.drops, []);
  assert.deepEqual(outcome.rejected, [], 'every planned operation should verify');

  assert.deepEqual(texts(outcome), [
    note5.blocks[0]!.text,
    note6.blocks[3]!.text,
    note6.blocks[4]!.text,
    note6.blocks[5]!.text,
    note6.blocks[6]!.text,
    note6.blocks[0]!.text,
    note6.blocks[1]!.text,
    note6.blocks[2]!.text,
  ]);

  // The section stays under note5's page, ahead of note6's π-array material.
  assert.deepEqual(outcome.blocks.map((block) => block.page), [0, 0, 0, 0, 0, 1, 1, 1]);

  // The completed line is there once; the unfinished one and any invented join are gone.
  const lines = outcome.blocks.flatMap((block) => [block.text ?? '', ...(block.items ?? [])]);
  assert.equal(lines.filter((line) => line.includes('d[v] should indicate the cost of')).length, 1);
  assert.ok(lines.some((line) => line.includes('algorithm') && line.startsWith('d[v] should indicate')));
  assert.ok(!lines.some((line) => /Notation array|cost of array/.test(line)));

  // note5's note said the last item was incomplete. Under the completed sentence
  // that would be false, so it is gone rather than carried across.
  assert.ok(!outcome.blocks.some((block) => block.note?.includes('incomplete')));
  assert.equal(outcome.blocks[4]!.note, undefined);

  assertNothingLost(pages, outcome);
});

test('a later photo completes an unfinished line instead of joining it to the other panel', () => {
  const pages = [page('note5.jpg', [{ type: 'paragraph', text: 'd[v] should indicate the cost of' }]), note6];

  const outcome = mergeDocument(pages);

  assert.deepEqual(outcome.supersedes, [{ id: 'p1.b1', by: ['p2.b7'] }]);
  assert.equal(outcome.blocks[0]!.text, note6.blocks[6]!.text);
  assertNothingLost(pages, outcome);
});

/* --- the earlier lecture photos: unchanged --- */

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
  assert.deepEqual(outcome.supersedes, []);
  assert.deepEqual(outcome.rejected, [], 'every planned operation should verify');

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

test('an unfinished line, its completion, and a repeat of the completion collapse to one', () => {
  const unfinished = 'd[v] should indicate the cost of';
  const complete = "d[v] should indicate the cost of algorithm's currently best-known s-v path";
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: unfinished }]),
    page('b.jpg', [{ type: 'paragraph', text: complete }]),
    page('c.jpg', [{ type: 'paragraph', text: complete }]),
  ];

  const outcome = mergeDocument(pages);

  assert.deepEqual(texts(outcome), [complete]);
  assert.deepEqual(outcome.rejected, []);
  assertNothingLost(pages, outcome);
});

test('never merges a different course into the lecture', () => {
  const outcome = mergeDocument([note2, note1]);

  assert.deepEqual(outcome.drops, []);
  assert.deepEqual(outcome.supersedes, []);
  assert.equal(outcome.blocks.length, note2.blocks.length + note1.blocks.length);
});

test('is deterministic', () => {
  for (const pages of [[note2, note3, note4, note1], [note5, note6]]) {
    assert.deepEqual(mergeDocument(pages), mergeDocument(pages));
  }
});

/* --- verifying supersede --- */

const longLine = 'all edge weights in this graph are distinct';

test('discards the note on a replaced block but keeps the note on its replacement', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: longLine, note: 'the end of the line is cut off' }]),
    page('b.jpg', [{ type: 'paragraph', text: `${longLine} and every tree is unique`, note: 'slightly blurred' }]),
  ];

  const outcome = mergeDocument(pages);

  assert.deepEqual(outcome.supersedes, [{ id: 'p1.b1', by: ['p2.b1'] }]);
  assert.deepEqual(outcome.blocks.map((block) => block.note), ['slightly blurred']);
});

test('refuses to supersede when the words are not in the same order', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'the cost of any shortest path is defined as w' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'w is defined as the cost of any shortest path' }]),
  ];

  const outcome = applyMergeOperations(pages, [supersede('p1.b1', 'p2.b1')]);

  assert.equal(outcome.supersedes.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /same order/);
});

test('does not plan to supersede a short line, though containment alone would allow it', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: 'array d of size n' }]),
    page('b.jpg', [{ type: 'paragraph', text: 'array d of size n holds the distances' }]),
  ];

  assert.equal(applyMergeOperations(pages, [supersede('p1.b1', 'p2.b1')]).supersedes.length, 1);
  assert.deepEqual(planMergeOperations(pages), []);
});

test('refuses to supersede a block that already has a verified later copy', () => {
  const pages = [
    page('a.jpg', [{ type: 'paragraph', text: longLine }]),
    page('b.jpg', [
      { type: 'paragraph', text: longLine },
      { type: 'paragraph', text: `${longLine} and every tree is unique` },
    ]),
  ];

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1'), supersede('p1.b1', 'p2.b2')]);

  assert.equal(outcome.supersedes.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /later copy/);
});

test('refuses a supersede from the same page, from earlier, or across a non-consecutive run', () => {
  const samePage = applyMergeOperations(
    [page('a.jpg', [{ type: 'paragraph', text: longLine }, { type: 'paragraph', text: `${longLine} too` }])],
    [supersede('p1.b1', 'p1.b2')],
  );
  assert.match(samePage.rejected[0]?.reason ?? '', /same page/);

  const backwards = applyMergeOperations(
    [page('a.jpg', [{ type: 'paragraph', text: `${longLine} too` }]), page('b.jpg', [{ type: 'paragraph', text: longLine }])],
    [supersede('p2.b1', 'p1.b1')],
  );
  assert.match(backwards.rejected[0]?.reason ?? '', /after it/);

  const gap = applyMergeOperations(
    [
      page('a.jpg', [{ type: 'paragraph', text: longLine }]),
      page('b.jpg', [
        { type: 'paragraph', text: 'all edge weights in this' },
        { type: 'paragraph', text: 'something else entirely' },
        { type: 'paragraph', text: 'graph are distinct' },
      ]),
    ],
    [supersede('p1.b1', ['p2.b1', 'p2.b3'])],
  );
  assert.match(gap.rejected[0]?.reason ?? '', /consecutive/);
});

test('refuses chains and shared replacements', () => {
  const chain = applyMergeOperations(
    [
      page('a.jpg', [{ type: 'paragraph', text: longLine }]),
      page('b.jpg', [{ type: 'paragraph', text: `${longLine} here` }]),
      page('c.jpg', [{ type: 'paragraph', text: `${longLine} here and now` }]),
    ],
    [supersede('p1.b1', 'p2.b1'), supersede('p2.b1', 'p3.b1')],
  );
  assert.equal(chain.supersedes.length, 1);
  assert.match(chain.rejected[0]?.reason ?? '', /already been replaced/);

  const shared = applyMergeOperations(
    [
      page('a.jpg', [{ type: 'paragraph', text: longLine }]),
      page('b.jpg', [{ type: 'paragraph', text: longLine }]),
      page('c.jpg', [{ type: 'paragraph', text: `${longLine} for sure` }]),
    ],
    [supersede('p1.b1', 'p3.b1'), supersede('p2.b1', 'p3.b1')],
  );
  assert.equal(shared.supersedes.length, 1);
  assert.match(shared.rejected[0]?.reason ?? '', /only one earlier block/);
});

test('never supersedes a table or an unreadable block', () => {
  const pages = [
    page('a.jpg', [note1.blocks[1]!, { type: 'unreadable', note: 'the bottom corner is cut off in this photo' }]),
    page('b.jpg', [
      { ...note1.blocks[1]!, items: ['batch processing', 'time sharing', 'multiprogramming'] },
      { type: 'unreadable', note: 'the bottom corner is cut off in this photo again' },
    ]),
  ];

  const outcome = applyMergeOperations(pages, [supersede('p1.b1', 'p2.b1'), supersede('p1.b2', 'p2.b2')]);

  assert.equal(outcome.supersedes.length, 0);
  assert.deepEqual(planMergeOperations(pages), []);
});

/* --- verifying drops --- */

test('drops a block covered by a run of earlier blocks, where no single block would do', () => {
  const pages = [note2, note3];

  // note3's first paragraph against note2's first block alone: not enough.
  assert.match(applyMergeOperations(pages, [drop('p2.b1', 'p1.b1')]).rejected[0]?.reason ?? '', /similar/);

  // Against note2's first two blocks read together: the same words.
  const outcome = applyMergeOperations(pages, [drop('p2.b1', ['p1.b1', 'p1.b2'])]);
  assert.equal(outcome.drops.length, 1, JSON.stringify(outcome.rejected));
  assertNothingLost(pages, outcome);
});

test('refuses a drop that would lose more than a stray word', () => {
  const kept = 'all edge weights in the graph are distinct so the minimum spanning tree is unique for every connected input we consider here';
  const pages = (extra: string) => [
    page('a.jpg', [{ type: 'paragraph', text: kept }]),
    page('b.jpg', [{ type: 'paragraph', text: `${kept} ${extra}` }]),
  ];

  assert.equal(applyMergeOperations(pages('always'), [drop('p2.b1', 'p1.b1')]).drops.length, 1);

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

test('refuses a drop pointing at a later block, or at an unknown one', () => {
  const pages = [page('a.jpg', [{ type: 'paragraph', text: sameSentence }]), page('b.jpg', [{ type: 'paragraph', text: sameSentence }])];

  assert.match(applyMergeOperations(pages, [drop('p1.b1', 'p2.b1')]).rejected[0]?.reason ?? '', /before/);
  assert.match(applyMergeOperations(pages, [drop('p9.b9', 'p1.b1')]).rejected[0]?.reason ?? '', /unknown/);
});

test('refuses dependent drops: a dropped keeper, or dropping a keeper', () => {
  const pages = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => page(name, [{ type: 'paragraph', text: sameSentence }]));

  const keeperDropped = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1'), drop('p3.b1', 'p2.b1')]);
  assert.match(keeperDropped.rejected[0]?.reason ?? '', /itself dropped/);

  const keeperNeeded = applyMergeOperations(pages, [drop('p3.b1', 'p2.b1'), drop('p2.b1', 'p1.b1')]);
  assert.match(keeperNeeded.rejected[0]?.reason ?? '', /depends/);
});

test('refuses a duplicate across incompatible block types', () => {
  const pages = [page('a.jpg', [{ type: 'heading', text: 'Kruskal' }]), page('b.jpg', [{ type: 'formula', text: 'Kruskal' }])];

  const outcome = applyMergeOperations(pages, [drop('p2.b1', 'p1.b1')]);

  assert.equal(outcome.drops.length, 0);
  assert.match(outcome.rejected[0]?.reason ?? '', /cannot duplicate/);
});

test('rejects operations that are not drop or supersede', () => {
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
