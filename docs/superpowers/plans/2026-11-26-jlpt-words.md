# Estimated JLPT word list `jlpt-words` — plan (issue #219)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage A, no dependency on other v0.9.0 work).
Model: `docs/superpowers/plans/2026-11-14-jlpt-approx.md` (the kanji estimate: base list, gap fill, calibrated
thresholds, holdout evaluation, deterministic generator). Result: a bundled `levels` pack `plugins/data/jlpt-words`,
usable everywhere (badges, level sessions, decks), not only by the course. No contract change (a `levels` pack is
a known type; entries are `{form, reading}` like `plugins/data/hsk-words/levels.json`).
Test first in every task; one commit per task. Builder: one agent, branch `feature/v090-jlpt-words` from `develop`.

## Licence gate (do first, before any data is committed)

- Base list: Jonathan Waller's lists (tanos.co.uk). Evidence so far: the reuse repository
  `Bluskyo/JLPT_Vocabulary` (README: "licenced under Creative Commons BY by Jonathan Waller"; the repository's own
  parsing code is MIT) and a Wayback snapshot of `www.tanos.co.uk/jlpt/` (2026-09-04). The licence statement was **not**
  found on the archived index page in a quick check. Find it on the archived download or "licence" page, or in a
  reuse repository that kept the original text, and quote it with the URL and date in `docs/sources.md`.
  **If it cannot be confirmed, do not use the base list**: run the gap-fill rule for every word (task 3 covers it).
- Downloaded files and archived pages are untrusted data: each in its own new directory; do not run anything from them.
- Pin the base list's source (release tag or Wayback timestamp) and record a SHA-256 of each downloaded file in
  `plugins/data/UPSTREAM.sha256` (existing file).

## Tasks

1. **Evidence and fixtures.** Download the pinned base list (N5–N1 vocabulary with readings), write the licence
   quote into the notes, add a small synthetic fixture (20 words across levels, a kana-only word, a word with
   two readings, a word JMdict does not know). Test: `scripts/prepare-jlpt-words.test.mjs` fails without the script.
2. **Matching** (`scripts/prepare-jlpt-words.mjs`, pure function + CLI): match each base-list word to a JMdict
   entry by written form **and** reading (the same `{form, reading}` the HSK pack uses); report per level:
   matched, unmatched (with the first 20), ambiguous (two entries). Unmatched words are listed in
   `plugins/data/jlpt-words/UNMATCHED.tsv` (reviewable, deterministic order), never silently dropped.
3. **Gap fill and fallback.** A word with no base-list level gets: for a word with kanji, the **hardest** (highest
   N number to lowest) estimated level among its kanji from `jlpt-kanji`, combined with the Jiten rank thresholds;
   a kana-only word by frequency alone. Thresholds are named constants with the evaluation numbers in a comment.
   Calibrate on the base list with a **20 % holdout**, report accuracy per level and overall; when no base list is
   available (licence not confirmed), calibrate on the kanji levels of the words that have them and say so in the
   notice. Test cases: each rule, determinism (byte-identical output on re-run), a missing Jiten pack → clear
   failure.
4. **Pack.** Write `plugins/data/jlpt-words/{manifest.json, levels.json, LICENSE, ATTRIBUTION.md, UNMATCHED.tsv}`:
   scheme name "JLPT words (approximate)", levels named "≈ N5" … "≈ N1" (the `≈` is part of the name, as for the
   kanji; check the badge text stays readable), `unit: "word"`. Notice: base list credit as its licence requires,
   Jiten credit (CC BY-SA 4.0), "no official list since 2010, this is an estimate".
5. **App and tests.** Seed registers the pack (`bundled_packs_test.go` expects the new counts), the level
   sessions and badges show it; update the web tests, fixtures and strings that count bundled schemes; a re-seed of
   an existing database adds the scheme (the levels importer handles a new pack; add a test for a changed pack
   with the same id).
6. **Docs.** `docs/sources.md` (Waller, Jiten use, evaluation numbers), `LICENSING.md` (the pack is CC BY-SA 4.0),
   `plugins/data/README.md`, wiki Data-and-licences, ROADMAP.
7. **Verify.** `node --test scripts/*.test.mjs`, Go `levels` and `cmd/qinqin` tests, web `check` and `test`;
   merge `origin/develop`, PR into `develop`, CI green.

## Rulings

- Ruling: the pack is **CC BY-SA 4.0** — the gap fill is derived from Jiten's CC BY-SA 4.0 ranks and a CC BY base
  list may sit inside a BY-SA work — if wrong, the pack cannot be combined into a CC BY pack, which nothing needs
  (cost: none today; a later "course pack with words" would not be allowed to embed it, as intended).
- Ruling: the base list's level wins over the estimate for every word it lists, as for the kanji — the base list is
  the better evidence — if wrong, a mislabelled word keeps its level (cost: a word in the wrong unit, fixable by
  the fill rule's topic placement).
- Ruling: words the base list lists with several levels take the **lowest N number** (hardest) like the kanji rule
  for ambiguity — a learner must not be told a word is easier than it is — if wrong, a word shows one level too
  high (cost: a slightly later unit).
- Ruling: unmatched base-list words are reported, not guessed — a wrong dictionary match would put the wrong
  entry on a card — if wrong, a word is missing from the course (cost: a few words; the report shows them).

## Needs human review

The per-level counts and the unmatched list (the owner glances at the numbers: roughly N5 ≈ 800, cumulative N3 ≈
3,700 words is the expected scale for the course); the licence evidence (decision 5 of the overview). No
native-speaker review: the list is an estimate and says so.

## Done when

`GET /api/schemes` lists the pack with ≈ N5–≈ N1 counts; the evaluation per level is in the script comment and
`docs/sources.md`; re-running the script reproduces the files byte for byte; CI green.
