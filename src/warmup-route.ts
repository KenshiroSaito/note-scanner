/**
 * POST /warmup — load the model before the first image needs it.
 *
 * The browser calls this when images are added, so Ollama's cold load happens
 * while the user is still choosing photos rather than during the first
 * conversion. Calling it when the model is already loaded costs milliseconds.
 */
import { Hono } from 'hono';

import { ExtractorError, type Warmup } from './extractors/index.ts';

export function createWarmupRoutes({ warmup }: { warmup: Warmup }) {
  const routes = new Hono();

  routes.post('/warmup', async (context) => {
    const startedAt = Date.now();

    try {
      const { warmed } = await warmup();
      if (!warmed) return context.json({ warmed: false }, 200);

      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      console.log(`warm-up: model ready in ${seconds}s`);
      return context.json({ warmed: true, seconds }, 200);
    } catch (error) {
      if (error instanceof ExtractorError) {
        return context.json({ error: error.message }, error.kind === 'timeout' ? 504 : 502);
      }
      throw error;
    }
  });

  return routes;
}
