/**
 * Cloud extraction via the Claude API (spec section 4, decision 5 — the paid,
 * higher-accuracy comparison).
 *
 * Raw fetch rather than the official SDK, because the project's dependency
 * budget is deliberately small and this is one POST. If the SDK is added later,
 * this is the only file that changes.
 */
import type { Config } from '../config.ts';
import { EXTRACTION_PROMPT } from '../prompt.ts';
import { ExtractorError, parseJsonLoosely, toBase64, type Extractor, type SourceImage } from './types.ts';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** Server-side fallback: if the model declines, the API retries on this one. */
const FALLBACK_BETA = 'server-side-fallback-2026-06-01';
const FALLBACK_MODEL = 'claude-opus-4-8';

type MessagesResponse = {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
};

export function createClaudeExtractor(config: Config): Extractor {
  const apiKey = config.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // loadConfig already enforces this; kept so the type narrows and so a
    // future caller cannot construct a keyless extractor silently.
    throw new Error('ANTHROPIC_API_KEY is required for the claude extractor');
  }

  return async function extractWithClaude(image: SourceImage): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-beta': FALLBACK_BETA,
        },
        body: JSON.stringify({
          model: config.CLAUDE_MODEL,
          max_tokens: 16_000,
          // A page of notes is a bounded transcription task, so the top of the
          // effort range would spend tokens without reading the page better.
          output_config: { effort: 'medium' },
          fallbacks: [{ model: FALLBACK_MODEL }],
          messages: [
            {
              role: 'user',
              content: [
                // Image before text: the model should see the page before the
                // instructions about it.
                {
                  type: 'image',
                  source: { type: 'base64', media_type: image.mediaType, data: toBase64(image.bytes) },
                },
                { type: 'text', text: `${EXTRACTION_PROMPT}\n\nFilename: ${image.name}` },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ExtractorError('timeout', `Claude API did not respond within ${config.REQUEST_TIMEOUT_MS}ms`);
      }
      throw new ExtractorError('unreachable', 'Could not reach the Claude API');
    }

    if (!response.ok) {
      // Only the documented type/message pair is logged. The raw body is never
      // logged or forwarded on this path, because anything that echoes request
      // headers would echo the API key.
      const detail = (await response.json().catch(() => null)) as
        | { error?: { type?: string; message?: string } }
        | null;
      console.error(
        `Claude API returned ${response.status}: ${detail?.error?.type ?? 'unknown'} — ${detail?.error?.message ?? 'no message'}`,
      );
      throw new ExtractorError('upstream', `Claude API returned ${response.status}`);
    }

    const payload = (await response.json()) as MessagesResponse;

    // A refusal arrives as HTTP 200, so stop_reason must be checked before the
    // content is read.
    if (payload.stop_reason === 'refusal') {
      const category = payload.stop_details?.category ?? 'unspecified';
      throw new ExtractorError('refused', `Claude declined this image (${category})`);
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      throw new ExtractorError('upstream', 'Claude API returned no text content');
    }

    return parseJsonLoosely(text);
  };
}
