# Grammar Lessons — Design ([#47](https://github.com/Elaktrato/qinqin/issues/47))

Date: 2026-11-15
Status: designed unattended (owner rule: licensing first, then the best experience for the
learner even at higher implementation cost); waiting for the owner's review. Builder check done
(see the end).

## Intent

Language packs carry words, levels and sentences, but nothing explains how the language works.
The owner proposed short grammar lessons inside packs: organised by level, read through with
examples, then practised with exercises built from the pack's own sentences. Content authoring is
separate from code; this design ships the content type, the reader and exercises, and one small
demo pack written for the project, so the feature can be seen and tested.

## Goals

- A `grammar` pack type with a validated schema, imported by `qinqin seed` like other packs, with
  its licence, attribution and notice shown on the Sources page.
- A Grammar page: browse lessons by level for the workspace language, read a lesson (pattern,
  explanation, examples with reading and translation, hover lookup on the target-language text),
  then practise.
- Two exercise types built only from the lesson's own examples: **fill the gap** (choose the
  grammar word) and **word order** (rebuild the sentence, the Word Salad board).
- Per-workspace progress: lesson done, best score.
- A demo pack, `zh-grammar-demo`: 10 Chinese A1 lessons, 40 example sentences, written for this
  project and released under CC0.

## Non-goals

- Spaced repetition of grammar (no FSRS cards, no review events) and no automatic flashcards from
  lessons. (A word the learner adds from a lookup popup behaves as in the reader, see below.)
- An authoring UI, user-written lessons, markup in lesson text (no HTML, no Markdown), audio.
- Japanese content (the format supports it; no Japanese pack is written now).
- Grammar in the Android client or the sync pull (v0.4.0 can add a collection later).

## Anti-goals

- Bundling or paraphrasing third-party grammar lists. In particular nothing from the HSK
  syllabus's grammar points (语法大纲): the HSK packs' notice states the project includes only
  the word and character lists, and this must stay true.
- A cloze whose wrong options are actually correct (an ambiguous exercise teaches the wrong thing).
- Lesson text rendered as HTML.

## Approaches

1. **New manifest type `grammar`** (chosen): its own data file `lessons.json`, importer, tables
   and API. Lessons are a different shape from levels (memberships of entries) and sentences
   (attached to dictionary entries), have their own levels, and need their own Sources section.
2. **Extend `sentences`**: lessons as a field of a sentences pack. Sentences there attach to
   entries by word and are skipped when the word is unknown; grammar examples are about a pattern,
   not a word. Mixing them makes the sentences importer and Sources row do two jobs.
3. **Extend `levels`**: levels packs are word/character memberships with derived character levels;
   lessons are not members of anything.

- **Ruling: new `grammar` type** — clean importer, own licence row per pack — cost if wrong: one
  more migration and importer than a field would need.
- **Ruling: "sentences in the same pack" means the lesson's own `examples`**, not rows of a
  sentences pack. Exercises use only them — the author checked each sentence shows the point —
  cost if wrong: a later option to also pull sentences by word.

## Pack format

`manifest.json`: the existing fields, `type: "grammar"`, `format: "json"`; `notice` is validated,
stored and shown. Data file `lessons.json`:

```json
{
  "levels": [
    {"id": "a1-1", "name": "A1 · Part 1",
     "schemeLevels": [{"scheme": "hsk-words", "level": "HSK 1"}]}
  ],
  "lessons": [
    {"id": "shi", "level": "a1-1", "title": "是: A is B", "summary": "Link two nouns.",
     "pattern": ["A + 是 + B"],
     "body": ["是 (shì) links two nouns…", "To negate it…"],
     "examples": [
       {"id": "shi-1", "text": "我是学生。", "reading": "wǒ shì xuéshēng.",
        "translation": "I am a student.", "focus": "是", "distractors": ["很", "在"]}
     ]}
  ]
}
```

Rules, checked at import (the whole pack is rejected with the offending path):
- `levels`: 1–50, ids `^[a-z0-9]+(-[a-z0-9]+)*$` unique, `name` non-empty; order is difficulty
  order. `schemeLevels` optional: `scheme` is a levels-pack id, `level` a level name in it; it only
  adds a badge ("≈ HSK 1") when that scheme is installed, and never fails the import.
- `lessons`: 1–500, ids as above unique in the pack, `level` one of `levels`; order inside a level
  is array order. `title` ≤ 120 chars, `summary` ≤ 300, `pattern` 0–5 lines ≤ 120, `body` 1–20
  paragraphs ≤ 2,000 chars, plain text only.
- `examples`: 1–20 per lesson, ids unique in the pack; `text` and `translation` required, `reading`
  optional (≤ 500 chars each). `focus` optional and must occur in `text`; `distractors` optional,
  0–4 (so at most 5 choices, keys 1–5), each non-empty, different from `focus` and from each other.
- **Ruling: language-neutral field names** (`text`/`reading`, not the sentences pack's
  `hanzi`/`pinyin`) — the type is for every language — cost if wrong: none.
- **Ruling: distractors are authored per example, never generated** — a generated wrong option is
  often grammatical (今天不冷 → 今天很冷); a cloze appears only when `focus` and at least 2
  distractors exist — cost if wrong: authors write a little more.

## Level taxonomy

- **Ruling: each pack declares its own ordered levels; `schemeLevels` optionally relates a level to
  an installed level scheme** — grammar progressions differ from vocabulary lists, a pack works
  without any scheme, and the cross-reference reuses the existing scheme ids — cost if wrong:
  browsing by a scheme instead of the pack's levels needs a grouping toggle later.
- The demo uses two levels, "A1 · Part 1" and "A1 · Part 2" (CEFR A1 named as a common reference
  level), each with `schemeLevels: [{scheme: "hsk-words", level: "HSK 1"}]`. The pack notice says
  these are the author's own estimates, not taken from any syllabus.

## Server

- `dict.TypeGrammar = "grammar"`; seed import order after sentences (no entry dependency).
- Migration `026_grammar.sql`: `grammar_packs(id, pack_id UNIQUE, name, version, language,
  license, attribution, notice, levels_json, updated_at, deleted_at)` and `grammar_lessons(id,
  pack_id → grammar_packs.id, lesson_id, level_id, ord, title, summary, content_json, updated_at,
  deleted_at, UNIQUE(pack_id, lesson_id))`. Re-import replaces the pack's lessons in one
  transaction (soft-delete missing, upsert the rest); an unchanged pack writes nothing.
- `internal/grammar`: `Import(ctx, db, pack) (Result, error)`, `ListPacks(ctx, db, language)`,
  `Lesson(ctx, db, packID, lessonID)`.
- Routes (public, like `/api/schemes`): `GET /api/grammar?language=zh` → packs with credits, levels
  and lesson summaries (`id, level, title, summary, examples` count); `GET /api/grammar/{pack}/
  {lesson}` → the full lesson plus pack credits, 404 when unknown.
- `plugins.go` lists grammar packs as data plugins; `warnStalePackTerms` checks `grammar_packs`;
  `qinqin-grammar` is registered as a built-in feature plugin (for its progress rows).

## Web

Feature plugin `qinqin-grammar`, page `/p/grammar` (nav "Grammar"), files in
`apps/web/src/lib/plugins/grammar/`.

```
Grammar · 中文                                   (no pack → "No grammar lessons for this
A1 · Part 1   ≈ HSK 1                             language yet." + link to Sources)
  ✓ 是: A is B            Link two nouns.      8/8
  ✓ 不: not               Negate verbs…        6/8
    吗: yes/no questions  …
A1 · Part 2   ≈ HSK 1
    …
Demo content · CC0 · Written for qinqin
```

- **Lesson** `/p/grammar/<pack>/<lesson>`: title, pattern lines in a box, body paragraphs, examples
  (text large, reading and translation below; a toggle hides readings, remembered per browser),
  hover and selection lookup through the reader's `LookupController` over the pattern lines, body
  paragraphs and example texts (each rendered `<p data-p={i}><span data-r="0">` as `dom.ts`
  expects, one runs model `[{text}]` per paragraph; English around Chinese simply finds nothing),
  previous/next lesson, credits footer, **Practice**.
- **Practice** `/p/grammar/<pack>/<lesson>/practice`: fill-the-gap for every example with a cloze,
  in example order, then word order for every example, shuffled with seed `<lessonId>`. Fill the
  gap shows the sentence with `focus` (its first occurrence) blanked and the choices
  `[focus, …distractors]` shuffled, keys 1–5; a wrong pick marks it and shows the right one.
  Word order reuses the Word Salad board, translation visible (tier 0). Each exercise is right
  when solved on the first try. Summary: score, Retry, Back to lesson, Next lesson.
- **Ruling: extract `WordSaladBoard.svelte` from `SentenceCard.svelte`** (tiles, check, give up;
  reports `{wrongChecks, gaveUp}`) and use it in both — reuse without dragging flashcard types into
  grammar — cost if wrong: a regression in Word Salad, guarded by keeping its tests green.
- **Ruling: lookup popups keep the reader's "+" add-to-study**, which saves the example the word
  was found in as the card's own sentence — the learner's explicit action, as in the reader; the
  content is the pack's and its licence travels with the pack — cost if wrong: pass
  `studyWorkspaceId = null` to hide it.
- **Ruling: lessons follow the reader's script setting** (`prefs.ts` variant, `variants.ts`
  `convertText`): `convertLesson(lesson, variant)` converts text, focus, distractors, pattern and
  body once at load, before tiles are cut and the gap is found — cost if wrong: one pure function.
- **Ruling: a grammar pack the user disables in Settings → Data plugins is hidden from the Grammar
  page** (`pluginEnabled(packId, states)`); there is no uninstall route in v1 (re-seeding replaces
  a pack) — cost if wrong: an admin route like `DELETE /api/admin/sentences/{pack}` later.
- Progress: plugin data `qinqin-grammar`, workspace-scoped, key `lesson:<packId>:<lessonId>` →
  `{completedAt, best, total}`; written when a practice run ends, `best` only grows.
- **Ruling: no SRS and no activity-heatmap source in v1** — keeps scope tight — cost if wrong: an
  `ACTIVITY_SOURCES` entry later.
- Sources page: a "Grammar lessons" table (pack, language, version, licence, attribution, notice)
  from `GET /api/grammar` with no language filter.

## Demo pack `plugins/data/zh-grammar-demo`

- Manifest: name "Chinese grammar demo (A1)", version "1.0", `license: "CC0-1.0"`,
  `attribution: "Demo content written for qinqin by the project; CC0 1.0"`, a notice saying it is
  demo content, the explanations and sentences are original, and the level estimates are the
  author's own. `ATTRIBUTION.md` with the CC0 1.0 dedication link; listed in `docs/sources.md`.
- **Ruling: bundled in `plugins/data`** (seeded by default) — original CC0 content has no licence
  risk and the feature is invisible without a pack — cost if wrong: move it to `plugins/samples`.
- Lessons (Part 1): 是; 不; 吗; 很 + adjective; 的. (Part 2): 也/都; 个; 在 + place; 有/没有; 了.
  Four examples each, every one with `focus` and two distractors chosen to be ungrammatical in
  that slot; the full text is in the grammar plan (Task 6), written by the designer (not a native
  speaker). **Open point for the owner:** have a fluent speaker read the 40 sentences before
  release; the plan's final review re-checks every distractor. Readings show tone changes as spoken (不是 bú shì, 一个 yí ge).

## Testing

Go: validation table tests for every rule above, import/re-import/no-op/lesson removal, API status
codes, the bundled demo pack imports cleanly. Web: exercise building (cloze parts, choices,
order, seed stability), progress parsing and best-only-grows, browse grouping and badges, the
board extraction keeps the Word Salad tests passing, `check-sources` passes.

## What is left to the builder

Styling, exact copy beyond the strings above, focus handling details.

## Builder check

A fresh subagent read this document against the code. Settled here as my calls: the plan holds
the demo text; distractors capped at 4 (keys 1–5); popups keep add-to-study; lookup covers
pattern, body and examples; lessons follow the script setting; disabled packs are hidden, no
uninstall route. Left for the owner: a fluent speaker's read of the demo sentences.
