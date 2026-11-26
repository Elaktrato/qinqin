# Chinese and Japanese course skeletons and reading texts — plan (issue #223)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage C, content). Design: courses design §5, §9.
Needs #220 (topic list and labels), #221 (format, fill rule and its report). Content licence: **CC BY 4.0,
project-written**. Our own selection and order: **not copied** from a textbook, the HSK syllabus or JLPT books
(the same rule as the grammar lessons). Builder: one agent per language, in parallel; branches
`content/v090-course-zh` and `content/v090-course-ja` from `develop`. No code except small validation scripts.

## What is written (per language)

`plugins/data/course-<lang>/course.json` (the skeleton) and `texts/<id>.json` (one per unit), in the format of #221.

- **Sections:** Chinese 0, ≈ HSK 1, 2, 3, 4; Japanese 0, ≈ N5, N4, N3. Section 0 = sounds (pinyin and tones /
  the Japanese sound system), the first script steps (kana; the first simple hanzi) and the base of Starter mode
  (#214: unit 0 points to the Starter set, it does not copy words).
- **Units**, 10–20 per section (target: Chinese 0:6, HSK1:12, HSK2:14, HSK3:16, HSK4:18 ≈ 66 units; Japanese 0:8,
  N5:14, N4:16, N3:18 ≈ 56). Each: id, theme (1–2 topic ids from `topics.json`), 1–2 grammar lessons by id **from
  the shipped grammar packs** (`zh-grammar`, `ja-grammar`; the lessons must exist: a validation script checks the
  ids), `chars` (the hanzi/kanji the unit introduces, cumulative across the section), a text id, an optional
  listening/speaking focus (ignored while those card kinds do not exist).
- **Script milestones:** all hiragana by unit `s0.uXX`, katakana by `s1.uXX`, the first 100 / 300 / 1,000 hanzi or
  kanji by units chosen so the counts are true (checked by script from `chars`). Stored in `script` of `course.json`
  (#221), consumed by #225.
- **Reading texts:** one per unit, a few sentences (section 0–1) to a short dialogue or paragraph (later). Words
  of the text must be from **this and earlier units' filled words** plus at most 5 glossed new words (`glossed`).
  Texts are checked by the coverage rule (the reader's coverage measure, #68): ≥ 92 % of tokens at or below the
  unit's level and ≥ 85 % from words already met in the course order; below that → revise.

## Tasks

1. **Skeleton draft:** an agent drafts `course.json` from `topics.json`, the grammar pack lesson lists and the
   frequency order of hanzi/kanji (our own order; no external syllabus). Validation script
   `scripts/check-course.mjs` (schema; unique ids; topics exist; grammar lesson ids exist; `chars` introduced once
   per section and not before the first unit; counts for script milestones; every section's level names exist in
   the level pack manifests).
2. **Fill check:** run #221's fill rule through the admin report on the real level packs and labels. Targets per
   section: `unplaced = 0`, `overflow < 3 %`, `unlabelled` reported, `unreadiable < 2 %`, lessons 5–7 words. Fix
   units the rule cannot fill well (too few words for a theme → merge or retheme; levels mixed → check `chars`).
   Commit the final report under `docs/superpowers/specs/2026-11-26-course-fill-report-<lang>.md`.
3. **Texts:** draft by units in batches (subagent tasks, one text per prompt with the unit's allowed words);
   `scripts/check-course-texts.mjs` runs the coverage rule and reports per text; revise until the thresholds hold.
4. **Section 0** by hand-checking: pinyin/tones or kana lessons refer to the writing-system trainer (#204) and
   Starter set ids that exist.
5. **Review packet for the owner:** a readable export (`scripts/export-course-review.mjs` → Markdown, per section:
   unit list with themes, grammar, characters, the text and the first lesson's words) in the scratchpad or
   `docs/superpowers/specs/`, **not** committed as data. The owner reviews; fixes go back into `course.json`.
6. **Pack files:** `manifest.json` (type `course`, language, version, licence `CC-BY-4.0`, notice), `LICENSE`
   (verbatim legal code, as for other CC BY 4.0 packs), `ATTRIBUTION.md`; `humanReviewed: false` in the manifest
   until the owner marks it; `check-sources` rule (no level-list words in any file, see #221).
7. **End-to-end:** with #222's player (or only the route), a learner can open unit 1 of each language, the filled
   words and the text show; the Go seed test loads both packs; both courses appear in `GET /api/courses`.
8. **Docs:** `docs/sources.md`, `LICENSING.md` (the course packs), wiki, ROADMAP.

## Rulings

- Ruling: **our own order** of units and characters — a copy of a syllabus or textbook would raise licence questions
  and the owner excluded it — if wrong, a learner may meet a character in a different order than in their textbook
  (cost: none functional; the fill rule and the reading lessons carry readings).
- Ruling: texts may contain **at most 5 glossed new words** and must pass the coverage thresholds — the reader
  already measures coverage, so the rule is checkable — if wrong, a text is too hard or too easy for its unit
  (cost: it is rewritten; the check runs in CI).
- Ruling: `humanReviewed: false` stays until the owner says otherwise, and the release notes state that texts
  were not native-reviewed — consistent with the grammar lessons — if wrong, a text has an unnatural phrase
  (cost: learner feedback; the Sources page says so).

## Needs human review

**The owner reviews both skeletons and a sample of texts** (the review packet). **Native-speaker review of the
reading texts is planned only during the owner's own use**, as for the grammar lessons, and the course is
labelled accordingly. Do not claim the texts are checked by a native speaker.

## Done when

Both course packs are in `plugins/data`, validation and coverage scripts pass in CI, the fill report meets the
targets (or the remaining misses are listed), the owner has reviewed the skeletons, and both courses load on a
fresh server.
