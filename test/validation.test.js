import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCEPTED_TYPES,
  MAX_IMAGES,
  MAX_SOURCE_BYTES,
  checkFile,
  dedupe,
  identityOf,
  isAcceptedType,
  isHeic,
  validateSelection,
} from '../public/lib/validation.js';

/** A stand-in for a browser File. */
function file(name, type, size = 1024, lastModified = 1) {
  return { name, type, size, lastModified };
}

test('accepts the documented image types by MIME', () => {
  for (const type of ACCEPTED_TYPES) {
    assert.ok(isAcceptedType(file('note.img', type)), `${type} should be accepted`);
  }
});

test('falls back to the extension when the browser reports no MIME type', () => {
  assert.ok(isAcceptedType(file('scan.JPG', '')));
  assert.ok(isAcceptedType(file('scan.jpeg', undefined)));
  assert.ok(isAcceptedType(file('scan.png', '')));
  assert.ok(!isAcceptedType(file('notes.pdf', '')));
});

test('rejects unsupported formats', () => {
  for (const unsupported of [file('notes.pdf', 'application/pdf'), file('notes.txt', 'text/plain')]) {
    const result = checkFile(unsupported);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported-type');
  }
});

test('recognises HEIC by MIME type and by extension', () => {
  assert.ok(isHeic(file('a.heic', 'image/heic')));
  assert.ok(isHeic(file('a.heif', 'image/heif')));
  assert.ok(isHeic(file('IMG_0412.HEIC', '')));
  assert.ok(!isHeic(file('a.jpg', 'image/jpeg')));
});

test('accepts HEIC, the iPhone default, by MIME type and by extension', () => {
  for (const heic of [
    file('IMG_0412.heic', 'image/heic'),
    file('IMG_0412.heif', 'image/heif'),
    file('IMG_0412.HEIC', ''),
  ]) {
    assert.deepEqual(checkFile(heic), { ok: true });
  }
});

test('names every accepted format when refusing one', () => {
  assert.match(checkFile(file('notes.pdf', 'application/pdf')).message, /JPEG, PNG, or HEIC/);
});

test('rejects empty files', () => {
  const result = checkFile(file('blank.jpg', 'image/jpeg', 0));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
});

test('accepts a large photo but rejects one past the source limit', () => {
  // A 48-megapixel JPEG must still get through; only the undecodable is refused.
  assert.equal(checkFile(file('big.jpg', 'image/jpeg', 20 * 1024 * 1024)).ok, true);
  assert.equal(checkFile(file('big.jpg', 'image/jpeg', MAX_SOURCE_BYTES)).ok, true);

  const result = checkFile(file('huge.jpg', 'image/jpeg', MAX_SOURCE_BYTES + 1));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-large');
  assert.match(result.message, /40 MB/);
});

test('accepts exactly the image limit and rejects the next one', () => {
  const files = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => file(`page-${i}.jpg`, 'image/jpeg'));

  const { accepted, rejected } = validateSelection(files);

  assert.equal(accepted.length, MAX_IMAGES);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'too-many');
  assert.equal(rejected[0].file.name, `page-${MAX_IMAGES}.jpg`);
});

test('counts images already in the list against the limit', () => {
  const { accepted, rejected } = validateSelection(
    [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')],
    { alreadyAccepted: MAX_IMAGES - 1 },
  );

  assert.deepEqual(accepted.map((f) => f.name), ['a.jpg']);
  assert.deepEqual(rejected.map((r) => r.reason), ['too-many']);
});

test('partitions a mixed selection without losing files', () => {
  const files = [
    file('good.jpg', 'image/jpeg'),
    file('notes.pdf', 'application/pdf'),
    file('blank.png', 'image/png', 0),
    file('huge.png', 'image/png', MAX_SOURCE_BYTES + 1),
    file('photo.heic', ''),
    file('shot.png', 'image/png'),
  ];

  const { accepted, rejected } = validateSelection(files);

  assert.deepEqual(accepted.map((f) => f.name), ['good.jpg', 'photo.heic', 'shot.png']);
  assert.deepEqual(rejected.map((r) => [r.file.name, r.reason]), [
    ['notes.pdf', 'unsupported-type'],
    ['blank.png', 'empty'],
    ['huge.png', 'too-large'],
  ]);
  assert.equal(accepted.length + rejected.length, files.length);
});

test('dedupe drops incoming files whose key is already selected', () => {
  const existingKeys = [identityOf(file('a.jpg', 'image/jpeg', 1024, 10))];
  const incoming = [file('a.jpg', 'image/jpeg', 1024, 10), file('b.jpg', 'image/jpeg', 2048, 20)];

  assert.deepEqual(dedupe(existingKeys, incoming).map((f) => f.name), ['b.jpg']);
});

test('dedupe keeps a same-named file that differs in size or timestamp', () => {
  const existingKeys = [identityOf(file('a.jpg', 'image/jpeg', 1024, 10))];
  const incoming = [file('a.jpg', 'image/jpeg', 4096, 10), file('a.jpg', 'image/jpeg', 1024, 99)];

  assert.equal(dedupe(existingKeys, incoming).length, 2);
});

test('dedupe also removes repeats inside a single drop', () => {
  const twice = [file('a.jpg', 'image/jpeg', 1024, 10), file('a.jpg', 'image/jpeg', 1024, 10)];

  assert.equal(dedupe([], twice).length, 1);
});

test('identity is taken from the source file, so normalizing changes the key', () => {
  // The guard against deduping on post-conversion identities.
  const source = file('IMG_0412.png', 'image/png', 1_700_000, 42);
  const normalized = file('IMG_0412.jpg', 'image/jpeg', 240_000, 42);

  assert.notEqual(identityOf(source), identityOf(normalized));
  assert.deepEqual(dedupe([identityOf(source)], [source]), []);
});
