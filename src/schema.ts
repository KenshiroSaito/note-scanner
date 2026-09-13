/**
 * The extraction contract (spec section 5).
 *
 * One definition, validated at runtime and exported as a type, so the backend
 * and (from phase 3) the frontend agree on one shape. Model output is never
 * trusted: everything passes through `extractionResultSchema` before it leaves
 * the server.
 */
import { z } from 'zod';

/** Block kinds the model may emit (spec section 5). */
export const BLOCK_TYPES = [
  'topic',
  'heading',
  'paragraph',
  'list',
  'question',
  'definition',
  'formula',
  'table',
  'unreadable',
] as const;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

const blockSchema = z
  .object({
    type: z.enum(BLOCK_TYPES),
    text: z.string().optional(),
    /** Only for lists and answer options. */
    items: z.array(z.string()).optional(),
    /** Explanation of what could not be read. */
    note: z.string().optional(),
  })
  // Unknown keys are dropped rather than fatal: a model adding a stray field is
  // not a reason to discard a page that is otherwise correct.
  .strip()
  // Drop fields the model filled in with nothing. Constrained decoding makes
  // models emit `"items": []` and `"note": ""` on every block, and an empty
  // array is truthy — a renderer checking `if (block.items)` would draw an
  // empty list. Absent is the honest representation.
  .transform((block) => ({
    type: block.type,
    ...(block.text?.trim() ? { text: block.text } : {}),
    ...(block.items?.length ? { items: block.items } : {}),
    ...(block.note?.trim() ? { note: block.note } : {}),
  }))
  .refine((block) => block.type !== 'unreadable' || Boolean(block.note?.trim()), {
    // An unreadable block that does not say what was unreadable tells the user
    // nothing, so the schema requires the explanation rather than hoping for it.
    message: 'unreadable blocks must carry a note explaining what could not be read',
    path: ['note'],
  })
  .refine((block) => block.type === 'unreadable' || Boolean(block.text?.trim()) || Boolean(block.items?.length), {
    message: 'blocks other than unreadable must have text or items',
    path: ['text'],
  });

export const extractionResultSchema = z
  .object({
    source_image: z.string().min(1),
    confidence: z.enum(CONFIDENCE_LEVELS),
    blocks: z.array(blockSchema),
  })
  .strip();

export type Block = z.infer<typeof blockSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/**
 * The same shape as a JSON Schema, for models that support constrained decoding.
 *
 * Built from the schema above so the two cannot drift. The refinements are not
 * expressible in JSON Schema and are enforced by validation after the call.
 */
export function extractionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(
    z.object({
      source_image: z.string(),
      confidence: z.enum(CONFIDENCE_LEVELS),
      blocks: z.array(
        z.object({
          type: z.enum(BLOCK_TYPES),
          text: z.string().optional(),
          items: z.array(z.string()).optional(),
          note: z.string().optional(),
        }),
      ),
    }),
  ) as Record<string, unknown>;
}

/** Shape returned when an image could not be extracted (spec section 5). */
export type FailedResult = {
  source_image: string;
  error: string;
};
