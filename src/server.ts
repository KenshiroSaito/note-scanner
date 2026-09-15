/**
 * The API proxy (spec section 4, decision 2): the frontend is static and holds
 * no key; this process holds the key and talks to the model.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { loadConfig, redacted } from './config.ts';
import { createExtractor } from './extractors/index.ts';
import { createExtractRoutes } from './extract.ts';
import { createMergeRoutes } from './merge-route.ts';

const config = loadConfig();
const app = new Hono();

// Explicit allowlist, never "*": this endpoint spends the operator's API budget,
// and the frontend lives on a different origin by design (decision 2).
app.use('/*', cors({ origin: config.allowedOrigins, allowMethods: ['POST', 'OPTIONS'] }));

// Also the frontend's source of runtime settings: the page has no build step
// and no environment of its own, so configuration stays here and is fetched.
app.get('/health', (context) =>
  context.json({
    ok: true,
    extractor: config.EXTRACTOR,
    maxConcurrency: config.MAX_CONCURRENCY,
  }),
);
app.route('/', createExtractRoutes({ config, extract: createExtractor(config) }));
app.route('/', createMergeRoutes());

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`note-scanner backend on http://localhost:${info.port}`);
  console.log('config:', redacted(config));
});
