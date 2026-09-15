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

/**
 * Output templates.
 *
 * A template changes only how blocks become Markdown, never what was extracted,
 * so switching one re-renders from memory with no model call (spec decision 10).
 * - lecture: headings, lists, and quoted notes — the default document
 * - practice: questions numbered across the document, options lettered
 * - freeform: just the text, with no heading or quote markup
 */
export const TEMPLATES = ['lecture', 'practice', 'freeform'];

export const DEFAULT_TEMPLATE = 'lecture';

/** State for one render: question numbers run across every page of a document. */
function newRenderContext() {
  return { questions: 0 };
}

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

/** Flavours whose target apps render a Markdown pipe table. */
const PIPE_TABLE_FLAVOURS = new Set(['latex', 'code']);

function cells(line) {
  return line
    .split('|')
    .map((cell) => cell.trim())
    // A leading or trailing pipe produces an empty edge cell, which is not a
    // column. Interior empties are kept: an empty cell is data.
    .filter((cell, index, all) => !((index === 0 || index === all.length - 1) && cell === ''));
}

/** A "|---|:--:|" line carries no content. */
function isSeparatorRow(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

/**
 * Work out the column structure of a table block.
 *
 * `text` becomes the header row when it plausibly is one. Two or three short
 * words read as headers ("job overhead"); four or more read as a sentence, and
 * inventing columns out of a sentence produces a nonsense table — those fall
 * back to a caption with a bullet list, which is always lossless.
 *
 * @returns {{ headers: string[], rows: string[][], caption: string }}
 */
function parseTable(block) {
  const text = String(block?.text ?? '').trim();
  const items = (block?.items ?? []).map((item) => String(item).trim()).filter(Boolean);
  const itemRows = items.map((item) => (item.includes('|') ? cells(item) : [item]));

  // The model sometimes writes a whole Markdown table into `text`.
  if (text.includes('|') && text.includes('\n')) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const content = lines.filter((line) => !isSeparatorRow(line));
    const [header, ...body] = content;
    return {
      headers: header ? cells(header) : [],
      rows: [...body.map(cells), ...itemRows],
      caption: '',
    };
  }

  if (text.includes('|')) {
    return { headers: cells(text), rows: itemRows, caption: '' };
  }

  const words = text ? text.split(/\s+/) : [];
  if (words.length >= 2 && words.length <= 3) {
    return { headers: words, rows: itemRows, caption: '' };
  }

  // No usable column structure: keep the text as a caption above a list.
  return { headers: [], rows: itemRows, caption: text };
}

/** Pad a row to the header width so empty cells stay visible. */
function padRow(row, width) {
  const padded = [...row];
  while (padded.length < width) padded.push('');
  return padded;
}

function renderPipeTable({ headers, rows, caption }) {
  const lines = [];
  if (caption) lines.push(caption, '');

  if (headers.length > 0) {
    const width = Math.max(headers.length, ...rows.map((row) => row.length), 1);
    const header = padRow(headers, width);
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`|${' --- |'.repeat(width)}`);
    for (const row of rows) lines.push(`| ${padRow(row, width).join(' | ')} |`);
    return lines.join('\n');
  }

  // No headers to hang a table on, so the rows become a list.
  for (const row of rows) lines.push(`- ${row.filter(Boolean).join(' — ')}`);
  return lines.join('\n');
}

/**
 * Plain-text form for apps that render no tables at all.
 *
 * Pipes would paste as literal "|---|---|" noise in Apple Notes, which is the
 * thing these flavours exist to avoid.
 */
function renderPlainTable({ headers, rows, caption }) {
  const lines = [];
  const heading = caption || headers.join(' / ');
  if (heading) lines.push(heading, '');

  for (const row of rows) {
    // An empty cell contributes nothing here: there is no content to lose.
    const filled = row.filter(Boolean);
    if (filled.length > 0) lines.push(`- ${filled.join(' — ')}`);
  }

  return lines.join('\n').trim();
}

function tableToMarkdown(block, flavour) {
  const parsed = parseTable(block);

  // With no rows there is no table to draw — a header row on its own is an
  // empty grid. The text is kept as an ordinary line instead.
  if (parsed.rows.length === 0) return String(block?.text ?? '').trim();

  return PIPE_TABLE_FLAVOURS.has(flavour) ? renderPipeTable(parsed) : renderPlainTable(parsed);
}

/** "3.", "Q3)", "Question 3:" — a number the board already gave the question. */
const QUESTION_NUMBER = /^\s*(?:q(?:uestion)?\s*)?\d+\s*[.):]/i;

/** "A. ", "b) ", "(c) " — a letter the board already gave an option. */
const OPTION_LETTER = /^\s*(?:\([a-z]\)|[a-z][.)])\s/i;

function optionLabel(index) {
  return index < 26 ? `${String.fromCharCode(65 + index)}.` : `${index + 1}.`;
}

/**
 * A question in the Practice questions template.
 *
 * Numbered across the whole document so a merged set of pages reads as one
 * problem sheet. Existing numbering and lettering on the board wins: a question
 * that already starts with a number gets no second one, and options are lettered
 * only when none of them has a letter, so labels are never doubled or mixed.
 */
function renderPracticeQuestion(block, context) {
  const text = String(block.text ?? '').trim();
  const items = (block.items ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!text && items.length === 0) return '';

  context.questions += 1;
  const lead = QUESTION_NUMBER.test(text) ? text : `**Q${context.questions}.**${text ? ` ${text}` : ''}`;

  const alreadyLettered = items.some((item) => OPTION_LETTER.test(item));
  const options = items
    .map((item, index) => `- ${alreadyLettered ? item : `${optionLabel(index)} ${item}`}`)
    .join('\n');

  return [lead, options].filter(Boolean).join('\n\n');
}

/**
 * A block in the Freeform template: the words, without heading or quote markup.
 *
 * Lists keep their "- " lines because the list is content, and the unreadable
 * marker stays because a gap you cannot see is a gap you will not fix.
 */
function renderFreeformBody(block, flavour) {
  const text = String(block?.text ?? '').trim();

  switch (block?.type) {
    case 'formula':
      return formatFormula(text, flavour);

    case 'table': {
      const parsed = parseTable(block);
      return parsed.rows.length === 0 ? text : renderPlainTable(parsed);
    }

    case 'unreadable': {
      const note = String(block.note ?? '').trim();
      return note ? `[unreadable] ${note}` : '[unreadable]';
    }

    default:
      return [text, listItems(block?.items)].filter(Boolean).join('\n\n');
  }
}

/**
 * Render one block.
 *
 * Returns an empty string for a block with nothing in it, which the caller
 * filters out — that is what keeps stray blank lines out of the document.
 *
 * @param {{ type: string, text?: string, items?: string[], note?: string }} block
 * @param {string} flavour
 * @param {string} template
 * @param {{ questions: number }} context
 */
function renderBlockBody(block, flavour, template, context) {
  if (template === 'freeform') return renderFreeformBody(block, flavour);
  if (template === 'practice' && block?.type === 'question') return renderPracticeQuestion(block, context);

  const text = String(block?.text ?? '').trim();

  switch (block?.type) {
    case 'topic':
      return text ? `# ${text}` : '';

    case 'heading':
      return text ? `## ${text}` : '';

    case 'formula':
      return formatFormula(text, flavour);

    case 'table':
      return tableToMarkdown(block, flavour);

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
 * Render one block, including any note the model attached to it.
 *
 * Notes used to render only for `unreadable` blocks and were dropped everywhere
 * else, which silently lost text the model had actually read — a note on a table
 * saying it was only partly filled, for instance. Nothing the model returns may
 * disappear from the output.
 *
 * @param {{ type: string, text?: string, items?: string[], note?: string }} block
 * @param {string} [flavour]
 * @param {string} [template] one of TEMPLATES
 * @param {{ questions: number }} [context] shared across a document's blocks
 */
export function blockToMarkdown(
  block,
  flavour = DEFAULT_FORMULA_FLAVOUR,
  template = DEFAULT_TEMPLATE,
  context = newRenderContext(),
) {
  const body = renderBlockBody(block, flavour, template, context);
  const note = String(block?.note ?? '').trim();

  // An unreadable block already states its note as its whole body.
  if (!note || block?.type === 'unreadable') return body;

  const annotation = template === 'freeform' ? `(note: ${note})` : `> ${note}`;
  return body ? `${body}\n\n${annotation}` : annotation;
}

/**
 * Render one image's result.
 *
 * No filename heading: the point is notes you can paste, not a report about
 * files.
 *
 * @param {{ blocks?: Array<object> }} result
 * @param {string} [flavour]
 * @param {string} [template]
 * @param {{ questions: number }} [context]
 */
export function resultToMarkdown(
  result,
  flavour = DEFAULT_FORMULA_FLAVOUR,
  template = DEFAULT_TEMPLATE,
  context = newRenderContext(),
) {
  // A page that could not be read is marked where it belongs, rather than left
  // out. A document that looks complete while a page is missing from the middle
  // is the failure this avoids — the reader has no way to know to go back to the
  // photo for something they were never shown was absent.
  if (result?.error) {
    const name = String(result.source_image ?? 'this image').trim() || 'this image';
    const failure = `[failed] ${name} — ${String(result.error).trim()}`;
    return template === 'freeform' ? failure : `> **[failed]**${failure.slice('[failed]'.length)}`;
  }

  return (result?.blocks ?? [])
    .map((block) => blockToMarkdown(block, flavour, template, context))
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
 * Concatenates only — this is the Pages view. The merged document produced by
 * pass 2 renders through `mergedToMarkdown`.
 *
 * @param {Array<object>} results
 * @param {string} [flavour]
 * @param {string} [template]
 */
export function resultsToMarkdown(results, flavour = DEFAULT_FORMULA_FLAVOUR, template = DEFAULT_TEMPLATE) {
  const context = newRenderContext();
  const sections = (results ?? [])
    .map((result) => resultToMarkdown(result, flavour, template, context))
    .filter(Boolean);

  if (sections.length === 0) return '';

  // Exactly one trailing newline: a file should end with one, and more read as
  // broken output when pasted.
  return `${sections.join(SECTION_SEPARATOR)}\n`;
}

/**
 * Render the merged document from pass 2 — the Merged view.
 *
 * One continuous document with no separators, since page boundaries are what
 * the merge removed. Pages that failed in pass 1 never reached the merge, but
 * their markers still appear exactly where those pages belong: a failure is
 * placed after the last block of the successful page before it. That holds
 * even when the page after it was merged away entirely.
 *
 * @param {Array<object & { page: number }>} blocks merged blocks, each tagged
 *   with the index of its page among the pages that were merged
 * @param {Array<{ afterPage: number, source_image: string, error: string }>} [failures]
 *   `afterPage` is the index of the merged page it follows, or -1 to lead
 * @param {string} [flavour]
 * @param {string} [template]
 */
export function mergedToMarkdown(
  blocks,
  failures = [],
  flavour = DEFAULT_FORMULA_FLAVOUR,
  template = DEFAULT_TEMPLATE,
) {
  // Stable sort, so failures between the same two pages keep their order.
  const pending = [...failures].sort((a, b) => a.afterPage - b.afterPage);
  const parts = [];
  const context = newRenderContext();

  const placeFailuresBefore = (page) => {
    while (pending.length > 0 && pending[0].afterPage < page) {
      parts.push(resultToMarkdown(pending.shift(), flavour, template, context));
    }
  };

  for (const block of blocks ?? []) {
    placeFailuresBefore(block.page);
    const markdown = blockToMarkdown(block, flavour, template, context).trim();
    if (markdown) parts.push(markdown);
  }
  placeFailuresBefore(Infinity);

  const document = parts.filter(Boolean).join('\n\n');
  return document ? `${document}\n` : '';
}
