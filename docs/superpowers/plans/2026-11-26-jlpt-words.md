# Estimated JLPT word list `jlpt-words` — plan (issue #219)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage A, no dependency on other v0.9.0 work).
Owner decision 5 (2026-11-26): **no third-party base list.** Jonathan Waller's lists are not used; `jlpt-words` is an
**estimate** built only from data already bundled: the JLPT kanji levels (`jlpt-kanji`), JMdict and the Jiten
frequency ranks. Model: `docs/superpowers/plans/2026-11-14-jlpt-approx.md` (the kanji estimate: named thresholds,
evaluation, deterministic generator), minus its base list. Result: a bundled `levels` pack `plugins/data/jlpt-words`,
usable everywhere (badges, level sessions, decks), not only by the course. No contract change (a `levels` pack is
a known type; entries are `{form, reading}` like `plugins/data/hsk-words/levels.json`).
Test first in every task; one commit per task. Builder: one agent, branch `feature/v090-jlpt-words` from `develop`.

## No licence gate

There is nothing to confirm: the pack copies no list. Its only inputs are `jlpt-kanji` (kanjiapi.dev data, already
bundled with its notice), JMdict (the dictionary, already bundled) and the Jiten ranks (CC BY-SA 4.0, already
bundled). The pack is therefore **CC BY-SA 4.0** (Ruling 1) and its notice says so. Do not fetch, quote or compare
against any published JLPT vocabulary list inside the repository or its tests (an out-of-repo sanity check of the
per-level counts against the commonly cited sizes is fine; those sizes are facts, not a list).

## The estimate (what the script computes)

For every JMdict entry word `{form, reading}` that has a Jiten rank or contains a kanji with a JLPT level:

- `kanjiLevel(word)`: the **hardest** level among its kanji from `jlpt-kanji` (N1 hardest), ignoring non-kanji
  characters; a kanji with no JLPT level counts as "beyond" (≈ N1). Kana-only words have none.
- `rankLevel(word)`: from the Jiten rank thresholds `R5 < R4 < R3 < R2` (named constants): rank ≤ R5 → ≈ N5, ≤ R4 →
  ≈ N4, ≤ R3 → ≈ N3, ≤ R2 → ≈ N2, otherwise ≈ N1. A word without a rank has none.
- **Estimate** = the **harder** of the two that exist (a frequent word with a rare kanji is not N5; a rare kana word is
  not N5). Neither exists → the word is left out (no evidence).
- Words with several readings or forms in JMdict are keyed by `{form, reading}` as the HSK pack does; two readings
  of one form are two entries unless Jiten ranks them together (then the lower rank is used for both).

Thresholds: chosen so the **cumulative size** of the pack at each level lands within ±10 % of the commonly cited
sizes (about 800 at ≈ N5, 1,500 at ≈ N4, 3,700 at ≈ N3, 6,000 at ≈ N2, and the rest at ≈ N1), checked after every
change. They are named constants with the resulting counts in a comment, as the kanji estimate does.

## Evaluation (no ground truth exists)

There is no official list since 2010 and no base list here, so accuracy cannot be measured; the script reports
**consistency checks** instead, written into the pack's notice and `docs/sources.md`:

1. **Kanji agreement:** for words that are a single JLPT kanji (the word `日`, `本`, …), the share whose estimate equals
   that kanji's own level (expected high by construction; it catches a broken combination rule).
2. **Monotonicity:** the cumulative size grows with the level, and no level is empty.
3. **Spot samples:** 20 deterministic words per level (printed, not asserted) for the owner's glance.
4. **Stability:** re-running the script reproduces the files byte for byte.

The notice says plainly: "an estimate, not an official list; no official JLPT vocabulary list has been published
since 2010".

## Tasks

1. **Fixtures.** A small synthetic fixture (30 words across levels: a kana-only word, a word with two readings, a
   word with a kanji that has no JLPT level, a word JMdict knows but Jiten does not, a word Jiten ranks but with
   no JMdict match). Test: `scripts/prepare-jlpt-words.test.mjs` fails without the script.
2. **Estimate** (`scripts/prepare-jlpt-words.mjs`, pure functions + CLI): `kanjiLevel`, `rankLevel`, `estimate`
   with table tests for each rule above (hardest kanji wins, harder-of-two, kana-only, no evidence, ties of ranks
   between readings, determinism). Words with no JMdict match are listed in `plugins/data/jlpt-words/UNMATCHED.tsv`
   (reviewable, deterministic order), never silently dropped or guessed.
3. **Thresholds and evaluation.** Pick `R5…R2` against the real Jiten data until the cumulative sizes are within
   ±10 %; the script prints the table of counts and the four consistency checks; a missing Jiten pack or
   `jlpt-kanji` is a clear failure, not a silent fallback.
4. **Pack.** Write `plugins/data/jlpt-words/{manifest.json, levels.json, LICENSE, ATTRIBUTION.md, UNMATCHED.tsv}`:
   scheme name "JLPT words (approximate)", levels named "≈ N5" … "≈ N1" (the `≈` is part of the name, as for the
   kanji; check the badge text stays readable), `unit: "word"`. Notice: Jiten credit (CC BY-SA 4.0), kanjiapi.dev
   credit for the kanji levels, JMdict credit, the sentence above.
5. **App and tests.** Seed registers the pack (`bundled_packs_test.go` expects the new counts), the level
   sessions and badges show it; update the web tests, fixtures and strings that count bundled schemes; a re-seed of
   an existing database adds the scheme (the levels importer handles a new pack; add a test for a changed pack
   with the same id).
6. **Docs.** `docs/sources.md` (the method, the inputs, the consistency numbers; Waller is **not** used), `LICENSING.md`
   (the pack is CC BY-SA 4.0), `plugins/data/README.md`, wiki Data-and-licences, ROADMAP.
7. **Verify.** `node --test scripts/*.test.mjs`, Go `levels` and `cmd/qinqin` tests, web `check` and `test`;
   merge `origin/develop`, PR into `develop`, CI green.

## Rulings

- Ruling: **no base list** (owner, 2026-11-26) — the licence of the published list could not be confirmed and the owner
  prefers an estimate to doubtful data — if wrong, levels are less accurate than a list would give (cost: some words
  appear one level off, which the fill rule's topic placement and the "≈" in the name already tolerate).
- Ruling: the pack is **CC BY-SA 4.0** — the estimate uses Jiten's CC BY-SA 4.0 ranks — if wrong, the pack cannot be
  combined into a CC BY pack, which nothing needs (cost: none today; a later "course pack with words" would not be
  allowed to embed it, as intended).
- Ruling: the estimate is the **harder** of kanji level and frequency level — a learner must not be told a word is
  easier than it is — if wrong, a word shows one level too high (cost: a slightly later unit).
- Ruling: thresholds are fitted to **cumulative sizes**, not to a list — the only external information is how many
  words each level is commonly said to contain — if wrong, the sizes drift as the Jiten data changes (cost: re-run
  the script against the pinned Jiten version; the counts are in a comment and a test pins them).
- Ruling: words without JMdict match are **reported, not guessed** — a wrong dictionary match would put the wrong
  entry on a card — if wrong, a word is missing from the course (cost: a few words; the report shows them).

## Needs human review

The per-level counts and the spot samples (the owner glances at the numbers: roughly 800 / 1,500 / 3,700 / 6,000
cumulative is the expected scale for the course, N3 ≈ 3,700). No licence evidence is needed. No native-speaker
review: the list is an estimate and says so.

## Done when

`GET /api/schemes` lists the pack with ≈ N5–≈ N1 counts; the consistency checks are in the script output,
the notice and `docs/sources.md`; re-running the script reproduces the files byte for byte; CI green.
