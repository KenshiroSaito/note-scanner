/**
 * Saving the document as a `.md` file.
 *
 * The filename is pure and tested; `downloadText` needs a DOM and is verified in
 * a browser.
 */

/**
 * Name for a downloaded document: `notes-YYYY-MM-DD.md`.
 *
 * Dated by the local calendar day, which is the day the user took the notes —
 * UTC would name an evening lecture after tomorrow.
 *
 * @param {Date} [date]
 */
export function downloadFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `notes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}

/**
 * Hand the browser a text file to save.
 *
 * @param {string} text
 * @param {string} filename
 */
export function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next task, not synchronously: some browsers start reading the
  // URL only after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
