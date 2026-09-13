/**
 * Enforces the invariant that LaTeX markup only ever appears in a `formula`
 * block.
 *
 * The prompt asks the model for this and mostly complies, but a model cannot
 * hold an invariant: pushing the rule harder made this one drop formula blocks
 * altogether. So the rule is enforced here, deterministically, after validation
 * and before the result leaves the server.
 *
 * Server-side rather than at render time because the JSON is the contract:
 * phase 5 feeds these blocks back to the model for merging, and would otherwise
 * inherit the bad shape.
 */
import type { Block, ExtractionResult } from './schema.ts';

/**
 * Characters that make a token look mathematical rather than like a word.
 * Note the absence of "." and "," — a full stop ends a sentence far more often
 * than it appears in an expression.
 */
const MATH_CHARACTERS = /[\\=+\-*/^_{}()[\]<>|]/;

/**
 * Markup that only LaTeX produces: a backslash command, a braced sub- or
 * superscript, or a dollar delimiter.
 *
 * Deliberately not "=" or "+". A sentence containing "x = 1" in plain
 * characters is not LaTeX markup, and splitting on it would shred ordinary
 * prose.
 */
const LATEX_MARKUP = /\\[a-zA-Z]+|[_^]\{|\$/;

/** Blocks whose text is prose and must therefore never contain LaTeX. */
const PROSE_BLOCKS = new Set(['paragraph', 'definition', 'topic', 'heading']);

export function containsLatex(text: string | undefined): boolean {
  return LATEX_MARKUP.test(String(text ?? ''));
}

/** A lone letter, or a number, reads as mathematics rather than as a word. */
function isMathToken(token: string): boolean {
  if (MATH_CHARACTERS.test(token)) return true;
  if (/^[0-9]+(\.[0-9]+)?$/.test(token)) return true;
  return /^[a-zA-Z]$/.test(token);
}

export type Segment = { kind: 'prose' | 'formula'; text: string };

/**
 * Split a line into alternating prose and formula segments.
 *
 * Tokens are grouped into runs of mathematics and runs of words; a run is only
 * promoted to a formula if it actually contains LaTeX markup, so plain prose is
 * never fragmented. On the real failing case:
 *
 *   "that minimizes w(A) = \sum_{e \in A} w(e)"
 *   -> prose "that minimizes", formula "w(A) = \sum_{e \in A} w(e)"
 *
 * Walking stops at "minimizes" (a word) but keeps "w(A)", which puts the cut on
 * the boundary of the expression rather than inside it.
 */
export function splitProseAndFormulas(text: string): Segment[] {
  const source = String(text ?? '').trim();
  if (!source) return [];
  if (!containsLatex(source)) return [{ kind: 'prose', text: source }];

  const runs: Array<{ math: boolean; tokens: string[] }> = [];

  for (const token of source.split(/\s+/)) {
    const math = isMathToken(token);
    const current = runs[runs.length - 1];
    if (current && current.math === math) current.tokens.push(token);
    else runs.push({ math, tokens: [token] });
  }

  const segments: Segment[] = [];

  for (const run of runs) {
    const joined = run.tokens.join(' ');
    // A mathematical run without LaTeX markup — "w(A)" on its own, say — is
    // left as prose: there is nothing to rescue and promoting it would invent
    // formula blocks the page never had.
    const kind = run.math && containsLatex(joined) ? 'formula' : 'prose';
    const previous = segments[segments.length - 1];

    if (previous && previous.kind === kind) previous.text += ` ${joined}`;
    else segments.push({ kind, text: joined });
  }

  return segments;
}

function proseToBlocks(block: Block): Block[] {
  const segments = splitProseAndFormulas(block.text ?? '');
  if (segments.length === 0) return [];

  // Nothing to split: keep the block exactly as it was, type included.
  if (segments.length === 1 && segments[0]!.kind === 'prose') return [block];

  return segments.map((segment) =>
    segment.kind === 'formula'
      ? ({ type: 'formula', text: segment.text } as Block)
      : // A split definition becomes a paragraph: the definition was the whole
        // statement, and half of one is just prose.
        ({ ...block, type: block.type === 'topic' || block.type === 'heading' ? block.type : 'paragraph', text: segment.text } as Block),
  );
}

function itemsToBlocks(block: Block): Block[] {
  const kept: string[] = [];
  const formulas: Block[] = [];

  for (const item of block.items ?? []) {
    if (containsLatex(item)) formulas.push({ type: 'formula', text: item.trim() } as Block);
    else kept.push(item);
  }

  if (formulas.length === 0) return [block];

  const remainder: Block[] = [];
  const text = block.text ?? '';

  // The lead-in may itself carry a formula, so it goes through the prose path.
  if (kept.length > 0) {
    remainder.push({ ...block, items: kept } as Block);
  } else if (text.trim()) {
    // Drop the key rather than setting it undefined: a list with no items is
    // not a list, and an empty `items` would still render as one.
    const { items, ...withoutItems } = block;
    void items;
    remainder.push(...proseToBlocks({ ...withoutItems, type: 'paragraph' } as Block));
  }

  // Formulas follow the list they were pulled out of, preserving reading order.
  return [...remainder, ...formulas];
}

/**
 * Rewrite a result so LaTeX only ever lives in a `formula` block.
 *
 * Block order is always preserved; blocks that need no change are returned
 * untouched.
 */
export function normalizeBlocks(result: ExtractionResult): ExtractionResult {
  const blocks: Block[] = [];

  for (const block of result.blocks) {
    // Checked on any block type, not just list and question: the schema allows
    // items anywhere, and the model really does return a `definition` whose
    // items hold the formula.
    if ((block.items ?? []).some(containsLatex)) {
      blocks.push(...itemsToBlocks(block));
      continue;
    }

    if (PROSE_BLOCKS.has(block.type) && containsLatex(block.text)) {
      blocks.push(...proseToBlocks(block));
      continue;
    }

    blocks.push(block);
  }

  return { ...result, blocks };
}
