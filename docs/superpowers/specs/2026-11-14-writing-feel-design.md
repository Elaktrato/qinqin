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
- `prefers-reduced-motion`: snaps are instant, no morph; a missed stroke stays as a static red line for ~250 ms instead of fading. Accepted strokes are announced through a polite live region.

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
  `matchStroke(ink, medians, next) → MatchResult` (`{ kind: 'match', strokes, score } | { kind: 'miss', reason } | { kind: 'ignored' }`; joins up to `maxJoin = 3` strokes)
  compares the learner's ink against the expected stroke `medians[next]`, and
  against the joined candidates `medians[next..next+k-1]` for k = 2..maxJoin
  (consecutive medians concatenated end-to-start). Accept the candidate with the
  best score among those under threshold; on a tie prefer the smaller k.
- `params.ts` — all thresholds in one place (tuned by feel, see Testing).
- `fixtures/*.json` — shared cases `{char, ink, expect}` used by the web tests
  and later by the Kotlin tests.

### Matching rules

Revised 2026-11-15 after the owner's touch and mouse test of the first build ("too strict":
好's 撇 took many tries with a vague down-left line; 子's corner stroke and the 竖钩 could not
be drawn in one motion; an exaggerated hook was rejected). The absolute endpoint and
later-stroke thresholds were replaced by the structure below; see the rulings.

The ink and every candidate (one stroke, or a join of consecutive strokes) are resampled
by arc length. Each is also prepared in its **forgiving forms**: the stroke's short brush
entry tick cut off (`body`), and, when it ends in a **hook** (a piece of at most `tailMax`
= 25 % of the length that turns off a straight body by at least 50°), the hook cut off
(`hookless`). The ink's own hook may be up to half its length (an exaggerated hook). In a
join the entry tick can only lie inside the first stroke and the hook inside the last, each at
most half of that stroke, so a short stroke of a join is never cut away as a tick or hook.
Before that, a tiny flick back at either end of the ink (pen-lift recoil or lead-in: at most
0.035 and a tenth of the ink, turning back by 120° or more) is dropped. Ink with a point that
is not a finite number (a pad without size) is ignored.
The ink is compared with a candidate in these pairings, and the best that passes counts:

- whole ink against the whole stroke, and against the stroke without its entry tick;
- hook strokes only: whole ink against the stroke without its hook (hook left off), and the
  ink without its hook against the stroke without its hook, when the ink's hook points the
  stroke hook's way within about ±70° (hook exaggerated or overshot). Both add a small
  `trimPenalty` to the cost.

One pairing passes when all of these generous ceilings hold:

1. **Direction:** the overall start→end chords agree within ±60° (cosine ≥ 0.5), and so do
   the chords of each half within about ±72° (cosine ≥ 0.3), and for a join the chord of each
   of its strokes as well. Reversed strokes fail here; loops (chord under a quarter of the
   length) skip a chord test and rely on shape and the other chords.
2. **Placement:** centroid offset ≤ 0.3 of the box, size ratio 0.45–2.2 (sizes below an rms
   radius of 0.02 count as 0.02, so a dot drawn small is not "too small").
3. **Shape:** after removing translation and uniform scale (no rotation), the mean point
   distance over the stroke length clamped to 0.18–0.4 is ≤ 0.24 (a hand's absolute wobble is
   not magnified on a dot, and a long stroke is not judged loosely in absolute terms); and the
   farthest point of either path from the other polyline, over the length (at least 0.18), is
   ≤ 0.22, so a leg added or left out fails even when the mean is small.

**Cost** of a passing pairing = shape + 0.5 × centroid offset + 0.1 × |ln size ratio|
(+ `trimPenalty`) + `joinCost` (0.03) for each stroke of a join beyond the first.

**Acceptance is by rank:** the expected candidates are the stroke `next` and the joins that
start at it. The best passing one is accepted unless some other stroke or join of the
character, earlier or later, also passes and costs less by more than `rankMargin` (0.03);
then the result is a miss with reason `order`. Ink that fails every expected candidate but
fits another stroke is also a miss with reason `order` (it was meant for that stroke);
otherwise the reason is the expected stroke's own failure (`direction`, `placement`,
`shape`). Ties go to the expected stroke, and among the expected candidates to the fewest
strokes.

**Joins** are candidates only when each stroke's end lies within `maxGap` (0.2 of the box)
of the next stroke's start (糸/纟/红 measure 0.15–0.17); the connector is a straight line
from one stroke's end to the next stroke's start, so a join is only offered where the pen
naturally flows on (口's 横折 + 横 does not join). This does not by itself rule out joins
whose strokes double back on each other (等's first three strokes); the per-stroke direction
test does. The corner between joined strokes must be present in the ink.

**Flow joins (#292).** The gap rule alone missed the joins people write in kana: き's
hooked diagonal ends 0.35 from the bottom curve it flows into. A second rule offers a join
of two strokes when stroke k **ends pointing at** stroke k+1's start: the chord over its last
15 % (`flowTail`, at least 0.03) points within ±60° (`flowCos` 0.5) of the move to that
start, the start is at most `flowGap` 0.5 away, and stroke k+1 keeps at least `flowClear`
0.4 of that distance away from where stroke k ended (so 口's 横折 + 横, whose 横 runs back
along the move, still does not join). `joinLink(a, b)` answers `near` (gap rule), `flow` or
null. A join through a flow link covers two strokes, never three: three-stroke flow joins
let a short middle stroke be skipped (ふ 2+4 credited as 2+3+4) and added no real join.

Measured on KanjiVG (r20260714, the `kanjivg-strokes` medians;
`apps/web/scripts/make-join-fixtures.mjs --report` prints every pair): of the 339
consecutive stroke pairs of hiragana and katakana, 73 lie within the gap rule. The flow rule
adds 36, which are the cursive joins: い, う, え, き 3+4, け 1+2, こ, さ 2+3, せ 2+3, た 3+4,
に 1+2 and 2+3, は 1+2, ふ 2+3 and 3+4, む 2+3, や 2+3, シ 2+3, ン 1+2 (and their voiced and
small forms). Their gaps are 0.21–0.46 and their end directions point on (cosine 0.53–1.0);
the pairs nobody writes in one motion (き 1+2, さ 1+2, ち 1+2, た 2+3, キ, サ) point elsewhere
(cosine ≤ −0.4). Raising `maxGap` for kana instead would offer every nearby pair whatever
its direction, so the list the issue proposed is not needed: the rule covers each example
(そ is one stroke already; ち 1+2 is not a join). Sweep (each stroke drawn as its median and
in the hand model, two hands, before → after): single strokes accepted unchanged (kana
3678/3830, KanjiVG Jōyō grades 1–2 12332/12362, Hanzi Writer HSK 1 12537/12593); later
stroke, earlier stroke again, next stroke credited as a join: 0 → 0; reversed unchanged.
Flow joins drawn in one motion: 36/36 kana, 38/38 kanji, 69/69 HSK 1 pairs as straight
joins, and 86 / 88 / 78 % of their hand-model variants. Cost: a learner who skips a stroke
in one motion (stroke k and k+2 drawn together) is credited a little more often: kana 14 →
14 of 181, Jōyō 119 → 126 of 1239, HSK 1 154 → 169 of 1230 (the gap rule already credits
most of these: the left-out stroke is a dot or tick).

All thresholds live in `params.ts` with a comment each.

**Ruling: rank-based acceptance replaces endpoint anchoring and the later-stroke ratio** —
fixes the owner's "too strict" — cost if wrong: a correct stroke drawn in the wrong place
right on top of another stroke of the same shape is a miss (it is then genuinely ambiguous).
The old rules (aligned endpoints within `max(0.08 × length, 0.04)`; a later stroke within the
next 3 rejecting only when the ink sat at under 0.3 of the distance) judged each candidate
alone against tight absolute limits, so ordinary hands failed: on the hand model below the
old matcher accepted 46 % of 好's 竖钩 and 68 % of its 撇. Ranking against every other
stroke lets the absolute ceilings be generous while order stays enforced: a later stroke
drawn cleanly fits itself better than the expected one, so it misses by construction.
Earlier strokes are rivals too (drawing an already drawn stroke again was accepted 3.9 % of
the time before, 0.1 % now). `rankMargin` 0.03: 0 rejected 5 % of correct strokes shifted by
0.1 towards a neighbour; 0.06 let 0.7 % of next strokes and 0.9 % of earlier strokes through.

**Ruling: hooks and entry ticks are optional** — fixes hook strokes accepted only in a narrow
form (hook left off, exaggerated or overshot: about 5 % before) — cost if wrong: a 竖 drawn
for a 竖钩 is accepted. A short end piece after a sharp turn is cut by finding the sharpest
turn between the body chord (15 % of the length, itself straight within 30°) and the chord to
the end; the straight-body condition stops a long leg after a corner (了's and 子's 横撇, 纟's
撇折) from being taken for a hook, so drawing only the 横 of a 横撇 still misses (corner leg
left out: 1.1 % accepted). `tailMax` 0.25: 0.3 let 6 % of first-leg-only drawings through.

**Ruling: farthest-point limit instead of a corner detector** — a windowed turning-angle
corner test was tried first; on wobbly ink it rejected 13 % of mid-length correct strokes.
The farthest-point limit (0.22) rejects 98.6 % of strokes longer than 0.3 drawn with an extra
perpendicular leg of half their length while keeping simplified straight lines of curved
strokes (大's long 撇). On dots and ticks under 0.15 such a flick is accepted about one time
in five: deliberate leniency, a flick on a dot is not a different stroke for a learner.

**Ruling: no path-length (stretch) limit** — pointer jitter inflates the length of slowly
drawn short strokes; the shape, farthest-point and half-direction rules already reject
zigzags and retraces (scribbles 0.3 %).

**Ruling: hardening after review (2026-11-15)** — fixes single strokes credited as joins,
reversed strokes accepted as joins, and non-finite ink matching — cost if wrong: a learner who
draws two strokes as one where the second is tiny gets only the first (draws the second
again). An independent review found: a join's short last stroke was cut as a "hook" and a
short first stroke as an "entry tick" (cuts are now bounded to half of the stroke they lie in),
joins replaced the single stroke on any lower score (each extra stroke now costs `joinCost`
0.03), long joins skipped the direction test (each stroke of a join now keeps its own
direction), and NaN/Infinity ink always matched (now ignored; `toPadUnit` returns null for a
pad without size). Capping the farthest-point divisor for joins at `shapeCap` was tried as the
review suggested and dropped: it rejected 7 % of genuine one-motion joins and the per-stroke
direction test already removes the reversed-join accepts. Also: dots drawn much smaller than
shown count (size floor), and a tiny recoil flick at the ink's ends is dropped.
On the reviewer's independent pointer model (234 characters, four hand profiles, seed 7),
before → after: correct strokes 97.29 → 97.99 % (sloppy 94.2 → 95.7 %); a single stroke
credited as a join 0.27 → 0.04 % (separate sweep: 47 → 12 of 14 988; only the next stroke
drawn and credited as a join 5 → 0); reversed accepted 0.13 → 0 %; one-motion joins accepted
97.2 → 97.8 %; later / earlier / next stroke false accepts 0.50 / 0.61 / 1.62 → 0.48 / 0.56 /
1.60 %; a foreign stroke more than 70° off 1.16 → 0.53 %. On the hand model below, 好's six
strokes stay at 100 % each (pinned by `matcher.feel.test.ts` at ≥ 97 %) and the sweep at
99.5 %; short strokes under 0.15 drop from 98.2 to 97.7 % (the recoil trim).

Measured with the hand model (`scripts/writing-ink-model.mjs`; per stroke: the stroke as a
straight line where it has no corner, smooth wobble 0.03 with ends over/undershot by up to
15 % and rotation up to ±10°, pointer jitter, hook left off / exaggerated ×2.2 / overshot ×3,
corners rounded, shifted by 0.1 and scaled ×0.7/×1.4), before → after:

| | before | after |
|---|---|---|
| 好 strokes 1–6 | 82 / 68 / 92 / 79 / 46 / 84 % | 100 % each |
| 234-character sweep, correct strokes | 85.1 % | 99.5 % |
| hook left off / exaggerated / overshot | 5 / 5 / 3 % | 97 / 98 / 93 % |
| next stroke drawn cleanly (false accept) | 0.4 % | 0 |
| any later stroke, clean / hand-drawn | 0.5 / 1.0 % | 0 / 0.1 % |
| earlier stroke drawn again | 3.9 % | 0.1 % |
| reversed, hand-drawn / scribble | 0 / 0.1 % | 0.1 / 0.3 % |

A harsher hand (wobble 0.04, ends ±20 %, ±15°) passes 95 % (before: 55 %).

### Writing pad (`WritingPad.svelte`, used by `WritingCard`)

- Square pad with a faint guide grid (cross + diagonals), our own styling.
- **Size (#285):** the pad is as wide as its container allows and square, but no taller than what keeps the
  last line below it (the card's feedback line, the scripts trainer's Hint / Show row) above the docked actions
  with the page at its top: `side = min(width, clamp(side + slack, 10rem, max))`, `max` 22.5rem on a touch
  screen and 17.5rem with a fine pointer (`lib/writing/padSize.ts`, `fitPad`). Re-measured when the container or
  the window changes size (rotation, browser bar); the canvas follows through its `ResizeObserver`. Ink is 3 % of
  the side wide (at least 4 px). Strokes are judged in pad units, so the size does not change the matcher. Both
  pads (flashcards and the scripts trainer) use the same rule.
- Pointer Events with coalesced events; ink drawn on a canvas layer each frame;
  `touch-action: none`.
- On accept: the matched reference outline(s) are drawn; the learner's ink
  morphs into the median and fades into the filled outline in ~120–160 ms.
  Several matched strokes snap together.
- On miss: the ink flashes red and fades (~250 ms); the mistake counts on the
  expected stroke. After 3 misses on one stroke that stroke glows briefly in
  place with its start marked, then stays faintly visible (dimmed, with its
  start) until the learner draws it. **Only that stroke**: no outline of the
  character, no other stroke (#287; until then the whole outline stayed as a
  scaffold, once per character). Per stroke: any later stroke that reaches 3
  misses is hinted again, and each automatic hint counts as one hint in
  `meta.hints` (`lib/writing/quiz.ts`: `autoHints`, `trace`).
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
swipe is classified by the existing `toneFromGesture`; the raw trace is cleared
and the clean contour of the recognised tone is drawn in (~120 ms; this is not a
morph of the trace), then focus moves to the next syllable. Pad aria-labels name
the character, never the pinyin ("Syllable 1, 学: no tone yet"). Checking stays per word ("Check", then right/wrong marks)
so a slip can be fixed before checking (swipe the pad again). Buttons and
keys 1–5 stay.

**What each pad shows (owner's decision): the character only**, so the card
tests the reading as well as the tone. Mapping: when the word's Han characters
match its syllables one to one, pad *i* shows character *i*. Otherwise (erhua
such as 花儿 = huār, non-Han characters in the written form) the whole word falls
back to today's toneless pinyin on the pads. After Check each pad shows the
correct pinyin with its tone mark, as the answer line does today.

## Testing

- Hand-model fixtures (`scripts/writing-ink-model.mjs`, emitted by
  `make-writing-fixtures.mjs`) for 好 女 子 了 我 永 红 口 十 人: every stroke drawn as a
  simplified straight line, with wobble/over- and undershoot/rotation, pointer jitter, hooks
  left off and exaggerated, rounded corners, shifted and scaled — all must match; the same hand
  drawing the stroke reversed, a later stroke, or the previous stroke again must miss (later and
  earlier strokes with reason `order`). `fixtures/strokes.json` stores coordinates as flat
  integer arrays (unit value × 10 000), at most 40 points per ink and one case per line; the
  file's `format` field states the layout for the Kotlin port. `matcher.feel.test.ts` pins the
  owner-approved feel of 好 (each stroke ≥ 97 % over 20 seeds of the hand model).
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
  and only where the strokes flow into each other (gap limit; from #292 also the flow
  rule, two strokes per flow join).
- No rotation in the alignment (a rotated stroke is a different stroke); the generous
  direction and shape ceilings absorb the ±10° a hand rotates.
- Hint after 3 misses (owner, #287, replacing "the outline then stays for that
  character"): the glow of that stroke, which then stays dimmed until it is
  drawn; only that stroke, once per stroke, each one a hint in `meta.hints`; the
  suggested grade is not lowered by it beyond the misses themselves. A manual
  Hint button adds one hint per press. Re-checked with the forgiving matcher (2026-11-15): kept — with
  correct strokes now accepted in nearly any hand, three misses on one stroke mean the
  learner does not know it, which is exactly when the glow helps.
- Tone pads keep today's layout (all syllables visible), just larger.
- Tone checking stays per word, not per syllable.
- Guide grid on the writing pad.

## Left to the builder

- Exact thresholds and resample count (starting values above).
- Canvas vs SVG for the ink layer; morph interpolation details.
- How fixtures are generated (script vs hand-written).
- Whether `WritingPad` replaces hanzi-writer in `WritingCard` entirely
  (expected) or behind a temporary switch for comparison.
