/**
 * The extractor interface.
 *
 * Deliberately returns `unknown`: no model is trusted to have produced valid
 * output, so both implementations go through the same Zod gate in the route.
 * That is also what makes switching engines a real comparison rather than two
 * divergent code paths (spec section 4, decision 5).
 */
export type SourceImage = {
  bytes: Uint8Array;
  mediaType: string;
  name: string;
};

export type Extractor = (image: SourceImage) => Promise<unknown>;

/** Raised when the engine itself failed, as opposed to returning bad output. */
export class ExtractorError extends Error {
  readonly kind: 'unreachable' | 'timeout' | 'refused' | 'upstream';

  constructor(kind: ExtractorError['kind'], message: string) {
    super(message);
    this.name = 'ExtractorError';
    this.kind = kind;
  }
}

/** Base64 without newlines, which the Claude API requires. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Pull the first JSON object out of a model response.
 *
 * Models wrap JSON in prose or code fences even when told not to (spec
 * section 6). Assistant prefill — the usual trick for forcing a bare "{" — is
 * rejected by current Claude models, so recovering the object here is the
 * remaining option before spending a retry.
 */
export function parseJsonLoosely(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    // Fall back to the outermost braces, which handles a leading sentence.
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('Response contained no JSON object');
    }
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}
