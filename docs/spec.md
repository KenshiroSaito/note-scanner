# note-scanner — Specification

A web app that turns photos of whiteboards, slides, and handwritten class notes
into structured text.

---

## 1. Goal

Eliminate the work of copying handwritten notes into an iPad by hand, and the
work of manually selecting text out of photos. The user drops in photos and
gets back clean, structured Markdown.

## 2. User flow

1. User opens the page (no install, no login)
2. Drag and drop or select images (up to 25)
3. Choose an output template (e.g. Lecture notes / Practice questions / Freeform)
4. Press "Convert"
5. Progress is shown per image (e.g. 7/25 done)
6. Structured text appears when finished
7. Copy as Markdown, or download as a `.md` file

## 3. Scope

### In scope
- Image upload (JPEG/PNG, up to 25 per run). HEIC is deferred — see decision 6
- Reading both handwriting and printed text
- Removing noise (circles, arrows, underlines, margin doodles, broken indentation)
- Reformatting into a defined structure
- Markdown output (copy / download)
- Per-image failure reporting and single-image retry

### Out of scope (v1)
- User accounts, saved history
- Preserving diagrams as images (formulas are transcribed as LaTeX text)
- Languages other than English and Japanese
- PDF input
- Live camera capture

## 4. Architecture decisions

### Decision 1: Use a vision LLM, not in-browser OCR

**Reason:** The core of this feature is not reading characters — it is deciding
what is body text and what is a doodle. Traditional OCR (Tesseract.js, EasyOCR)
returns characters with coordinates but cannot decide "ignore this circled mark"
or "these three lines are options A/B/C". That requires language understanding,
so images are sent to a vision-capable LLM.

**Consequence:** This cannot be fully browser-only. An API call is required.

### Decision 2: The API key lives on the server, never in the frontend

**Reason:** An API key written into frontend JS is readable by anyone through
DevTools, and is leaked the moment it is pushed to GitHub. No exceptions.

**Structure:**

```
Browser (static page)
    │  POST images
    ▼
Backend (holds the API key)
    │  calls the vision LLM
    ▼
Returns structured JSON
```

- Frontend: static files only. Can be served from GitHub Pages
- Backend: one small API proxy. Takes images, calls the LLM, returns JSON

### Decision 3: Two-pass processing

**Pass 1 (per image):** Each image is processed independently into structured
JSON by the vision LLM. Can run in parallel.
**Pass 2 (whole set):** All pass-1 results are merged into one document —
deterministically, in code, with no LLM call.

**Reason:** A single topic in lecture notes often spans several pages, and
students photograph a board more than once as a lecture goes on. The same writing
then arrives several times — unchanged, split into blocks differently, or extended
with more writing. Simply concatenating per-image results repeats whole sections.

**Revised in phase 5 — pass 2 does not use the LLM.** The first implementation
asked the model to propose merge operations, with code verifying each one before
applying it. On four real lecture photos, qwen2.5vl:7b proposed 10 operations and
all 10 failed verification: one would have deleted a formula, and nine were
impossible joins. The real duplicate — the same MST definition on two photos —
could not have been expressed anyway, because pass 1 split one copy into five
blocks and the other into two.

Repeated writing is findable from the words alone, so code finds it, after
normalising notation so `\sum` and `∑` count as the same word. Two operations,
each verified before it is applied:

- **Drop** a later block whose words a run of up to four consecutive earlier
  blocks already covers (at least 80% overlap, at most one word missing).
- **Supersede** an earlier block with a later run that contains all of its board
  writing in the same order — a later photo of the same writing, more complete.
  The later text takes the earlier block's place, so its section stays together.
  A note the model attached to the earlier block is discarded: it described what
  the earlier photo showed, and under the completed writing a note such as "the
  last item is incomplete" would be false rather than merely redundant.

A block under six words is removed only as part of a repeated run, so short generic
lines such as "Definition" survive. No board writing the model read can be lost.

**Joins were removed.** An earlier version joined a block ending without
punctuation to a next-page block starting in lower case. On two photos of one board
taken minutes apart, it glued the unfinished "d[v] should indicate the cost of"
onto "array π" from the other panel — a sentence on neither board. Punctuation and
case say nothing about content, and a join that invents a sentence is worse than
none. The only real evidence that one piece of writing continues another is a later
block containing both, which supersede already handles. Without that evidence, a
fragment is left as it is.

**Revisit if:** real use shows repeated content the word check misses, or a
stronger model (the Claude engine) makes model-proposed merges worth measuring
again.

### Decision 4: Backend in Node / TypeScript

**Reason:**
- Type definitions can be shared with the frontend (JSON schema defined once)
- No heavy image processing is needed — resizing happens in the browser via the
  Canvas API, so Python's strengths (OpenCV, Pillow) would go unused
- Zod unifies schema validation and type definitions in one place
- Runs on the free tiers of Cloudflare Workers / Vercel Functions as-is

**Revisit if:** Preprocessing (deskew, binarization via OpenCV) turns out to be
necessary to make handwriting readable.

### Decision 5: The extraction engine is swappable

Local (Ollama) and cloud (Claude API) are switchable via one environment variable.

```
POST /extract  →  extractor  →  ┬→ Ollama (localhost, free)
                                └→ Claude API (paid, higher accuracy)
```

**Reason:** Development can iterate for free locally. If handwriting accuracy is
insufficient, switching to the cloud allows a direct comparison. That measured
comparison is itself the record of the design decision.

### Decision 6: HEIC support is deferred, and needs a vendored WASM decoder

**Constraint:** Chrome and Firefox have no native HEIC decoder. `<img>` will not
render it and `createImageBitmap` rejects it. Only Safari can decode HEIC.

**Consequence:** supporting the format iPhones shoot by default requires libheif
compiled to WebAssembly (roughly 1-3 MB). Because the frontend has no build step,
that file has to be vendored into `public/vendor/` and committed rather than
installed from npm.

**Decision:** deferred to its own task after phase 1. Until then `.heic` is
rejected client-side with a message naming the format and pointing at JPEG — a
generic "unsupported format" on the default iPhone format would be the most
confusing failure the app could produce.

**Revisit when:** phase 1 is merged, and it is known which browser is actually
used for capture. iOS Safari usually transcodes HEIC to JPEG when a photo is
chosen through a file input, so the decoder may only matter for files dragged out
of macOS Finder.

## 5. Output data structure

The LLM must return JSON only — no preamble, no code fences.

```json
{
  "source_image": "IMG_0412.jpg",
  "confidence": "high | medium | low",
  "blocks": [
    {
      "type": "topic | heading | paragraph | list | question | definition | formula | table | unreadable",
      "text": "body text",
      "items": ["only for lists or answer options"],
      "note": "optional explanation of what could not be read"
    }
  ]
}
```

- `unreadable` exists so the model can state that something was not legible.
  It must never guess
- Returned JSON is always schema-validated. On failure, retry once; if it fails
  again, mark that image as failed
- Markdown conversion happens in the frontend, not the server (a direct mapping
  from `blocks` to Markdown)

## 6. Technical challenges

| Challenge | Approach |
|---|---|
| 25 images take time | Stream results one at a time; never block on the full set |
| Cost scales with image count | Resize to ~1568px on the long edge in the browser before upload |
| One failure stalls everything | Process images independently; retry just the failed one |
| LLM returns something other than JSON | Schema validation + one retry + fallback |
| Model invents text it cannot read | Prompt explicitly allows `unreadable` and forbids guessing |
| Large images break the request | Set a post-resize size limit and reject oversized files client-side |

## 7. Implementation phases

Each phase should fit in a single pull request.

**Phase 1 — Skeleton**
Static frontend. Drag and drop, preview, image-count validation. No API calls yet
(display dummy JSON). Also normalizes every dropped file in place — EXIF
orientation, resize to 1568px on the long edge, re-encode as JPEG — so the rest
of the app only handles one bounded format (moved up from phase 6).

**Phase 2 — Backend, single image**
Build the API proxy. Accept one image, call the vision LLM, return schema-validated
JSON. API key from an environment variable.

**Phase 3 — Connect frontend**
Convert one real image and render Markdown. Copy button.

**Phase 4 — Multiple images**
Up to 25 images, progress display, per-image failure and retry.

**Phase 5 — Pass 2 (merge)**
Remove content repeated across pages (a board photographed more than once), let a
later photo complete writing an earlier one caught unfinished, and keep the
page-by-page document available beside the merged one. Deterministic, in code, with
no model call, and never joining text across pages without evidence — see
decision 3.

**Phase 6 — Polish**
Template selection, `.md` download. (Client-side resizing moved to phase 1.)

## 8. Open questions

- **Local model accuracy** — Can an Ollama vision model read handwritten notes
  well enough? Verify with 3 real class-note photos before deciding
- **Where the backend runs** — Cloudflare Workers / Vercel Functions / Render.
  Compare on free tier and cold start
- **Who pays** — Use my own API key for everyone, or have users supply their own?
  Required decision before publishing
- **Template granularity** — Three fixed templates, or let users describe the
  structure freely?
- **Formulas** — Transcribe as LaTeX, or mark `unreadable` and reference the image?

## 9. Definition of done (v1)

Feeding in 10 real class-note photos produces Markdown that is faster than
copying by hand into an iPad, and as readable as if it had been copied by hand.