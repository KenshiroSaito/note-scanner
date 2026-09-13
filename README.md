# note-scanner

Web app that converts photos of class notes into structured Markdown.

See [`docs/spec.md`](docs/spec.md) for the full specification.

## Status

Phase 1 (skeleton) — static frontend only. Images can be selected, previewed,
and validated; pressing **Convert** shows sample output and makes no network
request. The backend arrives in phase 2.

Dropped images are normalized in place: EXIF orientation applied, resized to
1568px on the long edge, re-encoded as JPEG. JPEG and PNG input only — HEIC is
rejected for now, see decision 6 in the spec.

## Development

Requires Node 20 or newer. There are no dependencies and no build step.

```sh
npm test      # run the test suite
npm run serve # serve public/ at http://localhost:8000
```

Set `PORT` to serve on a different port.

The page must be served over HTTP rather than opened as a `file://` URL,
because ES module imports are blocked on `file://`.
