import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import createLibheif from '../public/vendor/libheif/libheif-bundle.mjs';
import { decodeHeic, looksLikeHeic } from '../public/lib/heic.js';

/** note1.jpg shrunk to 320px and saved as HEIC by macOS `sips`. */
const fixture = new URL('./fixtures/note1-small.heic', import.meta.url);

/** Build an ftyp box from a major brand and compatible brands. */
function ftyp(major, compatible = []) {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join('')}`), 4);
  return bytes;
}

/* --- detection --- */

test('recognises a real HEIC file by its bytes', async () => {
  const bytes = new Uint8Array(await readFile(fixture));
  assert.ok(looksLikeHeic(bytes.subarray(0, 64)));
});

test('recognises every HEVC brand and generic HEIF', () => {
  for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']) {
    assert.ok(looksLikeHeic(ftyp(brand)), `${brand} should count as HEIC`);
  }
  // iPhone files: major heic, compatible mif1 and friends.
  assert.ok(looksLikeHeic(ftyp('mif1', ['heic'])));
});

test('does not mistake AVIF for HEIC, even with the shared mif1 brand', () => {
  // The f*.jpg test images were AVIF under a .jpg name; libheif-js cannot decode them.
  assert.ok(!looksLikeHeic(ftyp('avif', ['mif1', 'miaf'])));
  assert.ok(!looksLikeHeic(ftyp('mif1', ['avif'])));
});

test('rejects JPEG, PNG, and buffers too short to hold a brand', () => {
  assert.ok(!looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])));
  assert.ok(!looksLikeHeic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])));
  assert.ok(!looksLikeHeic(new Uint8Array([0, 0, 0, 24, 0x66, 0x74])));
  assert.ok(!looksLikeHeic(new Uint8Array()));
  assert.ok(!looksLikeHeic(undefined));
});

/* --- decoding --- */

test('decodes a real HEIC through the vendored libheif', async () => {
  const bytes = new Uint8Array(await readFile(fixture));

  const pixels = await decodeHeic(createLibheif(), bytes);

  assert.equal(pixels.width, 320);
  assert.equal(pixels.height, 240);
  assert.equal(pixels.data.length, 320 * 240 * 4);
  // A whiteboard photo is not all zeros: the pixels were actually written.
  assert.ok(pixels.data.some((value) => value > 0));
});

/** A stand-in for libheif that records which handles were freed. */
function fakeLibheif(images) {
  return {
    HeifDecoder: class {
      decode() {
        return images;
      }
    },
  };
}

function fakeImage({ primary = false, fail = false } = {}) {
  return {
    freed: false,
    displayed: false,
    is_primary: () => primary,
    get_width: () => 2,
    get_height: () => 1,
    display(target, callback) {
      this.displayed = true;
      callback(fail ? null : target);
    },
    free() {
      this.freed = true;
    },
  };
}

test('decodes the primary image and frees every handle', async () => {
  const thumbnail = fakeImage();
  const photo = fakeImage({ primary: true });

  const pixels = await decodeHeic(fakeLibheif([thumbnail, photo]), new Uint8Array());

  assert.equal(pixels.data.length, 8);
  assert.ok(photo.displayed);
  assert.ok(!thumbnail.displayed);
  assert.ok(thumbnail.freed && photo.freed);
});

test('frees handles when decoding fails, and says so', async () => {
  const image = fakeImage({ primary: true, fail: true });

  await assert.rejects(decodeHeic(fakeLibheif([image]), new Uint8Array()), /HEIC decoding failed/);
  assert.ok(image.freed);
});

test('rejects a file with no image in it', async () => {
  await assert.rejects(decodeHeic(fakeLibheif([]), new Uint8Array()), /no readable HEIC image/);
});
