/**
 * The extraction prompt.
 *
 * Kept in its own module because prompt wording is the main lever on extraction
 * quality: changes here should be as visible in review as changes to code.
 *
 * Every rule below traces to the spec:
 * - deciding body text from doodles is the reason for using an LLM at all
 *   (section 4, decision 1)
 * - `unreadable` exists so the model can decline; it must never guess (section 5)
 * - formulas are transcribed as LaTeX (section 8, resolved)
 */
import { BLOCK_TYPES } from './schema.ts';

export const EXTRACTION_PROMPT = `You are transcribing a photo of class notes — a whiteboard, a slide, or handwriting.

Return JSON only. No preamble, no explanation, no markdown code fences.

Shape:
{
  "source_image": "<the filename you were given>",
  "confidence": "high" | "medium" | "low",
  "blocks": [ { "type": ..., "text": ..., "items": [...], "note": ... } ]
}

Block types: ${BLOCK_TYPES.join(', ')}.

Rules:
- Transcribe the content, not the page decoration. Ignore circles, arrows,
  underlines, highlighting, margin doodles, and stray marks. A circled word is
  just that word.

- Layout is not structure. Writing wraps on a board: when a sentence continues
  on the next line, join it into one block. Start a new block when the content
  changes, not when the line does. "weight of a tree A ⊆ E" followed by "is
  defined as ..." is one statement, not two.

- Do not invent lists. Use "list" only where the page actually shows bullets,
  dashes, or numbering. Ordinary prose is a "paragraph". A single item is never
  a list. Use "question" with "items" for multiple-choice options.

- All mathematics goes in a "formula" block as LaTeX. Never put an expression in
  a "list", inside "items", or in running prose, and never describe a formula in
  words. Example: "S = k_B \\\\ln \\\\Omega".

- A formula is one block even when it occupies several visual lines. Anything
  written above or below a summation, product, integral, or limit sign is part
  of that expression: reconstruct it as a subscript or superscript. A sigma with
  "e ∈ A" beneath it and "w(e) = w(A)" to its right is one formula block,
  "\\\\sum_{e \\\\in A} w(e) = w(A)" — not two lines, and not two list items.

- When a sentence runs into a formula, emit one "paragraph" block for the
  sentence and one "formula" block for the expression. Do not turn either into
  bullets.

- "items" belongs only to "list" and "question" blocks. A formula never goes in
  "items".

Worked example. A board reading "weight of a tree A ⊆ E / is defined as" with a
sigma to the right, "e ∈ A" beneath it, and "w(e) = w(A)" alongside, is exactly
two blocks:

  { "type": "paragraph", "text": "weight of a tree A ⊆ E is defined as" },
  { "type": "formula", "text": "\\\\sum_{e \\\\in A} w(e) = w(A)" }

The sentence is joined across its two lines, the subscript is reattached, and
the mathematics is its own "formula" block.

- Never guess. If something is genuinely illegible, emit a block of type
  "unreadable" with a "note" saying what and where it was, for example
  "two lines of working in the bottom-right corner are cut off". An unreadable
  block must always have a note.
- Do not invent content that is not on the page. Missing text is expected and
  fine; invented text is a failure.
- Set "confidence" to how well you could read the page overall: "high" when the
  text was clear, "low" when much of it was a guess you declined to make.`;

/**
 * The merge prompt (spec section 4, decision 3 — pass 2).
 *
 * The model is never asked to rewrite the notes, only to point at blocks by ID.
 * A rewrite could drop text with no way to detect it; an operation over an ID is
 * something code can check before applying it (src/merge.ts).
 */
export const MERGE_PROMPT = `You are merging the transcribed pages of one set of class notes. The pages were photographed separately, so the same content can appear on more than one page, and a sentence can be cut off at the end of one page and continue on the next.

Each block is listed on one line with an ID in square brackets, like [p2.b3] for page 2, block 3. Pages are listed in order. When you name a block, write its ID without the brackets: "p2.b3".

Return JSON only. No preamble, no explanation, no markdown code fences.

Shape:
{ "operations": [ ... ] }

You may use only these two operations:

- { "op": "drop_duplicate", "id": "p3.b1", "duplicate_of": "p1.b2" }
  The block "id" repeats content that "duplicate_of" already contains, for
  example the same definition photographed twice and read with small
  differences. "duplicate_of" must be on an earlier page. Something repeated on
  the same page is not a duplicate: keep both.

- { "op": "join", "first": "p1.b7", "second": "p2.b1" }
  "first" is the last block of a page, "second" is the first block of the next
  page, and a sentence was cut between them. Only join prose.

Rules:
- Never rewrite, summarise, shorten, or correct any text. You cannot change what
  a block says; you can only point at blocks by their IDs.
- Never reorder blocks.
- Only drop a block when the earlier block says the same thing. If the later
  block adds anything, keep it.
- Pages about different subjects are not duplicates of each other, even when
  they share a word.
- If nothing should be merged, return { "operations": [] }.`;
