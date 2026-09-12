import test from 'node:test';
import assert from 'node:assert/strict';

import { LONG_EDGE, fittedSize, normalizedName } from '../public/lib/normalize.js';

test('clamps the long edge of a landscape image', () => {
  // The real case: an iPhone 16 Pro photo.
  assert.deepEqual(fittedSize(4032, 3024), { width: 1568, height: 1176 });
});

test('clamps the long edge of a portrait image', () => {
  // The same photo shot rotated, as reported after EXIF orientation.
  assert.deepEqual(fittedSize(3024, 4032), { width: 1176, height: 1568 });
});

test('clamps a square image on both edges', () => {
  assert.deepEqual(fittedSize(3000, 3000), { width: LONG_EDGE, height: LONG_EDGE });
});

test('never upscales an image that already fits', () => {
  assert.deepEqual(fittedSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fittedSize(100, 100), { width: 100, height: 100 });
});

test('leaves an image exactly at the limit untouched', () => {
  assert.deepEqual(fittedSize(LONG_EDGE, 900), { width: LONG_EDGE, height: 900 });
  assert.deepEqual(fittedSize(900, LONG_EDGE), { width: 900, height: LONG_EDGE });
});

test('puts the long edge exactly on the limit and keeps the ratio', () => {
  const source = { width: 4032, height: 3024 };
  const fitted = fittedSize(source.width, source.height);

  assert.equal(Math.max(fitted.width, fitted.height), LONG_EDGE);
  assert.ok(
    Math.abs(fitted.width / fitted.height - source.width / source.height) < 0.01,
    'aspect ratio should survive the resize',
  );
});

test('returns whole pixels', () => {
  for (const [width, height] of [[4032, 3024], [3000, 1999], [1920, 1081], [2777, 1233]]) {
    const fitted = fittedSize(width, height);
    assert.ok(Number.isInteger(fitted.width), `${width}x${height} width should be an integer`);
    assert.ok(Number.isInteger(fitted.height), `${width}x${height} height should be an integer`);
  }
});

test('keeps an extreme panorama at least one pixel tall', () => {
  const fitted = fittedSize(20000, 40);
  assert.equal(fitted.width, LONG_EDGE);
  assert.ok(fitted.height >= 1);
});

test('honours a caller-supplied max edge', () => {
  assert.deepEqual(fittedSize(4000, 2000, 1000), { width: 1000, height: 500 });
});

test('renames any source extension to .jpg', () => {
  assert.equal(normalizedName('IMG_0412.png'), 'IMG_0412.jpg');
  assert.equal(normalizedName('IMG_0412.jpeg'), 'IMG_0412.jpg');
  assert.equal(normalizedName('IMG_0412.JPG'), 'IMG_0412.jpg');
  assert.equal(normalizedName('note1.jpg'), 'note1.jpg');
});

test('handles names with dots and no extension', () => {
  assert.equal(normalizedName('lecture.2026-09-11.notes.png'), 'lecture.2026-09-11.notes.jpg');
  assert.equal(normalizedName('scan'), 'scan.jpg');
});

test('treats a leading dot as part of the name, not an extension', () => {
  assert.equal(normalizedName('.notes'), '.notes.jpg');
});

test('falls back to a usable name when there is none', () => {
  assert.equal(normalizedName(''), 'image.jpg');
  assert.equal(normalizedName(undefined), 'image.jpg');
});
