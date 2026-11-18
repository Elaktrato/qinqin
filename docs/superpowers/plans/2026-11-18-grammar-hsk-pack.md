# Chinese Grammar Pack (HSK-Aligned) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ten-lesson Chinese grammar demo with a complete `zh-grammar` pack whose lessons cover every row of the HSK 3.0 grammar outline, with 4–8 examples per lesson and contrastive exercises.

**Architecture:** Authored per-level JSON fragments under `plugins/data/zh-grammar/authored/` are merged by a validated Node script into the shipped `lessons.json` and a reviewable `COVERAGE.md`. The existing grammar schema, importer, Grammar page and exercises are reused unchanged. The demo pack is deleted at cutover; there is no migration (no existing databases).

**Tech Stack:** Go 1.x server (`server/`), SvelteKit 5 web app (`apps/web/`), Node 22 ESM authoring scripts (`scripts/`), JSON grammar packs (schema in `server/internal/grammar/schema.go`).

**Spec:** `docs/superpowers/specs/2026-11-18-grammar-hsk-pack-design.md`

## Global Constraints

- Seven levels, exactly: `hsk-1` "Level 1 · First sentences", `hsk-2` "Level 2 · Everyday basics", `hsk-3` "Level 3 · Getting around", `hsk-4` "Level 4 · Connected speech", `hsk-5` "Level 5 · Nuance and attitude", `hsk-6` "Level 6 · Formal ground", `hsk-7-9` "Level 7 · Mastery". Each maps to `hsk-words` levels `HSK 1` … `HSK 7–9` (en dash in the last one).
- Syllabus row counts: 48, 61, 56, 46, 39, 30, 27. These are floors, not caps: a level may author extra rows if the PDF has more; `--complete` requires every row up to the floor and allows more. One lesson per 细目 row; rows that are several independent constructions may split into pattern-family lessons (HSK 7–9 mainly), and `COVERAGE.md` maps the row to every lesson. Total lessons between 307 and 500.
- Every lesson has 4–8 examples. Every example has a non-empty `reading`, `translation`, `focus`, and 2–4 `distractors`. `focus` occurs exactly once in `text`. Distractors are distinct, never equal the focus, and every one is wrong in that slot.
- Every lesson has 1–2 **contrast** examples: `focus` is a related point, not the lesson's own point, and the body explains the contrast. Every cloze has at least one clearly wrong distractor and at least one similar/contrastive distractor where one exists.
- Lesson text is plain text. No HTML, no Markdown. `title` ≤ 120 chars, `summary` ≤ 300, `pattern` 1–3 lines ≤ 120, `body` 1–4 paragraphs ≤ 2,000 each.
- Pinyin: tone marks; lower case except proper nouns; punctuation kept. Tone changes as spoken (不是 bú shì, 一个 yí ge); third-tone sandhi unmarked (nǐ hǎo); neutral tones unmarked.
- Content is original, CC0 1.0. No sentence, explanation or exercise is copied or paraphrased from a textbook, website or the syllabus. The syllabus is a scope index, cited in the pack credits; no syllabus text is reproduced.
- The pack ships marked "not reviewed by a native speaker". Do not claim review.
- No schema change, no new exercise type, no SRS, no migration. The demo directory is deleted at cutover.
- Keep `node scripts/check-sources.mjs` green: every bundled pack id appears in `docs/sources.md`; every notice follows `dict.ValidateNotice`.

## Review Focus

1. **A distractor that is actually correct in the slot** — a wrong option teaches the wrong grammar. Test: Task 2's sample-review step reads ten examples per level and checks every distractor.
2. **A contrast example the body does not explain** — the learner cannot tell why the focus is not the lesson point. Test: the build script requires 1–2 contrast examples; the Task 2 sample review checks the body names the contrast.
3. **Pinyin or tone errors, or a focus occurring twice** — the cloze blanks the first occurrence and the answer check relies on uniqueness. Test: `build-grammar-pack` rejects focus counts ≠ 1; the sample review reads the pinyin aloud.
4. **A syllabus row with no lesson or a lesson mapped to the wrong row** — “every item” is the promise. Test: the build script requires every row in every authored fragment and `--complete` requires all seven levels; `COVERAGE.md` is reviewed row by row.
5. **The full pack making the Grammar page or API unusable** — ~340 lessons and ~1,700 examples. Test: the web browse test with 7 × 50 lessons and the final pack import test; the Task 10 smoke test opens `/p/grammar` and one lesson.
6. **The Sources page contradicting itself about the syllabus** — the HSK word/character notices used to say no grammar points are included. Test: `check-sources` plus `TestCommittedPackNotices` and a manual Sources page read in Task 9.

## File Structure

**Create**
- `scripts/prepare-hsk-grammar.mjs` — extract the grammar outline rows from `pdftotext -tsv` into per-level JSON for authors.
- `scripts/prepare-hsk-grammar.test.mjs` — unit test for the extractor.
- `scripts/build-grammar-pack.mjs` — validate authored fragments, render `lessons.json` and `COVERAGE.md`.
- `scripts/build-grammar-pack.test.mjs` — unit tests for the validator and renderer.
- `plugins/data/zh-grammar/manifest.json` — pack credits and notice.
- `plugins/data/zh-grammar/LICENSE` — CC0 1.0 text (copy of the demo's).
- `plugins/data/zh-grammar/ATTRIBUTION.md` — authorship, syllabus source, SHA-256, policies.
- `plugins/data/zh-grammar/authored/hsk-1.json` … `hsk-7-9.json` — authored content (the reviewable source).
- `plugins/data/zh-grammar/lessons.json` — generated, committed.
- `plugins/data/zh-grammar/COVERAGE.md` — generated, committed, one row per syllabus row.

**Modify**
- `server/internal/grammar/bundled_test.go` — replace the demo test with the full-pack test.
- `server/cmd/qinqin/seed_notice_test.go` — `zh-grammar` notice; drop `zh-grammar-demo`.
- `apps/web/src/lib/plugins/grammar/browse.test.ts` — full-pack grouping test.
- `apps/web/src/lib/plugins/grammar/route.test.ts` — demo id → `zh-grammar` in the string fixture.
- `docs/sources.md`, `plugins/data/README.md`, `README.md`, `docs/wiki/Data-and-licences.md`, `docs/ROADMAP.md` — credits and pack-scoped wording.
- `apps/web/src/lib/i18n/messages/en.json` — `sources.grammar.notice`.
- `plugins/data/hsk-words/manifest.json`, `plugins/data/hsk-words/ATTRIBUTION.md`, `plugins/data/hsk-chars/manifest.json`, `plugins/data/hsk-chars/ATTRIBUTION.md` — pack-scoped HSK notices.

**Delete**
- `plugins/data/zh-grammar-demo/` (at cutover, Task 9).

## Reusable authoring procedure

Every level task below uses this procedure with its own outline file and row count.

1. Read `docs/superpowers/specs/2026-11-18-grammar-hsk-pack-design.md`, the level's outline JSON from Task 1, and the existing demo `plugins/data/zh-grammar-demo/lessons.json` for tone (until it is deleted).
2. Author the level into `plugins/data/zh-grammar/authored/<level>.json` in the wrapper format:
   ```json
   {"level": "hsk-1", "rows": [
     {"row": 1, "label": "Prefixes 小- and 第-",
      "lesson": {"id": "hsk1-prefixes", "level": "hsk-1", "title": "…", "summary": "…",
        "pattern": ["…"], "body": ["…"],
        "examples": [{"id": "hsk1-prefixes-1", "text": "…", "reading": "…",
          "translation": "…", "focus": "…", "distractors": ["…", "…"],
          "contrast": false, "kinds": ["similar", "clearly-wrong"]}]}}
   ]}
   ```
3. Every `rows` entry has one `row` number from the outline. A split row appears more than once with the same `row` and a different `label`/lesson, and the split scopes together cover the row.
4. Write in batches of 10–15 lessons; after each batch run `node scripts/build-grammar-pack.mjs --check` and fix every error before continuing. `contrast` and `kinds` are authoring metadata; the build script strips them.
5. When the whole level is written, run `node scripts/build-grammar-pack.mjs` to regenerate `lessons.json` and `COVERAGE.md`.
6. Run `cd server && go test ./internal/grammar -run TestBundledGrammarPack` and fix any import failure.
7. Commit the authored fragment, generated pack and coverage file together.

## Task 1: Authoring tooling

**Files:**
- Create: `scripts/prepare-hsk-grammar.mjs`, `scripts/prepare-hsk-grammar.test.mjs`
- Create: `scripts/build-grammar-pack.mjs`, `scripts/build-grammar-pack.test.mjs`

**Interfaces:**
- Consumes: `pdftotext -tsv` output of the syllabus PDF (download commands in Appendix A).
- Produces:
  - `parseGrammarTsv(text: string): { levels: { name: string, rows: { row: number, category: string, subcategory: string, item: string, content: string[] }[] }[] }`
  - `LEVELS` (array of `{ id, name, schemeLevel, rows }`, values in Global Constraints).
  - `buildGrammarPack({ authoredDir, outDir, levels = LEVELS, check = false, complete = false }): { rows: number, lessons: number }`
  - CLI: `node scripts/build-grammar-pack.mjs [--check] [--complete] [--authored <dir>] [--out <dir>]`; defaults `plugins/data/zh-grammar/authored` and `plugins/data/zh-grammar`.

- [ ] **Step 1: Write the failing extractor test**

In `scripts/prepare-hsk-grammar.test.mjs`, call `parseGrammarTsv` with a tiny TSV whose header is the `pdftotext -tsv` header and whose words are one level heading (`HSK（一级）语法`), one item (`方位名词` at x 220), one content line (`上、下、里、外、前、后` at x 350), one watermark glyph (`汉`, height 48) and one page number (`1`). Assert: one level named `HSK 1`; one row `{row: 1, category: '', subcategory: '', item: '方位名词', content: ['上、下、里、外、前、后']}`; the watermark and page number are absent.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/prepare-hsk-grammar.test.mjs`
Expected: FAIL, `parseGrammarTsv is not a function` (or the module cannot be imported).

- [ ] **Step 3: Implement the extractor**

Group words by `(page_num, top)`; drop glyphs taller than 30 (the watermark); drop header/footer lines and bare page numbers; map `HSK（一）语法` … `HSK（七—九）语法` to `HSK 1` … `HSK 7–9`; assign columns by `left` (`<105` category, `<195` subcategory, `<285` item, else content); carry the current category/subcategory/item forward; start a new row when the item changes or a content line appears; number rows 1..N per level in page/top order. Do not commit the PDF or the TSV.

- [ ] **Step 4: Run the extractor test to pass**

Run: `node --test scripts/prepare-hsk-grammar.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing build-script tests**

In `scripts/build-grammar-pack.test.mjs`, use a two-row fixture level `[{id:'x', name:'X', schemeLevel:'HSK 1', rows:2}]` and a valid `authored/x.json` with two lessons of four examples each, one contrast example per lesson, and `kinds` including `clearly-wrong`. Assert the valid build returns 2 rows/2 lessons, `renderLessons` has one level and two lessons, and `COVERAGE.md` names both lessons. Then add one case per rejection:
- a lesson with 3 examples;
- a focus that occurs twice in `text`;
- a distractor equal to `focus`;
- two identical distractors;
- a lesson with no contrast example;
- a lesson with two contrast examples when it has only four examples (valid: 1–2; use three to fail);
- a missing row number;
- a duplicate row number with no split label;
- a duplicate lesson id;
- a body containing `<b>`.
Each case asserts the thrown error message names the JSON path (for example `rows[0].lesson.examples[0].focus`).

- [ ] **Step 6: Run them and see them fail**

Run: `node --test scripts/build-grammar-pack.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement the build script**

Read `authored/*.json` in `LEVELS` order. Validate every rule in Global Constraints. During authoring a fragment may cover a subset of its level's rows (batches); `--complete` additionally requires every row 1..`level.rows` to appear at least once, all seven fragments to be present, and the total lesson count 300–500. A row above `level.rows` is allowed (the count is a floor); a split repeats a row with a different label. Also validate: lesson `level` equals the fragment level; ids match `^[a-z0-9]+(-[a-z0-9]+)*$` and are unique across the pack; contrast count is 1–2; `kinds` includes `clearly-wrong` in every example and `similar` wherever a related point exists. On success render:
- `lessons.json`: `{"levels":[...all seven in LEVELS order with schemeLevels], "lessons":[...in level/row/split order]}`
- `COVERAGE.md`: a heading, the source paragraph, then one table per level with columns `#`, `Syllabus row (qinqin's words)`, `Lesson(s)`; a row with no authored lesson yet says `not authored yet`.

`--check` validates and writes nothing. `--complete` additionally requires all seven fragments, every row, and a total of 300–500 lessons. Use 2-space indent and one trailing newline. Error messages name the path, for example `hsk-1 rows[3].lesson.examples[0].distractors[1]: "了" equals focus`.

- [ ] **Step 8: Run the build-script tests to pass**

Run: `node --test scripts/build-grammar-pack.test.mjs`
Expected: PASS.

- [ ] **Step 9: Generate the outlines from the real PDF**

Run the commands in Appendix A. The target row counts are 48, 61, 56, 46, 39, 30, 27. The extractor is an aid: merged cells can shift or hide a label, so the printed counts may differ. Do not hand-edit the authored content; authors cross-check each level against the layout dump and add any missing row.

- [ ] **Step 10: Run the script test suite and commit**

Run: `node --test scripts/*.test.mjs`
Expected: PASS.

```bash
git add scripts/prepare-hsk-grammar.mjs scripts/prepare-hsk-grammar.test.mjs scripts/build-grammar-pack.mjs scripts/build-grammar-pack.test.mjs
git commit -m "feat(grammar): authoring tools for the HSK grammar pack"
```

## Task 2: HSK 1 and the pack skeleton

**Files:**
- Create: `plugins/data/zh-grammar/manifest.json`, `plugins/data/zh-grammar/LICENSE`, `plugins/data/zh-grammar/ATTRIBUTION.md`, `plugins/data/zh-grammar/authored/hsk-1.json`
- Create (generated): `plugins/data/zh-grammar/lessons.json`, `plugins/data/zh-grammar/COVERAGE.md`
- Modify: `server/internal/grammar/bundled_test.go`, `server/cmd/qinqin/seed_notice_test.go`, `docs/sources.md`, `plugins/data/README.md`

**Interfaces:**
- Consumes: `buildGrammarPack`, `LEVELS`, the HSK 1 outline from Task 1.
- Produces: the pack directory; `TestBundledGrammarPack`; a `zh-grammar` entry in the Sources docs and the notice test.

- [ ] **Step 1: Write the manifest**

Use exactly these fields (the notice stays under 4,000 bytes and links only https URLs):

```json
{
  "id": "zh-grammar",
  "name": "Chinese grammar (HSK-aligned)",
  "version": "1.0",
  "type": "grammar",
  "language": "zh",
  "license": "CC0-1.0 (the lessons); the HSK 3.0 syllabus is referenced, no reuse licence granted",
  "attribution": "Chinese grammar lessons written for qinqin; CC0 1.0. Topic coverage follows the HSK 3.0 grammar outline (语法大纲) of the 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test, CLEC/CTI, 2025-11 (effective 2026-07), https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf; used as a scope reference, no syllabus text reproduced. Not reviewed by a native speaker.",
  "format": "json",
  "notice": "Chinese grammar lessons written for qinqin, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).\n\nTopic coverage follows the grammar outline (语法大纲) of the 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test (CLEC/CTI, 2025-11, effective 2026-07; [PDF](https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf)). The lesson grouping and order, explanations, example sentences, readings, translations and exercise answers are qinqin's own; no syllabus text is reproduced. The syllabus grants no reuse licence.\n\nThe levels are qinqin's estimates (\"≈ HSK N\"), not official HSK levels. The content has not been reviewed by a native speaker; corrections are welcome."
}
```

- [ ] **Step 2: Add the licence and attribution**

Copy `plugins/data/zh-grammar-demo/LICENSE` to `plugins/data/zh-grammar/LICENSE`. Write `ATTRIBUTION.md` with: authorship and CC0 1.0; the syllabus title, publisher, edition, URL and SHA-256 `d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad`; what is used (the grammar outline's rows as a topic index only); coverage policy (`COVERAGE.md`, one lesson per 细目 row, splits); pinyin conventions; vocabulary policy; contrast/distractor policy; native-review status; licence split (lessons CC0, syllabus not CC0).

- [ ] **Step 3: Author HSK 1 (rows 1–48)**

Follow the reusable authoring procedure. Author rows 1–16, 17–32 and 33–48 in three batches of 10–16 lessons, running `node scripts/build-grammar-pack.mjs --check` after each batch. Every lesson has 4–8 examples, 1–2 contrast examples and a body paragraph that explains the contrast; every example has at least one clearly wrong distractor. Split 语气助词 into two lessons if six particles cannot be taught in eight examples; the coverage index then lists both lesson ids for that row.

- [ ] **Step 4: Build the level**

Run: `node scripts/build-grammar-pack.mjs`
Expected: writes `lessons.json` and `COVERAGE.md`; prints 48 rows and 48–50 lessons. The file has seven levels, with only HSK 1 carrying lessons at this point.

- [ ] **Step 5: Replace the bundled demo test**

Replace `TestBundledGrammarDemo` in `server/internal/grammar/bundled_test.go` with `TestBundledGrammarPack`:

```go
func TestBundledGrammarPack(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "plugins", "data", "zh-grammar")
	pack, err := dict.LoadPack(dir)
	if err != nil { t.Fatal(err) }
	if pack.Manifest.ID != "zh-grammar" || !strings.HasPrefix(pack.Manifest.License, "CC0-1.0") {
		t.Fatalf("manifest: %+v", pack.Manifest)
	}
	data, err := grammar.ReadData(dir)
	if err != nil { t.Fatal(err) }
	if len(data.Levels) != 7 { t.Fatalf("levels = %d, want 7", len(data.Levels)) }
	if len(data.Lessons) < 48 || len(data.Lessons) > 500 {
		t.Fatalf("lessons = %d, want 48..500", len(data.Lessons))
	}
	for _, l := range data.Lessons {
		if n := len(l.Examples); n < 4 || n > 8 {
			t.Errorf("%s: %d examples, want 4..8", l.ID, n)
		}
		for _, e := range l.Examples {
			if e.Reading == "" || e.Translation == "" || e.Focus == "" || len(e.Distractors) < 2 {
				t.Errorf("%s: incomplete example", e.ID)
			}
			if n := strings.Count(e.Text, e.Focus); n != 1 {
				t.Errorf("%s: focus %q occurs %d times, want 1", e.ID, e.Focus, n)
			}
			seen := map[string]bool{}
			for _, d := range e.Distractors {
				if d == e.Focus || seen[d] {
					t.Errorf("%s: bad distractor %q", e.ID, d)
				}
				seen[d] = true
			}
		}
	}
	sqlDB := newDB(t)
	ctx := t.Context()
	if _, err := grammar.Import(ctx, sqlDB, pack); err != nil { t.Fatal(err) }
	packs, err := grammar.ListPacks(ctx, sqlDB, "zh")
	if err != nil || len(packs) != 1 || packs[0].PackID != "zh-grammar" {
		t.Fatalf("ListPacks = %+v, %v", packs, err)
	}
	for _, summary := range packs[0].Lessons {
		if _, err := grammar.LessonByID(ctx, sqlDB, "zh-grammar", summary.ID); err != nil {
			t.Errorf("LessonByID(%s): %v", summary.ID, err)
		}
	}
}
```

Keep the file's `newDB` helper use; remove the old demo-specific checks.

- [ ] **Step 6: Update the notice test and docs**

In `server/cmd/qinqin/seed_notice_test.go`, remove the `zh-grammar-demo` entry and add:

```go
"zh-grammar": {"CC0 1.0", "grammar outline", "not been reviewed by a native speaker"},
```

In `docs/sources.md` replace the demo grammar entry with a `zh-grammar` entry naming the pack, its CC0 lessons, the syllabus source (title, CLEC/CTI, URL, edition), the "topic index, no text reproduced" statement and the unreviewed status. Keep the pack id in backticks. In `plugins/data/README.md`, add the `zh-grammar` row to the "Committed (small, hand-written, CC0 — a sample)" table with the same facts; the demo row stays until Task 9.

- [ ] **Step 7: Run the checks**

Run: `node scripts/build-grammar-pack.mjs --check`
Expected: PASS, 48 rows.

Run: `node scripts/check-sources.mjs`
Expected: PASS.

Run: `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`
Expected: PASS.

Run: `cd server && go test ./cmd/qinqin -run TestCommittedPackNotices -v`
Expected: PASS.

- [ ] **Step 8: Sample-review HSK 1**

Run the Appendix B checklist on ten HSK 1 lessons (include the split 语气助词 lessons, if any). Fix every wrong distractor, unexplained contrast, tone error or misleading pattern. Record the ten lesson ids in the commit message or a `SAMPLE-REVIEW.md` next to the pack (the file is optional; the record is not).

- [ ] **Step 9: Commit**

```bash
git add plugins/data/zh-grammar server/internal/grammar/bundled_test.go server/cmd/qinqin/seed_notice_test.go docs/sources.md plugins/data/README.md
git commit -m "feat(grammar): Chinese grammar pack with HSK 1"
```

## Task 3: HSK 2

**Level:** `hsk-2` · **Outline:** `outline/hsk-2.json` · **Rows:** 61 · **Lessons:** 61–64 · **Split note:** split 趋向补语1 into simple and compound directions if needed.

Follow the reusable authoring procedure. Author rows 1–61 in batches of 10–15, checking after each batch. Do not skip a row.

- [ ] **Step 1: Author the level fragment** in `plugins/data/zh-grammar/authored/hsk-2.json`, in batches, running `node scripts/build-grammar-pack.mjs --check` after each. Use the outline row numbers exactly; every `label` is your own one-line description.
- [ ] **Step 2: Build and inspect the coverage** with `node scripts/build-grammar-pack.mjs`. Open `COVERAGE.md` and verify every HSK 2 row appears (plus split entries where used).
- [ ] **Step 3: Run the pack test** with `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`. Expected: PASS.
- [ ] **Step 4: Commit** the authored fragment, `lessons.json` and `COVERAGE.md` with `git commit -m "feat(grammar): HSK 2 lessons"`.

## Task 4: HSK 3

**Level:** `hsk-3` · **Outline:** `outline/hsk-3.json` · **Rows:** 56 · **Lessons:** 56–60 · **Split note:** split “把”字句1 into its three form groups if needed.

Follow the reusable authoring procedure. Author rows 1–56 in batches of 10–15.

- [ ] **Step 1: Author the level fragment** in `plugins/data/zh-grammar/authored/hsk-3.json`, checking after each batch.
- [ ] **Step 2: Build and inspect the coverage**; every HSK 3 row appears.
- [ ] **Step 3: Run `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`.** Expected: PASS.
- [ ] **Step 4: Commit** with `git commit -m "feat(grammar): HSK 3 lessons"`.

## Task 5: HSK 4

**Level:** `hsk-4` · **Outline:** `outline/hsk-4.json` · **Rows:** 46 · **Lessons:** 46–48 · **Split note:** split 兼语句2 by its three meanings if needed.

Follow the reusable authoring procedure. Author rows 1–46 in batches of 10–15.

- [ ] **Step 1: Author the level fragment** in `plugins/data/zh-grammar/authored/hsk-4.json`, checking after each batch.
- [ ] **Step 2: Build and inspect the coverage**; every HSK 4 row appears.
- [ ] **Step 3: Run `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`.** Expected: PASS.
- [ ] **Step 4: Commit** with `git commit -m "feat(grammar): HSK 4 lessons"`.

## Task 6: HSK 5

**Level:** `hsk-5` · **Outline:** `outline/hsk-5.json` · **Rows:** 39 · **Lessons:** 39–42 · **Split note:** split 趋向补语3 / 状态补语2 only if eight examples cannot show the uses.

Follow the reusable authoring procedure. Author rows 1–39 in batches of 10–15.

- [ ] **Step 1: Author the level fragment** in `plugins/data/zh-grammar/authored/hsk-5.json`, checking after each batch.
- [ ] **Step 2: Build and inspect the coverage**; every HSK 5 row appears.
- [ ] **Step 3: Run `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`.** Expected: PASS.
- [ ] **Step 4: Commit** with `git commit -m "feat(grammar): HSK 5 lessons"`.

## Task 7: HSK 6

**Level:** `hsk-6` · **Outline:** `outline/hsk-6.json` · **Rows:** 30 · **Lessons:** 30–33 · **Split note:** split 四字格 / fixed patterns into pattern-family lessons.

Follow the reusable authoring procedure. Author rows 1–30 in batches of 10–15.

- [ ] **Step 1: Author the level fragment** in `plugins/data/zh-grammar/authored/hsk-6.json`, checking after each batch.
- [ ] **Step 2: Build and inspect the coverage**; every HSK 6 row appears.
- [ ] **Step 3: Run `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`.** Expected: PASS.
- [ ] **Step 4: Commit** with `git commit -m "feat(grammar): HSK 6 lessons"`.

## Task 8: HSK 7–9

**Level:** `hsk-7-9` · **Outline:** `outline/hsk-7-9.json` · **Rows:** 27 · **Lessons:** 55–65 · **Split note:** split 四字格, fixed patterns and discourse markers by family; every listed pattern appears in at least one example or the body.

Follow the reusable authoring procedure. Author rows 1–27 in families; a family that is too large for eight examples becomes a second `rows` entry with the same row number. This is the one level where several lessons per row are expected.

- [ ] **Step 1: Author the level fragment** in `plugins/data/zh-grammar/authored/hsk-7-9.json`, checking after each family.
- [ ] **Step 2: Build and inspect the coverage**; all 27 rows appear, with split entries for the large families.
- [ ] **Step 3: Run `cd server && go test ./internal/grammar -run TestBundledGrammarPack -v`.** Expected: PASS.
- [ ] **Step 4: Commit** with `git commit -m "feat(grammar): HSK 7–9 lessons"`.

## Task 9: Cutover — delete the demo and fix the credits

**Files:**
- Delete: `plugins/data/zh-grammar-demo/`
- Modify: `server/internal/grammar/bundled_test.go` (lesson-count floor), `server/cmd/qinqin/seed_notice_test.go`, `docs/sources.md`, `plugins/data/README.md`, `README.md`, `docs/wiki/Data-and-licences.md`, `docs/ROADMAP.md`, `apps/web/src/lib/i18n/messages/en.json`, `apps/web/src/lib/plugins/grammar/route.test.ts`, `apps/web/src/lib/plugins/grammar/browse.test.ts`, `plugins/data/hsk-words/manifest.json`, `plugins/data/hsk-words/ATTRIBUTION.md`, `plugins/data/hsk-chars/manifest.json`, `plugins/data/hsk-chars/ATTRIBUTION.md`

- [ ] **Step 1: Delete the demo and its references**

Remove `plugins/data/zh-grammar-demo/`. Remove the demo row from `plugins/data/README.md`, the demo entry from `docs/sources.md`, the `zh-grammar-demo` entry from `seed_notice_test.go`, and the demo sentence from `docs/ROADMAP.md`. Replace `zh-grammar-demo` with `zh-grammar` in `apps/web/src/lib/plugins/grammar/route.test.ts` where it is only fixture text. Leave the historical files under `docs/superpowers/plans/`, `docs/superpowers/handoffs/` and `docs/contracts/packages/` alone unless a test fails.

- [ ] **Step 2: Tighten the full-pack test**

In `TestBundledGrammarPack`, change the lesson floor/ceiling to `len(data.Lessons) < 300 || len(data.Lessons) > 500` and add a check that each of the seven level ids appears in at least one lesson. Use `len(packs[0].Lessons) == len(data.Lessons)` after import. Run `node scripts/build-grammar-pack.mjs --complete` before the test; it must pass, proving every syllabus row is authored.

- [ ] **Step 3: Rewrite the HSK notices pack-scoped**

In `hsk-words/manifest.json`, replace the sentence “The project includes only the vocabulary (word) list and the list of characters to recognise … and none of the syllabus's other content (grammar points, descriptions, the lists of characters to write, explanatory text).” with: “This pack includes only the vocabulary (word) list, as a plain list of words with their levels and pinyin readings; it does not include the syllabus's descriptions, task and topic lists, or explanatory text. The Chinese grammar pack, when installed, is listed separately in the Sources page's Grammar lessons section and uses the syllabus's grammar outline as a topic index.”

In `hsk-chars/manifest.json`, replace the same sentence with: “This pack includes only the characters to recognise (认读字) with their levels; it does not include the syllabus's descriptions, task and topic lists, the characters to write, or explanatory text. The Chinese grammar pack, when installed, is listed separately in the Sources page's Grammar lessons section and uses the syllabus's grammar outline as a topic index.”

Make the same wording change in both `ATTRIBUTION.md` files, `docs/sources.md`'s HSK section, `docs/wiki/Data-and-licences.md` and the HSK paragraphs in `README.md`. Do not claim the grammar pack is part of the word/character packs.

- [ ] **Step 4: Change the grammar section note**

In `apps/web/src/lib/i18n/messages/en.json`, replace `sources.grammar.notice` with: “Grammar lessons are written by the pack's author. A pack's note states whether it follows a syllabus's topic outline, what it reproduces, and whether a native speaker has reviewed it.” Keep the existing key and JSON escaping.

- [ ] **Step 5: Add the full-pack browse test**

In `apps/web/src/lib/plugins/grammar/browse.test.ts`, add a test with seven levels, each with 50 lessons, and a scheme containing all seven HSK names. Assert `browseSections` returns seven levels, 350 lessons, and the first level's badge `['≈ HSK 1']`. This pins the page's grouping; no component change is expected.

- [ ] **Step 6: Sample-review every level**

Run the Appendix B checklist on ten lessons per level (70 total; for HSK 7–9 include the split 四字格, fixed-pattern and discourse-marker families). Fix every wrong distractor, unexplained contrast, tone error or misleading pattern. Record the checked lesson ids per level in the pull request or commit message.

- [ ] **Step 7: Run the checks**

Run: `node scripts/check-sources.mjs`
Expected: PASS; `zh-grammar-demo` no longer named.

Run: `node --test scripts/*.test.mjs`
Expected: PASS.

Run: `cd server && go test ./internal/grammar ./cmd/qinqin`
Expected: PASS.

Run: `cd apps/web && npm ci && npm test && npm run check`
Expected: PASS. Use the worktree's `apps/web`; if `npm ci` is unavailable, report it and run the existing test command.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(grammar): ship the HSK-aligned pack; remove the demo"
```

## Task 10: Full verification and handover

**Files:** no product changes; this task proves the result.

- [ ] **Step 1: Run the whole Node script suite**

Run: `node --test scripts/*.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run the Go tests**

Run: `cd server && go test ./...`
Expected: PASS. If the real-data test is desired, run `QINQIN_REAL_DATA_TESTS=1 go test ./cmd/qinqin -run RealPacks -v` and report its result.

- [ ] **Step 3: Seed a smoke database**

Create a temp pack root with only `zh-grammar` (the grammar pack has no dictionary dependency; the badge is tested separately), then:

```bash
tmp=$(mktemp -d)
mkdir -p "$tmp/packs"
cp -r plugins/data/zh-grammar "$tmp/packs/"
cd server
go run ./cmd/qinqin seed --data "$tmp/data" --packs "$tmp/packs"
```

Expected: a seed line for `zh-grammar` with the lesson count (300–500) and no warnings. Then start `go run ./cmd/qinqin serve --data "$tmp/data" --addr 127.0.0.1:8099` and:

```bash
curl -fsS 'http://127.0.0.1:8099/api/grammar?language=zh' | jq '.[0].levels | length'
curl -fsS 'http://127.0.0.1:8099/api/grammar?language=zh' | jq '.[0].lessons | length'
curl -fsS 'http://127.0.0.1:8099/api/grammar/zh-grammar/<a-lesson-id>' | jq '.lesson.examples | length'
```

Expected: 7 levels; 300–500 lessons; 4–8 examples. Stop the server.

- [ ] **Step 4: Open the Grammar page**

Open `/p/grammar` in the web app, confirm seven level headings with `≈ HSK N` badges, browse to the last lesson of the last level, open it, run the practice: a fill-the-gap and a word-order exercise must both work. This is the manual check for the 340-lesson page.

- [ ] **Step 5: Read the Sources page**

Open `/sources`, confirm the Grammar lessons section shows `zh-grammar` with the CC0/syllabus attribution and the unreviewed note, and the HSK word/character notices say “This pack includes only …” with no claim that the project has no grammar content.

- [ ] **Step 6: Record the handover**

Update the plan checkboxes and report: lesson/example counts per level, the command results, the native-speaker review still open, and any sample-review corrections made. Do not mark the native review done.

## Appendix A: Generate the outline from the PDF

Keep the PDF and the TSV outside the repository.

```bash
mkdir -p /tmp/opencode/hsk
cd /tmp/opencode/hsk
curl -fsSLo syllabus.pdf 'https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf'
sha256sum syllabus.pdf   # d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad
pdftotext -tsv -f 386 -l 405 syllabus.pdf grammar.tsv
cd -
node scripts/prepare-hsk-grammar.mjs /tmp/opencode/hsk/grammar.tsv /tmp/opencode/hsk/outline
```

Expected printed counts: HSK 1 45, HSK 2 60, HSK 3 56, HSK 4 46, HSK 5 39, HSK 6 30, HSK 7–9 27. The extractor is an authoring aid: the author must still check each row against the PDF because the table's merged cells and watermark can shift a line.

## Appendix B: Sample review checklist (Task 2 and Task 9)

For each level, read ten randomly chosen lessons and check:

- [ ] Every example's `focus` occurs once and is the grammar point the translation tests.
- [ ] Every distractor is wrong in that exact slot; none is another correct answer.
- [ ] At least one distractor is a similar/contrastive point and at least one is clearly wrong.
- [ ] The 1–2 contrast examples are explained in the body.
- [ ] Pinyin tone marks and tone changes are correct; translations match aspect and tone.
- [ ] The sentence uses level-appropriate vocabulary; no rare character was used to decorate.
- [ ] The pattern line and summary describe the lesson accurately.
- [ ] The row in `COVERAGE.md` matches the lesson's scope.

Record the ten lessons checked per level in the pull request or commit message. Native-speaker review remains a separate, open item.
