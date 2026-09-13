/**
 * Converts extraction results into Markdown.
 *
 * This mapping lives in the frontend by design (spec section 5): the server's
 * job ends at validated JSON, and a direct blocks-to-Markdown mapping needs no
 * server round trip to change.
 *
 * Pure functions only — no DOM — so the same module runs in the browser and
 * under `node --test`.
 */

import { latexToUnicode } from './latex-unicode.js';

/** How a formula is written, since LaTeX only renders in some apps. */
export const FORMULA_FLAVOURS = ['latex', 'unicode', 'plain', 'code'];

export const DEFAULT_FORMULA_FLAVOUR = 'latex';

/** Separates one image's section from the next in a combined document. */
const SECTION_SEPARATOR = '\n\n---\n\n';

/**
 * Render a formula.
 *
 * The only place the flavour matters: everything else in the output is portable
 * Markdown, so switching target apps is a change to this function alone.
 *
 * @param {string} text LaTeX source as transcribed by the model
 * @param {string} [flavour] one of FORMULA_FLAVOURS
 */
export function formatFormula(text, flavour = DEFAULT_FORMULA_FLAVOUR) {
  const formula = String(text ?? '').trim();
  if (!formula) return '';

  switch (flavour) {
    case 'unicode':
      // Apps that render no markup at all still show Unicode, so this is the
      // one flavour that looks like the board wherever it is pasted.
      return latexToUnicode(formula);
    case 'plain':
      // Apple Notes renders neither LaTeX nor code spans; bare text at least
      // reads as the formula it is.
      return formula;
    case 'code':
      // Backticks would break a formula that contains one, so pick a fence that
      // does not appear in the text.
      return formula.includes('`') ? `\`\` ${formula} \`\`` : `\`${formula}\``;
    case 'latex':
    default:
      return `$$\n${formula}\n$$`;
  }
}

function listItems(items) {
  return (items ?? [])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join('\n');
}

/**
 * Render one block.
 *
 * Returns an empty string for a block with nothing in it, which the caller
 * filters out — that is what keeps stray blank lines out of the document.
 *
 * @param {{ type: string, text?: string, items?: string[], note?: string }} block
 * @param {string} [flavour]
 */
export function blockToMarkdown(block, flavour = DEFAULT_FORMULA_FLAVOUR) {
  const text = String(block?.text ?? '').trim();

  switch (block?.type) {
    case 'topic':
      return text ? `# ${text}` : '';

    case 'heading':
      return text ? `## ${text}` : '';

    case 'formula':
      return formatFormula(text, flavour);

    case 'table':
      // The model is asked for a Markdown table, so this passes through.
      return text;

    case 'unreadable': {
      const note = String(block.note ?? '').trim();
      // Visible on purpose: a gap you cannot see is a gap you will not fix.
      return note ? `> **[unreadable]** ${note}` : '> **[unreadable]**';
    }

    case 'list':
    case 'question': {
      const items = listItems(block.items);
      // The lead-in line is skipped when the block is only a list, so the
      // output does not open with a blank line.
      return [text, items].filter(Boolean).join('\n\n');
    }

    case 'paragraph':
    case 'definition':
    default: {
      const items = listItems(block?.items);
      return [text, items].filter(Boolean).join('\n\n');
    }
  }
}

/**
 * Render one image's result.
 *
 * No filename heading: the point is notes you can paste, not a report about
 * files.
 *
 * @param {{ blocks?: Array<object> }} result
 * @param {string} [flavour]
 */
export function resultToMarkdown(result, flavour = DEFAULT_FORMULA_FLAVOUR) {
  return (result?.blocks ?? [])
    .map((block) => blockToMarkdown(block, flavour))
    .map((markdown) => markdown.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Render the whole document — what the copy button copies.
 *
 * Takes an array from the start: this phase passes one result and phase 4 passes
 * several, with no interface change and no per-image copy buttons.
 *
 * Concatenates only. Merging duplicate headings and reconnecting sentences
 * across images is phase 5 (spec section 4, decision 3).
 *
 * @param {Array<object>} results
 * @param {string} [flavour]
 */
export function resultsToMarkdown(results, flavour = DEFAULT_FORMULA_FLAVOUR) {
  const sections = (results ?? [])
    .map((result) => resultToMarkdown(result, flavour))
    .filter(Boolean);

  if (sections.length === 0) return '';

  // Exactly one trailing newline: a file should end with one, and more read as
  // broken output when pasted.
  return `${sections.join(SECTION_SEPARATOR)}\n`;
}
