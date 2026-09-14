import type { ExtractionResult } from '../../src/schema.ts';

/*
 * Pass 1 as qwen2.5vl:7b actually returned it for four lecture photos, verbatim.
 *
 * note3 is a wider shot of the board in note2, so the MST definition appears on
 * both — but split into five blocks from one photo and two from the other, which
 * is what pass 2 has to see through. note4 continues the same CSC 226 lecture;
 * note1 is a different course and must never be merged into it.
 *
 * The model's misreadings are kept on purpose ("A spanning tree is" for "A
 * minimum spanning tree is", "duckmode" for "dual mode"): pass 2 has to work on
 * the output it really gets, not on a tidied version.
 */

export const note2: ExtractionResult = {
  source_image: 'note2.jpg',
  confidence: 'high',
  blocks: [
    { type: 'paragraph', text: 'weight of a tree A ⊆ E is defined as' },
    { type: 'formula', text: '\\sum_{e \\in A} w(e) = w(A)' },
    { type: 'paragraph', text: 'A minimum spanning tree is' },
    { type: 'paragraph', text: 'any spanning tree A that minimizes' },
    { type: 'formula', text: 'w(A) = \\sum_{e \\in A} w(e)' },
  ],
};

export const note3: ExtractionResult = {
  source_image: 'note3.jpg',
  confidence: 'high',
  blocks: [
    { type: 'paragraph', text: 'weight of a tree A ⊆ E is defined as ∑_e∈A w(e) = w(A)' },
    { type: 'paragraph', text: 'A spanning tree is any spanning tree A that minimizes w(A) = ∑_e∈A w(e)' },
    { type: 'paragraph', text: 'Assumption: All edge weights are distinct' },
    { type: 'paragraph', text: "Prim's Algorithm" },
    { type: 'paragraph', text: 'S = {s}' },
    { type: 'paragraph', text: 'A = ∅ = {}' },
    { type: 'paragraph', text: 'while |A| < |V| - 1' },
    { type: 'paragraph', text: 'Among all edges (u, v) where u ∈ S and v ∈ V \\ S find the edge of min weight (v ∉ S)' },
    { type: 'paragraph', text: 'S ← S ∪ {v}' },
    { type: 'paragraph', text: 'A ← A ∪ {(u, v)}' },
  ],
};

export const note4: ExtractionResult = {
  source_image: 'note4.jpg',
  confidence: 'high',
  blocks: [
    { type: 'definition', text: 'A cut (S, V \\ S) is a partition of V such that S is non-empty and V \\ S is non-empty' },
    {
      type: 'definition',
      text: 'A crossing edge (uv) for a cut (S, V \\ S) is an edge such that one vertex is in S and the other one is in V \\ S.',
    },
    { type: 'paragraph', text: 'V / S' },
    { type: 'paragraph', text: 'S' },
    { type: 'paragraph', text: 'e is not a crossing edge' },
  ],
};

export const note1: ExtractionResult = {
  source_image: 'note1.jpg',
  confidence: 'high',
  blocks: [
    { type: 'paragraph', text: 'Friday, Sept 11 through Teams' },
    {
      type: 'table',
      text: 'job overhead',
      items: ['batch processing', 'time sharing'],
      note: 'Table with two columns and two rows.',
    },
    { type: 'paragraph', text: 'policy: {uni multi}' },
    { type: 'paragraph', text: 'mechanisms: interrupts' },
    { type: 'paragraph', text: 'duckmode' },
  ],
};
