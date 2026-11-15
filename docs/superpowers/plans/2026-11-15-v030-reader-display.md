# Reader display settings and smart reading hiding (#78, v0.3.0 item 6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (a fresh
> implementer per task, test first — write the test, SEE it fail, implement, see it pass — an
> independent review on the strongest model, one fix wave per branch, a whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Rules: `/home/user/qinqin-v030/AGENT-RULES.md`.

**Goal:** per-workspace reader settings (book ruby on/off, dictionary readings never/always/smart,
threshold, ruby size, font), generated pinyin/furigana from the segmenter, smart hiding of readings
of known words with tap/hover/keyboard reveal, without breaking the reader's DOM mapping.

**Spec:** `docs/superpowers/specs/2026-11-15-v030-reader-display-design.md` (binding rulings). Owner
scope: reader only.

**Order / prerequisites:** after item 1 (`readContract`, `lib/testing/contracts.ts`), item 3 (`cardScore` exported from `lib/study/mastery.ts`) and the
decks view (its `deck-stats.json` fixture defines `cardScore` cases) are merged. Independent of the
PWA and backup branches. No migration.

**Architecture:** one Go change (`POST /api/segment` `readings` flag in
`server/internal/api/handlers_segment.go` + `server/internal/segment`), pure modules in
`apps/web/src/lib/plugins/reader/`: `displaySettings.ts`, `fonts.ts`, `furigana.ts`, `smartReadings.ts`,
`annotations.ts` (chunking, loader, LRU), `reveal.ts`; components `DisplayPanel.svelte` (new),
`ChapterText.svelte`, `BookView.svelte`; `dom.ts` extended.

**Tech stack:** Go 1.26 (Docker), SvelteKit 2 / Svelte 5, vitest + jsdom. No new dependencies.

**Worktree:** `WT=/home/user/www/github/qinqin/.claude/worktrees/v030-reader-display`, created with
`git worktree add -b feature/v030-reader-display .claude/worktrees/v030-reader-display feature/v0.3.0`;
`npm --prefix $WT/apps/web ci` once.

## Gates

```bash
SP=/tmp/claude-1000/-home-user-www-github-qinqin--claude-worktrees-feature-reader/768f9452-f6f2-4d96-9ec8-321a7a58ebb3/scratchpad
GO() { docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e GOPATH=/gp -e GOCACHE=/gc \
  -v $SP/gp-m:/gp -v $SP/gc-m:/gc -v $WT:/src -w /src/server -e GOTOOLCHAIN=auto \
  -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "$*"; }
# Task 1: GO "go vet ./internal/segment/ ./internal/overlay/ ./internal/api/ && go test -p 2 -run 'Segment|Readings' ./internal/segment/ ./internal/overlay/ ./internal/api/"
# web (Tasks 2–10): npm --prefix $WT/apps/web run check; echo $?; npm --prefix $WT/apps/web test; echo $?
# last task: GO "go vet ./... && go test -p 2 -timeout 30m ./..." and the web gates incl. run build
```

After each gate `git -C $WT status --short` shows only the task's files; `find $WT -user root` empty.
One commit per task, conventional, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Never merge or push.

## Global constraints

- Reader only: no change to entry pages, flashcards, study cards, journal (grep the diff: no file
  outside `lib/plugins/reader/`, `lib/api/segment.ts`, `lib/api/types.ts` (`SegmentMatch`), the Go
  segment, segment handler and `overlay` files, docs and contracts).
- "Known" uses `cardScore` from `lib/study/mastery.ts` on **vocab** cards only; the threshold is the
  setting, default `MASTERY_THRESHOLD`.
- `dom.ts` contract: selection offsets map identically with readings on and off (round-trip tests).
- Hidden readings use `visibility: hidden` (no reflow on reveal); words never become tab stops.
- Fixtures use the contract format `{"version":1,"rule":"…","cases":[…]}` read by `readContract`
  (`lib/testing/contracts.ts`) and get a line in `docs/contracts/README.md`.

## Rulings (plan-specific)

- Ruling: the overlay for readings is applied by one `SELECT entry_id, readings FROM user_edits
  WHERE user_id = ? AND entry_id IN (…)` per request (chunks of 500 ids) in a new
  `overlay.Readings(ctx, db, userID, ids) (map[int64][]Reading, error)` that decodes the stored JSON
  exactly like `overlay.Apply` — cost if wrong: none.
- Ruling: Japanese kana folding for alignment is katakana→hiragana plus the long-vowel mark kept
  literally — enough for dictionary readings vs. surface kana — cost if wrong: a few words get no
  furigana (never a wrong one).
- Ruling: annotations are memory-only (LRU 6 chapters), never persisted — they depend on mastery,
  which changes with every review — cost if wrong: one re-segmentation per reopened chapter.

## Tasks

### Task 1 — Readings in `POST /api/segment`

Files: `server/internal/segment/segment.go` (`Match.Reading *Reading` with `json:"reading,omitempty"`,
`type Reading struct{Type, Value string}`; filled from the top result's `Readings` by an option),
`server/internal/api/handlers_segment.go` (`segmentRequest.Readings bool`; overlay lookup for the
caller), `server/internal/overlay/overlay.go` (`Readings`), `apps/web/src/lib/api/types.ts`
(`SegmentMatch.reading?: {type, value}`); tests in all three packages.
- [ ] Test first: without the flag the JSON is byte-identical to today (golden); zh match gets
  `{"type":"pinyin",…}`; ja form match gets the entry's first kana reading, kana-only reading match gets
  the matched one; the caller's overlay readings replace the shared ones, another user's overlay does
  not; unauthenticated 401 unchanged; 5 000-rune cap unchanged.
- [ ] Commit `feat(segment): optional readings with the caller's overlay`.

### Task 2 — Display settings model and font stacks

Files: `apps/web/src/lib/plugins/reader/displaySettings.ts` (new: `type ReaderDisplay`,
`DEFAULT_DISPLAY`, `parseDisplay(settings: Record<string, unknown> | null, localFurigana: boolean |
null) → ReaderDisplay`, `displayPatch(change: Partial<ReaderDisplay>) → {reader: …}`),
`apps/web/src/lib/plugins/reader/fonts.ts` (new: `fontStack(font, lang) → string`), tests,
`docs/contracts/reader/display-settings.json`.
- [ ] Test first (fixture): defaults; each field invalid → its default; `smartThreshold` clamped to
  10–100 integer; `rubyScale` snapped to the four values; `bookRuby` falls back to the local
  `furigana` pref, then `true`; unknown keys inside `reader` preserved by `displayPatch`; font stacks
  for zh/ja × four fonts contain only system families and end with a generic family.
- [ ] Commit `feat(reader): per-workspace display settings model`.

### Task 3 — Furigana alignment

Files: `apps/web/src/lib/plugins/reader/furigana.ts` (new: `alignFurigana(surface, lemma, reading)
→ {text: string, rt?: string}[] | null`), `furigana.test.ts`, `docs/contracts/reader/furigana-align.json`.
- [ ] Test first (fixture): 漢字/かんじ; 食べました/食べる/たべる → 食(た)べました; お茶/おちゃ
  → お 茶(ちゃ); 取り扱い/とりあつかい → 取(と)り扱(あつか)い; katakana reading; mismatch → null;
  surface without Han → null; lemma ≠ surface prefix (irregular) → null.
- [ ] Commit `feat(reader): align furigana with okurigana`.

### Task 4 — Mastery index and the smart rule

Files: `apps/web/src/lib/plugins/reader/smartReadings.ts` (new: `masteryIndex(cards, reviews, nowMs,
weights) → Map<number, number>`; `isKnown(match, index, threshold) → boolean`;
`annotateParagraph(runs, matches, index, display) → Piece[]` with `Piece = {start, end, rt?: string,
concealed: boolean, source: 'book' | 'dict'}` in paragraph code points; zh readings via
`formatReading`, ja via `alignFurigana`), tests, `docs/contracts/reader/smart-readings.json`.
- [ ] Test first (fixture): vocab-only and max per entry; threshold edge (score = threshold → known);
  `never` → only book ruby per `bookRuby`; `always` → nothing concealed; `smart` → known matches
  concealed, unknown shown; a match on a run with book ruby yields no dict reading; book-ruby run
  concealed only when all its Han characters are inside known matches; characters outside matches
  never known; `bookRuby: false` hides book ruby in every mode.
- [ ] Commit `feat(reader): smart reading rule from card mastery`.

### Task 5 — Chunked segmentation loader

Files: `apps/web/src/lib/api/segment.ts` (new or extended: `segment(lang, text, {readings, signal})`),
`apps/web/src/lib/plugins/reader/annotations.ts` (new: `chunkParagraphs(paragraphTexts, startIndex,
maxCodePoints = 4000) → {paragraphs: number[], text: string, offsets: number[]}[]` in visit order;
`createAnnotationLoader({segment, concurrency: 2, lru: 6})` with `load(key, paragraphs, start,
onParagraph)` and `abort()`; matches mapped back to paragraph offsets), tests.
- [ ] Test first: chunks ≤ 4 000 code points (astral characters counted once); a long paragraph split
  at `。！？!?`, else hard; order = visible paragraph, onward, backward; paragraph offsets correct
  across chunk joins (a newline separator never yields a match); concurrency never above 2; abort
  stops callbacks; LRU hit makes no request; a failed chunk leaves its paragraphs plain and is retried
  on the next load.
- [ ] Commit `feat(reader): load readings chapter by chapter`.

### Task 6 — DOM mapping with readings inside pieces

Files: `apps/web/src/lib/plugins/reader/dom.ts` (a `[data-o]` piece may be `<ruby>` with an `<rt>`;
lengths from the first text node; points inside any `<rt>` → `inRt: true`), `dom.dom.test.ts` (new, jsdom project).
- [ ] Test first: for paragraphs rendered with dict ruby pieces, book ruby, highlights and both,
  `runPointAt` and `rangeForSpan`/`selectionSpan` round-trip every code-point offset; a caret inside an `<rt>`
  reports `inRt`; existing tests unchanged.
- [ ] Commit `feat(reader): map selections across generated readings`.

### Task 7 — Rendering readings in ChapterText

Files: `apps/web/src/lib/plugins/reader/ChapterText.svelte` (new prop `pieces: Map<number, Piece[]>`
and `display`; runs cut by highlight segments and pieces — a piece crossed by a highlight edge or run
boundary renders without `rt`; `<rt class="concealed">`; CSS vars `--reader-rt-size`, `--reader-font`;
`ruby:hover > rt.concealed`, `.revealed > rt` visible), `highlightUi.ts` (`groupSegsByRun` takes the
extra cut points), `ChapterText.dom.test.ts` (new).
- [ ] Test first: zh paragraph with `always` shows `<ruby data-o><rt>nǐhǎo`-style readings; `smart`
  marks known words' `rt.concealed`; book ruby + `bookRuby:false` → no `<rt>`; highlight across half
  a word → that word has no `rt`; `selectionSpan` over a passage with readings returns the same span
  as without (jsdom ignores `user-select`, so the stylesheet rule `rt { user-select: none }` is
  asserted to stay present instead of `Selection.toString()`); `lang`
  attribute kept; computed style vars set from `display`.
- [ ] Commit `feat(reader): show dictionary readings and conceal known ones`.

### Task 8 — Reveal controller

Files: `apps/web/src/lib/plugins/reader/reveal.ts` (new: `createReveal({now, setTimer})` with
`tap(el)` → adds `revealed` for 4 s, `toggleAll()`, `isAllShown`; key handler `revealKey(e, ctx)`
for `R` outside fields), wiring in `ChapterText.svelte` (delegated `pointerup` without drag on
`ruby:has(rt.concealed)`), `reveal.test.ts`, extend `ChapterText.dom.test.ts`.
- [ ] Test first (fake timers): tap reveals then hides after 4 s; a second tap restarts the timer; a
  drag (pointer moved > 6 px) reveals nothing; the lookup handlers still receive the events; `R` in an
  input does nothing; `R` in the reader toggles all; chapter change resets.
- [ ] Commit `feat(reader): reveal hidden readings by tap, hover or keyboard`.

### Task 9 — Display panel and BookView wiring

Files: `apps/web/src/lib/plugins/reader/DisplayPanel.svelte` (new: disclosure with `aria-expanded`,
Escape closes, focus returns; Book ruby (only if the book has ruby), Readings radio, threshold slider
10–100 step 5 with the sentence and a link to Stats → Characters, Ruby size radio, Font radio, Show
all readings `aria-pressed`), `BookView.svelte` (replaces the Furigana checkbox; reads the book's
workspace settings via `lib/workspaces.ts`; `masteryIndex` from `loadStudyHistory(workspaceId)`, rebuilt
after Add to study; loader started only when `readings ≠ never`; saves via `setSettings` debounced
400 ms; failed save → existing notice, local state kept), `prefs.ts` (stops writing `furigana`;
`variant` unchanged), `DisplayPanel.dom.test.ts`, `BookView` dom test if present (else
`displayController.ts` pure + test).
- [ ] Test first: each control writes the right `{reader:{…}}` patch once after 400 ms; threshold
  slider only in Smart; Book ruby control hidden for a book without ruby; Escape returns focus to the
  Display button; `never` + no book ruby makes no segment request; switching to Smart loads once.
- [ ] Commit `feat(reader): display settings panel`.

### Task 10 — Docs, contract and real-app check (no browser)

Files: `docs/contracts/reader/README.md` (settings object, smart rule, alignment, segment `readings`
flag; Android notes), `docs/contracts/README.md` index line, `README.md` (reader features line).
- [ ] Full Go and web gates incl. `run build`.
- [ ] Real app (copy `$WT` to `$SP/reader-app`; repo Dockerfile with `WITH_OCR=0 WITH_AUDIO=0`; free
  127.0.0.1 port; `qinqin seed`): register; create zh and ja workspaces; `PUT /api/workspaces/{id}`
  `{"settings":{"reader":{"readings":"smart","smartThreshold":70}}}` then `{"settings":{"audioAutoplay":true}}`
  → GET shows both keys merged; `POST /api/segment` `{"lang":"zh","text":"你好，世界","readings":true}`
  shows pinyin; ja `食べました` shows lemma 食べる with reading たべる; set an overlay reading on 你好
  and see it in the segment response for that user only (second user unchanged); without the flag the
  response has no `reading`; time one 4 000-character zh request (`curl -w %{time_total}`) and put the
  number in the report. Remove container, image and copy.
- [ ] Commit `docs: reader display settings and smart readings`.

## Review Focus

1. **Scope:** only the reader changed; study answers, entry pages and cards untouched.
2. **One mastery definition:** `cardScore` on vocab cards, threshold from settings; fixture shared with
   the decks view's score cases.
3. **No wrong readings:** alignment returns null on doubt; book ruby wins; overlay per caller only.
4. **DOM contract:** selection/highlight/bookmark offsets identical with readings on/off; no reflow on
   reveal; `rt` never selected or copied.
5. **Performance:** no segmentation in `never`; ≤ 2 requests in flight; abort on chapter change; LRU;
   one mastery replay per open.
6. **a11y:** Display panel keyboard and focus; concealed readings out of the accessibility tree;
   `R` and Show all readings as the keyboard path; no tab stop per word.

## Contract notes

- `docs/contracts/reader/display-settings.json` — the `reader` settings object and its parse rules (Task 2).
- `docs/contracts/reader/furigana-align.json` — alignment cases (Task 3).
- `docs/contracts/reader/smart-readings.json` — the smart rule incl. book ruby, using `cardScore`
  (Task 4).
- `docs/contracts/reader/README.md` — the segment `readings` flag (`reading: {type, value}` on matches,
  overlay applied) and that Android's reader must honour the same settings object per workspace.
