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
- Use "list" with "items" for bulleted or numbered content, and for the answer
  options of a question. Use "question" with "items" for multiple-choice.
- Transcribe mathematics as LaTeX in a "formula" block, for example
  "S = k_B \\\\ln \\\\Omega". Do not describe a formula in words.
- Never guess. If something is genuinely illegible, emit a block of type
  "unreadable" with a "note" saying what and where it was, for example
  "two lines of working in the bottom-right corner are cut off". An unreadable
  block must always have a note.
- Do not invent content that is not on the page. Missing text is expected and
  fine; invented text is a failure.
- Set "confidence" to how well you could read the page overall: "high" when the
  text was clear, "low" when much of it was a guess you declined to make.`;
