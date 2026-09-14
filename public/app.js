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
import { extractImage, fetchRuntimeConfig } from './lib/api.js';
import { runWithConcurrency } from './lib/queue.js';
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
const statusMessage = document.querySelector('#status-message');
const statusElapsed = document.querySelector('#status-elapsed');
const flavourSelect = document.querySelector('#flavour');
const copyButton = document.querySelector('#copy');
const stopButton = document.querySelector('#stop');
const retryButton = document.querySelector('#retry');
const progress = document.querySelector('#progress');

/**
 * @typedef {object} Entry
 * @property {number} id            stable across re-renders and async work
 * @property {string} sourceKey     identity of the file as dropped
 * @property {string} name          display name (the normalized .jpg name once ready)
 * @property {boolean} pending      true while normalization is in flight
 * @property {File | null} file     the normalized JPEG
 * @property {string | null} previewUrl
 * @property {'ready'|'converting'|'done'|'failed'} status conversion state
 * @property {object | null} result the extraction result once converted
 * @property {string | null} error  why this image failed, if it did
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

/** Ticks the elapsed counter while converting; cleared on every exit path. */
let elapsedTimer = null;

/** Aborts the whole run: both the queue and the requests already in flight. */
let runAbort = null;

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
      status: 'ready',
      result: null,
      error: null,
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
  runAbort?.abort();
  selection.forEach(releasePreview);
  selection = [];
  lastRejected = [];
  lastResults = [];
  output.hidden = true;
  outputMarkdown.textContent = '';
  stopElapsed();
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

    if (entry.status !== 'ready') {
      const badge = document.createElement('span');
      badge.className = `thumb__state thumb__state--${entry.status}`;
      badge.textContent =
        entry.status === 'converting' ? 'Reading…' : entry.status === 'done' ? 'Done' : 'Failed';
      if (entry.status === 'failed' && entry.error) badge.title = entry.error;
      item.append(badge);
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

    if (entry.status === 'failed' && !converting) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'thumb__retry';
      retry.textContent = 'Retry';
      retry.setAttribute('aria-label', `Retry ${entry.name}`);
      retry.addEventListener('click', () => runConversion([entry]));
      item.append(retry);
    }

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
  const failed = selection.filter((entry) => entry.status === 'failed').length;
  const converted = convertedCount();

  counter.textContent = `${selection.length} / ${MAX_IMAGES}`;
  emptyState.hidden = selection.length > 0;
  clearButton.disabled = selection.length === 0 || converting;
  // Nothing may be converted while an image is still being read, or the output
  // would describe images that are not ready.
  convertButton.disabled = selection.length === 0 || pending || converting;
  convertButton.textContent = converting ? 'Converting…' : 'Convert';

  stopButton.hidden = !converting;
  retryButton.hidden = converting || failed === 0;
  retryButton.textContent = failed === 1 ? 'Retry 1 failed image' : `Retry ${failed} failed images`;

  progress.textContent = converting || converted > 0 ? `${converted} / ${selection.length} converted` : '';
}

function setStatus(message, kind = 'info') {
  // Written to the live region only, so a screen reader hears the message once
  // rather than hearing the counter tick beside it.
  statusMessage.textContent = message;
  status.className = message ? `status status--${kind}` : 'status';
}

function startElapsed() {
  const startedAt = Date.now();
  const tick = () => {
    statusElapsed.textContent = `${Math.round((Date.now() - startedAt) / 1000)}s`;
  };

  tick();
  elapsedTimer = setInterval(tick, 1000);
}

/** Must run on every exit path, or a timer outlives its conversion. */
function stopElapsed() {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  statusElapsed.textContent = '';
}

/**
 * Re-render the Markdown from results already in memory.
 *
 * Built from `selection` order, never completion order: with several images in
 * flight at once completions interleave arbitrarily, and page order is the one
 * thing the reader depends on.
 */
function renderMarkdown() {
  const results = selection
    .map((entry) =>
      entry.result ??
      (entry.status === 'failed' ? { source_image: entry.name, error: entry.error } : null),
    )
    .filter(Boolean);

  const markdown = resultsToMarkdown(results, formulaFlavour);
  outputMarkdown.textContent = markdown;
  output.hidden = markdown.length === 0;
}

function convertedCount() {
  return selection.filter((entry) => entry.status === 'done' || entry.status === 'failed').length;
}

/** Convert one image and fold the outcome back into its entry. */
async function convertEntry(entry, signal) {
  if (!entry.file) return;

  entry.status = 'converting';
  entry.error = null;
  render();

  const startedAt = Date.now();
  const outcome = await extractImage(entry.file, { signal });
  const seconds = Math.round((Date.now() - startedAt) / 1000);

  if (outcome.cancelled) {
    // Stopped by the user, so it never failed: back to ready, no retry offered.
    entry.status = 'ready';
    render();
    return;
  }

  if (outcome.ok) {
    entry.status = 'done';
    entry.result = outcome.result;
  } else {
    entry.status = 'failed';
    entry.error = outcome.message;
  }

  // Printed so the concurrency measurement is a matter of reading numbers.
  console.log(`${entry.name}: ${entry.status} in ${seconds}s`);

  // Streamed, not batched: the document grows as the run proceeds.
  renderMarkdown();
  render();
}

/**
 * Convert a set of images with a bounded number in flight.
 *
 * @param {Entry[]} queue
 */
async function runConversion(queue) {
  if (queue.length === 0 || converting) return;

  const { maxConcurrency } = await fetchRuntimeConfig();

  converting = true;
  runAbort = new AbortController();
  setStatus(`Converting ${queue.length} image${queue.length === 1 ? '' : 's'}…`, 'busy');
  startElapsed();
  render();

  await runWithConcurrency(
    queue,
    maxConcurrency,
    (entry) => convertEntry(entry, runAbort.signal),
    { signal: runAbort.signal },
  );

  const stopped = runAbort.signal.aborted;
  converting = false;
  runAbort = null;
  stopElapsed();

  const failed = selection.filter((entry) => entry.status === 'failed').length;
  const done = selection.filter((entry) => entry.status === 'done').length;

  if (stopped) {
    setStatus(`Stopped. ${done} image${done === 1 ? '' : 's'} converted.`, 'info');
  } else if (failed > 0) {
    setStatus(
      `${done} converted, ${failed} failed. Retry the failed images, or copy what worked.`,
      'error',
    );
  } else {
    setStatus(`Converted ${done} image${done === 1 ? '' : 's'}.`, 'done');
  }

  renderMarkdown();
  render();
  if (!output.hidden) output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Convert everything not already converted, leaving finished work alone. */
function convert() {
  return runConversion(selection.filter((entry) => entry.file && entry.status !== 'done'));
}

function retryFailed() {
  return runConversion(selection.filter((entry) => entry.status === 'failed'));
}

function stopRun() {
  // Aborts the in-flight requests as well as the queue: stopping only the
  // scheduling would leave the browser waiting on requests nobody wants.
  runAbort?.abort();
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
stopButton.addEventListener('click', stopRun);
retryButton.addEventListener('click', retryFailed);
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
