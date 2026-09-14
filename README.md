# note-scanner

Web app that converts photos of class notes into structured Markdown.

See [`docs/spec.md`](docs/spec.md) for the full specification.

## Status

Phase 4 (multiple images). Drop up to 25 photos, press **Convert**, and get one
Markdown document you can copy.

**Frontend** — images are normalized in place on drop: EXIF orientation applied,
resized to 1568px on the long edge, re-encoded as JPEG. JPEG and PNG input only;
HEIC is rejected for now, see decision 6 in the spec. Convert runs every selected
image with a few in flight at once, streaming each result into the document as it
lands; progress, Stop, and per-image Retry are all live during a run. Formulas can
be written as LaTeX, Unicode, plain text, or code spans.

**Backend** — `POST /extract` takes one image, calls a vision model, and returns
schema-validated JSON (the shape in spec section 5). Ollama runs it locally by
default; the Claude API is a drop-in alternative.

Markdown conversion happens in the frontend, not the server (spec section 5).

## Development

Requires Node 22 or newer (Node runs the TypeScript directly — there is no build
step). Install once with `npm install`.

```sh
npm test        # run the test suite
npm run typecheck   # tsc --noEmit
npm run serve   # frontend: serve public/ at http://localhost:8000
npm start       # backend:  API at http://localhost:8787
npm run dev     # backend, restarting on change
```

**Using the app needs both processes**: run `npm start` and `npm run serve` in
separate terminals, then open <http://localhost:8000>. If Convert reports that it
cannot reach the backend, `npm start` is the one that is missing.

The frontend must be served over HTTP rather than opened as a `file://` URL,
because ES module imports are blocked on `file://` (and the clipboard needs a
secure context, which `localhost` provides and `file://` does not).

The backend address is a constant in `public/lib/api.js`. The frontend has no
build step and no environment variables, so deploying it somewhere else means
editing that line — revisited when the hosting question in spec section 8 is
settled.

### Backend configuration

All configuration comes from the environment; copy `.env.example` to `.env` and
fill in what you need. `.env` is gitignored, and no key is ever written to a
source file.

The default path needs no configuration at all: it expects Ollama on
`localhost:11434` with `qwen2.5vl:7b` pulled. To use the Claude API instead, set
`EXTRACTOR=claude` and `ANTHROPIC_API_KEY`; the key is required only in that case.

Check it end to end with a real photo:

```sh
curl -sS -F image=@your-photo.jpg http://localhost:8787/extract
```

Expect this to take 30–120 seconds on a local 7B vision model — hence the
generous `REQUEST_TIMEOUT_MS` default. The browser converts `MAX_CONCURRENCY`
images at once (default 3), which measured 2.7x faster than sequential on six
images; change it with `MAX_CONCURRENCY=2 npm start` and watch the per-image
timings in the browser console. Responses are `200` with the validated
result, `400` for a bad request, `502` when the model is unreachable or returned
unusable output twice, and `504` on timeout.
