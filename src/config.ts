/**
 * Environment configuration, parsed and validated once at boot.
 *
 * Failing here means the process refuses to start with a clear message, rather
 * than surfacing a missing key as a 500 on the first request.
 *
 * The API key is read from the environment only — never from a source file,
 * never logged, never returned in a response (spec section 4, decision 2).
 */
import { z } from 'zod';

const MEGABYTE = 1024 * 1024;

const configSchema = z
  .object({
    EXTRACTOR: z.enum(['ollama', 'claude']).default('ollama'),

    OLLAMA_URL: z.url().default('http://localhost:11434'),
    OLLAMA_MODEL: z.string().min(1).default('qwen2.5vl:7b'),

    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CLAUDE_MODEL: z.string().min(1).default('claude-opus-5'),

    PORT: z.coerce.number().int().positive().max(65535).default(8787),

    /**
     * Deliberately long. A 7B vision model reading a 1568px photo on a laptop
     * can take 30-120s; a conventional 30s timeout would make the default
     * local path look broken.
     */
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),

    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * MEGABYTE),

    /**
     * How many images the browser converts at once.
     *
     * Sequential would take about twenty minutes for a full 25-image run.
     * Configurable because how many parallel requests this machine sustains
     * before it degrades is a thing to measure, not to guess. Capped so a typo
     * cannot launch 500 requests at a local model.
     */
    MAX_CONCURRENCY: z.coerce.number().int().positive().max(16).default(3),

    /** Explicit allowlist; never "*", since this endpoint spends real money. */
    ALLOWED_ORIGINS: z.string().default('http://localhost:8000'),
  })
  // The key is required only for the paid path, so the default local setup
  // needs no secret and no .env file at all.
  .refine((env) => env.EXTRACTOR !== 'claude' || Boolean(env.ANTHROPIC_API_KEY), {
    message: 'ANTHROPIC_API_KEY is required when EXTRACTOR=claude',
    path: ['ANTHROPIC_API_KEY'],
  });

export type Config = z.infer<typeof configSchema> & { allowedOrigins: string[] };

/**
 * Parse configuration from an environment-like object.
 *
 * Takes `env` as a parameter so tests can supply one instead of mutating the
 * real process environment.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return {
    ...parsed.data,
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

/**
 * A version of the config that is safe to log.
 *
 * The key is reduced to whether it is set. Logging the parsed config directly
 * is the easiest way to leak a secret into a terminal, a CI log, or a
 * screenshot, so the safe form is the one that exists.
 */
export function redacted(config: Config): Record<string, unknown> {
  const { ANTHROPIC_API_KEY, ...rest } = config;
  return { ...rest, ANTHROPIC_API_KEY: ANTHROPIC_API_KEY ? '[set]' : '[unset]' };
}
