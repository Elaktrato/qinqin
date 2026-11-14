# Writing and Tone Card Feel — Design

Date: 2026-11-14
Status: approved by the owner (2026-11-14).

## Intent and why

The writing card works but feels strict and stiff. The owner compares it with
Skritter, where a stroke can be off in position and even size and still
**snaps** onto the character's real stroke, and where two connected strokes can
be drawn in **one motion** (了 in one stroke instead of two). The goal is that
feel: forgiving, quick, every accepted stroke visibly confirmed. Not a copy of
Skritter's look, assets or wording — only a similar feel built our own way.

The writing logic will later be ported to the native Kotlin Android app (#38),
so it is built as a small, pure engine with shared test cases.

## Goals

- **Forgiving matching:** a stroke is judged mainly on its shape and direction.
  Position and size get wide tolerance relative to the character box.
- **Joined strokes:** one motion may cover the next two or three strokes in
  order where the pen naturally flows on: stroke k ends close to where stroke
  k+1 starts (了; the first two strokes of 子, 糸 and its radical forms 纟/糹, e.g. in 红).
- **Snap:** an accepted stroke morphs quickly from the learner's ink into the
  clean reference stroke; a rejected one flashes and fades.
- **Snappy:** ink follows the pointer without lag; no waits between strokes.
- **Tone card with the same feel:** the swipe snaps to a clean tone contour.
- **Portable:** matching rules and thresholds live in pure modules with
  JSON fixtures that the Kotlin port runs unchanged.

## Non-goals

- Free-form handwriting recognition: stroke **order still matters**.
- Writing kana; drawing characters without stroke data (skipped as today).
- Changing the entry page's stroke-order animation (`StrokePlayer` stays on
  hanzi-writer).
- The Android implementation itself (#38).
- Copying Skritter's visual design, sounds, assets or copy.

## Anti-goals (failure even if it technically works)

- So lenient that a scribble or the wrong stroke passes.
- A stroke drawn backwards, or strokes out of order, accepted.
- Noticeable lag between finger and ink, or animations that slow down a
  fast writer.

## Constraints

- No new dependencies. Stroke data stays the already bundled
  `hanzi-writer-data` (Make Me a Hanzi, Arphic PL) served as
  `/hanzi/U<HEX>.json`: per character `strokes` (SVG outline paths) and
  `medians` (point lists), 1024-unit box, y axis pointing up.
- The card contract stays: `WritingCard` reports `CardResult` with a suggested
  grade via `suggestWritingGrade(outcomes)` and `meta {mistakes, hints}`; the
  review event shape is unchanged, so history and mastery are unaffected.
- Keyboard isolation as today (drawing must not trigger the runner's 1–4 /
  Space keys); "Show character" and self-grading remain as the accessible path.
- `prefers-reduced-motion`: snaps are instant, no morph.

## Approaches

- **A. Tune hanzi-writer's quiz (`leniency`, `drawingWidth`)** — rejected: no
  control over snapping, no way to match several strokes in one motion, and
  nothing reusable for Android.
- **B. Fork hanzi-writer's quiz matcher (MIT)** — rejected: the matcher is tied
  to its renderer and internals; we would maintain a fork and still port it.
- **C. Own small writing engine on the same stroke data (CHOSEN by the owner)**
  — pure TypeScript geometry + matcher modules with shared fixtures, and a
  Svelte writing pad that renders ink and snapped strokes. Ports 1:1 to Kotlin.

## Design

### Modules (web, `apps/web/src/lib/writing/`)

- `geometry.ts` — pure: resample a path to N evenly spaced points, path length,
  bounding box, centroid, start/end direction vectors, coordinate transform
  from the 1024 data box (y up) to pad pixels.
- `matcher.ts` — pure:
  `matchStroke(ink, medians, next, maxJoin = 3) → { matched: number, score } | { miss: reason }`
  compares the learner's ink against the expected stroke `medians[next]`, and
  against the joined candidates `medians[next..next+k-1]` for k = 2..maxJoin
  (consecutive medians concatenated end-to-start). Accept the candidate with the
  best score among those under threshold; on a tie prefer the smaller k.
- `params.ts` — all thresholds in one place (tuned by feel, see Testing).
- `fixtures/*.json` — shared cases `{char, ink, expect}` used by the web tests
  and later by the Kotlin tests.

### Matching rules

For a candidate (one stroke or a join):

1. Resample ink and candidate to the same number of points.
2. **Direction:** the ink's start must be nearer the candidate's start than its
   end, and the overall direction vectors must agree (cosine above a threshold).
   A reversed stroke is a miss.
3. **Shape:** align the ink to the candidate by translation and uniform scale
   (no rotation); shape distance = mean point distance after alignment, divided
   by the candidate's length. This is what makes position and size forgiving.
4. **Placement tolerance:** the alignment itself is bounded — centroid offset
   at most a fraction of the character box, scale ratio within a range — so a
   stroke drawn in the wrong part of the character, or tiny, is still a miss.
5. **Joins** use the same rules and are only candidates when each stroke's end
   lies within a gap limit of the next stroke's start (starting value 0.2 of
   the box; 糸/纟/红 measure 0.15–0.17), so a join never needs a retrace or a backwards connector (口's
   横折 + 横 does not join). The corner between joined strokes must be present
   in the ink (the shape distance covers this).

Starting values (to be tuned): 32 resample points, centroid offset ≤ 0.3 of
the box, scale 0.5–2.0, direction cosine ≥ 0.5, shape distance ≤ 0.2.

**Ruling: endpoint anchoring** — fixes later-stroke/scribble false accepts at starting values — cost if wrong: slightly stricter on sloppy ends; tune `maxEnd` in Task 6. After mapping the ink into the candidate frame, the aligned ink start and end must each lie within `maxEnd` (0.08 x candidate path length) of the candidate's start and end. The ruling started at 0.35; against the fixtures, 0.08 is the loosest value that rejects every wrong-stroke and scribble case while all genuine cases pass (0.06 already rejects genuine noisy strokes).
Deviation: the direction rule (start nearer start than end) is judged relative to each path's centroid, so a shifted stroke is not mistaken for a reversed one; placement is judged separately.

### Writing pad (`WritingPad.svelte`, used by `WritingCard`)

- Square pad with a faint guide grid (cross + diagonals), our own styling.
- Pointer Events with coalesced events; ink drawn on a canvas layer each frame;
  `touch-action: none`.
- On accept: the matched reference outline(s) are drawn; the learner's ink
  morphs into the median and fades into the filled outline in ~120–160 ms.
  Several matched strokes snap together.
- On miss: the ink flashes red and fades (~250 ms); the mistake counts on the
  expected stroke. After 3 misses on one stroke the next stroke glows briefly
  in place with its start marked; as today, the character outline then stays
  visible as a scaffold for the rest of that character (one hint per character).
- "Hint" button (shows the next stroke briefly, each press counts as a hint) and "Show
  character" (as today, makes the character revealed → Again).
- On the last stroke: a short completion flash, then the next character, as
  today (`NEXT_CHAR_DELAY_MS`).

### Grading

Unchanged rules in `suggestWritingGrade`: revealed → Again; no mistakes → Good;
mistakes ≤ 25 % of strokes → Hard; else Again. Joined strokes count as the
strokes they covered. Hints are recorded in `meta.hints`.

### Tone card

Same feel: all syllable pads stay visible as today, larger; the
swipe is classified by the existing `toneFromGesture` and the ink **snaps** to
the clean contour of the recognised tone (~120 ms morph), then focus moves to
the next syllable. Checking stays per word ("Check", then right/wrong marks)
so a slip can be fixed before checking (swipe the pad again). Buttons and
keys 1–5 stay.

**What each pad shows (owner's decision): the character only**, so the card
tests the reading as well as the tone. Mapping: when the word's Han characters
match its syllables one to one, pad *i* shows character *i*. Otherwise (erhua
such as 花儿 = huār, non-Han characters in the written form) the whole word falls
back to today's toneless pinyin on the pads. After Check each pad shows the
correct pinyin with its tone mark, as the answer line does today.

## Testing

- Unit tests for geometry and matcher from fixtures built on real stroke data:
  each stroke drawn from its median with noise, offset, scale up/down; joins
  (了 as one motion, the first two strokes of 子, 糸, 纟 and 红); negatives: a join that would need a retrace (口's
  横折 + 横), reversed strokes, the
  wrong next stroke, strokes out of order, a scribble, a dot for a long stroke,
  a stroke in the wrong quadrant.
- Gates as usual (`check`, `test`, `build`), plus a browser run of a writing
  session.
- **Feel acceptance by the owner** on a touch device: thresholds in `params.ts`
  are adjusted from that feedback.

## My calls (made without asking; reject any)

- Order stays enforced; joins only cover consecutive strokes in order, at most 3,
  and only where the strokes flow into each other (gap limit).
- No rotation tolerance (a rotated stroke is a different stroke).
- Hint after 3 misses keeps today's behaviour (brief glow of the next stroke,
  then the outline stays for that character); a manual Hint button adds
  one hint per press.
- Tone pads keep today's layout (all syllables visible), just larger.
- Tone checking stays per word, not per syllable.
- Guide grid on the writing pad.

## Left to the builder

- Exact thresholds and resample count (starting values above).
- Canvas vs SVG for the ink layer; morph interpolation details.
- How fixtures are generated (script vs hand-written).
- Whether `WritingPad` replaces hanzi-writer in `WritingCard` entirely
  (expected) or behind a temporary switch for comparison.
