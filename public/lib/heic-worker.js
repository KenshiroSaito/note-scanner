/**
 * Decodes HEIC off the main thread and returns the normalized JPEG.
 *
 * A worker because a 5712×4284 iPhone photo is ~98 MB of RGBA and over a second
 * of single-threaded WebAssembly; a drop of 25 on the main thread would freeze
 * the page for half a minute.
 *
 * Message in:  { id, bytes: ArrayBuffer }
 * Message out: { id, blob: Blob } or { id, error: string }
 */
import createLibheif from '../vendor/libheif/libheif-bundle.mjs';
import { decodeHeic } from './heic.js';
import { JPEG_QUALITY, fittedSize } from './normalize.js';

let libheif = null;
let decoder = null;

async function toJpeg(bytes) {
  libheif ??= createLibheif();
  decoder ??= new libheif.HeifDecoder();

  const pixels = await decodeHeic(libheif, bytes, decoder);
  const { width, height } = fittedSize(pixels.width, pixels.height);

  const bitmap = await createImageBitmap(new ImageData(pixels.data, pixels.width, pixels.height));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');

  // Same flattening as the native path in normalize.js.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

self.addEventListener('message', async (event) => {
  const { id, bytes } = event.data;
  try {
    self.postMessage({ id, blob: await toJpeg(new Uint8Array(bytes)) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
