/**
 * POST /extract — one image in, schema-validated JSON out (spec section 7,
 * phase 2).
 *
 * Multipart rather than base64 JSON: the browser can post a File through
 * FormData directly, and base64 would inflate every upload by a third.
 */
import { Hono } from 'hono';

import type { Config } from './config.ts';
import { ExtractorError, type Extractor } from './extractors/index.ts';
import { extractionResultSchema, type ExtractionResult } from './schema.ts';

/** Formats the browser can produce after phase 1 normalization. */
const ACCEPTED_MEDIA_TYPES = ['image/jpeg', 'image/png'];

type ExtractRoutes = {
  config: Config;
  extract: Extractor;
};

/**
 * One attempt: call the engine, then validate.
 *
 * Returns the parsed result or the reason it was unusable, rather than
 * throwing, so the caller can decide whether to spend the retry.
 */
async function attempt(
  extract: Extractor,
  image: { bytes: Uint8Array; mediaType: string; name: string },
): Promise<{ ok: true; result: ExtractionResult } | { ok: false; reason: string }> {
  let raw: unknown;

  try {
    raw = await extract(image);
  } catch (error) {
    if (error instanceof ExtractorError) throw error;
    // A parse failure is the model's fault, not the engine's, so it is worth
    // one retry rather than a 502.
    return { ok: false, reason: error instanceof Error ? error.message : 'Unparseable response' };
  }

  const parsed = extractionResultSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join('.') || 'result';
    return { ok: false, reason: `${where}: ${first?.message ?? 'did not match the schema'}` };
  }

  // The model is told the filename but may still echo it wrong; the server
  // knows the truth, so it wins.
  return { ok: true, result: { ...parsed.data, source_image: image.name } };
}

export function createExtractRoutes({ config, extract }: ExtractRoutes) {
  const routes = new Hono();

  routes.post('/extract', async (context) => {
    let form: FormData;
    try {
      form = await context.req.formData();
    } catch {
      return context.json({ error: 'Expected a multipart/form-data body' }, 400);
    }

    const field = form.get('image');
    if (!(field instanceof File)) {
      return context.json({ error: 'Expected one image file in the "image" field' }, 400);
    }

    if (field.size === 0) {
      return context.json({ error: 'The uploaded file is empty' }, 400);
    }

    if (field.size > config.MAX_UPLOAD_BYTES) {
      return context.json(
        { error: `Image is larger than the ${config.MAX_UPLOAD_BYTES} byte limit` },
        400,
      );
    }

    const mediaType = field.type || 'application/octet-stream';
    if (!ACCEPTED_MEDIA_TYPES.includes(mediaType)) {
      return context.json({ error: `Unsupported media type "${mediaType}". Use JPEG or PNG.` }, 400);
    }

    const image = {
      bytes: new Uint8Array(await field.arrayBuffer()),
      mediaType,
      name: field.name || 'image.jpg',
    };

    try {
      const first = await attempt(extract, image);
      if (first.ok) return context.json(first.result, 200);

      // Exactly one retry, then give up on this image (spec section 5).
      const second = await attempt(extract, image);
      if (second.ok) return context.json(second.result, 200);

      return context.json(
        {
          source_image: image.name,
          error: `The model did not return valid output after two attempts (${second.reason})`,
        },
        502,
      );
    } catch (error) {
      if (error instanceof ExtractorError) {
        const status = error.kind === 'timeout' ? 504 : 502;
        return context.json({ source_image: image.name, error: error.message }, status);
      }
      throw error;
    }
  });

  return routes;
}
