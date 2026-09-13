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
 * Decoding goes through an `<img>` element rather than `createImageBitmap`
 * because EXIF orientation is then applied by the browser: `image-orientation:
 * from-image` is the CSS initial value, and `drawImage` uses the oriented
 * intrinsic size. `createImageBitmap` needs an `imageOrientation` option that
 * older Safari accepts and ignores, which silently yields sideways images.
 *
 * @param {File} file
 * @returns {Promise<File>} a JPEG File
 */
export async function normalizeImage(file) {
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
