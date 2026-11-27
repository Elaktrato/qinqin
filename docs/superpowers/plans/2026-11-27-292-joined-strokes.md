# #292 — accept natural joined strokes (き 3+4) (2026-11-27)

Milestone v0.9.0, phase 2. Branch `feature/v090-292-joined-strokes`, from `feature/v090-287-next-stroke-hint` (#287,
itself on #285).

## What

The matcher lets one motion cover two or three strokes in a row only when stroke k ends within `maxGap` (0.2 of
the box) of where stroke k+1 starts (`candidates()` in `lib/writing/matcher.ts`). Natural cursive joins in kana are
longer: き's third stroke ends in a hook that points at the start of the fourth, 0.35 away, so き 3+4 written in one
motion is refused. Both pads (flashcards and the scripts trainer's Write mode) use the same matcher.

## Measurement (KanjiVG r20260714, the `kanjivg-strokes` pack's medians)

All 339 consecutive stroke pairs of hiragana and katakana: 73 are within the gap rule (≤ 0.2). Of the rest, the joins people write (い, う, え, き 3+4, こ, さ 2+3, た 3+4, に, は 1+2, ふ 2+3, や 2+3,
け 1+2, せ 2+3, シ 2+3, ン 1+2) all have one thing in common: the stroke **ends pointing at the next stroke's start**
(its hook or flick leads there), 0.21–0.46 away. The pairs that are not written joined (き 1+2, さ 1+2, ち 1+2, た 2+3,
キ, サ) end pointing elsewhere (cosine of the angle between the stroke's end direction and the move to the next
start ≤ −0.4). Raising `maxGap` for kana would instead admit every nearby pair, whatever the direction. Details and
the per-character table: `apps/web/scripts/make-join-fixtures.mjs --report` (needs a KanjiVG checkout).

## The rule (Ruling)

Ruling: joins follow a **general flow rule, not a hand-picked list**: stroke k flows into stroke k+1 when k+1
starts within `maxGap` (0.2, the gap rule, unchanged) **or** when stroke k ends pointing at k+1's start (within ±60°,
cosine ≥ `flowCos` 0.5, of the chord over the last 15 % of k's length), that start is at most `flowGap` (0.5) away,
and stroke k+1 does not run back past where k ended (it keeps at least `flowClear` 0.4 of the gap away; 口's 横折 +
横 would retrace). A flow join covers two strokes only. The same scoring, join cost and per-stroke direction checks apply; order still matters; drawing the strokes
separately keeps working. One rule for kana and kanji, both pads, Chinese and Japanese data — the issue's list idea
would need a reviewed entry per character and still miss what the list forgot; the measurement shows that the joins
people write are exactly the ones whose hook points on, and the sweep below shows the rule costs nothing elsewhere —
cost if wrong: a pair the rule admits that nobody writes joined is only a candidate (the ink must still match the
joined shape and rank first), and a natural join it misses (gap > 0.45 or a hook pointing elsewhere, e.g. 心 2+3 at
0.54) is still refused, as today; a list can be added beside the rule then.

## Tasks

1. This plan.
2. Tests first, on real stroke data: `apps/web/scripts/make-join-fixtures.mjs` builds
   `src/lib/writing/fixtures/joins.json` from a KanjiVG checkout (kana き さ ふ こ た い う け に シ ン ち and kanji 小
   心 以 子 糸 女): the medians, which consecutive pairs flow on (pinned), and cases: each flowing pair drawn in one
   motion (straight and hand-drawn) is a match of both strokes; each stroke drawn on its own still matches alone; a
   wrong join (き 1+3, every "skip one" pair) misses; a non-flowing pair drawn joined misses; a join drawn out of
   order misses. `matcher.joins.test.ts` runs them, and a sweep over all kana of the fixture that a single stroke is
   never credited as a join.
3. `params.ts` (`flowGap`, `flowCos`, `flowTail`, `flowTailMin`) and `matcher.ts` (`flowsOn`, used by
   `candidates()`).
4. Docs: the writing-feel design ("Joins", the measurement, the sweep numbers), `fixtures/README.md` (licence: the
   fixture is an adaptation of KanjiVG, CC BY-SA 3.0, used by tests only), LICENSING.md, the wiki (Flashcards: Writing;
   scripts trainer), `docs/releases/NEXT.md`.

## Rulings

- Ruling (above): the flow rule instead of a list.
- Ruling: `flowGap` 0.5 and `flowCos` 0.5 — the natural kana joins measured lie at 0.21–0.46 (い and に 1+2 at 0.46:
  0.45, tried first, left them out) with cosines 0.53–1.0; the non-joins have cosines ≤ −0.4. 0.45 and 0.5 measure the
  same on single strokes and wrong strokes — cost if wrong: two numbers in `params.ts`.
- Ruling: `flowClear` 0.4 (the next stroke stays at least 0.4 × the gap away from where the joined stroke ended) —
  the existing fixture "口 1+2 do not join" (Hanzi Writer data) failed with the first version of the rule: 口's 横折
  ends in a small left tick that points at the bottom 横, which then runs back along the move. Measured: the kana
  joins have 0.41–1.0, the retrace pairs of the kanji and HSK sets cluster at 0.05–0.3 — cost if wrong: a flow join
  whose next stroke passes close to the end of the first is refused (せ 2+3 is the closest kana join at 0.41).
- Ruling: a flow link joins two strokes, never three — with three-stroke flow joins a learner who leaves out a short
  middle stroke (ふ 2 then 4 in one motion) was credited 2+3+4; limiting flow joins to two strokes brought the kana
  skip count back to its old value and lost no join — cost if wrong: a three-stroke cursive flow (none found) is
  refused.
- Ruling: a per-stroke coverage check for joins (each stroke of a join within 0.3–0.6 of its own length of the ink)
  was tried against skipped strokes and dropped — the shape alignment scales the ink onto the candidate, so it changed
  almost nothing (Jōyō 135 → 132 at 0.4) and cost genuine joins at 0.3 — cost if wrong: none; not shipped.
- Ruling: the end direction is the chord over the last 15 % of the stroke (at least 0.03) — short enough to be the
  hook, long enough not to be the last pixel of the median — cost if wrong: a hook shorter than 15 % is averaged with
  the body; the sweep shows no loss.
- Ruling: the fixture is KanjiVG-derived data (CC BY-SA 3.0, an adaptation) committed for tests only, with a
  README and a line in LICENSING.md, as `scripts/testdata/kanjivg/` already does — the issue asks for tests on real
  kana data and the KanjiVG pack is never committed; the fixture is not imported by app code, so it is in neither the
  web build nor the APK — cost if wrong: the fixture is regenerated without KanjiVG (the owner can drop it; the
  generator stays).
- Ruling: no ContractVersion bump — the matcher and its params are web code ported to Kotlin through the fixtures
  (`fixtures/strokes.json`, now `fixtures/joins.json`), not a server–client contract in `docs/contracts/` — cost if
  wrong: one number and a CHANGELOG line.
- Ruling: ち 1+2 is not joined (the horizontal ends pointing away from the second stroke, 0.20 away, just over the gap
  rule) — the issue marked it with a question mark; そ is one stroke in KanjiVG already — cost if wrong: a learner who
  writes ち in one motion gets a miss, as today.

## Execution record

- The measurement and the sweep ran first, in a scratch vitest file over KanjiVG kana (all), KanjiVG Jōyō grades 1–2
  (240 kanji) and Hanzi Writer HSK 1 (246 characters), before → after (fixed seeds per stroke, two hand-model hands):

  | | before | after |
  |---|---|---|
  | single strokes as medians | 100 % | 100 % |
  | single strokes, hand model (kana / Jōyō / HSK 1) | 3678/3830, 12332/12362, 12537/12593 | unchanged |
  | later stroke, earlier stroke again, next stroke credited as a join, reversed | 0, 0, 0, 10/1/0 | unchanged |
  | flow-join pairs drawn in one motion (straight) | refused | 36/36, 38/38, 69/69 |
  | flow joins, hand model | refused | 262/306, 272/308, 470/606 |
  | stroke k + k+2 in one motion credited (skip) | 14/181, 119/1239, 154/1230 | 14/181, 126/1239, 169/1230 |

  The skip count already existed (the left-out stroke is a dot or tick that the joined shape absorbs); the flow rule
  adds 0 in kana and about 1 point in kanji. Reported in the design doc.
- Test-first, honestly: the rule was implemented while measuring, before the committed tests. The committed tests
  (`matcher.joins.test.ts` on `fixtures/joins.json`, 218 tests) were then run with the rule switched off
  (`flowGap` 0): 66 failed (every flow link and every flow-join case), and against the old `matcher.ts`/`params.ts`
  (stashed): the file fails (`joinLink` does not exist). The e2e (scripts trainer at 360 px, き 1, 2, then 3+4 in
  one motion) failed with `flowGap` 0 (2 strokes filled, not 4) and passes with the rule.
- The existing fixture "口 1+2 do not join" caught the first version of the rule (see `flowClear`).
- The KanjiVG checkout came from GitHub at the pinned tag into the scratch directory; the generator needs it, the
  tests do not.
- Not checked by hand: joined kana on a touch screen (Local follow-up).

## Local follow-up

- #292: on a phone (browser and the Android app, with the `kanjivg-strokes` pack installed), write き with strokes 3
  and 4 in one motion, さ with 2 and 3, こ and い in one motion, in the scripts trainer's Write mode and on a Japanese
  writing card; each should be accepted, and drawing the strokes separately should still work. Write き's 1 and 3 in
  one motion: a miss.
- To regenerate the fixture: `scripts/fetch-kanjivg-strokes.sh` clones KanjiVG; or clone
  `https://github.com/KanjiVG/kanjivg` at tag r20260714 and run
  `node apps/web/scripts/make-join-fixtures.mjs <checkout>/kanji` (and `--report` for the gap table).
