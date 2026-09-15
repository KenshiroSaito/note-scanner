/**
 * POST /merge — pass 2 over the pages of one run (spec section 4, decision 3).
 *
 * Deterministic and instant: no engine is involved (src/merge.ts explains why).
 * JSON rather than multipart, since the input is the pass-1 results the browser
 * already holds.
 *
 * Fewer than two pages is not an error — there is simply nothing to merge — so it
 * answers 200 with `merged: false` and a reason, and the frontend keeps showing
 * the pages.
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { mergeDocument } from './merge.ts';
import { extractionResultSchema, type ExtractionResult } from './schema.ts';

/** One run holds at most 25 images (spec section 3). */
export const MAX_MERGE_PAGES = 25;

const mergeRequestSchema = z.object({
  pages: z.array(extractionResultSchema).max(MAX_MERGE_PAGES),
});

export function createMergeRoutes() {
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

    const outcome = mergeDocument(pages);

    console.log(
      `merge: ${pages.length} pages, ${outcome.drops.length} dropped, ${outcome.supersedes.length} superseded`,
    );
    // Every operation comes from the planner and should verify. A rejection means
    // the planner and the verifier disagree, which is a bug worth seeing.
    for (const { operation, reason } of outcome.rejected) {
      console.warn(`merge: planner produced a rejected operation ${JSON.stringify(operation)}: ${reason}`);
    }

    return context.json(
      {
        merged: true,
        blocks: outcome.blocks,
        dropped: outcome.drops.length,
        superseded: outcome.supersedes.length,
        rejected: outcome.rejected.length,
      },
      200,
    );
  });

  return routes;
}
