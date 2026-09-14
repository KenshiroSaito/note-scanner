/**
 * Local engine via Ollama (spec section 4, decision 5 — the free default).
 *
 * Plain fetch: Ollama's HTTP API is one POST, and a client library would be a
 * dependency for nothing.
 */
import type { Config } from '../config.ts';
import { EXTRACTION_PROMPT } from '../prompt.ts';
import { extractionJsonSchema } from '../schema.ts';
import {
  ExtractorError,
  parseJsonLoosely,
  toBase64,
  type Extractor,
  type Generate,
  type GenerateRequest,
} from './types.ts';

/**
 * Context window to ask Ollama for.
 *
 * Ollama defaults to 4096, which a photo plus this prompt overruns: a 4032px
 * image alone costs thousands of vision tokens, and the request is rejected
 * outright rather than degraded. Phase 1 normalizes uploads to 1568px, so this
 * is headroom for an unnormalized image posted straight to the API.
 */
const NUM_CTX = 16_384;

/**
 * Room for the answer.
 *
 * Ollama's default cuts generation off early, which shows up as JSON that stops
 * mid-token — valid-looking right up to the point it is unparseable. A page of
 * notes needs the whole object.
 */
const NUM_PREDICT = 4_096;

export function createOllamaGenerate(config: Config): Generate {
  return async function generateWithOllama({ prompt, images, jsonSchema }: GenerateRequest): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(new URL('/api/generate', config.OLLAMA_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.OLLAMA_MODEL,
          prompt,
          ...(images?.length ? { images: images.map((image) => toBase64(image.bytes)) } : {}),
          // Constrained decoding against the caller's schema, which is a far
          // stronger guarantee than asking for JSON in the prompt.
          ...(jsonSchema ? { format: jsonSchema } : {}),
          stream: false,
          // temperature 0: transcription and merging should not be creative.
          options: { temperature: 0, num_ctx: NUM_CTX, num_predict: NUM_PREDICT },
        }),
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ExtractorError('timeout', `Ollama did not respond within ${config.REQUEST_TIMEOUT_MS}ms`);
      }
      throw new ExtractorError('unreachable', `Could not reach Ollama at ${config.OLLAMA_URL}`);
    }

    if (!response.ok) {
      // Logged for the operator, never forwarded to the client. Ollama is local
      // and no credential is involved, so the body is safe to put in a log —
      // and without it a misconfiguration is undebuggable.
      const detail = await response.text().catch(() => '');
      console.error(`Ollama returned ${response.status}: ${detail.slice(0, 500)}`);
      throw new ExtractorError('upstream', `Ollama returned ${response.status}`);
    }

    const payload = (await response.json()) as { response?: unknown };
    if (typeof payload.response !== 'string') {
      throw new ExtractorError('upstream', 'Ollama response had no text field');
    }

    return parseJsonLoosely(payload.response);
  };
}

export function createOllamaExtractor(config: Config): Extractor {
  const generate = createOllamaGenerate(config);

  return (image) =>
    generate({
      prompt: `${EXTRACTION_PROMPT}\n\nFilename: ${image.name}`,
      images: [image],
      jsonSchema: extractionJsonSchema(),
    });
}
