# Chinese grammar pack — full HSK 3.0 alignment (design)

Date: 2026-11-18
Issues: [#111](https://github.com/Elaktrato/qinqin/issues/111), [#112](https://github.com/Elaktrato/qinqin/issues/112)–[#118](https://github.com/Elaktrato/qinqin/issues/118)
Status: design, waiting for the owner's approval.

## Intent

Replace the ten-lesson demo (`plugins/data/zh-grammar-demo`) with a real Chinese grammar
pack. The pack follows the grammar outline (语法大纲) of the official 《HSK 考试大纲》
(Syllabus for the Chinese Proficiency Test, 2025-11 / effective 2026-07, CLEC/CTI) level by
level. Every syllabus row is covered by a lesson; every lesson has 4–8 examples. The lessons,
their grouping and order, the explanations, the example sentences, the readings, the
translations and the exercise answers are written for qinqin. No text from the syllabus is
reproduced.

The owner's decisions, 2026-11-18:

- One new pack, `plugins/data/zh-grammar`; the demo is deleted (layout B).
- The syllabus's per-band topics are the scope, used exactly: coverage follows the grammar
  outline's rows. The old "nothing from the grammar outline" rule in #111 is superseded for
  this pack; the notices and the Sources page say what is used and how.
- Every syllabus item gets a lesson with 4–8 examples. Each lesson also carries 1–2
  **contrast** examples whose focus is a similar point (not the lesson's own point), and
  every cloze gets at least one clearly wrong option next to the similar-point options.
- The pack ships marked "not reviewed by a native speaker" until a fluent speaker reviews it.

## Goals

- 7 levels: ≈ HSK 1, 2, 3, 4, 5, 6 and 7–9, each with its own `schemeLevels` badge.
- One lesson per syllabus 细目 row. A row that bundles a list of members (pronouns, numerals,
  particles, measure words) is one lesson: its examples cover the row's contrasts and its body
  names the members. A row that is genuinely several constructions (HSK 7–9 四字格, fixed
  patterns, discourse markers; a few HSK 1–3 rows such as 语气助词 and 趋向补语) is split into
  pattern-family lessons, and the coverage index maps the row to each. The row count is about
  48 (HSK 1), 61 (HSK 2), 56 (HSK 3), 46 (HSK 4), 39 (HSK 5), 30 (HSK 6) and 55–65 (HSK 7–9);
  the final, reviewed list is the pack's coverage index. The pack limit is 500 lessons, so the
  count fits.
- 4–8 example sentences per lesson, each with reading and translation. Every example has a
  `focus` and 2–4 authored distractors, so every example yields both a fill-the-gap and a
  word-order exercise.
- At least 1–2 contrast examples per lesson: the focus is a related point (for example 过 in a
  lesson about 了), and the body explains the difference. At least one distractor in every
  cloze is clearly wrong in that slot; the rest are similar points that are also wrong there.
- A coverage index (`COVERAGE.md` in the pack) maps every syllabus row to its lesson id, so a
  reviewer can check completeness without the PDF.
- The pack imports with `qinqin seed`, the Grammar page browses it, the Sources page shows its
  credits, and the syllabus is named as a source in the manifest, `docs/sources.md`, the
  README's HSK note and the Sources page's grammar note.

## Non-goals

- A new grammar schema, new exercise types, audio, SRS cards, or an authoring UI.
- Japanese grammar (the Japanese pack keeps its own design and review).
- Copying the syllabus's explanatory text, task descriptions or word lists into this pack.
- Machine-checking vocabulary against `hsk-words` (Chinese word segmentation makes a strict
  check unreliable); the author keeps examples within the level's vocabulary by hand and
  records the policy in `ATTRIBUTION.md`.
- Claiming native-speaker review. The pack says it has not had one.

## Anti-goals

- A lesson that is a renamed syllabus table (the point must be taught, with examples).
- A cloze whose wrong options are actually correct in that sentence.
- A level labelled "official HSK 3 grammar". Levels are estimates; the badge is "≈ HSK N".
- Reproducing the syllabus's prose or its long lists verbatim in lesson bodies. The coverage
  index names rows; the lessons teach them in qinqin's words.

## Conflict with #111, resolved by the owner

#111 and the grammar design said "nothing from the HSK syllabus's grammar points" and the HSK
packs' notices promised only the word and character lists. The owner has overridden that for
this pack: the syllabus's grammar outline is used as the **scope** and cited as a source; the
content stays original. The following wording changes are part of the work:

- `zh-grammar` manifest `attribution` and `notice` name the syllabus, its URL, publisher,
  edition and PDF SHA-256, and say "topic coverage follows the grammar outline; lesson
  grouping, order, explanations, examples and exercises are qinqin's own; no syllabus text is
  reproduced; the syllabus grants no reuse licence".
- `docs/sources.md` gets a "Chinese grammar (HSK-aligned)" entry and a source note.
- `README.md`'s HSK section no longer says the project includes "none of the syllabus's other
  content (grammar points …)"; it says the grammar pack uses the grammar outline as a topic
  index, with attribution.
- `plugins/data/README.md` gets the new grammar pack row and updates the HSK note.
- `apps/web/src/lib/i18n/messages/en.json` `sources.grammar.notice` no longer says the
  explanations "are not taken from a syllabus"; it says a pack may follow a syllabus's topic
  outline and that each pack's note states what it uses.
- `hsk-words` and `hsk-chars` manifests and `ATTRIBUTION.md` change "The project includes only
  …" to pack-scoped wording: "This pack includes only the vocabulary/character list … The
  Chinese grammar pack, when installed, is listed separately in the Grammar lessons section."
  `docs/sources.md`'s HSK section and `docs/wiki/Data-and-licences.md` get the same wording.
- `docs/ROADMAP.md` and the pack `ATTRIBUTION.md` record the change.

**Ruling: pack-scoped wording, no runtime detection.** The Sources page shows a pack only when
it is installed, so each notice can speak for its own pack and name what other packs add "when
installed"; the page is accurate in every combination without computing cross-pack text. The
HSK notices stop claiming what the whole project includes. This also covers the language pack
and its dictionary/word list: the dictionary and word-list notices say what each one contains,
and the HSK word list says its readings and badges need the dictionary/level packs only when
those are present. No server or web code inspects active packs to rewrite a notice; the cost of
that is not worth it for these static credits.

## Pack layout

`plugins/data/zh-grammar/`:

- `manifest.json`: `id: "zh-grammar"`, `name: "Chinese grammar (HSK-aligned)"`,
  `version: "1.0"`, `type: "grammar"`, `language: "zh"`, `format: "json"`,
  `license: "CC0-1.0 (the lessons); the HSK 3.0 syllabus is referenced, no reuse licence granted"`,
  attribution/notice as above.
- `lessons.json`: the seven levels and every lesson.
- `ATTRIBUTION.md`: authorship, CC0, syllabus source with URL/edition/SHA-256, the coverage
  policy, pinyin conventions, vocabulary policy, exercise policy, native-review status.
- `LICENSE`: the CC0 1.0 text (moved from the demo).
- `COVERAGE.md`: one table per level, one row per syllabus 细目 row, with the lesson id.
  This is a topic index in our own words, not a copy of the syllabus text.

Levels (ids are stable; names avoid claiming official status):

| id | name | schemeLevels | lessons (target) |
|---|---|---|---|
| `hsk-1` | Level 1 · First sentences | `hsk-words` / `HSK 1` | 48 |
| `hsk-2` | Level 2 · Everyday basics | `hsk-words` / `HSK 2` | 61 |
| `hsk-3` | Level 3 · Getting around | `hsk-words` / `HSK 3` | 56 |
| `hsk-4` | Level 4 · Connected speech | `hsk-words` / `HSK 4` | 46 |
| `hsk-5` | Level 5 · Nuance and attitude | `hsk-words` / `HSK 5` | 39 |
| `hsk-6` | Level 6 · Formal ground | `hsk-words` / `HSK 6` | 30 |
| `hsk-7-9` | Level 7 · Mastery | `hsk-words` / `HSK 7–9` | 55–65 |

The exact counts follow the syllabus's rows, not a quota. If a row bundles several patterns
(for example the HSK 7–9 四字格 row), it is split into one lesson per pattern family only when
one lesson cannot teach the row with 4–8 examples; `COVERAGE.md` then maps the row to more than
one lesson. The total stays under the 500-lesson schema limit.

## Lesson format and content rules

Each lesson follows the existing `lessons.json` format (no schema change):

- `id`: stable, lowercase, hyphenated, derived from the point (for example `hsk1-shi`,
  `hsk2-le-guo`). Unique in the pack.
- `title`: ≤ 120 chars, English and the Chinese point, for example `是: A is B`.
- `summary`: ≤ 300 chars, one sentence.
- `pattern`: 1–3 lines, ≤ 120 chars each, using `A`, `B`, `V`, `N` placeholders and the
  Chinese point.
- `body`: 1–4 paragraphs, plain text, ≤ 2,000 chars each. Explains the point, the contrast
  point where the lesson has one, and one common mistake. No HTML or Markdown.
- `examples`: 4–8 per lesson.
  - `text`: one natural sentence, ≤ 30 characters where possible, ending in Chinese
    punctuation. It contains the `focus` exactly once (the practice code blanks the first
    occurrence; uniqueness keeps the exercise unambiguous).
  - `reading`: Hanyu Pinyin with tone marks, lower case except proper nouns, punctuation kept.
    Tone changes are written as spoken (不是 bú shì, 一个 yí ge); third-tone sandhi is not
    marked (nǐ hǎo); neutral tones are unmarked.
  - `translation`: natural English, matching the sentence.
  - `focus`: the grammar word or pattern tested. For 1–2 examples per lesson it is a **contrast**
    point, not the lesson's own point; the body says so. For the rest it is the lesson's point.
  - `distractors`: 2–4 options, each wrong in that slot, different from the focus and from
    each other. At least one is a similar/contrastive point (for example 过/着 for 了,
    得/地 for 的, 没/别 for 不); at least one is clearly wrong (for example a particle that
    cannot appear there). Never include another correct answer or a paraphrase of the focus.
  - Every example gets a cloze, so every lesson has 4–8 clozes and 4–8 word-order exercises.
- Vocabulary: examples use words from the level's HSK word list and earlier levels where
  possible; a proper noun or a necessary word above the level is allowed but kept rare. The
  policy is stated in `ATTRIBUTION.md`; it is not machine-checked.
- Content is written by the project. No sentence, explanation or exercise is copied or
  paraphrased from a textbook, a website or the syllabus.

## Granularity: what one "syllabus item" is

The syllabus's 细目 rows are the unit. A row such as 疑问代词 (多、多少、几、哪……) or 语气助词
(吧、了、吗、呢……) is one lesson, not one lesson per pronoun or particle: the lesson's 4–8
examples show the row's main contrasts and the body names the remaining members. Making every
listed member its own 4–8-example lesson would exceed the 500-lesson schema cap and turn the
pack into a reference table.

A row is split into several lessons when it contains independent constructions that cannot be
taught together in 4–8 examples: the HSK 7–9 四字格 families, fixed patterns and discourse
markers are the main cases; a few lower-level rows (HSK 1 语气助词, HSK 2 趋向补语, HSK 3
"把"字句1) may also split. `COVERAGE.md` lists the row once and gives every lesson that teaches
it, so a reviewer can see both the row coverage and the split rationale. The target total is
about 340 lessons; it must stay under 500.

## Coverage index

`COVERAGE.md` is the reviewer's completeness check. For each level it lists the syllabus's
categories and 细目 rows in order, with the lesson id (or ids) that teach each row and a
one-line note on the row's scope in our own words. It is not part of the JSON schema. The
author checks it row by row against the PDF before the level is called done; the PDF and any
extracted text stay outside the repository (as the existing HSK converter requires).

## Sources and credits

The syllabus is a source, not the pack's licence:

- Publisher: 中外语言交流合作中心 (CLEC), distributed by Chinese Testing International (CTI),
  <https://www.chinesetest.cn>.
- Title: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test, 2025-11, effective
  2026-07.
- PDF: the URL the owner supplied, SHA-256
  `d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad`.
- Terms: no reuse licence granted; the CTI Legal Notice requires the source to be indicated
  and permits only reasonable, good-faith quoting for informative public use. The pack uses
  the outline as a topic index and reproduces no syllabus text; the legal status of the
  topic index is not verified.

The pack's own text and examples are CC0 1.0. `ATTRIBUTION.md` says both clearly, so the
Sources page does not imply the syllabus is CC0.

The HSK word/character notices are rewritten pack-scoped: "This pack includes only the
vocabulary/character list … The Chinese grammar pack, when installed, is listed separately in
the Grammar lessons section." The Sources page shows each pack only when it is installed, so
the page is true whether or not `zh-grammar`, `cedict` or `hsk-words` is present. No code
detects active packs to rewrite a notice; the static pack-scoped sentence is the whole
mechanism. This also covers the language pack and its dictionary/word list: the dictionary and
word-list notices say what each contains and what it adds when the other is installed.

## Demo removal

`plugins/data/zh-grammar-demo` is deleted, not kept as a sample. Consequences:

- `server/internal/grammar/bundled_test.go` targets `zh-grammar`, checks the seven levels,
  the total lesson count, every example's reading/focus/cloze, and imports the pack.
- `server/cmd/qinqin/seed_notice_test.go` drops `zh-grammar-demo` and adds `zh-grammar` to
  the notice list.
- `docs/sources.md`, `plugins/data/README.md`, `README.md` and `docs/ROADMAP.md` replace the
  demo entry with the new pack.
- `apps/web/src/lib/plugins/grammar/route.test.ts` and other tests that use the demo id only
  as a string are updated to `zh-grammar` for clarity; fixtures under
  `docs/contracts/packages/` are API fixtures, not a list of bundled packs, and stay as they
  are unless a test fails.
- No web code change is expected: the Grammar page already groups by pack level, shows the
  `≈ HSK N` badge only when `hsk-words` is installed, and renders every lesson. The build
  verifies a ~60-lesson level and the full pack; if the page becomes unusable, a level jump
  list is added as a small follow-up, not a schema change.

There is no removal migration: the project has no existing databases or users (owner's call,
2026-11-18). `qinqin seed` imports packs and never uninstalls a pack whose directory disappears,
so a database seeded before this change would keep the demo; that is accepted because no such
database is in use. Fresh seeds get only `zh-grammar`. If the project gains installations before
this ships, add a one-time cleanup then; it is not part of this work.

## Approaches considered

1. **Grouped lessons with a coverage matrix** (around 120 lessons, 2–4 rows each): more
   coherent teaching, fewer examples, easier review. Rejected because the owner asked for
   every syllabus item with 4–8 examples of its own.
2. **One lesson per syllabus row** (chosen): literal coverage, each point gets 4–8 examples,
   the coverage index is simple, and the pack stays under the schema limits. Cost: about 300+
   lessons and 1,500–2,000 examples, a long authoring job; mitigated by level-by-level
   authoring and validation.
3. **Reuse the demo pack id** and replace its content: least churn in tests, but the id lies
   about the content and the demo's A1 levels do not fit seven HSK bands. Rejected.

Exercise approaches:

1. **Only the lesson point, clearly-wrong distractors** (the demo's policy): simple, but it
   does not teach discrimination between near points, and the owner asked for contrast.
2. **Related-point distractors plus 1–2 contrast examples** (chosen): the learner must choose
   between 了/过/着, 的/得/地, 不/没/别 and similar pairs; each lesson still teaches its own
   point. Cost: more authoring care; every distractor must be checked as wrong in that slot.
3. **Generated distractors**: rejected in the grammar design and still rejected; generated
   options are often grammatical.

## What is left to the builder

- The exact lesson list and the per-row wording of `COVERAGE.md`, derived from the syllabus.
- The authored sentences, readings, translations, bodies and distractors.
- The final native-speaker review (not done in this work; the pack stays marked unreviewed).
- Styling and any Grammar page adjustment if a full pack exposes a browsing problem.
