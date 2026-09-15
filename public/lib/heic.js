/**
 * HEIC detection and decoding helpers.
 *
 * Pure: no DOM and no worker, so the same code runs in the decoder worker and
 * under `node --test` against the vendored libheif (spec decision 6).
 */

/** ftyp brands that mean HEVC-coded HEIF — what iPhones write. */
const HEVC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];

/** Generic HEIF brands. AVIF also uses these, so they only count without an AVIF brand. */
const GENERIC_HEIF_BRANDS = ['mif1', 'msf1'];

const AVIF_BRANDS = ['avif', 'avis'];

function fourcc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Does this file start like a HEIC image?
 *
 * Reads the ISO-BMFF `ftyp` box rather than trusting the name: files arrive
 * misnamed (an AVIF saved as `.jpg` has already happened), and a HEIC renamed to
 * `.jpg` should still decode.
 *
 * @param {Uint8Array} bytes the start of the file; the first 64 bytes are plenty
 * @returns {boolean}
 */
export function looksLikeHeic(bytes) {
  if (!bytes || bytes.length < 12 || fourcc(bytes, 4) !== 'ftyp') return false;

  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.length, boxSize);

  // Major brand at 8, minor version at 12, compatible brands from 16.
  const brands = [fourcc(bytes, 8)];
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(fourcc(bytes, offset));

  if (brands.some((brand) => AVIF_BRANDS.includes(brand))) return false;
  return brands.some((brand) => HEVC_BRANDS.includes(brand) || GENERIC_HEIF_BRANDS.includes(brand));
}

/**
 * Decode the primary image of a HEIC file to RGBA.
 *
 * libheif applies the file's rotation and mirroring (`irot`/`imir`) while
 * decoding, so the pixels come back upright and EXIF orientation must not be
 * applied on top.
 *
 * Every image handle is freed before returning. The decoder itself frees its
 * previous file when it decodes the next, so one decoder can be reused across a
 * whole drop without the WebAssembly heap growing per photo.
 *
 * @param {any} libheif the initialised libheif module
 * @param {Uint8Array} bytes the whole file
 * @param {any} [decoder] a `libheif.HeifDecoder` to reuse
 * @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>}
 */
export async function decodeHeic(libheif, bytes, decoder = new libheif.HeifDecoder()) {
  const images = decoder.decode(bytes);
  if (!images || images.length === 0) throw new Error('The file contains no readable HEIC image.');

  try {
    // A file can hold more than one image (a burst, a thumbnail); the primary is the photo.
    const image = images.find((candidate) => candidate.is_primary?.()) ?? images[0];
    const width = image.get_width();
    const height = image.get_height();
    const pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };

    await new Promise((resolve, reject) => {
      image.display(pixels, (result) => (result ? resolve() : reject(new Error('HEIC decoding failed.'))));
    });

    return pixels;
  } finally {
    for (const image of images) image.free?.();
  }
}
