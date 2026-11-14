# Yomitan-style Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reader's single-entry lookup with a Yomitan-style ranked, stacked-entry popup (frequency ordering, part-of-speech-gated Japanese deinflection, nested popups via Shift+hover), on a dictionary schema redesigned from scratch.

**Architecture:** A new `lexicon` Go package and `lx_*` tables hold one entry per JMdict word (per-sense POS, forms, readings, `uk`/priority) and one entry per written form for Chinese. Importers write the lexicon beside the old tables, a new `lookup` service ranks candidates with Yomitan's sort chain (frequency before inflection length), and a public `GET /api/lookup` serves it to a new web popup stack. Once the new path works, every consumer (entry API, search, overlay, levels, sentences, sync, tokenizer endpoints) is moved onto the lexicon and the legacy tables, importers and tests are deleted.

**Tech Stack:** Go 1.26 (stdlib `net/http`, `modernc.org/sqlite`), SvelteKit 2 / Svelte 5 + vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-yomitan-lookup-design.md` (builds on `2026-11-12-reader-design.md`). Work on branch `feature/yomitan-lookup`.

## Global Constraints

- No backward compatibility: nothing is published; no data migration, no re-import notes; dev DBs are rebuilt with `qinqin seed`. Existing code that uses the dictionary (search, entry page, flashcards, reader, tokenizer endpoints) must keep working against the new schema; stored data and entry ids need not survive.
- Sort chain for Japanese and Chinese lookup, in this order: matched source text length (longest first), **frequency order (ascending rank)**, primary-reading match, inflection chain length (shortest first), count of exact source-term matches, dictionary order, entry score (`uk` + priority for Japanese), headword text. Missing data falls through to the next key.
- Part-of-speech gating: a deinflected candidate is accepted for a word if ANY of its senses' POS tags satisfies the rule's required class; failing candidates are dropped before ranking.
- Popup: 3 entries and 3 senses shown before "show more"; nested popups capped at depth 4; nested lookup only while **Shift** is held (reader text keeps plain hover); Esc closes the top popup; moving away or clicking outside closes the whole stack.
- New lookup endpoint: public, client window ≤ 16 code points, server cap 64 code points, at most 30 entries returned; "show more" is client-side.
- Licence rule: only data with a clear publisher-stated CC BY-SA 4.0 (or more permissive) licence is bundled, with LICENSE/ATTRIBUTION files; anything uncertain or restrictive is local-only (gitignored, fetched by the user) and the app must work without it. If a task cannot confirm a licence from the publisher's own page, stop and report instead of committing data.
- Chinese keeps one entry per written form carrying all its readings; no per-reading splitting. No add-to-study, no audio, no settings UI.
- Offsets on the wire are Unicode code points. The existing tokenizer JSON (`GET /api/segment/at`, `POST /api/segment`: `{surface,start,end,lemma,reason,entries[{id,kind,reading?}]}`) stays API-compatible; `GET /api/entries/{id}` keeps its current JSON fields (`written, kind, language, readings, senses, badges, variants, sentences, radicalId`) and gains `forms` and `senseGroups`.
- Gates before each commit batch: `cd server && go vet ./... && go test ./...`, `npm --prefix apps/web run check`, `npm --prefix apps/web test`; run `npm --prefix apps/web run build` for web tasks. Commit per task.

## Review Focus

- Shift not held (or released mid-hover) inside a popup must never open a nested popup; closing and re-entering must not leave orphan popups (Task 8, 9).
- Words with no dictionary entry, or when no frequency pack is installed: results still rank by the fallback chain, no crash, no empty chips (Task 6, 9).
- Deinflection false positives: 話した (話 is a noun), 食べた, 行った, した, 来た must gate correctly (Task 5, 6).
- A seed that fails halfway must leave the lexicon consistent, not half-written entries (Task 2, 3).
- Traditional-form input finds the simplified Chinese entry; a polyphonic character shows all its readings in ONE entry (Task 3, 6, 9).
- Kana homophones (こと, いる, する, ある) end up in a sensible order with and without frequency data (Task 6).

---

### Task 1: Lexicon schema and store

**Files:**
- Create: `server/internal/db/migrations/014_lexicon.sql`, `server/internal/lexicon/lexicon.go`, `server/internal/lexicon/lexicon_test.go`

**Interfaces:**
- Produces (`package lexicon`):
  ```go
  type Form struct{ Text string; Ord int; Flags []string; Pri int }              // flags e.g. rK oK iK sK trad
  type Reading struct{ Type, Value, Plain string; Ord int; Flags []string; Pri int } // type: pinyin bopomofo kana on kun romaji
  type Sense struct{ ID, DictionaryID int64; Ord int; POS, Tags, Glosses, Xrefs []string }
  type Entry struct{ ID int64; Language, Kind, Key string; Forms []Form; Readings []Reading; Senses []Sense; Pri int; UK bool; Attrs map[string]string; UpdatedAt time.Time }
  type Store struct{ DB *sql.DB }
  var ErrNotFound error
  func (s Store) Put(ctx context.Context, e *Entry, dictionaryID int64) (int64, error)   // upsert by (Language, Kind, Key); replaces forms/readings; replaces ONLY this dictionary's senses
  func (s Store) Get(ctx context.Context, id int64) (*Entry, error)
  func (s Store) GetMany(ctx context.Context, ids []int64) ([]Entry, error)              // caller order, skips unknown
  func (s Store) ByForm(ctx context.Context, language string, forms []string) (map[string][]Entry, error)
  func (s Store) ByReading(ctx context.Context, language string, plains []string) (map[string][]Entry, error) // readings.plain match, kana/pinyin/etc. types
  func (s Store) Best(ctx context.Context, language, kind, form string) (*Entry, error)  // best-ranked entry with that form: uk-with-pri, pri, entry id
  func (s Store) Link(ctx context.Context, fromID, toID int64, typ string) error        // typ: variant radical
  func (s Store) Variants(ctx context.Context, id int64) ([]Entry, error)
  ```
- Tables (all soft-delete via `deleted_at`, RFC3339 `updated_at`): `lx_entries(id, language, kind CHECK word|character, ext_key, pri, uk, attrs JSON, updated_at, deleted_at, UNIQUE(language,kind,ext_key))`, `lx_forms(entry_id, text, ord, flags, pri)` index on `(text)`, `lx_readings(entry_id, type, value, plain, ord, flags, pri)` index on `(plain, entry_id)`, `lx_senses(id, entry_id, dictionary_id, ord, pos, tags, glosses JSON, xrefs JSON)`, `lx_links(from_id,to_id,type)`. Existing `dictionaries` rows are reused.

- [ ] **Step 1: Write failing tests** in `lexicon_test.go` (use `db.Open(filepath.Join(t.TempDir(),"test.db"))`): `TestPutGetRoundTrip` (forms, readings, senses with POS/xrefs survive), `TestPutReplacesOnlyOwnDictionarySenses` (two dictionaries, re-put one), `TestPutIsIdempotent` (identical Put writes nothing: `UpdatedAt` unchanged), `TestByFormMatchesAnyForm` (a word with forms 為る and 爲る found by either), `TestByReadingUsesPlain`, `TestBestPrefersUkWithPriority`, `TestGetManyKeepsOrder`.
- [ ] **Step 2: Run** `cd server && go test ./internal/lexicon/ -v` — expect FAIL (package missing).
- [ ] **Step 3: Implement** migration and `Store`. Single transaction per `Put`; skip all writes when the stored entry is identical; slice values stored as JSON text.
- [ ] **Step 4: Run** the tests plus `go test ./internal/db/` (update the table-list assertion in `db_test.go`) — PASS. **Commit** `feat(lexicon): schema and store`.

### Task 2: JMdict into the lexicon

**Files:**
- Modify: `server/internal/dict/jmdict.go` (parse `ent_seq`, per-sense `pos`/`misc`/`xref`, keep `ke_pri`/`re_pri`/`ke_inf`/`re_inf` raw), create `server/internal/dict/lexicon_import.go`, `lexicon_jmdict_test.go`

**Interfaces:**
- Consumes: `lexicon.Store.Put` (Task 1), existing `priorityScore` / penalty helpers in `jmdict.go`.
- Produces:
  ```go
  func ImportLexicon(ctx context.Context, sqlDB *sql.DB, p *Pack) (Result, error) // dispatches on p.Format; this task handles "jmdict"
  ```
  `ImportLexicon` also registers the pack's `dictionaries` row (same fields and built-in ids as the legacy import) and passes its id to `Put`. One lexicon entry per `ent_seq`: `Key = "j:<ent_seq>"`, `Forms` = all `keb` (flags from `ke_inf`, per-form `Pri` via the existing score), `Readings` = all `reb` typed `kana` (flags from `re_inf`, `Pri`, derived romaji via `lang.For("ja")`), `Senses` = one per JMdict `<sense>` (POS tags as written, e.g. `v1`, `vs-i`, `n`; misc tags; English glosses; xref texts), `UK` if any sense is `uk`, `Pri` = max form/reading score with the rK-only exemption already implemented for uk words. No homograph merging.

- [ ] **Step 1: Write failing tests** with a tiny in-test JMdict XML using the real element names and entities (declare or leave undeclared like the real file): two words sharing the form 為る (する and なる) become TWO entries; 居る has senses `[v1 vi]` and `uk` is true; senses keep their POS per sense and glosses stay grouped per sense; xrefs are captured; ent_seq in `Key`; `Pri` follows the existing score table; the import is one transaction (inject an error after N entries → nothing persists: `TestJmdictImportRollsBackOnError`); re-import writes nothing.
- [ ] **Step 2: Run** `cd server && go test ./internal/dict/ -run Lexicon -v` — FAIL.
- [ ] **Step 3: Implement** the parser additions (entities arrive as text like `&uk;` with `Strict=false`; strip `&…;`) and the lexicon import. Use one transaction per pack with batched inserts (open the DB the seed way, `OpenForSeed`, when called from `seed`).
- [ ] **Step 4: Run** the dict tests — PASS (existing jmdict tests stay green; the old `Import` is untouched). **Commit** `feat(dict): import jmdict into the lexicon per word`.

### Task 3: CC-CEDICT, KANJIDIC2, Unihan and JSON packs into the lexicon

**Files:**
- Modify: `server/internal/dict/lexicon_import.go`, `server/cmd/qinqin/seed.go`; Create: `server/internal/dict/lexicon_chinese_test.go`, `lexicon_kanji_test.go`

**Interfaces:**
- Consumes: Task 2 `ImportLexicon`, `lexicon.Store`.
- Produces: `ImportLexicon` handles formats `cedict`, `kanjidic2`, `unihan`, `json`. Keys: CEDICT `Key = <simplified>` with `Forms` = simplified then traditional (flag `trad`); homograph lines merge into ONE entry (all pinyin readings + derived bopomofo; all glosses as one sense per CEDICT line, in file order); single hanzi are `Kind = "character"`; KANJIDIC2 and Unihan write `Kind = "character"`, `Key = <char>` (language `ja` / `zh`), kanjidic2 on/kun readings, `Attrs["strokes"]`, radical and Unihan variants as `lexicon.Store.Link` rows (`radical`, `variant`; a bare character entry is created for a missing radical).
- `seed` calls `ImportLexicon` after the legacy `dict.Import` for every dictionary pack (temporary dual import; the legacy call is removed in Task 12).

- [ ] **Step 1: Write failing tests** reusing the fixtures in `server/internal/dict/testdata`: 行 yields ONE entry with readings xíng and háng and both glosses lines; searching by traditional form via `ByForm` finds the simplified entry; unihan variants link; kanjidic2 radical link; JSON mini packs import; a failing line aborts the whole pack (no partial entries).
- [ ] **Step 2: Run** `cd server && go test ./internal/dict/ -run 'Lexicon' -v` and `go test ./cmd/qinqin/` — FAIL.
- [ ] **Step 3: Implement** the per-format mapping reusing the existing parsers (`parseCedictLenient`, `ParseKanjidic2`, unihan reader, json reader).
- [ ] **Step 4: Run** `go vet ./... && go test ./...` (including `seed_default_test.go` which seeds the real bundled data) — PASS. **Commit** `feat(dict): import cedict, kanjidic2, unihan and json packs into the lexicon`.

### Task 4: Frequency packs

**Files:**
- Create: `server/internal/freq/freq.go`, `freq_test.go`, `server/internal/db/migrations/015_frequency.sql`
- Modify: `server/internal/dict/manifest.go` (type `frequency`; formats `yomitan-freq`, `freq-csv`; update the hard-coded "want …" error strings and their tests), `server/cmd/qinqin/seed.go` (`importOrder`: frequency after dictionaries; `--packs` accepts several directories, default `plugins/data` plus `plugins/data-local` when it exists), `.gitignore` (`/plugins/data-local/`)

**Interfaces:**
- Tables: `lx_freq_packs(id, pack_id UNIQUE, name, version, license, attribution, ord, updated_at, deleted_at)`, `lx_frequency(pack_id → lx_freq_packs.id, term, reading, rank INTEGER)` indexes `(term)` and `(pack_id, term, reading)`.
- Produces (`package freq`):
  ```go
  func Import(ctx context.Context, sqlDB *sql.DB, p *dict.Pack) (dict.Result, error)
  type Store struct{ DB *sql.DB }
  type Hit struct{ PackID int64; PackName string; Rank int; Display string }
  func (s Store) Lookup(ctx context.Context, terms []string, readings map[string][]string) (map[string][]Hit, error) // term → best hit per pack, matching reading when the pack has one
  func (s Store) Packs(ctx context.Context) ([]PackInfo, error)                                                  // ordered by ord (pack order = frequency-order priority)
  ```
  Formats: `yomitan-freq` = a Yomitan dictionary zip/dir (`index.json` + `term_meta_bank_*.json` rows `[term,"freq",data]`; `data` is a number, `{value,displayValue}`, or `{reading,frequency:…}`); `index.json.frequencyMode` `rank-based` stores values as ranks, `occurrence-based` is converted to dense ranks (highest count = rank 1). `freq-csv` = `freq.csv(.gz)` with header `term,reading,rank`.

- [ ] **Step 1: Write failing tests**: both formats import (small fixtures committed under `server/internal/freq/testdata`), occurrence mode converts to ranks, rows with and without readings, `Lookup` returns the best rank per pack and respects the reading, re-import is idempotent and replaces rows, a malformed pack aborts without partial rows, manifest validation accepts `frequency`.
- [ ] **Step 2: Run** `cd server && go test ./internal/freq/ ./internal/dict/ -v` — FAIL.
- [ ] **Step 3: Implement** the importer (streaming parse, batched inserts in one transaction) and the seed changes (`findPacks` over several roots; local-only root optional).
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(freq): frequency packs`.

### Task 5: Part-of-speech-gated deinflection

**Files:**
- Modify: `server/internal/lang/lang.go` (`Deinflection` gains `Reasons []string` and `Class string`; the existing `Reason string` field stays, equal to the joined chain, so `segment.Match.Reason` is unchanged), `server/internal/lang/ja_deinflect.go`; Create: `server/internal/lang/ja_pos.go`, `ja_pos_test.go`; update `ja_deinflect_test.go`

**Interfaces:**
- Produces:
  ```go
  type Deinflection struct{ Form, Reason string; Reasons []string; Class string } // Reasons = inflection chain in application order; Class = word class the dictionary form must have
  func ClassMatches(class string, pos []string) bool                      // pos = JMdict tags of a sense, e.g. v1, v5r, vs-i, vk, adj-i
  ```
  Classes: `v1` (v1, v1-s), `v5` (any v5*), `vs` (vs, vs-i, vs-s, vs-c), `vk` (vk), `adj-i` (adj-i, adj-ix). Each rule has an input class and an output class; chains compose only when classes agree; the final form's class is `Class`. Irregular する/来る/行く rows keep working. The old behaviour for callers that ignore `Class` is unchanged (the existing tokenizer keeps using only `Form`/first reason).

- [ ] **Step 1: Write failing tests** (table): `食べた`→`食べる` class `v1`; `飲んだ`→`飲む` `v5`; `勉強した`→`勉強する` `vs`; `来た`→`来る` `vk`; `高かった`→`高い` `adj-i`; `ClassMatches("vs", []string{"n","vs-i"})` true and `ClassMatches("vs", []string{"n"})` false (so 話する is rejected when 話 is only `n`); chains `食べさせられなかった` keep a valid class chain; a chain whose intermediate classes do not agree is not produced.
- [ ] **Step 2: Run** `cd server && go test ./internal/lang/ -v` — FAIL.
- [ ] **Step 3: Implement** the class annotations on the rule table and `ClassMatches`; keep the depth limit 3 and the cycle guard.
- [ ] **Step 4: Run** `go test ./internal/lang/ ./internal/segment/` — PASS (segment tests unchanged). **Commit** `feat(lang): part-of-speech classes for japanese deinflection`.

### Task 6: Lookup service

**Files:**
- Create: `server/internal/lookup/lookup.go`, `rank.go`, `lookup_test.go`, `rank_test.go`

**Interfaces:**
- Consumes: `lexicon.Store` (`ByForm`, `ByReading`), `freq.Store` (`Lookup`, `Packs`), `lang.For(language)` (`Deinflect`, `NormalizeReading`), `lang.ClassMatches`.
- Produces:
  ```go
  const MaxWindowRunes = 12; const MaxEntries = 30
  type Frequency struct{ PackID int64; PackName string; Rank int; Display string }
  type SenseOut struct{ DictionaryID int64; DictionaryName string; POS, Tags, Glosses, Xrefs []string }
  type Result struct {
      EntryID int64; Kind, Term, Reading string      // Term = matched/primary form, Reading = matched or first reading
      Forms []lexicon.Form; Readings []lexicon.Reading
      Matched string; Start, End int                  // matched source text, code-point offsets in the request text
      Reasons []string                                 // inflection chain (empty when exact)
      Tags []string                                    // e.g. "usually kana"
      Frequencies []Frequency; Senses []SenseOut; Pri int
  }
  type Service struct{ Lexicon lexicon.Store; Freq freq.Store; DB *sql.DB }
  func (s Service) Lookup(ctx context.Context, language, text string, offset int, kinds []string) ([]Result, error) // kinds empty = word and character; ≤ MaxEntries, ranked by the sort chain
  ```
  Candidate generation: prefixes 1..`MaxWindowRunes` from `offset` (start rune must be a letter/Han/kana as in the existing tokenizer), exact forms via `ByForm`, kana-only prefixes also via `ByReading` (ja), deinflected forms via `lang.Deinflector` gated with `ClassMatches` against ANY sense of the entry, Traditional/Simplified via forms (both are stored). Ranking implements the Global Constraints chain; "primary reading match" = matched text equals the entry's first reading or first form; "exact source-term matches" = number of the entry's forms/readings equal to the matched text; frequency order = best rank in the first pack (pack order) that has data, entries without data sort after those with data; dictionary order = lowest dictionary id of the entry's senses; score = `uk` with pri > 0, then `Pri`.

- [ ] **Step 1: Write failing tests** through the real importers (seed a lexicon from small in-test JMdict XML and CEDICT lines, plus a tiny frequency pack): for `宿題をした` offset 3: with frequency data 為る (past) ranks above 下 above 舌; with NO frequency data 下 (0 inflections) ranks above 為る (past); 話した offered only for 話 as `vs`; `いる` → 居る first then 要る; `こと` and `ある` orderings; Chinese: `學習` finds 学习, 行 returns ONE result with both readings; longest match wins; result list capped at 30; `kinds=["character"]` on a single hanzi; Latin/digits/punctuation → empty; each sort key has a unit test in `rank_test.go` that fails if that key is removed.
- [ ] **Step 2: Run** `cd server && go test ./internal/lookup/ -v` — FAIL.
- [ ] **Step 3: Implement** `Lookup` and the comparator in `rank.go` (one sort function over a candidate struct; document each key). One DB round trip per candidate set (batched `IN`, chunked under SQLite's variable limit).
- [ ] **Step 4: Run** the tests plus `go test -race ./internal/lookup/` — PASS. **Commit** `feat(lookup): ranked lookup service with yomitan sort chain`.

### Task 7: Lookup endpoint

**Files:**
- Create: `server/internal/api/handlers_lookup.go`, `handlers_lookup_test.go`; Modify: `server/internal/api/api.go`

**Interfaces:**
- Produces: `GET /api/lookup?lang=&text=&offset=&kind=` (public; `kind` optional, repeatable: `word`, `character`) → `200 {"results": Result[]}` with JSON field names `entryId, kind, term, reading, forms[{text,flags}], readings[{type,value,plain}], matched, start, end, reasons, tags, frequencies[{packId,packName,rank,display}], senses[{dictionaryId,dictionaryName,pos,tags,glosses,xrefs}], pri`. `lang` must be a registered code pack (400 otherwise), `text` non-empty, `offset` integer, `text` ≤ 64 code points (413), responses never leak internals (500 generic).

- [ ] **Step 1: Write failing tests** mirroring `handlers_segment_test.go`: happy path JSON, `kind` filter, 400/413 cases, empty result is `{"results":[]}`, anonymous access works.
- [ ] **Step 2: Run** `cd server && go test ./internal/api/ -run Lookup -v` — FAIL.
- [ ] **Step 3: Implement** the handler and register the route; build `lookup.Service` where the other services are constructed.
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(api): public lookup endpoint`.

### Task 8: Web lookup client and popup-stack core

**Files:**
- Create: `apps/web/src/lib/api/lookup.ts`, `lookup.test.ts`, `apps/web/src/lib/plugins/reader/popupStack.ts`, `popupStack.test.ts`; Modify: `apps/web/src/lib/api/types.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LookupResult { entryId: number; kind: 'word'|'character'; term: string; reading: string; forms: {text:string; flags?:string[]}[]; readings: {type:string; value:string; plain:string}[]; matched: string; start: number; end: number; reasons: string[]; tags: string[]; frequencies: {packId:number; packName:string; rank:number; display?:string}[]; senses: {dictionaryId:number; dictionaryName:string; pos:string[]; tags:string[]; glosses:string[]; xrefs:string[]}[]; pri: number }
  export function lookupAt(lang: string, text: string, offset: number, kinds?: string[], signal?: AbortSignal): Promise<LookupResult[]>   // sends windowAt(text, offset) (≤16 code points) with offset 0; start/end translated back to the original offsets
  // popupStack.ts — DOM-free
  export const MAX_DEPTH = 4
  export interface PopupFrame { id: number; depth: number; anchor: {x:number;y:number;w:number;h:number}; text: string; offset: number; results: LookupResult[] | null; error?: string }
  export class PopupStack { frames: PopupFrame[]; open(frame: Omit<PopupFrame,'id'|'depth'>, parentId?: number): number | null; closeTop(): void; closeAll(): void; closeAbove(id: number): void }
  ```
  `open(…, parentId)` closes every frame above `parentId` first and returns `null` at `MAX_DEPTH`.

- [ ] **Step 1: Write failing tests**: `lookupAt` URL/params (window, kinds), offset translation with an astral char, empty window → `[]` with no request, ApiError statuses; `PopupStack` depth cap, `closeAbove` semantics, `closeTop` order, opening a sibling replaces the old child, ids unique.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- lookup popupStack` — FAIL.
- [ ] **Step 3: Implement** both modules (reuse `windowAt`).
- [ ] **Step 4: Run** the web gates — PASS. **Commit** `feat(web): lookup client and popup stack core`.

### Task 9: Stacked popup UI and reader integration

**Files:**
- Create: `apps/web/src/lib/plugins/reader/EntryCard.svelte`, `PopupStack.svelte`, `scanText.ts`, `scanText.test.ts`, `showMore.ts`, `showMore.test.ts`; Modify: `useLookup.svelte.ts`, `hoverLookup.ts`, `selectionLookup.ts`, `ChapterText.svelte`, `BookView.svelte`; Delete: `LookupPopup.svelte` (and its now-unused helpers)

**Interfaces:**
- Consumes: `lookupAt`, `PopupStack`, `LookupResult` (Task 8).
- Produces: `showMore.ts`: `visibleCount(total: number, shown: number, step?: number): number`, `ENTRIES_VISIBLE = 3`, `SENSES_VISIBLE = 3`; `scanText.ts`: `scanTarget(root: HTMLElement, caretNode: Node, caretOffset: number): { text: string; offset: number } | null` (pure over the `data-scan` markup: finds the nearest ancestor with `data-scan`, returns that element's full text and the code-point offset).
- `EntryCard.svelte` shows, per result: term over its reading (ruby), tags (inflection `reasons`, "usually kana"), one frequency chip per pack, source dictionary + what matched, numbered senses with POS chips, xrefs ("see also …") and glosses inside `data-scan` elements (the language of the popup), "show more" for senses beyond 3. `PopupStack.svelte` renders `frames` as positioned popups (flip into the viewport, `role="dialog"`, Esc closes the top, outside click closes all), lists the first 3 `EntryCard`s with "Show N more entries".
- Reader behaviour: page-text hover/selection call `lookupAt` (single selected hanzi/kanji passes `kinds=['character']`) and open frame 1; inside any popup, **Shift + hover** over a `data-scan` element runs `scanTarget` → `lookupAt` → `open(…, parentId)`; without Shift nothing happens; releasing Shift does not close anything; the existing hover grace/abort logic (hide vs abort separation) is kept.

- [ ] **Step 1: Write failing tests** for `visibleCount`, `scanTarget` (astral chars, nested `data-scan`, a caret outside any scan region → null) and the controller changes that are DOM-free (extend `hoverLookup.test.ts`: result list instead of one match; a no-result hover shows nothing; Shift gating through an injected `isShift()` dependency; a nested open while a lookup is in flight aborts the previous).
- [ ] **Step 2: Run** `npm --prefix apps/web test` — FAIL for the new tests.
- [ ] **Step 3: Implement** the components and wire them; remove the old popup; keep keyboard selection lookup working.
- [ ] **Step 4: Run** `npm --prefix apps/web test`, `run check`, `run build`; do a real-app smoke (Go server on 127.0.0.1 with a freshly seeded data dir, headless Chromium): hover した in a Japanese epub, Shift+hover a xref inside the popup, Esc, click outside. **Commit** `feat(reader): stacked lookup popups with nested scanning`.

### Task 10: Entry API, search and overlay on the lexicon

**Files:**
- Modify: `server/internal/api/handlers_entries.go`, `handlers_search.go`, `server/internal/overlay/overlay.go`, `server/internal/model/model.go`; Create: `server/internal/lexicon/search.go`, `search_test.go`; Update tests: `handlers_entries_test.go`, `handlers_search_test.go`, `overlay_test.go`

**Interfaces:**
- Produces: `lexicon.Store.Search(ctx, q SearchQuery) ([]SearchHit, error)` with the same `SearchQuery`/tiers as today (exact form, exact reading plain, reading prefix, bopomofo prefix, gloss substring; kind/scheme/level filters; ranked within a tier by `uk`+pri then id). `GET /api/entries/{id}` and `GET /api/search` return the same JSON field names as before, with `written` = first form (else first reading), `readings` flattened, `senses` flat `[{dictionaryId,dictionaryName,packId,license,attribution,gloss}]` expanded from sense glosses, plus new `forms` and `senseGroups[{dictionaryId,dictionaryName,pos,tags,glosses,xrefs}]`. `overlay.Apply(userID, *model.Entry)` keeps overriding `written`/`readings` on the response struct.

- [ ] **Step 1: Write failing tests**: switch the fixtures of the three test files to seed via `ImportLexicon`; assert the unchanged JSON fields and the new `forms`/`senseGroups`; search tier order and kind filter; overlay still replaces readings.
- [ ] **Step 2: Run** `cd server && go test ./internal/api/ ./internal/overlay/ ./internal/lexicon/ -v` — FAIL.
- [ ] **Step 3: Implement** the lexicon-backed handlers and search; map the lexicon `Entry` onto the response structs.
- [ ] **Step 4: Run** the full gates — PASS. **Commit** `refactor(api): entry, search and overlay read the lexicon`.

### Task 11: Levels, sentences and sync on the lexicon

**Files:**
- Modify: `server/internal/levels/levels.go`, `server/internal/sentences/sentences.go`, `server/internal/sync/pull.go`, `sync.go`, `server/internal/api/handlers_levels.go`, `handlers_sentences.go`, `plugins/plugins.go` (pack-exists queries if table names change); update their tests and `server/cmd/qinqin/seed.go`

**Interfaces:**
- Consumes: `lexicon.Store.Best` (a word form resolves to the best-ranked entry; documented rule), `GetMany`.
- Produces: `levels.Import` / `sentences.ImportPack` resolve forms via `Best` and skip unknown ones as today; `level_members.entry_id`, `sentences.entry_id` and `user_edits.entry_id` now hold lexicon ids; sync `Delta.Entries` ships lexicon entries (forms, readings) and `Senses` in the new shape; frequency data is not synced.

- [ ] **Step 1: Write failing tests**: level and sentence fixtures resolve through the lexicon; JLPT/HSK membership of a word with several same-form entries picks the best-ranked one; sync pull from cursor zero returns lexicon entries and senses; `backdate` helpers use the lexicon tables.
- [ ] **Step 2: Run** `cd server && go test ./internal/levels/ ./internal/sentences/ ./internal/sync/ ./internal/api/ -v` — FAIL.
- [ ] **Step 3: Implement** the changes; make `seed` import levels and sentences after the lexicon dictionaries.
- [ ] **Step 4: Run** the full gates including `cmd/qinqin` (`seed_default_test.go`) — PASS. **Commit** `refactor: levels, sentences and sync use the lexicon`.

### Task 12: Tokenizer endpoints on the lexicon, delete the legacy layer

**Files:**
- Modify: `server/internal/segment/segment.go` and tests, `server/internal/api/handlers_segment.go`, `server/cmd/qinqin/seed.go`; Create: `server/internal/db/migrations/016_drop_legacy.sql`; Delete: `server/internal/entries/` (store, search, changes), the legacy importers in `server/internal/dict/import.go` and per-format `Import` paths no longer used, legacy tests that only covered them

**Interfaces:**
- Produces: `segment.Service{Lexicon lexicon.Store}` with the same `MatchAt` / `Segment` / `Match` / `Candidate` types and JSON (`entries[{id,kind,reading?}]` now lexicon ids); the old ranking rules (written beats reading; exact beats deinflected; `MaxReadingCandidates`) are preserved on top of `ByForm`/`ByReading`. Migration 016 drops the legacy tables (`entries, entry_links, readings, entry_attrs, senses`) and renames `lx_*` tables to final names (`entries, forms, readings, senses, entry_links, frequency, …`); update every SQL string in `lexicon`, `freq`, `lookup`, `levels`, `sentences`, `sync` accordingly. `seed` calls only `ImportLexicon`. `WordsContaining`/`wordchar` links are dropped.

- [ ] **Step 1: Write failing tests**: the existing segment tests (ordering rules, astral offsets, deinflection, reading hits) run against a lexicon seeded through the importers; `db_test.go` expects the final table names and no legacy tables; a full `seed` of `plugins/data` followed by a lookup of 為る/する/行 works end to end.
- [ ] **Step 2: Run** `cd server && go test ./... 2>&1 | tail -30` — FAIL.
- [ ] **Step 3: Implement** the port, the migration and the deletions; fix every remaining reference (`grep -rn "entries\\.Store\\|FROM entries\\|readings r" server`).
- [ ] **Step 4: Run** the full Go gates, `npm --prefix apps/web test`, `run check`, `run build` — PASS. **Commit** `refactor: remove the legacy dictionary layer`.

### Task 13: Jiten frequency pack, local-only packs, Sources page

**Files:**
- Create: `plugins/data/jiten-frequency/{manifest.json,freq.csv.gz,LICENSE,ATTRIBUTION.md}`, `scripts/fetch-jiten-frequency.sh`; Modify: `scripts/fetch-seeds.sh` (call the new script), `apps/web/src/routes/sources/+page.svelte`, `docs/sources.md`, `plugins/data/README.md`

**Interfaces:**
- Consumes: `freq-csv` format (Task 4). The pack manifest is `{id:"jiten-frequency", type:"frequency", format:"freq-csv", language:"ja", license:"CC BY-SA 4.0", ...}`.

- [ ] **Step 1: Confirm the licence from the publisher's own page** (`https://jiten.moe/frequency-dictionaries` and its terms) and record the exact URLs and the date in `ATTRIBUTION.md`. If the page does not state CC BY-SA 4.0 for the global frequency list, STOP and report: the pack then becomes local-only (`plugins/data-local/`, gitignored) and nothing is committed.
- [ ] **Step 2: Write the converter script** `fetch-jiten-frequency.sh` (download the published global list, convert to `term,reading,rank` gzip CSV, write the manifest); run it; the converted file is committed with the licence text.
- [ ] **Step 3: Write a failing test** in `server/cmd/qinqin/seed_default_test.go`: seeding the real `plugins/data` registers the frequency pack and `lookup` ranks 為る (past) above 下 for `した` using the real data.
- [ ] **Step 4: Run** it — FAIL, then wire the Sources page (reads the registered frequency packs with their name, licence, attribution) and `docs/sources.md` — PASS. **Commit** `feat(data): bundle the jiten frequency list`.

### Task 14: Docs and final verification

**Files:**
- Modify: `README.md` (Reading section, API table: new `GET /api/lookup`, the popup behaviour with Shift+hover, frequency packs and the local-only directory, seeding), `plugins/data/README.md`, `docs/superpowers/specs/2026-11-12-yomitan-lookup-design.md` (status and an Implementation notes section: schema, sort chain deviation, limits), `docs/superpowers/specs/2026-11-10-chinese-learning-platform-design.md` (data model section pointer)

- [ ] **Step 1:** Remove the "re-import JMdict" notes (no longer applicable) and document the new schema in prose (one entry per JMdict word; Chinese merged entry with all readings; POS per sense; frequency packs; Jiten attribution; how to add a local frequency pack).
- [ ] **Step 2:** Run all gates once: `cd server && go vet ./... && go test ./... && go test -race ./internal/lexicon ./internal/lookup ./internal/freq ./internal/dict`, `npm --prefix apps/web run check`, `npm --prefix apps/web test`, `npm --prefix apps/web run build` — PASS.
- [ ] **Step 3:** Real-app smoke on a freshly seeded data dir (127.0.0.1): hover `した` (為る first with frequency, then 下, 舌), `いる` (居る first), a Chinese word with traditional text (`學習`), a polyphone (`行`: one entry, both readings), Shift+hover on an xref inside a popup, Esc, outside click; report what appeared. **Commit** `docs: yomitan-style lookup`.
