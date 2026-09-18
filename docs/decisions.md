# Decisions log

Decisions that came from hitting a problem rather than from planning: what we
tried, what failed, the evidence, and what we chose instead. Planned decisions
live in [spec section 4](spec.md#4-architecture-decisions). Newest entries go at
the bottom.

---

## 2026-09-12 → 13 — A prompt cannot enforce a hard invariant

**What happened.** On note2.jpg a summation came back inside paragraph text
(`that minimizes w(A) = \sum_{e \in A} w(e)`), which pastes as literal
backslashes. The rule "all mathematics goes in a formula block" was already in the
prompt. A stricter version saying every expression *must* be a formula block
regressed: the model dropped formula blocks entirely and fell back to inline
Unicode.

**Decision.** The guarantee moved into code. `normalizeBlocks`
(`src/normalize-blocks.ts`) splits LaTeX out of prose and list items on the server,
after schema validation and before the response is sent. The prompt rules stay,
because they still reconstruct subscripts and join wrapped lines; code is the
backstop.

**Why.** A model can make something likely, not guaranteed. "Never" is a property
only code can hold. This reversed the Phase 2 position that post-processing was a
patch over a prompt problem (`98bc420`).

## 2026-09-13 — Model-proposed merges failed verification; pass 2 became deterministic

**What happened.** Pass 2 first asked qwen2.5vl:7b to propose merge operations,
with code verifying each one before applying it. On note1–note4 it proposed 10
operations and all 10 failed verification. One would have deleted a formula; nine
were impossible joins. The real duplicate, the same MST definition on two photos,
could not even be expressed, because pass 1 had split one copy into five blocks and
the other into two.

**Decision.** Pass 2 runs in code with no model call. It compares normalised words
(case, punctuation, and notation such as `\sum`/`∑` treated as equal) and drops a
later block when consecutive earlier blocks already cover at least 80% of its words
with at most one missing.

**Why.** Repeated writing is findable from the words alone, and a merge must never
lose text. The fixtures in `test/fixtures/lecture-pages.ts` are the captured pass-1
output this was tested against.

## 2026-09-14 — A repeated section slipped past the duplicate check

**What happened.** note5 and note6 are one board photographed minutes apart. Its
"Notation" section survived twice. Pass 1 split it into one block with items in one
photo and four paragraphs in the other, and the model attached an invented note to
one copy. Meanwhile the line `d[v] should indicate the cost of`, unfinished in the
first photo, was complete in the second. Duplicate detection had no way to prefer
the more complete copy.

**Decision.** A second verified operation, **supersede**. An earlier block is
replaced in place by a later run of blocks that contains all of its board writing
(text and items, not the note) in the same order. A later fix discards the replaced
block's note, because "the last item is incomplete" sitting under completed text is
false rather than merely redundant.

**Why.** Photographing a board repeatedly as a lecture goes on is normal use, so
writing that was *extended* between photos has to be handled, not just writing that
repeats. The fixtures are in `test/fixtures/shortest-paths-pages.ts`.

## 2026-09-14 — A join the code isn't confident about stays a fragment

**What happened.** Pass 2 joined a block that ended without punctuation to the next
page's first block when that block started in lower case. On note5 and note6 it
glued `d[v] should indicate the cost of` onto `array π "predecessor array" (of size
n)` from the other panel. The result was a sentence that existed on neither board.

**Decision.** Joins were removed. The only real evidence that one piece of writing
continues another is a later block containing both halves, and supersede already
handles that. Without that evidence a fragment is left as it is.

**Why.** Punctuation and case say nothing about content, and boards are rarely
punctuated. Output that reads as true and isn't is worse than a visible gap.

## 2026-09-14 — The concurrency measurement was confounded by the cold model load

**What happened.** `MAX_CONCURRENCY` was measured at 1, 2, 3, and 4 over the same
four photos. The runs went in that order, 1 → 2 → 3 → 4, so only the first paid
Ollama's cold load of the ~6 GB model. Limit 1 took 151 s and limits 2–4 each took
under 100 s. That gap is not a concurrency effect that can be read off: the limit-1
run is the only one that included the model load, so 151 s cannot be compared with
the sub-100 s runs. Among 2–4, all warm, there was no meaningful difference. The
comparison is confounded, not merely inconclusive.

An earlier Phase 4 figure, "3 at once is 2.7× faster than sequential", is also
withdrawn. It compared one run at limit 3 (117 s) with the sum of the per-image
times *inside that same run* (311 s), not with a sequential run.

**Decision.** The default stays at 3 as a reasonable value, not a measured optimum.
Warm-up was added so the cold load happens when images are added rather than during
the first conversion: a load took 6.0 s, and the next request with the extraction
settings loaded in 0.015 s. A clean re-measurement, with every run starting from
the same warm state, is still open (spec section 8).

**Why.** The cold load dominates whichever run comes first. It is also what users
feel on their first conversion, which made removing it more valuable than tuning
the limit.

## 2026-09-12 → 14 — HEIC deferred from Phase 1, built in Phase 6

**What happened.** HEIC is the iPhone default, but Chrome and Firefox have no
native decoder: `<img>` will not render it and `createImageBitmap` rejects it. The
frontend has no build step, so a decoder could not simply be installed from npm.
Phase 1 rejected `.heic` with a message naming the format rather than a generic
error.

**Decision.** Phase 6 vendors libheif-js 1.23.2 into `public/vendor/libheif/` with
its version, source, and hash recorded. The browser's own decoder goes first, so
Safari never downloads it. Elsewhere libheif runs in a module worker that loads only
after the first HEIC the browser cannot read.

**Why.** Most students photograph notes on an iPhone, so the app was unusable for
anyone else without this. A 5712×4284 iPhone photo decodes to ~98 MB of RGBA in
~1.2 s, so decoding runs in a worker to keep a 25-photo drop from freezing the page.
