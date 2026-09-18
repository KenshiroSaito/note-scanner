/**
 * Client-side validation for image selections.
 *
 * Pure logic only: nothing here touches the DOM or the File API, so the same
 * module runs in the browser and under `node --test`. Anything with
 * `{ name, type, size, lastModified }` is accepted as a file.
 */

/** Maximum number of images per run (spec section 3). */
export const MAX_IMAGES = 25;

/**
 * Size ceiling on the *source* file, before normalization.
 *
 * Generous on purpose. The uploaded bytes are the normalized output, which is
 * bounded by construction (1568px JPEG), so the only job left here is refusing
 * files too large to decode comfortably. A tight limit would reject legitimate
 * 48-megapixel photos.
 */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/**
 * HEIC is what iPhones shoot by default. Safari decodes it natively; elsewhere
 * normalize.js falls back to a vendored libheif (spec section 4, decision 6).
 */
const HEIC_TYPES = ['image/heic', 'image/heif'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];

/** MIME types we can decode in-browser. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', ...HEIC_TYPES];

/** Extensions used when a browser reports no MIME type. */
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', ...HEIC_EXTENSIONS];

const MEGABYTE = 1024 * 1024;

function extensionOf(name) {
  const dot = String(name ?? '').lastIndexOf('.');
  return dot === -1 ? '' : String(name).slice(dot).toLowerCase();
}

function formatMegabytes(bytes) {
  return `${Math.round((bytes / MEGABYTE) * 10) / 10} MB`;
}

/**
 * Is this file an image we can decode?
 *
 * Safari and some Android browsers report an empty `type`, so the filename
 * extension is the fallback rather than the primary check.
 */
export function isAcceptedType(file) {
  const type = (file.type ?? '').toLowerCase();
  if (type) return ACCEPTED_TYPES.includes(type);
  return ACCEPTED_EXTENSIONS.includes(extensionOf(file.name));
}

/** True for HEIC/HEIF, by MIME type or extension. */
export function isHeic(file) {
  const type = (file.type ?? '').toLowerCase();
  if (HEIC_TYPES.includes(type)) return true;
  return HEIC_EXTENSIONS.includes(extensionOf(file.name));
}

/**
 * Check one file.
 *
 * @returns {{ ok: true } | { ok: false, reason: string, message: string }}
 */
export function checkFile(file) {
  if (!isAcceptedType(file)) {
    return {
      ok: false,
      reason: 'unsupported-type',
      message: 'Unsupported format. Use JPEG, PNG, or HEIC.',
    };
  }
  if (!file.size) {
    return { ok: false, reason: 'empty', message: 'File is empty.' };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: `Larger than ${formatMegabytes(MAX_SOURCE_BYTES)} (this file is ${formatMegabytes(file.size)}).`,
    };
  }
  return { ok: true };
}

/**
 * Split a selection into the files we keep and the ones we refuse.
 *
 * Files past `MAX_IMAGES` are rejected individually rather than failing the
 * whole selection, so dropping a folder of 30 still gets the user 25 images.
 *
 * @param {Array} files
 * @param {{ alreadyAccepted?: number }} [options] images already in the list
 * @returns {{ accepted: Array, rejected: Array<{ file: any, reason: string, message: string }> }}
 */
export function validateSelection(files, { alreadyAccepted = 0 } = {}) {
  const accepted = [];
  const rejected = [];
  let remaining = Math.max(0, MAX_IMAGES - alreadyAccepted);

  for (const file of files) {
    const result = checkFile(file);
    if (!result.ok) {
      rejected.push({ file, reason: result.reason, message: result.message });
      continue;
    }
    if (remaining === 0) {
      rejected.push({
        file,
        reason: 'too-many',
        message: `Over the ${MAX_IMAGES}-image limit for one run.`,
      });
      continue;
    }
    accepted.push(file);
    remaining -= 1;
  }

  return { accepted, rejected };
}

/**
 * A stable key for one source file.
 *
 * Must be taken from the file as dropped: the selection holds normalized JPEGs,
 * whose size and type differ from the original, so comparing those would let
 * every repeat drop through.
 */
export function identityOf(file) {
  return `${file.name}:${file.size}:${file.lastModified ?? 0}`;
}

/**
 * Drop incoming files already represented by one of `existingKeys`.
 *
 * Without this, dropping the same files twice — an easy thing to do when a
 * drag is ambiguous — silently duplicates every tile.
 *
 * @param {Iterable<string>} existingKeys keys from `identityOf`
 * @param {Array} incoming
 */
export function dedupe(existingKeys, incoming) {
  const seen = new Set(existingKeys);
  const unique = [];
  for (const file of incoming) {
    const key = identityOf(file);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }
  return unique;
}
