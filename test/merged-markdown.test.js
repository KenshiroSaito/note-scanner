import test from 'node:test';
import assert from 'node:assert/strict';

import { FORMULA_FLAVOURS, mergedToMarkdown } from '../public/lib/markdown.js';

const failure = (afterPage, name) => ({ afterPage, source_image: name, error: 'the model could not read this page' });

test('renders merged blocks as one continuous document', () => {
  const document = mergedToMarkdown([
    { type: 'heading', text: 'Minimum spanning trees', page: 0 },
    { type: 'paragraph', text: 'A minimum spanning tree is any spanning tree A', page: 0 },
    { type: 'heading', text: "Prim's Algorithm", page: 1 },
  ]);

  assert.equal(
    document,
    "## Minimum spanning trees\n\nA minimum spanning tree is any spanning tree A\n\n## Prim's Algorithm\n",
  );
  assert.ok(!document.includes('---'), 'page boundaries are what the merge removed');
});

test('places a failed page between the pages it sat between', () => {
  const document = mergedToMarkdown(
    [
      { type: 'paragraph', text: 'Page one', page: 0 },
      { type: 'paragraph', text: 'Page three', page: 1 },
    ],
    [failure(0, 'page-two.jpg')],
  );

  const parts = document.trim().split('\n\n');
  assert.equal(parts[0], 'Page one');
  assert.match(parts[1] ?? '', /\[failed\].*page-two\.jpg/);
  assert.equal(parts[2], 'Page three');
});

test('keeps a failure in place when the page after it was merged away entirely', () => {
  // Merged page 1 was all duplicates, so no block carries page 1.
  const document = mergedToMarkdown(
    [
      { type: 'paragraph', text: 'first', page: 0 },
      { type: 'paragraph', text: 'third', page: 2 },
    ],
    [failure(1, 'missing.jpg')],
  );

  const parts = document.trim().split('\n\n');
  assert.equal(parts[0], 'first');
  assert.match(parts[1] ?? '', /missing\.jpg/);
  assert.equal(parts[2], 'third');
});

test('places failures before the first page and after the last', () => {
  const document = mergedToMarkdown(
    [{ type: 'paragraph', text: 'only page', page: 0 }],
    [failure(0, 'after.jpg'), failure(-1, 'before.jpg')],
  );

  const parts = document.trim().split('\n\n');
  assert.match(parts[0] ?? '', /before\.jpg/);
  assert.equal(parts[1], 'only page');
  assert.match(parts[2] ?? '', /after\.jpg/);
});

test('honours the formula flavour and marks failures in every flavour', () => {
  for (const flavour of FORMULA_FLAVOURS) {
    const document = mergedToMarkdown(
      [{ type: 'formula', text: '\\sum_{e \\in A} w(e)', page: 0 }],
      [failure(0, 'x.jpg')],
      flavour,
    );
    assert.match(document, /\[failed\]/, `${flavour} should mark the failure`);
    if (flavour === 'latex') assert.match(document, /\$\$/);
    if (flavour === 'unicode') assert.match(document, /∑\(e∈A\)/);
  }
});

test('ends with one newline and never leaves a blank run', () => {
  const document = mergedToMarkdown(
    [
      { type: 'paragraph', text: 'a', page: 0 },
      { type: 'paragraph', text: '   ', page: 0 },
      { type: 'paragraph', text: 'b', page: 1 },
    ],
    [failure(0, 'gap.jpg')],
  );

  assert.ok(document.endsWith('\n') && !document.endsWith('\n\n'));
  assert.ok(!document.includes('\n\n\n'));
});

test('renders nothing for nothing', () => {
  assert.equal(mergedToMarkdown([]), '');
  assert.equal(mergedToMarkdown(undefined), '');
});
