/**
 * Image selection, normalization, extraction, and Markdown output.
 *
 * The drop zone is a normalization boundary — every accepted file is decoded,
 * oriented, resized, and re-encoded as JPEG before it enters the selection, so
 * what is previewed is exactly what gets uploaded.
 *
 * Convert sends one image to the backend and renders the result as Markdown.
 * Converting every selected image, with progress and per-image retry, is phase 4.
 */
import { MAX_IMAGES, dedupe, identityOf, validateSelection } from './lib/validation.js';
import { normalizeImage } from './lib/normalize.js';
import { extractImage } from './lib/api.js';
import { DEFAULT_FORMULA_FLAVOUR, FORMULA_FLAVOURS, resultsToMarkdown } from './lib/markdown.js';

const dropzone = document.querySelector('#dropzone');
const fileInput = document.querySelector('#file-input');
const thumbnails = document.querySelector('#thumbnails');
const emptyState = document.querySelector('#empty-state');
const counter = document.querySelector('#counter');
const errors = document.querySelector('#errors');
const clearButton = document.querySelector('#clear');
const convertButton = document.querySelector('#convert');
const output = document.querySelector('#output');
const outputMarkdown = document.querySelector('#output-markdown');
const status = document.querySelector('#status');
const flavourSelect = document.querySelector('#flavour');
const copyButton = document.querySelector('#copy');

/**
 * @typedef {object} Entry
 * @property {number} id            stable across re-renders and async work
 * @property {string} sourceKey     identity of the file as dropped
 * @property {string} name          display name (the normalized .jpg name once ready)
 * @property {boolean} pending      true while normalization is in flight
 * @property {File | null} file     the normalized JPEG
 * @property {string | null} previewUrl
 */

/** @type {Entry[]} */
let selection = [];

/** Entries are addressed by id, never by index: normalization is async and indices shift. */
let nextId = 1;

/** Nested drag events fire on children, so track depth instead of toggling. */
let dragDepth = 0;

/** Rejections from the most recent drop, shown until the next one. */
let lastRejected = [];

/**
 * Results from the last conversion.
 *
 * Kept so changing the formula flavour re-renders from memory: a display choice
 * must never cost another 40-second model call.
 */
let lastResults = [];

/** True while a conversion is in flight, so Convert cannot be double-fired. */
let converting = false;

const FLAVOUR_STORAGE_KEY = 'note-scanner.formula-flavour';

/** Reading storage can throw in a private window or with site data blocked. */
function loadFlavour() {
  try {
    const stored = localStorage.getItem(FLAVOUR_STORAGE_KEY);
    if (stored && FORMULA_FLAVOURS.includes(stored)) return stored;
  } catch {
    // Ignore: the default is fine.
  }
  return DEFAULT_FORMULA_FLAVOUR;
}

function saveFlavour(flavour) {
  try {
    localStorage.setItem(FLAVOUR_STORAGE_KEY, flavour);
  } catch {
    // A remembered preference is a convenience, not a requirement.
  }
}

let formulaFlavour = loadFlavour();

function releasePreview(entry) {
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
}

function findById(id) {
  return selection.find((entry) => entry.id === id);
}

async function addFiles(fileList) {
  const incoming = dedupe(
    selection.map((entry) => entry.sourceKey),
    Array.from(fileList),
  );

  const { accepted, rejected } = validateSelection(incoming, {
    alreadyAccepted: selection.length,
  });

  lastRejected = rejected;

  // Show every accepted file immediately as a pending tile, so a slow decode
  // looks like work in progress rather than a dropped file.
  const queued = accepted.map((file) => {
    /** @type {Entry} */
    const entry = {
      id: nextId++,
      sourceKey: identityOf(file),
      name: file.name,
      pending: true,
      file: null,
      previewUrl: null,
    };
    selection.push(entry);
    return { entry, file };
  });

  render();

  for (const { entry, file } of queued) {
    try {
      const normalized = await normalizeImage(file);

      // The user may have removed this tile or cleared the list mid-decode.
      if (!findById(entry.id)) continue;

      entry.file = normalized;
      entry.name = normalized.name;
      entry.previewUrl = URL.createObjectURL(normalized);
      entry.pending = false;
    } catch (error) {
      console.error(`Could not read ${file.name}`, error);
      selection = selection.filter((candidate) => candidate.id !== entry.id);
      lastRejected = [
        ...lastRejected,
        { file, reason: 'decode-failed', message: 'Could not be read as an image.' },
      ];
    }
    render();
  }
}

function removeById(id) {
  const entry = findById(id);
  if (!entry) return;
  releasePreview(entry);
  selection = selection.filter((candidate) => candidate.id !== id);
  render();
}

function clearAll() {
  selection.forEach(releasePreview);
  selection = [];
  lastRejected = [];
  lastResults = [];
  output.hidden = true;
  outputMarkdown.textContent = '';
  setStatus('');
  render();
}

function renderThumbnails() {
  thumbnails.replaceChildren();

  for (const entry of selection) {
    const item = document.createElement('li');
    item.className = 'thumb';

    if (entry.previewUrl) {
      const image = document.createElement('img');
      image.className = 'thumb__image';
      image.src = entry.previewUrl;
      image.alt = '';
      item.append(image);
    } else {
      const pending = document.createElement('div');
      pending.className = 'thumb__pending';
      pending.textContent = 'Reading…';
      item.append(pending);
    }

    const name = document.createElement('span');
    name.className = 'thumb__name';
    name.textContent = entry.name;
    name.title = entry.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb__remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${entry.name}`);
    remove.addEventListener('click', () => removeById(entry.id));

    item.append(name, remove);
    thumbnails.append(item);
  }
}

function renderErrors() {
  errors.replaceChildren();
  if (lastRejected.length === 0) return;

  const title = document.createElement('p');
  title.className = 'errors__title';
  title.textContent =
    lastRejected.length === 1
      ? '1 file was not added'
      : `${lastRejected.length} files were not added`;

  const list = document.createElement('ul');
  list.className = 'errors__list';

  for (const { file, message } of lastRejected) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'errors__file';
    name.textContent = file.name;
    item.append(name, document.createTextNode(` — ${message}`));
    list.append(item);
  }

  errors.append(title, list);
}

function render() {
  renderThumbnails();
  renderErrors();

  const pending = selection.some((entry) => entry.pending);

  counter.textContent = `${selection.length} / ${MAX_IMAGES}`;
  emptyState.hidden = selection.length > 0;
  clearButton.disabled = selection.length === 0 || converting;
  // Nothing may be converted while an image is still being read, or the output
  // would describe images that are not ready.
  convertButton.disabled = selection.length === 0 || pending || converting;
  convertButton.textContent = converting ? 'Converting…' : 'Convert';
}

function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.className = message ? `status status--${kind}` : 'status';
}

/** Re-render the Markdown from results already in memory. */
function renderMarkdown() {
  const markdown = resultsToMarkdown(lastResults, formulaFlavour);
  outputMarkdown.textContent = markdown;
  output.hidden = markdown.length === 0;
}

async function convert() {
  const [entry] = selection;
  if (!entry?.file || converting) return;

  converting = true;
  lastResults = [];
  output.hidden = true;
  // A local model takes tens of seconds; silence would read as a hang.
  setStatus(`Converting ${entry.name}… this can take up to a minute on a local model.`);
  render();

  const outcome = await extractImage(entry.file);

  converting = false;

  if (!outcome.ok) {
    setStatus(outcome.message, 'error');
    render();
    return;
  }

  lastResults = [outcome.result];
  const skipped = selection.length - 1;
  setStatus(
    skipped > 0
      ? `Converted ${entry.name}. ${skipped} other image${skipped === 1 ? '' : 's'} were not converted — that arrives in phase 4.`
      : `Converted ${entry.name}.`,
    'done',
  );

  renderMarkdown();
  render();
  output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function copyMarkdown() {
  const markdown = outputMarkdown.textContent;
  if (!markdown) return;

  try {
    await navigator.clipboard.writeText(markdown);
    copyButton.textContent = 'Copied';
    setTimeout(() => {
      copyButton.textContent = 'Copy';
    }, 1500);
  } catch {
    // Needs a secure context: localhost qualifies, a file:// page does not.
    setStatus('Could not copy automatically — select the text and copy it manually.', 'error');
  }
}

/* Drag and drop. Every handler preventDefaults, or the browser navigates to the file. */
dropzone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropzone.classList.add('dropzone--active');
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
});

dropzone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('dropzone--active');
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('dropzone--active');
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
});

/* Dropping outside the zone should not navigate away from the page either. */
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) addFiles(fileInput.files);
  // Reset so re-picking the same file still fires a change event.
  fileInput.value = '';
});

clearButton.addEventListener('click', clearAll);
convertButton.addEventListener('click', convert);
copyButton.addEventListener('click', copyMarkdown);

flavourSelect.value = formulaFlavour;
flavourSelect.addEventListener('change', () => {
  formulaFlavour = flavourSelect.value;
  saveFlavour(formulaFlavour);
  // Re-renders from lastResults: no second API call.
  renderMarkdown();
});

window.addEventListener('pagehide', () => selection.forEach(releasePreview));

render();
