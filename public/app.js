/**
 * Phase 1 skeleton: image selection and preview.
 *
 * Deliberately makes no network request. Pressing Convert renders dummy data
 * in the schema the backend will return in phase 2.
 */
import { MAX_IMAGES, dedupe, needsPlaceholder, validateSelection } from './lib/validation.js';
import { sampleResultFor } from './lib/sample-result.js';

const dropzone = document.querySelector('#dropzone');
const fileInput = document.querySelector('#file-input');
const thumbnails = document.querySelector('#thumbnails');
const emptyState = document.querySelector('#empty-state');
const counter = document.querySelector('#counter');
const errors = document.querySelector('#errors');
const clearButton = document.querySelector('#clear');
const convertButton = document.querySelector('#convert');
const output = document.querySelector('#output');
const outputJson = document.querySelector('#output-json');

/** @type {Array<{ file: File, previewUrl: string | null }>} */
let selection = [];

/** Nested drag events fire on children, so track depth instead of toggling. */
let dragDepth = 0;

function releasePreview(entry) {
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
}

function addFiles(fileList) {
  const incoming = dedupe(
    selection.map((entry) => entry.file),
    Array.from(fileList),
  );

  const { accepted, rejected } = validateSelection(incoming, {
    alreadyAccepted: selection.length,
  });

  for (const file of accepted) {
    selection.push({
      file,
      // HEIC has no browser-renderable preview, so don't hold an object URL for it.
      previewUrl: needsPlaceholder(file) ? null : URL.createObjectURL(file),
    });
  }

  render(rejected);
}

function removeAt(index) {
  const [entry] = selection.splice(index, 1);
  if (entry) releasePreview(entry);
  render([]);
}

function clearAll() {
  selection.forEach(releasePreview);
  selection = [];
  output.hidden = true;
  outputJson.textContent = '';
  render([]);
}

function renderThumbnails() {
  thumbnails.replaceChildren();

  selection.forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = 'thumb';

    if (entry.previewUrl) {
      const image = document.createElement('img');
      image.className = 'thumb__image';
      image.src = entry.previewUrl;
      image.alt = '';
      item.append(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'thumb__placeholder';
      placeholder.textContent = 'HEIC';
      item.append(placeholder);
    }

    const name = document.createElement('span');
    name.className = 'thumb__name';
    name.textContent = entry.file.name;
    name.title = entry.file.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb__remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
    remove.addEventListener('click', () => removeAt(index));

    item.append(name, remove);
    thumbnails.append(item);
  });
}

function renderErrors(rejected) {
  errors.replaceChildren();
  if (rejected.length === 0) return;

  const title = document.createElement('p');
  title.className = 'errors__title';
  title.textContent =
    rejected.length === 1 ? '1 file was not added' : `${rejected.length} files were not added`;

  const list = document.createElement('ul');
  list.className = 'errors__list';

  for (const { file, message } of rejected) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'errors__file';
    name.textContent = file.name;
    item.append(name, document.createTextNode(` — ${message}`));
    list.append(item);
  }

  errors.append(title, list);
}

function render(rejected) {
  renderThumbnails();
  renderErrors(rejected);

  counter.textContent = `${selection.length} / ${MAX_IMAGES}`;
  emptyState.hidden = selection.length > 0;
  clearButton.disabled = selection.length === 0;
  convertButton.disabled = selection.length === 0;
}

function convert() {
  const results = selection.map((entry, index) => sampleResultFor(entry.file.name, index));
  outputJson.textContent = JSON.stringify(results, null, 2);
  output.hidden = false;
  output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

window.addEventListener('pagehide', () => selection.forEach(releasePreview));

render([]);
