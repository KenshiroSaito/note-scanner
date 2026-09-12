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
 * Per-file size ceiling before upload.
 *
 * Provisional: the real limit depends on the client-side resizing added in
 * phase 6, after which files are shrunk to ~1568px on the long edge before
 * they are ever sent.
 */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** MIME types we accept. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];

/** Extensions used when a browser reports no MIME type. */
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];

const MEGABYTE = 1024 * 1024;

function extensionOf(name) {
  const dot = String(name ?? '').lastIndexOf('.');
  return dot === -1 ? '' : String(name).slice(dot).toLowerCase();
}

function formatMegabytes(bytes) {
  return `${Math.round((bytes / MEGABYTE) * 10) / 10} MB`;
}

/**
 * Is this file an image we can handle?
 *
 * Safari and some Android browsers report an empty `type` for HEIC, so the
 * filename extension is the fallback rather than the primary check.
 */
export function isAcceptedType(file) {
  const type = (file.type ?? '').toLowerCase();
  if (type) return ACCEPTED_TYPES.includes(type);
  return ACCEPTED_EXTENSIONS.includes(extensionOf(file.name));
}

/** True for formats no mainstream browser can render in an `<img>`. */
export function needsPlaceholder(file) {
  const type = (file.type ?? '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return true;
  const extension = extensionOf(file.name);
  return extension === '.heic' || extension === '.heif';
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
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: `Larger than ${formatMegabytes(MAX_FILE_BYTES)} (this file is ${formatMegabytes(file.size)}).`,
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

function identityOf(file) {
  return `${file.name}:${file.size}:${file.lastModified ?? 0}`;
}

/**
 * Drop incoming files that are already in the list.
 *
 * Without this, dropping the same files twice — an easy thing to do when a
 * drag is ambiguous — silently duplicates every tile.
 */
export function dedupe(existing, incoming) {
  const seen = new Set(existing.map(identityOf));
  const unique = [];
  for (const file of incoming) {
    const id = identityOf(file);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(file);
  }
  return unique;
}
