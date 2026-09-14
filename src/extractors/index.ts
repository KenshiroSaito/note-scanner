/**
 * Engine selection: one environment variable switches the whole pipeline
 * (spec section 4, decision 5).
 */
import type { Config } from '../config.ts';
import { createClaudeExtractor } from './claude.ts';
import { createOllamaExtractor } from './ollama.ts';
import type { Extractor } from './types.ts';

export function createExtractor(config: Config): Extractor {
  switch (config.EXTRACTOR) {
    case 'ollama':
      return createOllamaExtractor(config);
    case 'claude':
      return createClaudeExtractor(config);
  }
}

export { ExtractorError } from './types.ts';
export type { Extractor, SourceImage } from './types.ts';
