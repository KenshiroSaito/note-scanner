# note-scanner

Web app that converts photos of class notes into structured Markdown.

See [`docs/spec.md`](docs/spec.md) for the full specification.

## Status

Phase 2 (backend, single image). The frontend and backend both work, but are not
yet connected — that is phase 3.

**Frontend** — images can be selected, previewed, and validated; pressing
**Convert** shows sample output and makes no network request. Dropped images are
normalized in place: EXIF orientation applied, resized to 1568px on the long
edge, re-encoded as JPEG. JPEG and PNG input only; HEIC is rejected for now, see
decision 6 in the spec.

**Backend** — `POST /extract` takes one image, calls a vision model, and returns
schema-validated JSON (the shape in spec section 5). Ollama runs it locally by
default; the Claude API is a drop-in alternative.

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

The frontend must be served over HTTP rather than opened as a `file://` URL,
because ES module imports are blocked on `file://`.

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
generous `REQUEST_TIMEOUT_MS` default. Responses are `200` with the validated
result, `400` for a bad request, `502` when the model is unreachable or returned
unusable output twice, and `504` on timeout.
