# Character Grid (Mastery Map Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the level-pack-driven mastery map with a Kanji-Grid-style view that lists EVERY Hanzi/Kanji in the dictionary for the workspace language (studied or not), split into sections by grade/level, each cell heat-coloured by derived mastery, with learned counts per section and overall.

**Architecture:** The importers keep the grade/JLPT/frequency/stroke/standard-list fields they currently drop (stored in `entries.attrs`, no schema change; a re-seed refreshes them). A new public endpoint `GET /api/characters?language=` returns a compact universe list (ja: all KANJIDIC2 characters; zh: standard characters plus every character with a CEDICT reading). A pure web module defines the "group by" options per language, builds sections, applies filters and computes variant-aware mastery; the map page renders sections as collapsible, lazily rendered blocks so 13k cells stay fast.

**Tech Stack:** Go 1.26 (`modernc.org/sqlite`), SvelteKit 2 / Svelte 5, vitest. No new dependencies. All data used is already bundled and licence-recorded (Unihan: Unicode License v3; KANJIDIC2: CC BY-SA 4.0 EDRDG; CC-CEDICT: CC BY-SA 4.0). **No HSK list is bundled** (no licence-clean official list); an HSK grouping appears automatically when the user installs an HSK level pack locally (see rulings).

**Branch:** continue on `feature/reader-feedback` (single branch for owner testing). **Recon:** the facts below come from a read-only recon of the real dev DB copy (13,110 ja / 103,021 zh character entries; `attrs` today holds only `strokes` for ja).

## Rulings

- **Universe:** ja = every KANJIDIC2 character (13,108; the two bare radical entries 戶/靑 are excluded because they carry no KANJIDIC2 attrs). zh = every zh character entry with `attrs.tghz = "1"` (通用规范汉字表, 8,105) **or** a CC-CEDICT pinyin reading (single-character CEDICT lines, ≈10.8k) — about 11k simplified characters; the other ≈92k Unihan-only entries are not listed (a footnote says so). Traditional forms are not separate cells: a character's `variant` links (traditional/simplified) are sent as `v` and **share the cell** (a card written 愛 lights up 爱).
- **Groupings** (a "Group by" selector, remembered per workspace language in localStorage):
  - ja: **Grade** (default: Grade 1–6 = elementary kyōiku kanji; "Secondary (grade 8)"; "Names (jinmeiyō, 9–10)"; "Not graded"), **JLPT (old scale)** (levels 4,3,2,1 as stored by KANJIDIC2 — labelled "JLPT 4 … 1 (pre-2010 scale)"; no invented N5–N1 mapping; "Not in JLPT"), **Frequency** (1–500, 501–1000, 1001–1500, 1501–2000, 2001–2501, "Not ranked"), **Strokes** (1…n).
  - zh: **Common** (default: GB2312 level 1 ≈3,755; GB2312 level 2 ≈3,008; "Other standard characters"; "Other characters in the dictionary"), **HK primary grade** (Unihan kGradeLevel 1–6, "No grade"), **Strokes**.
  - Any installed level scheme for the language (the existing `/api/schemes` machinery: HSK/JLPT/Jōyō packs the user installed, including local packs) is offered as an extra "Group by" option named after the scheme, using its levels as sections plus "Not in this scheme". The bundled `hsk-mini`/`jlpt-mini` samples are hidden from the selector (they are samples).
- **Mastery:** unchanged definition (`mastery.ts`: per-card strength over cards whose `written` contains the character); a cell's score is the maximum over the character and its variants; a section shows `learned/total` where learned = score ≥ 80 (`MASTERY_THRESHOLD`), plus a stacked bar of the five stages (unknown, fresh, learning, mature, learned).
- **Rendering:** sections are `<details>`-style collapsible blocks; sections with more than 600 cells render only when expanded and use `content-visibility: auto`; the default open state is: every section expanded when the language's total ≤ 1500 cells shown, else only the first non-empty section expanded plus the "Expand all" button; filters: stage (All / Not started / Learning / Learned), text search box (a character, reading or English meaning substring), "Jump to character".
- **Cell UX:** the glyph on a stage-tinted background (the existing stage palette with dark-mode variants; unseen = neutral grey, visibly distinct from "fresh"), tooltip/popover with reading + first gloss + score + stage, click opens `/entry/<id>`; keyboard navigable (roving tabindex within a section, arrow keys), accessible name per cell = glyph + stage; legend with counts per stage.
- **Payload:** `GET /api/characters?language=ja|zh` → compact JSON array; gzip when the client accepts it; `ETag` from the max `updated_at` and count, `Cache-Control: private, max-age=0, must-revalidate` (revalidate on each visit, 304 when unchanged); the web client keeps it in memory for the session.
- **Data refresh:** old databases need a re-seed (`qinqin seed`) to fill the new attrs; until then the endpoint still returns the universe but with missing grade/JLPT/etc., and the page says "Level data missing — run `qinqin seed` to refresh" when ≥ 90 % of characters lack the fields of the chosen grouping.

## Global Constraints

- No new dependencies; no schema migration (attrs are a JSON map). Do not bundle anything of uncertain licence.
- Server gates `cd server && go vet ./... && go test ./...` and `go test -race ./internal/dict ./internal/lexicon ./internal/api`; web gates `check`, `test`, `build` (absolute `npm --prefix /home/user/www/github/qinqin/.claude/worktrees/feature-reader/apps/web`; builds one at a time). UI has no component tests: pure modules for logic.
- Commit only your own files with explicit `git add <paths>`; never merge or push. Real-app checks: playwright-core 1.52 in the scratchpad `pw`, Chromium headless shell 1161, 127.0.0.1 only on a FREE port (check with `ss`), never 8080/localhost; kill what you start. Never open the live data dir `/home/user/qinqin-integration-data` (root-owned, in use): copy it with a root container (`docker run --rm -v /home/user/qinqin-integration-data:/data:ro -v <dir>:/out alpine cp -a /data/. /out/`) when real data is needed.

## Attr keys (shared contract between Tasks 1, 2 and 3)

`entries.attrs` string values for `kind = 'character'`:
- ja (KANJIDIC2): `strokes` (existing), `grade` ("1".."6","8","9","10"), `jlpt` ("1".."4", old scale), `freq` ("1".."2500", the KANJIDIC2 newspaper rank), `src` = `"kd2"` marks KANJIDIC2 characters.
- zh (Unihan): `strokes` (kTotalStrokes first value), `tghz` ("1" when kTGHZ2013), `gb` ("1" or "2" from kGB0 row: GB2312 row 16–55 → "1", 56–87 → "2"; kGB0 value is a 4-digit row-cell code `RRCC`), `hkgrade` ("1".."6" from kGradeLevel).

## Review Focus

- Re-importing on a database that already has the old attrs (the live dev DB): idempotent, attrs added/updated, no duplicate entries, and the importer does not clobber attrs written by the other importer (zh characters get attrs from Unihan; CEDICT must not drop them; ja KANJIDIC2 vs JMdict) (Task 1).
- Universe counts on the real data: ja 13,108, zh ≈ 11k, no entries outside the rules; variants complete (Task 2).
- The page with 13k cells: first paint fast, scrolling smooth, no jank when toggling a group; unknown vs fresh vs learned visually distinct in light/dark and for colour-blind users (not colour alone: also a corner marker or pattern for learned) (Task 4).
- A zh card written in traditional lights the simplified cell; a character in no group appears under the "other" section, never silently missing (Task 3, 4).
- An es (or other non-Han) workspace still shows the "not for this language" note and no Map link (unchanged).

---

### Task 1: Importers keep grade/level/stroke fields (server)

**Files:**
- Modify: `server/internal/dict/kanjidic2.go`, `server/internal/dict/unihan.go`, `server/internal/dict/lexicon_import.go` (`importKanjidic2Lexicon`/`kanjidic2LexiconEntry`, `importUnihanLexicon` ~446), tests `kanjidic2_test.go`, `unihan_test.go`, `lexicon_*_test.go` + testdata fixtures
- Do not change schema/migrations.

**Interfaces:**
- Produces: the attr keys listed above on character entries. KANJIDIC2: parse `<misc><grade>`, `<jlpt>`, `<freq>`, and store with `src=kd2` (keep existing strokes). Unihan: add the zip members that carry `kTotalStrokes` (IRGSources, already opened), `kTGHZ2013` (Readings, already opened), `kGB0` (OtherMappings — new member), `kGradeLevel` (DictionaryLikeData — new member); tolerate missing members (older Unihan zips) without failing the import; derive `gb` level from the kGB0 row.
- [ ] **Step 1:** Failing tests: KANJIDIC2 fixture with grade/jlpt/freq present/absent per character; Unihan fixture with each field incl. multi-value `kTotalStrokes` ("7 9" → first), kGB0 "1603" → gb "1", "5601" → gb "2", rows outside 16–87 → no gb; missing members tolerated; re-importing the same pack twice is a no-op (no restamp), importing over an entry that has old attrs updates them; CEDICT importing after Unihan keeps the zh attrs (and vice versa order) — test both orders.
- [ ] **Step 2:** `cd server && go test ./internal/dict` — FAIL. **Step 3:** implement. **Step 4:** gates + race — PASS. Verify on the real bundled packs in a scratch data dir (seed `plugins/data` into a temp dir under the scratchpad; count characters with each attr: expect ja grade tagged 2,999 / jlpt 2,230 / freq 2,501; zh tghz 8,105, gb level1+2 ≈ 6,763, hkgrade 2,632) and put the numbers in the report. **Commit** `feat(dict): keep grade, JLPT, frequency and standard-list fields for characters`.

### Task 2: Characters endpoint (server)

**Files:**
- Create: `server/internal/api/handlers_characters.go` (+ test), `server/internal/lexicon/characters.go` (+ test)
- Modify: `server/internal/api/api.go` (route)

**Interfaces:**
- Produces:
  ```go
  // GET /api/characters?language=ja|zh   (public; 400 on missing/unsupported language; other languages → [] )
  // response: {"language":"ja","count":13108,"chars":[{"i":entryID,"c":"字","s":6,"g":1,"j":3,"f":512,"r":"ジ","m":"character; letter","v":["…"], "t":1, "b":2, "h":3, "x":["c"...]}]}
  //   i id; c written (simplified for zh); s strokes; ja: g grade, j jlpt(old), f freq; zh: t tghz(1), b gb level(1|2), h hkgrade; r first reading (ja: first on reading else kun; zh: first pinyin) ≤ 16 runes; m first gloss ≤ 48 runes; v variant forms (zh traditional/simplified partners via entry_links 'variant'; empty omitted); fields omitted when absent
  // universe: ja kind=character AND attrs.src='kd2'; zh kind=character AND (attrs.tghz='1' OR has a pinyin reading); not deleted; deterministic order (ja: grade asc nulls last then freq then id; zh: gb, tghz, stroke, id — or simply by codepoint: pick codepoint order for stability)
  // gzip if Accept-Encoding allows; ETag from (language, count, max(updated_at)); 304 on If-None-Match; Cache-Control: private, max-age=0, must-revalidate
  func (s *Store) Characters(ctx context.Context, language string) ([]CharacterRow, error)   // one pass of SQL: entries + attrs JSON (json_extract) + first reading + first sense gloss + variants, batched; no N+1
  ```
- [ ] **Step 1:** Failing tests with fixtures (ja/zh characters with and without attrs/readings/senses/variants; soft-deleted excluded; universe rules for zh: tghz-only, pinyin-only, neither excluded; compact JSON keys omit-empty; ETag/304; gzip; 400s; language with no data → `[]`; query plan test uses indexes; a timing/benchmark test on a generated 15k-entry fixture asserts < 300 ms).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** gates + race — PASS; then on a COPY of the real dev DB (after Task 1's importer fix, re-seeded copy) report real counts (ja 13,108; zh ≈ 11k), payload size raw/gzip and latency. **Commit** `feat(api): character universe endpoint for the map`.

### Task 3: Grouping and mastery logic (web, pure)

**Files:**
- Create: `apps/web/src/lib/study/charGroups.ts` (+ test), `apps/web/src/lib/api/characters.ts` (+ test)
- Modify: `apps/web/src/lib/api/types.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CharRow { i: number; c: string; s?: number; g?: number; j?: number; f?: number; t?: number; b?: number; h?: number; r?: string; m?: string; v?: string[] }
  export function fetchCharacters(language: string, signal?: AbortSignal): Promise<{ chars: CharRow[]; count: number }>   // memory cache per language, honours ETag via the browser cache
  export type GroupKey = 'grade' | 'jlpt' | 'freq' | 'strokes' | 'common' | 'hkgrade' | `scheme:${number}`
  export function groupOptions(language: string, schemes: Scheme[]): { key: GroupKey; label: string }[]   // ja: grade, jlpt, freq, strokes; zh: common, hkgrade, strokes; + one option per non-sample installed scheme of that language (samples hsk-mini/jlpt-mini hidden)
  export interface Section { id: string; label: string; chars: CharRow[]; }
  export function buildSections(chars: CharRow[], key: GroupKey, schemeMembers?: Map<string, Set<string>>): Section[]   // fixed section order/labels as in the rulings; every character lands in exactly one section (an 'other' section catches the rest, never dropped); empty sections omitted; stable order inside sections
  export interface CellState { char: CharRow; score: number; stage: Stage; reviewedCards: number }   // score = max over char + variants
  export function cellStates(chars: CharRow[], mastery: Map<string, CharMastery>): CellState[]
  export interface SectionStats { total: number; learned: number; byStage: Record<Stage, number> }
  export function sectionStats(cells: CellState[]): SectionStats
  export type StageFilter = 'all' | 'not-started' | 'learning' | 'learned'
  export function filterCells(cells: CellState[], filter: StageFilter, query: string): CellState[]   // query: substring of glyph/variants/reading/gloss, case-insensitive, NFKC
  export function dataGap(chars: CharRow[], key: GroupKey): boolean   // ≥ 90 % of characters lack the grouping's field → page shows the re-seed hint
  ```
  `masteryForChars` is called with every glyph incl. variants (reuse `lib/study/mastery.ts`; do not change its scoring).
- [ ] **Step 1:** Failing tests: each grouping with fixtures incl. missing fields → 'Not graded'/'Other'; every input char appears exactly once across sections; variant-aware mastery (card written with the traditional form lights the simplified cell; max not sum); stats; filters/search (reading, gloss, variant); scheme grouping with members; `groupOptions` hides the samples; `dataGap`; the fetch client (cache, error mapping) with an injected fetch.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** web gates — PASS. **Commit** `feat(map): character grouping and variant-aware mastery logic`.

### Task 4: The map page (web UI)

**Files:**
- Modify: `apps/web/src/routes/study/map/+page.svelte` (rewrite), plus new components under `apps/web/src/lib/plugins/flashcards/` or `apps/web/src/lib/components/` as needed (e.g. `CharGrid.svelte`, `CharCell.svelte`, `MapSummary.svelte`), remove now-dead level-summary code from the old page

**Interfaces:**
- Consumes: Tasks 2–3. Behaviour exactly as in the Rulings (Group by, sections with `learned/total` + stage bar, collapsible/lazy rendering, filters + search + jump, cell tooltip/popover, keyboard roving tabindex, legend with counts, overall summary header "N of M learned (p %)" and per-stage counts, data-gap hint, non-Han note unchanged, loading/error states with Retry, remembered group-by per language). Cell encoding must not rely on colour alone (e.g. learned cells show a small corner tick; unseen cells are dashed-outline/neutral). Dark mode and 390 px layouts (cell size ≥ 2.4rem tap targets at 390 px, sections full width). Performance: 13k cells first meaningful paint < 1 s on the dev machine with all sections collapsed except the first; expanding a 3k-cell section < 150 ms; `content-visibility: auto`.
- [ ] **Step 1:** Implement the page with the pure modules. **Step 2:** web gates — PASS. **Step 3:** real-app check against a data copy re-seeded with Task 1's importer (scratch data dir seeded from `plugins/data` into the scratchpad — the full seed takes a few minutes; build the server from a scratchpad copy of the committed tree with the web build embedded): ja workspace shows 13,108 cells split by grade (counts per grade: 80/160/200/202/193/191/1,110/863/…), group-by switching (JLPT, frequency, strokes), zh workspace ≈ 11k split GB2312 1/2 etc., a studied word's characters coloured (create cards + reviews via the API; one card written in traditional), filters/search/jump, expand/collapse, timing numbers for first paint and expansion, 390 px and dark screenshots read yourself, no console errors, es workspace note. Report pass/fail/not-run per check. **Commit** `feat(map): list every character, grouped by grade and level`.

### Task 5: Docs, re-seed and container

- [ ] README: the Map section (universe, groupings, colour/marker legend, data refresh note: run `qinqin seed` after upgrading to fill grade/JLPT/frequency fields; no HSK pack bundled and how to install one locally under `plugins/data-local/`), API row for `GET /api/characters`, docs/sources.md note on which Unihan/KANJIDIC2 fields are now used; update the flashcards spec's Mastery map section (R2) to point to the new design. **Commit** `docs: character grid`.
- [ ] Rebuild image `docker build -t qinqin:integration .`; back up the data dir with a root container copy to `/home/user/qinqin-integration-data.bak-before-grid`; restart `qinqin-integration` on 127.0.0.1:8085; run `docker exec qinqin-integration qinqin seed` (idempotent; takes a few minutes; JMdict holds the write lock ~20 s — avoid using the app meanwhile) and verify `GET /api/characters?language=ja` returns 13,108 and zh ≈ 11k and the grade attrs are populated.
