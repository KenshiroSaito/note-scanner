import test from 'node:test';
import assert from 'node:assert/strict';

import { downloadFilename } from '../public/lib/download.js';

test('names the file after the local date', () => {
  assert.equal(downloadFilename(new Date(2026, 8, 14, 10, 30)), 'notes-2026-09-14.md');
});

test('pads single-digit months and days', () => {
  assert.equal(downloadFilename(new Date(2026, 0, 5)), 'notes-2026-01-05.md');
});

test('uses the local day, not the UTC one, late in the evening', () => {
  // 23:59 local is already tomorrow in UTC for anyone west of Greenwich.
  assert.equal(downloadFilename(new Date(2026, 11, 31, 23, 59)), 'notes-2026-12-31.md');
});

test('defaults to today', () => {
  assert.match(downloadFilename(), /^notes-\d{4}-\d{2}-\d{2}\.md$/);
});
