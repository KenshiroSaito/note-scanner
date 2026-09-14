/**
 * Engine selection: one environment variable switches the whole pipeline, both
 * passes included (spec section 4, decision 5).
 */
import type { Config } from '../config.ts';
import { createClaudeExtractor, createClaudeMerger } from './claude.ts';
import { createOllamaExtractor, createOllamaMerger } from './ollama.ts';
import type { Extractor, Merger } from './types.ts';

export function createExtractor(config: Config): Extractor {
  switch (config.EXTRACTOR) {
    case 'ollama':
      return createOllamaExtractor(config);
    case 'claude':
      return createClaudeExtractor(config);
  }
}

export function createMerger(config: Config): Merger {
  switch (config.EXTRACTOR) {
    case 'ollama':
      return createOllamaMerger(config);
    case 'claude':
      return createClaudeMerger(config);
  }
}

export { ExtractorError } from './types.ts';
export type { Extractor, Merger, SourceImage } from './types.ts';
