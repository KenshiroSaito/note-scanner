/**
 * POST /merge — pass 2 over the pages of one run (spec section 4, decision 3).
 *
 * JSON rather than multipart: the input is the pass-1 results the browser
 * already holds, not files.
 *
 * A merge that cannot happen is not an error. The page-by-page document is still
 * correct, so every reason not to merge — too few pages, too much text, a model
 * that returned nothing usable — answers 200 with `merged: false` and a reason,
 * and the frontend simply keeps the pages. Only a failing engine is an error.
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { ExtractorError, type Merger } from './extractors/index.ts';
import { MAX_MERGE_INPUT_CHARS, applyMergeOperations, describePages, mergeResponseSchema } from './merge.ts';
import { extractionResultSchema, type ExtractionResult } from './schema.ts';

/** One run holds at most 25 images (spec section 3). */
export const MAX_MERGE_PAGES = 25;

const mergeRequestSchema = z.object({
  pages: z.array(extractionResultSchema).max(MAX_MERGE_PAGES),
});

type MergeRoutes = {
  merge: Merger;
};

/**
 * One attempt: ask the engine, then check the answer has an operations list.
 *
 * Individual operations are judged later by applyMergeOperations; here the only
 * question is whether the answer is usable at all, which decides the retry.
 */
async function attempt(
  merge: Merger,
  listing: string,
): Promise<{ ok: true; operations: unknown[] } | { ok: false; reason: string }> {
  let raw: unknown;

  try {
    raw = await merge(listing);
  } catch (error) {
    if (error instanceof ExtractorError) throw error;
    return { ok: false, reason: error instanceof Error ? error.message : 'unparseable response' };
  }

  const parsed = mergeResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'the answer had no operations list' };

  return { ok: true, operations: parsed.data.operations };
}

export function createMergeRoutes({ merge }: MergeRoutes) {
  const routes = new Hono();

  routes.post('/merge', async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Expected a JSON body' }, 400);
    }

    const parsed = mergeRequestSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.join('.') || 'body';
      return context.json({ error: `Invalid pages (${where}: ${first?.message ?? 'did not match'})` }, 400);
    }

    const pages: ExtractionResult[] = parsed.data.pages;

    if (pages.length < 2) {
      return context.json({ merged: false, reason: 'Merging needs at least two pages.' }, 200);
    }

    const listing = describePages(pages);
    if (listing.length > MAX_MERGE_INPUT_CHARS) {
      // Declined before the engine is called: sending it would only fail against
      // the context window, as the 4096-token default did in phase 2.
      return context.json(
        {
          merged: false,
          reason: `These pages are too long to merge in one pass (${listing.length} characters; the limit is ${MAX_MERGE_INPUT_CHARS}).`,
        },
        200,
      );
    }

    try {
      const first = await attempt(merge, listing);
      // Exactly one retry for an unusable answer (spec section 5).
      const answer = first.ok ? first : await attempt(merge, listing);

      if (!answer.ok) {
        return context.json(
          {
            merged: false,
            reason: `The model did not return usable merge operations after two attempts (${answer.reason}).`,
          },
          200,
        );
      }

      const outcome = applyMergeOperations(pages, answer.operations);

      // For the operator tuning the similarity threshold: what was refused, and why.
      console.log(
        `merge: ${outcome.drops.length} dropped, ${outcome.joins.length} joined, ${outcome.rejected.length} rejected`,
      );
      for (const { operation, reason } of outcome.rejected.slice(0, 10)) {
        console.log(`  rejected ${JSON.stringify(operation)}: ${reason}`);
      }

      return context.json(
        {
          merged: true,
          blocks: outcome.blocks,
          dropped: outcome.drops.length,
          joined: outcome.joins.length,
          rejected: outcome.rejected.length,
        },
        200,
      );
    } catch (error) {
      if (error instanceof ExtractorError) {
        const status = error.kind === 'timeout' ? 504 : 502;
        return context.json({ error: error.message }, status);
      }
      throw error;
    }
  });

  return routes;
}
