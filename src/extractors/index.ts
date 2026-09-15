/**
 * Engine selection: one environment variable switches the whole pipeline
 * (spec section 4, decision 5).
 */
import type { Config } from '../config.ts';
import { createClaudeExtractor, createClaudeWarmup } from './claude.ts';
import { createOllamaExtractor, createOllamaWarmup } from './ollama.ts';
import type { Extractor, Warmup } from './types.ts';

export function createExtractor(config: Config): Extractor {
  switch (config.EXTRACTOR) {
    case 'ollama':
      return createOllamaExtractor(config);
    case 'claude':
      return createClaudeExtractor(config);
  }
}

export function createWarmup(config: Config): Warmup {
  switch (config.EXTRACTOR) {
    case 'ollama':
      return createOllamaWarmup(config);
    case 'claude':
      return createClaudeWarmup();
  }
}

export { ExtractorError } from './types.ts';
export type { Extractor, SourceImage, Warmup } from './types.ts';
