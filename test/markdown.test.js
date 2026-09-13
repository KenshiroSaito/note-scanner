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

test('passes a table through unchanged', () => {
  const table = '| Stage | Q |\n|---|---|\n| Expansion | +Q |';

  assert.equal(blockToMarkdown({ type: 'table', text: table }), table);
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
