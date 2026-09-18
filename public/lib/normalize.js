/**
 * Normalizes images at the drop zone boundary.
 *
 * Every accepted file is decoded, EXIF-oriented, downscaled to LONG_EDGE on its
 * long edge, and re-encoded as JPEG before it enters the selection. Everything
 * downstream then handles one uniform, bounded format.
 *
 * The geometry and filename helpers are pure and tested; `normalizeImage` needs
 * a DOM and is verified in a browser.
 */
import { looksLikeHeic } from './heic.js';
import { isHeic } from './validation.js';

/** Long-edge target in pixels (spec section 6). */
export const LONG_EDGE = 1568;

/** JPEG quality for the re-encode. */
export const JPEG_QUALITY = 0.85;

/**
 * Fit dimensions inside a square of `maxEdge`, preserving aspect ratio.
 *
 * Only ever shrinks: an image already within the bound is returned unchanged,
 * since upscaling adds bytes without adding detail.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [maxEdge]
 * @returns {{ width: number, height: number }}
 */
export function fittedSize(width, height, maxEdge = LONG_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    // The long edge lands exactly on maxEdge; the short edge is rounded, and
    // clamped to at least 1px so a panorama cannot collapse to zero height.
    width: width >= height ? maxEdge : Math.max(1, Math.round(width * scale)),
    height: height > width ? maxEdge : Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Rename a file to the .jpg it becomes after normalization.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizedName(name) {
  const original = String(name ?? '');
  const dot = original.lastIndexOf('.');
  // A leading dot is part of the name, not an extension (".notes" stays whole).
  const base = dot > 0 ? original.slice(0, dot) : original;
  return `${base || 'image'}.jpg`;
}

/**
 * Decode, orient, resize, and re-encode one image.
 *
 * The browser's own decoder goes first. It handles JPEG and PNG everywhere, and
 * HEIC in Safari — so iPhone users never download the WebAssembly decoder. Only a
 * HEIC the browser cannot read falls back to it.
 *
 * @param {File} file
 * @returns {Promise<File>} a JPEG File
 */
export async function normalizeImage(file) {
  try {
    return await normalizeNatively(file);
  } catch (nativeError) {
    if (!(await isHeicFile(file))) throw nativeError;
    return normalizeHeic(file);
  }
}

/** By name or type, or by content for a HEIC saved under the wrong extension. */
async function isHeicFile(file) {
  if (isHeic(file)) return true;
  return looksLikeHeic(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
}

/** Created on the first HEIC, so the decoder is only downloaded when needed. */
let heicWorker = null;
let nextRequestId = 1;
const pendingRequests = new Map();

function heicDecoder() {
  if (heicWorker) return heicWorker;

  heicWorker = new Worker(new URL('./heic-worker.js', import.meta.url), { type: 'module' });

  heicWorker.addEventListener('message', ({ data }) => {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if (data.error) pending.reject(new Error(data.error));
    else pending.resolve(data.blob);
  });

  // Fires when the worker itself could not load, not for a bad file: fail
  // everything waiting and start a fresh worker next time.
  heicWorker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The HEIC decoder could not start.');
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
    heicWorker?.terminate();
    heicWorker = null;
  });

  return heicWorker;
}

/**
 * Decode a HEIC in the worker, which resizes and encodes it too.
 *
 * libheif applies the file's own rotation while decoding, so the result is
 * already upright.
 */
async function normalizeHeic(file) {
  const bytes = await file.arrayBuffer();
  const worker = heicDecoder();
  const id = nextRequestId++;

  const blob = await new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ id, bytes }, [bytes]);
  });

  return new File([blob], normalizedName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified ?? Date.now(),
  });
}

/**
 * The browser's own decoder.
 *
 * Decoding goes through an `<img>` element rather than `createImageBitmap`
 * because EXIF orientation is then applied by the browser: `image-orientation:
 * from-image` is the CSS initial value, and `drawImage` uses the oriented
 * intrinsic size. `createImageBitmap` needs an `imageOrientation` option that
 * older Safari accepts and ignores, which silently yields sideways images.
 */
async function normalizeNatively(file) {
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = sourceUrl;

  try {
    await image.decode();

    // naturalWidth/Height are post-orientation, so a rotated photo reports the
    // dimensions the user sees rather than the dimensions on disk.
    const { width, height } = fittedSize(image.naturalWidth, image.naturalHeight);
    if (!width || !height) throw new Error('Image has no dimensions');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    // White, not transparent: transparent PNG areas would otherwise turn black
    // when flattened into JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob) throw new Error('Encoding to JPEG failed');

    return new File([blob], normalizedName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified ?? Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
