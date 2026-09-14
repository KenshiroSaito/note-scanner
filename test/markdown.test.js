import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FORMULA_FLAVOUR,
  FORMULA_FLAVOURS,
  blockToMarkdown,
  formatFormula,
  resultToMarkdown,
  resultsToMarkdown,
} from '../public/lib/markdown.js';
import { sampleResultFor } from './fixtures/sample-results.js';

test('renders a topic as a level-one heading and a heading as level two', () => {
  assert.equal(blockToMarkdown({ type: 'topic', text: 'Thermodynamics' }), '# Thermodynamics');
  assert.equal(blockToMarkdown({ type: 'heading', text: 'Entropy' }), '## Entropy');
});

test('renders paragraphs and definitions as plain text', () => {
  assert.equal(blockToMarkdown({ type: 'paragraph', text: 'Entropy rises.' }), 'Entropy rises.');
  assert.equal(
    blockToMarkdown({ type: 'definition', text: 'Reversible: no net change.' }),
    'Reversible: no net change.',
  );
});

test('renders a list with a lead-in line above the items', () => {
  const markdown = blockToMarkdown({
    type: 'list',
    text: 'Consequences',
    items: ['Heat flows hot to cold', 'No perfect engine'],
  });

  assert.equal(markdown, 'Consequences\n\n- Heat flows hot to cold\n- No perfect engine');
});

test('omits the lead-in line when a list has only items', () => {
  // Otherwise the block opens with a blank line and the document looks broken.
  const markdown = blockToMarkdown({ type: 'list', items: ['one', 'two'] });

  assert.equal(markdown, '- one\n- two');
});

test('keeps answer-option prefixes exactly as the model produced them', () => {
  const markdown = blockToMarkdown({
    type: 'question',
    text: 'Maximum efficiency?',
    items: ['A. 20%', 'B. 40%'],
  });

  assert.equal(markdown, 'Maximum efficiency?\n\n- A. 20%\n- B. 40%');
});

test('keeps a Markdown table the model wrote itself', () => {
  const table = '| Stage | Q |\n|---|---|\n| Expansion | +Q |';
  const rendered = blockToMarkdown({ type: 'table', text: table }, 'latex');

  for (const cell of ['Stage', 'Q', 'Expansion', '+Q']) {
    assert.ok(rendered.includes(cell), `${cell} should survive`);
  }
  assert.match(rendered, /^\| Stage \| Q \|/);
  assert.ok(rendered.includes('---'), 'should keep a separator row');
});

test('renders an unreadable block as a visible marker naming the reason', () => {
  const markdown = blockToMarkdown({ type: 'unreadable', note: 'corner is cut off' });

  assert.match(markdown, /^> /, 'should be a blockquote so it stands out');
  assert.match(markdown, /unreadable/);
  assert.match(markdown, /corner is cut off/);
});

test('still marks an unreadable block that arrived without a note', () => {
  assert.match(blockToMarkdown({ type: 'unreadable' }), /unreadable/);
});

test('drops list items that are blank', () => {
  assert.equal(blockToMarkdown({ type: 'list', items: ['real', '  ', ''] }), '- real');
});

test('renders nothing for a block with no content', () => {
  assert.equal(blockToMarkdown({ type: 'paragraph', text: '   ' }), '');
  assert.equal(blockToMarkdown({ type: 'heading' }), '');
});

/* --- formula flavours --- */

test('latex wraps a formula in display delimiters', () => {
  assert.equal(formatFormula('S = k_B \\ln \\Omega', 'latex'), '$$\nS = k_B \\ln \\Omega\n$$');
});

test('plain leaves a formula as bare text', () => {
  // Apple Notes renders neither LaTeX nor code spans.
  assert.equal(formatFormula('S = k_B \\ln \\Omega', 'plain'), 'S = k_B \\ln \\Omega');
});

test('code wraps a formula in a code span', () => {
  assert.equal(formatFormula('E = mc^2', 'code'), '`E = mc^2`');
});

test('code uses a longer fence when the formula contains a backtick', () => {
  // A single backtick fence would break the span.
  assert.equal(formatFormula('a ` b', 'code'), '`` a ` b ``');
});

test('defaults to latex', () => {
  assert.equal(DEFAULT_FORMULA_FLAVOUR, 'latex');
  assert.equal(formatFormula('x = 1'), formatFormula('x = 1', 'latex'));
  assert.deepEqual(FORMULA_FLAVOURS, ['latex', 'unicode', 'plain', 'code']);
});

test('every flavour produces something for a formula block', () => {
  for (const flavour of FORMULA_FLAVOURS) {
    const markdown = blockToMarkdown({ type: 'formula', text: 'x = 1' }, flavour);
    assert.ok(markdown.includes('x = 1'), `${flavour} should keep the formula text`);
  }
});

test('renders an empty formula as nothing rather than empty delimiters', () => {
  assert.equal(formatFormula('', 'latex'), '');
  assert.equal(blockToMarkdown({ type: 'formula', text: '' }), '');
});

/* --- documents --- */

test('separates blocks with one blank line', () => {
  const markdown = resultToMarkdown({
    blocks: [
      { type: 'heading', text: 'Entropy' },
      { type: 'paragraph', text: 'It rises.' },
    ],
  });

  assert.equal(markdown, '## Entropy\n\nIt rises.');
});

test('joins two images with a horizontal rule and ends with one newline', () => {
  const document = resultsToMarkdown([
    { blocks: [{ type: 'heading', text: 'Page one' }] },
    { blocks: [{ type: 'heading', text: 'Page two' }] },
  ]);

  assert.equal(document, '## Page one\n\n---\n\n## Page two\n');
});

test('never emits three consecutive newlines', () => {
  // Stray blank lines are what make generated Markdown look broken when pasted,
  // and it is invisible until someone pastes it.
  const document = resultsToMarkdown([
    {
      blocks: [
        { type: 'heading', text: 'Heading' },
        { type: 'paragraph', text: '   ' },
        { type: 'formula', text: '' },
        { type: 'list', items: [] },
        { type: 'paragraph', text: 'Real content.' },
      ],
    },
    { blocks: [{ type: 'paragraph', text: 'Second page.' }] },
  ]);

  assert.ok(!document.includes('\n\n\n'), `unexpected blank run in:\n${JSON.stringify(document)}`);
  assert.ok(document.endsWith('\n'));
  assert.ok(!document.endsWith('\n\n'));
});

test('returns an empty document for no results or empty results', () => {
  assert.equal(resultsToMarkdown([]), '');
  assert.equal(resultsToMarkdown(), '');
  assert.equal(resultsToMarkdown([{ blocks: [] }]), '');
});

test('skips an image that produced no renderable blocks', () => {
  const document = resultsToMarkdown([
    { blocks: [{ type: 'paragraph', text: '' }] },
    { blocks: [{ type: 'heading', text: 'Real page' }] },
  ]);

  // No leading separator from the empty first section.
  assert.equal(document, '## Real page\n');
});

test('converts the spec section 5 fixture end to end', () => {
  const document = resultsToMarkdown([sampleResultFor('note1.jpg', 0)], 'latex');

  assert.match(document, /^# /, 'should open with the topic heading');
  assert.match(document, /\$\$/, 'should contain a formula block');
  assert.match(document, /^- /m, 'should contain list items');
  assert.ok(!document.includes('\n\n\n'));
  assert.ok(document.endsWith('\n'));
});

test('converts a fixture containing an unreadable block', () => {
  // Fixture index 1 is the medium-confidence page with an unreadable note.
  const document = resultsToMarkdown([sampleResultFor('note2.jpg', 1)]);

  assert.match(document, /> \*\*\[unreadable\]\*\*/);
});

/* --- tables --- */

/** The real block note1.jpg produced, which used to lose three of its strings. */
const note1Table = {
  type: 'table',
  text: 'job overhead',
  items: ['batch processing', 'time sharing'],
  note: 'The table is partially filled with text.',
};

test('renders two-word table text as column headings', () => {
  const markdown = blockToMarkdown(note1Table, 'latex');

  assert.equal(
    markdown.split('\n').slice(0, 4).join('\n'),
    '| job | overhead |\n| --- | --- |\n| batch processing |  |\n| time sharing |  |',
  );
});

test('leaves empty cells empty rather than dropping them', () => {
  const markdown = blockToMarkdown(note1Table, 'latex');

  // Two columns on every row, so a partly-filled board still looks partly filled.
  for (const line of markdown.split('\n').filter((l) => l.startsWith('|'))) {
    assert.equal(line.split('|').length - 1, 3, `row should have two cells: ${line}`);
  }
});

test('loses nothing from the real note1 table, in any flavour', () => {
  // The invariant: every string the model returned appears somewhere.
  for (const flavour of FORMULA_FLAVOURS) {
    const markdown = blockToMarkdown(note1Table, flavour);
    for (const fragment of ['job', 'overhead', 'batch processing', 'time sharing', 'partially filled']) {
      assert.ok(markdown.includes(fragment), `${flavour} dropped "${fragment}"`);
    }
  }
});

test('uses no pipes in the flavours whose apps cannot render tables', () => {
  for (const flavour of ['unicode', 'plain']) {
    const markdown = blockToMarkdown(note1Table, flavour);
    assert.ok(!markdown.includes('|'), `${flavour} should not emit pipe syntax`);
    assert.match(markdown, /^job \/ overhead/);
    assert.match(markdown, /^- batch processing$/m);
  }
});

test('falls back to a caption and bullets when the text is a sentence', () => {
  // Four or more words read as prose; inventing columns from that is nonsense.
  const block = {
    type: 'table',
    text: 'Comparison of the scheduling policies',
    items: ['round robin', 'first come first served'],
  };

  const markdown = blockToMarkdown(block, 'latex');

  assert.ok(!markdown.includes('|'), 'should not guess columns out of a sentence');
  assert.match(markdown, /^Comparison of the scheduling policies/);
  assert.match(markdown, /^- round robin$/m);
  assert.match(markdown, /^- first come first served$/m);
});

test('splits explicit pipe columns in the heading and in items', () => {
  const block = {
    type: 'table',
    text: 'Stage | Q | W',
    items: ['Expansion | +Q | +W', 'Compression | -Q | -W'],
  };

  const markdown = blockToMarkdown(block, 'latex');

  assert.match(markdown, /^\| Stage \| Q \| W \|/);
  assert.match(markdown, /^\| Expansion \| \+Q \| \+W \|$/m);
});

test('pads a row that has fewer cells than there are columns', () => {
  const block = { type: 'table', text: 'a | b | c', items: ['only one'] };

  assert.match(blockToMarkdown(block, 'latex'), /^\| only one \|  \|  \|$/m);
});

test('converts a model-written pipe table to bullets for plain-text apps', () => {
  const table = '| Stage | Q |\n|---|---|\n| Expansion | +Q |';
  const markdown = blockToMarkdown({ type: 'table', text: table }, 'plain');

  assert.ok(!markdown.includes('|'), 'pipes would paste as noise in Apple Notes');
  assert.match(markdown, /Stage \/ Q/);
  assert.match(markdown, /- Expansion — \+Q/);
});

test('renders a table that has text but no items', () => {
  assert.equal(blockToMarkdown({ type: 'table', text: 'Results summary' }, 'latex'), 'Results summary');
});

/* --- notes on any block --- */

test('renders a note attached to a block that is not unreadable', () => {
  const markdown = blockToMarkdown({ type: 'paragraph', text: 'Body', note: 'partly erased' });

  assert.equal(markdown, 'Body\n\n> partly erased');
});

test('does not repeat the note on an unreadable block', () => {
  const markdown = blockToMarkdown({ type: 'unreadable', note: 'corner cut off' });

  assert.equal(markdown, '> **[unreadable]** corner cut off');
  assert.equal(markdown.match(/corner cut off/g)?.length, 1);
});

test('loses no string from any block type, in any flavour', () => {
  const blocks = [
    { type: 'topic', text: 'Scheduling' },
    { type: 'heading', text: 'Policies' },
    { type: 'paragraph', text: 'Round robin is preemptive.', note: 'smudged' },
    { type: 'list', text: 'Kinds', items: ['batch', 'interactive'] },
    { type: 'question', text: 'Which is fair?', items: ['A. RR', 'B. FCFS'] },
    { type: 'definition', text: 'Quantum: the slice length.' },
    { type: 'formula', text: '\\sum_{i} t_i' },
    note1Table,
    { type: 'unreadable', note: 'bottom edge cut off' },
  ];

  for (const flavour of FORMULA_FLAVOURS) {
    const markdown = resultsToMarkdown([{ blocks }], flavour);

    for (const block of blocks) {
      for (const value of [block.text, block.note, ...(block.items ?? [])]) {
        if (!value || block.type === 'formula') continue;
        // Table text is split into headings, so check its words individually.
        const fragments = block === note1Table && value === block.text ? value.split(' ') : [value];
        for (const fragment of fragments) {
          assert.ok(markdown.includes(fragment), `${flavour} dropped "${fragment}"`);
        }
      }
    }
  }
});
