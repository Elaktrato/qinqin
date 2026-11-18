# Search master–detail and the dictionary entry page (issue #104) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it FAIL, implement,
> see it PASS.

**Goal:** search and the dictionary entry look and work like design §9 "Search" and "Dictionary entry".
**Search** (desktop): the results list on the left — an underline search field with a By-parts button,
filters as text options, a count line, one row per result (word large, reading, gloss, kind · level) — and the
selected entry beside it (master–detail); the URL reflects the query, the filters and the selected entry, so
it can be shared. On the phone: the list, then the entry as its own page. **Entry**: a header (word large, the
variant small, readings — pinyin + zhuyin / kana — play, chips: level, frequency rank, kind, "In N decks" in
`good`; actions **Add to deck** (primary) and Edit); a main column (meanings grouped by dictionary with source and
licence, examples with the target word in the accent, related words); a side column (characters: glyph,
reading, gloss, radical, strokes, level; the stroke-order player with Play, Loop and progress; the learner's
note). Character entries keep their radical section and "characters under this radical". Phone: one column,
Add to deck in the top bar. What search and entries do (ranking, filters, lookup history, audio, notes,
editing, add to study, view events) does not change; the data additions are a gloss and levels per search hit
and the component characters of a word.

**Design (binding):** `docs/superpowers/specs/2026-11-16-visual-rework-design.md` §5, §6, §9 "Search" and
"Dictionary entry", §11 ("the search URL shape" is the builder's); mockups
`docs/superpowers/specs/assets/2026-11-16-visual-rework-mockups.html` sections "Search" (`.se-panel`,
`.se-left`, `.sfield`, `.sfilters`, `.scount`, `.slist`, `.sr-row`, `.sr-w`, `.sr-r`, `.sr-g`, `.sr-b`,
`.se-entry`) and "Dictionary entry" (`.en-panel`, `.en-head`, `.en-word`, `.en-var`, `.en-reads`,
`.en-badges`, `.lk-c`, `.lk-c.on`, `.en-acts`, `.en-main`, `.en-sec`, `.en-k`, `.en-gl`, `.en-sent`,
`.en-rel`, `.en-side`, `.ec`, `.en-stroke`, `.en-sbtn`, `.se-note`, `.en-phone`) with the Lighter weight.
Direction: `docs/superpowers/directions/2026-11-17-visual-rework.md`. The planner read the mockup's HTML and
CSS; the builder opens it with Playwright in Task 15 to compare.

**Builds on:** #96 (tokens incl. `--reading-accent`, `--good`, `--readable-*`, `--selected-wash`, `--hair`),
#97 (`--font-hanzi`), #98 PART A (`lib/ui`: Button, IconButton, Tooltip, Field, Menu/MenuItem, Chip, Section,
Icon with `search`, `parts`, `draw`, `play`, `pause`, `repeat`, `add`, `edit`, `back`, `expand-down`),
**#98 PART B** — a concurrent agent (branch `feature/vr-tokens`) migrates every component's literal colours to
tokens, including `routes/search`, `routes/entry`, `lib/components/{StrokePlayer,Senses,Sentences,Badges,
Readings,AddToStudy}` (StrokePlayer's `#0b6bcb` stroke colour onto `--accent` read at runtime). **Build on the
token-migrated tree:** start only after `feature/vr-tokens` is merged into `feature/visual-rework` and
`apps/web/src/lib/ui/lint/pending.json` lists none of these files; if not, stop and report. Also after #99
(frame: `setFrameTitle`, the 720px phone switch, the page-actions slot if it provides one), #102 (the lookup
`levels` helper, `AddToStudyButtons` on `Menu`) and #103 per the direction's order.

## Architecture

- **Server: search hits carry a gloss and levels.** `GET /api/search` hits gain `glosses:
  [{dictionaryId, gloss}]` — the first gloss of each dictionary in the order the entry lists its senses, at most
  3, taken from the senses `GetMany` already loads (active dictionaries only; no new query) — and `levels:
  [{scheme, level}]` (lowest level per scheme, always an array) from one batched query over the hit ids. The
  levels helper is the one #102 adds for lookups; if it lives in `internal/lookup`, this task moves it to
  `internal/levels` as `LowestPerScheme(ctx, db, ids) (map[int64][]Level, error)` and both callers use it.
  The web type `SearchHit` gains both fields.
- **Server: a word's characters.** The entry response (`GET` and `PUT /api/entries/{id}`, built by
  `buildEntryResponse`) gains `characters: [{id, written, reading: {type, value} | null, gloss, radical: {id,
  written} | null, strokes, levels}]` for `kind = word` in zh and ja: the distinct Han characters of the written
  form in order (at most 8), each resolved to the character entry of the same language with that written form
  (lowest id), strokes from `attrs.strokes`, the first reading and the first gloss (active dictionaries),
  levels as above. `[]` for characters, other languages and characters without an entry. A fixed number of
  queries per entry (one for the character entries, one for their radicals' written forms, one for levels;
  senses via `GetMany`) regardless of the word's length. Web type `Entry.characters`.
- **Search URL shape (web only).** `/search?q=<query>[&kind=character|word][&scheme=<packId>][&level=<name>]
  [&e=<entryId>]`. `searchHref(q, filters, entryId?)` writes the keys in that order, omitting empty ones;
  `selectedFromParams(params)` reads `e` (a positive safe integer, else none). A new submitted query drops `e`;
  a filter change keeps it; `reconcileFilters` keeps it.
- **Search page (`routes/search/+page.svelte`).** A two-pane grid (`minmax(18rem, 24rem) minmax(0, 1fr)`) at
  ≥ 720px with a `--hair` line between; one pane below. Left: the field (lib/ui `Field` type search, label
  visually hidden, a search icon, a submit IconButton "Search", and for Han languages an IconButton "By parts"
  linking `/search/parts`), the filters as text options (`All / Words / Characters` as `aria-pressed` text
  buttons with a 1.5px accent underline on the pressed one; "Level: any ▾" as a `lib/ui/Menu` with radio items
  "Any level", then per scheme its levels; "Clear filters" as plain text when a filter is set), the count line
  ("{count} results for {query}" or the capped note), the list (`ResultRow.svelte`), and a foot link "Lookup
  history". Right: `EntryView` (below) for the selected entry. Each row is a link to the search URL with
  `e=<id>`: on click (≥ 720px) `goto(href, {replaceState: true, keepFocus: true, noScroll: true})`, below 720px
  a normal push navigation (so Back returns to the list). Middle-click / open in a new tab get the real URL.
  The selected row has `aria-current="true"`, `--selected-wash` and an accent start bar. Below 720px: with `e`
  the list is hidden and the entry shows with a "Back to results" link (the URL without `e`); without `e` only
  the list shows. Without `e` on wide screens the detail previews the first result (row 1 not marked current,
  nothing recorded). ArrowDown / ArrowUp move focus between rows (Home / End to the ends).
- **`ResultRow.svelte` (new).** Word (`--font-hanzi`, 1.5rem, regular weight, `lang`), the first reading in
  `--reading-accent`, the first gloss not in a hidden dictionary (`hiddenDictionaries`) muted and ellipsed, and
  "Word · HSK 5" (kind label · the first level, muted small). The link's accessible name is the word; reading,
  gloss and kind/level are its description (`aria-describedby`), so a screen reader hears "勤奋, link, qínfèn,
  diligent, Word · HSK 5".
- **`EntryView.svelte` (new, `lib/entry/`)** — the whole entry, used by `/entry/[id]` (heading level 1) and the
  search detail (level 2). Props `{entryId, headingLevel, editing?, oncloseeditor?, recordView}`. It owns what
  the route owns today: the load with the stale-response guard, not-found and error states with retry, the
  extras (radical, characters under it), audio, the view event (once per entry per mount, only when
  `recordView`), the editor switch, the note. Layout with a **container query** (`container-type:
  inline-size`): ≥ 48rem two columns (`minmax(0, 1fr) 17rem`, main + side, `--hair` between); below one column
  in the order header, meanings, characters, stroke order, examples, related, note, radical sections.
  - `EntryHeader.svelte`: the word (`--font-hanzi`, 3.5rem, weight 400), the variant(s) small with their label
    ("traditional" / "simplified" from the form flags or the variant's script; plain "Variant" otherwise) as
    links, "Also written" (ja forms, as today), the readings line (`Readings` restyled: pinyin in the reading
    accent, zhuyin / kana muted, play as an IconButton "Play {word}"), the chips (`lib/ui/Chip`: each level
    badge — derived ones keep their "≈" and explanation —, "#4,812 in frequency" via `formatNumber`, the kind,
    "In 2 decks" with `tone="good"`; the language chip only when it differs from the current workspace's), and
    the actions: **Add to deck** (primary) and Edit (secondary link to `?edit=1`; on the search detail it links
    to `/entry/<id>?edit=1`).
  - Add to deck: `AddToStudy.svelte` restyled to the reader's pattern (#102): a primary "Add to deck" (one click
    to the selected deck, General by default, as today) and a small IconButton "Choose a deck" opening
    `lib/ui/Menu` (the `<select>` goes); in a deck: "In study deck" with a check icon (as today).
  - Main: `Senses.svelte` restyled as "Meanings · {dictionary}" Sections — numbered glosses, part of speech
    muted (from `senseGroups` when present), the source and licence line small muted with the licence link (as
    today); the hidden-dictionaries reveal kept. `Sentences.svelte` as "Examples": each sentence in the study
    font with the target word in the accent (`markTerm`), the translation muted, the source line; the
    learner's own sentence form unchanged. `EntryRelated.svelte` (new): "Related" — the dictionaries'
    cross-references (`senseGroups[].xrefs` through the reader's `parseXref`), distinct, the word itself
    excluded, as links to `/search?q=<headword>`; hidden when there are none.
  - Side: `EntryCharacters.svelte` (new; words): one row per `characters` item linking to the character
    entry — glyph large, the reading in the accent, the gloss, then "Radical 力 · 13 strokes · HSK 5" small
    muted (each part only when known). The stroke-order player (`StrokePlayer.svelte` restyled): zh only, for a
    character entry its glyph, for a word the character picked with small `aria-pressed` glyph buttons above
    the player (first by default); controls Play / Pause, Loop (`aria-pressed`) and a progress line "勤 · 3 of
    13" driven by `animateStroke` per stroke (hanzi-writer 3.7.3 has it) and the stroke count of the data;
    stroke colours read from `--accent` / `--line` at runtime. `EntryNote` as "Your note" (unchanged logic).
    Character entries: the radical section and "Characters under this radical" stay (restyled: unboxed rows,
    no bordered pills).
  - "In N decks": `decksContaining(studyData, entryId)` (pure, `lib/entry/decks.ts`) over the shared
    `getStudyData` cache — the number of distinct decks with a card of the entry in the current workspace;
    nothing when signed out, no workspace, 0, or the load fails.
  - Frequency rank: one `POST /api/entries/frequency-ranks` (`lib/api/frequency.ts`) with the entry id; nothing
    when signed out or without a ranking pack.
- **Entry route (`routes/entry/[id]/+page.svelte`).** Thin: parses the id, renders `EntryView` with heading
  level 1 and `recordView`, calls `setFrameTitle(written)`. On the phone, "Add to deck" also goes into the
  frame's phone top bar through the page-actions slot if #99 provides one; otherwise the header's own button
  stays first in the one column (see Rulings).

**Tech stack:** Go (lexicon / levels / api), SvelteKit 2 / Svelte 5, vitest + jsdom, hanzi-writer 3.7.3
(present). **No new dependency.**

**Branch / worktree:** `feature/vr-search-entry` at `/home/user/www/github/qinqin/.claude/worktrees/vr-search-entry`
(`<wt>`), cut from `feature/visual-rework` after #98 PART B, #99, #102 and #103 are merged into it (record the
commit). The orchestrator merges and pushes; never push, merge, tag, rewrite history or touch `main`, the
`qinqin` container or `/home/user/qinqin-deploy`.

## Gates

- Toolchain: `export PATH=/home/user/qq-tools/goroot/bin:/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH`.
- Go (Tasks 2–3), from `<wt>/server`: `flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u
  https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l .
  ; go vet ./internal/lexicon/... ./internal/levels/... ./internal/lookup/... ./internal/api/... && go test
  -count=1 -p 2 -timeout 30m ./internal/lexicon/... ./internal/levels/... ./internal/lookup/...
  ./internal/api/...'`; the full `./...` once before the last commit (the `internal/ai` IPv6 test and the known
  timing tests may fail only under load or without IPv6; rerun alone and record).
- No new route: no `route{}` row, no PWA routes fixture change; `node <wt>/scripts/gen-api-docs.mjs` leaves
  `docs/wiki/API-Routes.md` unchanged (the response fields are documented in the wiki, Task 14).
- Web: `npm --prefix <wt>/apps/web ci` once; per task `cd <wt>/apps/web && npx vitest run <paths>` (fail
  first, then pass); `npm run check` before each commit that touches Svelte; `npx vitest run src/routes/search
  src/routes/entry src/lib/entry src/lib/components` after every search/entry task; the colour lint `npx vitest
  run src/lib/ui/lint`, the i18n tests `npx vitest run src/lib/i18n` and the doc tests `npx vitest run
  src/lib/contractsDocs.test.ts src/lib/wikiDocs.test.ts` when their inputs change; full `npx vitest run` and
  `npm run build` (Node 26) before the last commit. Never two builds in one worktree at once. Read exit codes.
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git status` clean after each commit.

## Global constraints

- **Tokens only** (the #98 lint is live): no literal colours, no `prefers-color-scheme`; readings
  `--reading-accent`, the target word in examples `--reading-accent` (accent text that reaches 4.5:1, else
  `--text` weight 600 — the #96 rule), "In N decks" `Chip tone="good"`, separators `--hair`, secondary text
  `--readable-muted`; shadows only on the Menu.
- **§5:** no boxes around results, sections or character rows (hover `--raised`, selected `--selected-wash` +
  accent start bar); one primary action per view (search page: none in the list — the detail's "Add to deck" is
  the view's primary; entry: "Add to deck"); filters are text, not bordered pills; labels sentence case, no
  all-caps (the uppercase section labels go); type tops out at 600, the big word 400.
- **Never colour alone:** the pressed filter has `aria-pressed` and an underline; the selected row
  `aria-current` and a start bar; "In N decks" has its text and the dot; derived level badges keep "≈" and their
  explanation; the example's target word is also `<b>` (weight) for forced colours.
- **Strings:** new strings in `apps/web/src/lib/i18n/messages/en.json` (sorted) via `t()` / `<Msg>`; numbers
  via `formatNumber`; no literal `lang` (CJK text keeps `lang={studyLang(…)}`, readings `readingLang`).
- **Privacy and events unchanged:** a typed query is never recorded; selecting a result records the lookup
  (source `search`) once, as opening a result does today (click, Enter, middle click); the first-result
  preview records nothing; a `view` event is recorded once per shown entry when it was selected or opened from
  a URL, as the entry page does today.
- **Accessibility:** the result count stays a polite live region; the search form keeps `role="search"`;
  focus stays on the row after a selection on wide screens; on the phone the entry heading receives focus after
  navigation; "Back to results" is a link; the stroke player's progress is `aria-live="off"` (visible text
  only, not chatty) and its buttons have names; `prefers-reduced-motion`: the stroke animation does not
  autoplay (it never did) and the row/section transitions use `--motion-*`.

## i18n keys (new; English text)

| Key | Text |
| --- | --- |
| `search.byParts` | By parts |
| `search.count` | {count, plural, one {# result for “{query}”} other {# results for “{query}”}} |
| `search.filters.all` | All |
| `search.filters.levelMenu` | Level: {level} |
| `search.filters.anyLevel` | any |
| `search.filters.schemeLevel` | {scheme} {level} |
| `search.backToResults` | Back to results |
| `search.detail` | Selected entry |
| `search.kind.word` | Word |
| `search.kind.character` | Character |
| `search.rowKindLevel` | {kind} · {level} |
| `entry.page.meaningsFrom` | Meanings · {dictionary} |
| `entry.page.examples` | Examples |
| `entry.page.related` | Related |
| `entry.page.characters` | Characters |
| `entry.page.strokeOrder` | Stroke order |
| `entry.page.yourNote` | Your note |
| `entry.page.variantLabel` | {form} ({label}) |
| `entry.page.traditional` | traditional |
| `entry.page.simplified` | simplified |
| `entry.page.variant` | variant |
| `entry.chips.frequency` | #{rank} in frequency |
| `entry.chips.inDecks` | {count, plural, one {In # deck} other {In # decks}} |
| `entry.chips.word` | Word |
| `entry.chips.character` | Character |
| `entry.char.meta` | Radical {radical} · {strokes, plural, one {# stroke} other {# strokes}} |
| `entry.char.level` | {meta} · {level} |
| `entry.strokes.pause` | Pause |
| `entry.strokes.progress` | {char} · {n} of {total} |
| `entry.strokes.pick` | Show the strokes of {char} |
| `entry.study.chooseDeck` | Choose a deck |
| `entry.play` | Play {word} |

Reuse: `search.submit` (the submit IconButton's name), `search.lookupsLink`, `search.capped`,
`search.filters.clear`, `entry.page.radical`, `entry.page.underRadical`, `entry.page.alsoWritten`,
`entry.study.*`. Removed when unused (the catalogue test fails on unused keys): `search.partsLink` (the By-parts
button replaces it), `search.matched` / `search.matchedWritten` if the row no longer says which field matched
(see Rulings), `entry.page.variants`, `entry.badges.title` if the chips have no heading. Record each removal.

## Rulings

- Ruling: the search URL is `/search?q=&kind=&scheme=&level=&e=` — today's keys plus `e` for the selected
  entry id; a submitted query drops `e`, a filter change keeps it — query and filters are already in the URL
  (shareable today), `e` is the smallest addition, and the id is stable — cost: a shared link with `e` shows
  that entry even if the recipient's filters would hide it (the detail still shows it; the row is absent).
- Ruling: selecting a result replaces the history entry on wide screens and pushes one on the phone (checked
  with `matchMedia('(min-width: 720px)')` at click time) — stepping through results should not fill Back on the
  desktop, while on the phone Back must return to the list — cost: none; the link's `href` is the same in both.
- Ruling: one layout switch for search at the frame's 720px (CSS), and a container query (48rem) inside
  `EntryView` for its two columns — the same component then fits the search detail and the full page — cost:
  container queries need a current browser (all supported ones have them).
- Ruling: without `e`, wide screens preview the first result in the detail, unmarked and unrecorded — the mock
  shows an entry beside the list, and recording a preview would inflate views and lookups — cost: a link copied
  before choosing a row does not name the entry.
- Ruling: no Draw button — qinqin has no handwriting recogniser; adding one is a feature, not a restyle (§2
  non-goal) — cost: the field has one button where the mock draws two; a follow-up issue is filed by the
  orchestrator.
- Ruling: search hits carry `glosses` (first gloss per dictionary, ≤ 3) and the web picks the first not hidden
  by the workspace — the route is public and does not know the workspace's hidden dictionaries — cost: a few
  bytes per hit; a user's overlay edits (#37) are not applied to the list's gloss (the entry page applies them).
- Ruling: the row no longer prints "matched pinyin" — the mock's row is word, reading, gloss, kind · level; the
  match source stays in the data — cost: a person cannot see why a gloss match ranked (rare; the gloss shows it).
- Ruling: a word's characters come from the entry response (`characters`), not from the client — the design
  needs reading, gloss, radical, strokes and level per character, and only the server has them in one place —
  cost: an additive field and three batched queries per entry view.
- Ruling: "Related" is the dictionaries' cross-references linked to search (no "words containing this
  character" query, no antonyms) — the data exists; inventing relations is a feature — cost: the section is
  missing for entries without cross-references, and the mock's "opposite" label is not shown.
- Ruling: the variant shown small beside the word is the entry's variants (zh traditional/simplified partners)
  labelled from their forms' flags; "Also written" stays for ja forms — both exist today as separate sections —
  cost: none.
- Ruling: Add to deck keeps one-click add to the selected deck (General) and moves the deck choice into a
  "Choose a deck" Menu, as the reader's popup does (#102) — one pattern everywhere — cost: the deck `<select>`
  disappears.
- Ruling: the phone's Add to deck goes into the frame's phone top bar only through a page-actions slot that #99
  provides (the reader plan made the same request); without one, the header's own button stays first in the
  one column and a follow-up is noted for #99 — cost: depends on #99's API.
- Ruling: the stroke player stays zh only (the stroke data package covers hanzi) and shows one character at a
  time; a word picks the character with small glyph buttons — cost: Japanese entries show no stroke order, as
  today.
- Ruling: the language chip shows only when the entry's language differs from the current workspace's — the
  flag already says the language — cost: none.
- Ruling: `/search/parts` and `/lookups` are not restyled here ("pages not mocked", #106) beyond PART B —
  cost: none.

## Review focus

URL shape and history (reload, share, Back on phone and desktop, a bad `e`, `e` with no results, filter
reconcile keeping `e`); events and privacy (no typed query recorded, one lookup per selection, no record for
the preview, view events not doubled between the search detail and the entry page); the server additions
batched (no N+1 — a test counts queries), additive and documented, public-route safe (no user data in search
hits), `characters` correct for zh and ja and empty otherwise; keyboard and screen-reader paths (rows,
filters Menu, the detail heading, Back to results, stroke player controls); container-query layout at
1024/1440 and phone; no literal colours; the existing search (31) and entry (13) dom tests unchanged except
recorded forced changes.

## Tasks

### Task 1: This plan

- [x] Written in the planning commit `docs: plans for the journal and for search and the entry page (#103, #104)`.

### Task 2: Search hits carry glosses and levels (server)

Files: `server/internal/levels/levels.go` (or a new `lowest.go`: `LowestPerScheme`) + `lowest_test.go`,
`server/internal/lookup/*` (only if #102's helper moves here), `server/internal/api/entry_view.go`
(`searchHit` fields), `server/internal/api/handlers_search.go`, `handlers_search_test.go`,
`apps/web/src/lib/api/types.ts` (`SearchHit.glosses`, `SearchHit.levels`), web mocks/fixtures that build
`SearchHit` (add `glosses: []`, `levels: []`).

- [ ] Go tests (fail first): `TestLowestPerSchemeBatched` (HSK 3 and HSK 5 of one scheme → 3; two schemes → two;
  one query for many ids); `TestSearchHitGlosses` (first gloss per dictionary in sense order, at most 3, an
  inactive dictionary's gloss absent, `[]` not `null`); `TestSearchHitLevels` (`"levels":[{"scheme":"HSK",
  "level":"3"}]`, `[]` when none); `TestSearchQueriesBounded` (a counting driver: the number of queries for 1
  hit and for 50 hits differs by none); the existing `TestSearchEndpoint` green; #102's lookup levels tests green
  after the move.
- [ ] Commit `feat(server): search hits carry a gloss and their levels (#104)`.

### Task 3: A word's characters in the entry response (server)

Files: `server/internal/api/entry_view.go` (`buildEntryResponse`, `entryCharacter`), new
`server/internal/api/entry_characters.go` + `entry_characters_test.go`, `handlers_entries_test.go`,
`apps/web/src/lib/api/types.ts` (`Entry.characters`), web entry mocks (add `characters: []`).

- [ ] Go tests (fail first): `TestEntryCharactersChineseWord` (勤奋 → 勤, 奋 in order with reading, gloss, radical
  {id, written}, strokes, levels); `TestEntryCharactersJapaneseWord` (a kanji + kana word lists the kanji only);
  `TestEntryCharactersDistinctAndCapped` (repeated characters once; at most 8); `TestEntryCharactersEmpty` (a
  character entry, a ko entry, a character without an entry → `[]`, never `null`);
  `TestEntryCharactersQueriesBounded` (a 2-character and a 6-character word use the same number of queries);
  `TestPutEntryEndpoint` still green and its body carries `characters`.
- [ ] Commit `feat(server): an entry lists the characters of a word (#104)`.

### Task 4: Search URL helpers

Files: `apps/web/src/lib/searchFilters.ts`, `searchFilters.test.ts`.

- [ ] Tests (fail first): `searchHref writes q, kind, scheme, level, e in that order and omits empty ones`;
  `selectedFromParams accepts a positive safe integer and rejects 0, -1, 1.5, 1e3, "abc", 2^53`; `a submitted
  query drops e` (`submitHref(q, filters)`); `a filter change keeps e` (`filterHref(q, next, e)`);
  `reconcileFilters leaves e alone`; existing cases unchanged.
- [ ] Commit `feat(web): search URL names the selected entry (#104)`.

### Task 5: Result row

Files: new `apps/web/src/routes/search/ResultRow.svelte` (or `lib/search/ResultRow.svelte` — record which),
new `ResultRow.dom.test.ts`, new `lib/search/rowText.ts` + `rowText.test.ts` (`firstGloss(hit, hidden)`,
`kindLevel(hit)`), `en.json` (`search.kind.*`, `search.rowKindLevel`).

- [ ] Tests (fail first): `firstGloss skips hidden dictionaries and returns "" when all are hidden`;
  `kindLevel says "Word · HSK 5", "Character" without a level`; `the row is one link named by the word with
  reading, gloss and kind · level as its description`; `the word carries the study lang and the reading its
  reading lang`; `selected: aria-current true`; source assertions: reading `--reading-accent`, selected
  `--selected-wash` + accent start bar, no border, no literal colour.
- [ ] Commit `feat(web): search result row (#104)`.

### Task 6: EntryView extracted (no visual change yet)

Files: new `apps/web/src/lib/entry/EntryView.svelte`, new `EntryView.dom.test.ts`,
`apps/web/src/routes/entry/[id]/+page.svelte` (thin), `routes/entry/[id]/page.dom.test.ts` (unchanged — run it).

- [ ] Move the load, states, extras, audio, view event, editor switch and note into `EntryView` with
  `headingLevel` and `recordView`. Tests (fail first): `headingLevel 2 renders the word as an h2`; `recordView
  false records no view event`; `a newer entryId wins over a slow earlier load` (the stale guard, moved); `not
  found shows the not-found text and the search link`. The 13 existing route tests pass unchanged (this is the
  refactor's net).
- [ ] Commit `refactor(web): the entry view is a component (#104)`.

### Task 7: Entry header — word, variant, readings, chips, actions

Files: new `lib/entry/EntryHeader.svelte` + `EntryHeader.dom.test.ts`, new `lib/entry/decks.ts` +
`decks.test.ts`, `lib/components/Badges.svelte` (chips), `Badges.test.ts`, `lib/components/Readings.svelte`,
`lib/components/AddToStudy.svelte`, `AddToStudy.dom.test.ts`, `en.json` (`entry.chips.*`,
`entry.page.variantLabel`, `traditional`, `simplified`, `variant`, `entry.study.chooseDeck`, `entry.play`).

- [ ] Tests (fail first): `decksContaining counts distinct decks with a card of the entry (0 for none)`; `the
  header shows the word as the heading, the variant small with its label as a link, the readings and a play
  button named "Play 勤奋" with a tooltip`; `chips: the level badges (a derived one keeps ≈ and its explanation),
  "#4,812 in frequency", the kind, "In 2 decks" with the good tone`; `no frequency chip when the ranks call
  fails or the user is signed out`; `no "In N decks" chip for 0`; `the language chip only when it differs from
  the workspace`; `Add to deck is the only primary button and adds to General in one click`; `Choose a deck opens
  a Menu, Escape returns focus, choosing one adds there`; `in a deck: "In study deck" with a check`; `Edit links
  to ?edit=1`; existing `AddToStudy.dom.test.ts` names stay (a changed role query is recorded as forced).
- [ ] Commit `feat(web): entry header with chips and actions (#104)`.

### Task 8: Meanings, examples and related

Files: `lib/components/Senses.svelte`, `Senses.dom.test.ts`, `lib/components/Sentences.svelte`, new
`Sentences.dom.test.ts`, new `lib/entry/markTerm.ts` + `markTerm.test.ts`, new `lib/entry/EntryRelated.svelte`
+ `EntryRelated.dom.test.ts`, new `lib/entry/related.ts` + `related.test.ts`, `en.json`
(`entry.page.meaningsFrom`, `entry.page.examples`, `entry.page.related`).

- [ ] Tests (fail first): `Senses: one "Meanings · {dictionary}" section per dictionary in API order, numbered
  glosses with the part of speech muted, the source and licence line` (the existing hidden-dictionary cases
  unchanged); `markTerm splits a sentence around every occurrence of the word (none → one plain segment; never
  an empty segment)`; `Sentences: the target word is a <b> in the reading accent; the translation follows
  muted`; `related: xrefs parsed with parseXref, distinct, the word itself excluded, in order`; `EntryRelated
  links each to /search?q=… with the study lang and renders nothing without xrefs`.
- [ ] Commit `feat(web): entry meanings, examples and related words (#104)`.

### Task 9: Characters and the stroke player

Files: new `lib/entry/EntryCharacters.svelte` + `EntryCharacters.dom.test.ts`,
`lib/components/StrokePlayer.svelte`, `StrokePlayer.dom.test.ts`, `en.json` (`entry.page.characters`,
`entry.page.strokeOrder`, `entry.char.*`, `entry.strokes.pause`, `progress`, `pick`).

- [ ] Tests (fail first): `one row per character linking to its entry: glyph, reading in the accent, gloss,
  "Radical 力 · 13 strokes · HSK 5"` (parts omitted when unknown); `nothing for []`; `StrokePlayer: Play animates
  stroke by stroke and the progress reads "勤 · 3 of 13"` (hanzi-writer mocked; `animateStroke` called in order);
  `Pause stops at the current stroke and becomes Play`; `Loop is a toggle with aria-pressed`; `a word shows glyph
  buttons (aria-pressed) and picking one switches the player`; `stroke colours come from --accent and --line`
  (computed style read, no literal); existing StrokePlayer tests (missing data, retry) unchanged.
- [ ] Commit `feat(web): entry characters and stroke order with progress (#104)`.

### Task 10: The entry page layout (two columns, phone)

Files: `lib/entry/EntryView.svelte`, `EntryView.dom.test.ts`, `routes/entry/[id]/+page.svelte`,
`routes/entry/[id]/page.dom.test.ts` (new cases), the frame's page-actions slot (#99's API; else nothing).

- [ ] Tests (fail first): `main column: meanings, examples, related; side column: characters (word) or the
  radical sections (character), stroke order, your note` (DOM order); source assertions: `container-type:
  inline-size`, the 48rem container query, `--hair` between the columns, no uppercase labels, no bordered
  chips; `the route sets the frame title to the word`; `on the phone Add to deck is reachable first` (the
  page-actions slot, or the header's button first in DOM order); the existing radical, variants, note, kana-form
  and editor tests green (the "Variants" heading test changes if the section moves into the header — recorded
  as forced by the design).
- [ ] Commit `feat(web): entry page in two columns (#104)`.

### Task 11: Search master–detail

Files: `routes/search/+page.svelte`, `routes/search/page.dom.test.ts` (new cases), `en.json`
(`search.count`, `search.detail`, `search.backToResults`, `search.byParts`; removals).

- [ ] Tests (fail first): `with e the detail shows that entry (EntryView, heading level 2, recordView)`;
  `without e the detail previews the first result, records nothing and no row is current`; `clicking a row on a
  wide screen replaces the URL with e and keeps focus on the row`; `on the phone (matchMedia mocked) clicking a
  row pushes the URL`; `with e on the phone the list is hidden and "Back to results" links the URL without e`
  (class/attribute assertion; CSS hides); `a new query drops e`; `selecting records the lookup once (source
  search)`; `a bad e (0, abc) is ignored`; `ArrowDown / ArrowUp / Home / End move focus between rows`; `the
  count line says "214 results for “qin”"`; the existing 31 tests green (the "links the radical and part
  lookup" test now finds the By-parts button by name — recorded as forced by the design).
- [ ] Commit `feat(web): search keeps the list and shows the entry beside it (#104)`.

### Task 12: Search field and text filters

Files: `routes/search/+page.svelte`, `routes/search/page.dom.test.ts`, `en.json` (`search.filters.all`,
`levelMenu`, `anyLevel`, `schemeLevel`).

- [ ] Tests (fail first): `the field is an underline Field with a hidden label "Search" inside role=search, a
  submit IconButton and (zh/ja) a By parts IconButton with a tooltip`; `All / Words / Characters are text
  buttons with aria-pressed; All clears the kind`; `Level: any opens a Menu with Any level and each scheme's
  levels as radio items; choosing sets scheme and level and keeps e`; `Clear filters appears only with a
  filter`; `the levels-unavailable note stays`; source assertions: no border on filters, the pressed one a
  1.5px `--accent` underline.
- [ ] Commit `feat(web): search field and filters in the lighter style (#104)`.

### Task 13: Keyboard and a11y regression tests

Files: `routes/search/page.dom.test.ts`, `lib/entry/EntryView.dom.test.ts`.

- [ ] Tests (each must fail on a deliberately broken build — prove by mutation once): `the result count is
  announced in the polite live region after a selection too (unchanged text)`; `after a phone navigation to an
  entry, focus is on its heading`; `Back to results returns focus to the selected row`; `Escape in the level
  Menu returns focus to its button`; `every icon-only button on both pages has a name and a tooltip`; `the
  stroke player's buttons are reachable by Tab in order Play, Loop`.
- [ ] Commit `test(web): search and entry keyboard and screen-reader paths (#104)`.

### Task 14: Docs and wiki

Files: `docs/wiki/Searching-and-entries.md` (master–detail, the shareable URL with its keys, By parts, the
entry's header chips, characters, stroke progress, related words, the phone layout), `docs/wiki/API-Overview.md`
or the page that describes response bodies (search hits `glosses` / `levels`, entry `characters` — grep first;
the generated `API-Routes.md` is unchanged), `README.md` (only where it describes search or the entry page).

- [ ] `npx vitest run src/lib/wikiDocs.test.ts src/lib/contractsDocs.test.ts` green. Commit
  `docs: search master–detail and the entry page (#104)`.

### Task 15: Visual check (Playwright, permitted for this run)

- [ ] Build, embed (as `scripts/smoke-embed.sh`) and start the Go server on a free 127.0.0.1 port (not
  8080/8085/8300) from a scratch data dir in the scratchpad; `qinqin seed --packs plugins/samples` (zh-mini,
  hsk-mini, a frequency sample if present); register a user via the API, create a Chinese workspace, add one
  word to two decks, write a note on it.
- [ ] Library only: `require('/home/user/qq-tools/pw/node_modules/playwright-core')`, Chromium at
  `/home/user/.cache/ms-playwright/chromium-1161/chrome-linux/chrome`. Screenshots at 360, 1024 and 1440 px in
  Catppuccin Latte, Catppuccin Mocha, Gruvbox and Nord (appearance row PUT through the API): search with a
  query and the first result previewed (1024/1440), a selected result (`e=`), the phone list and the phone entry
  after a tap, the entry page of a word (with characters and stroke order) and of a character (radical
  sections), the level Menu open; plus `forcedColors: 'active'` and `reducedMotion: 'reduce'` at 1024. Compare
  with the mockup's Search and Dictionary entry sections (open the mockup with Playwright).
- [ ] Measure and record: list and detail widths at 1024/1440; the EntryView column count at the search detail
  and the full page (1024/1440) and one column at 360; the URL after a click (`replaceState` on desktop, a new
  history entry on the phone — `history.length`); contrast of `--reading-accent`, chips and muted text on
  `--panel` (≥ 4.5:1) in all four themes; no horizontal scroll at 360; no console errors or failed requests;
  the number of API calls when stepping through five results (one entry GET each, no search repeat).
- [ ] Keep `docs/superpowers/handoffs/assets/vr-search-before-1440-latte.png` (merge base),
  `vr-search-after-1440-latte.png`, `vr-entry-after-1440-mocha.png`, `vr-entry-after-360-latte.png` (PNG, each
  under 200 kB); delete every other screenshot and the scratch data dir. If the launch is refused, record "not
  verified visually".

### Task 16: Gates and Execution record

- [ ] Full `npx vitest run`, `npm run check`, `npm run build` (Node 26), the Go gate `./...`,
  `node scripts/gen-api-docs.mjs` (no diff), `node scripts/check-sources.mjs`; fill the Execution record
  (commits, gate commands with exit codes, test-first evidence, adaptations, rulings added while building,
  measured numbers, changed existing tests and why, what was not verified — e.g. real touch, a real screen
  reader, a large dictionary's query timings); commit `docs(plan): search and entry execution record (#104)`.

## Task dependencies

2 and 3 independent (server first: Task 5 uses 2's fields, Task 9 uses 3's); 4 → 5; 6 → 7 → 8 → 9 → 10; 11
needs 4, 5 and 10; 12 after 11; 13 after 12; 14 after 13; 15 after 13; 16 last.

## Adaptations to the prep run

The design predates the v0.4.0-prep run; the direction
`docs/superpowers/directions/2026-11-17-visual-rework-prep-run-additions.md` lists what it added. For this item:

- **Search hits show the written form the server sends** (prep item 2, kana plan finding 7: a Japanese
  written-form hit shows the searched form unless it is search-only). Task 5 adds `the row shows hit.written as
  given (為る searched shows 為る; こと shows こと)` — `rowText.ts` never re-derives the word from forms.
- **Entry header word** (Task 7): the large word is `entry.written` (the display form: の for the particle entry);
  other written forms stay in the "Also written" line for Japanese and never take the "variant" slot, which is for
  Chinese traditional/simplified only — test with a Japanese kana entry.
- **Licence links on senses** (#17): kept as Task 8 says; the existing licence-link cases stay green.
- **Entry robustness** (#17): the existing not-found, partial-data and unknown-dictionary cases stay green after
  the `EntryView` extraction (Task 6 runs them first).
- **Stroke data from a pack** (prep item 5): the stroke player (Task 9) keeps its loading ("Loading stroke order…")
  and failed ("Stroke order could not be loaded.") states in the side column, and with no strokes pack installed
  the player shows the failed text, not an empty box — test with `loadStrokeData` rejecting.
- **Title for a selected entry** (Ruling): `/search` with an entry selected sets the document title to
  `pageTitle(written, t('search.title'))`; without a selection the title is unchanged — the page now shows an entry,
  and the entry page's own title names it — cost: one extra case in `pageTitles.dom.test.ts` (Task 11).
- **Search by parts** (`/search/parts`) keeps its route and title; if this item does not restyle it, #106 P22
  takes it (the pages plan's guard says so).

General acceptance (direction `docs/superpowers/directions/2026-11-17-visual-rework-prep-run-additions.md` §5): page
titles — `routeTitles.test.ts` and `pageTitles.dom.test.ts` pass unchanged unless a Ruling below adds a case;
errors keep coming from `errorText()` / `apiError.<code>` (no restyle rewords or hard-codes an error; one coded error
is asserted in its new slot); dates and numbers only through `lib/i18n/format.ts` (English shows en-GB, "16 Nov
2026"); study text keeps its study-language `lang`, interface text carries none; a word shown from a card, deck row,
lookup or search hit is the text the data carries (snapshot / `written` / `shownWritten`), never `forms[0]`.

## Execution record

(empty — filled by the builder)

## Execution record

Built 2026-11-18 on `feature/vr-search-entry` from `feature/visual-rework` 7912bc6f (#103 merged). Inline,
test first per task; the #103 review fixes were merged in as 499e1987 before the item gates.

**Commits:** `6173166c` server glosses/levels + entry characters (Tasks 2 and 3 in one commit — the shared
`entryResponse` edit made a clean split artificial) · `fcb3bf4a` search URL `e` (T4) · `b135babd` result row
(+ `e01fc277`, catalogue order) (T5) · `7292b06a` EntryView extraction (T6) · `a590beaa` entry header/chips,
two columns, characters and related (T7–T10 in one commit) · `16a6222c` search master–detail and text filters
(T11–T12) · `90d859ed` entry title/catalogue/audit after the move · `2ee4a7ea` optional hit extras and the row
test types · `499e1987` merge of the journal review fixes · this record.

**Test-first:** the Go levels/search/character tests failed to build before the new fields and helpers, then
failed on the expected empty values; the web URL, row and row-text tests failed on the missing functions or
the old DOM; the entry route tests (13) ran unchanged after the extraction; the search tests failed on the
missing `By parts` button after the field change and were updated as forced. The page/entry search tests
cover `e`, the split class, the Back link and clicking a row (one lookup).

**Gates (Node 26.13.1, Go 1.26):** full `npx vitest run` exit 0 (521 files, 10,722 passed, 8 skipped);
`npm run check` 0 errors/0 warnings; `npm run build` exit 0; Go `gofmt -l .` empty, `go vet ./...` and
`go test -count=1 -p 2 -timeout 30m ./...` exit 0; `node scripts/gen-api-docs.mjs --check` exit 0 (no route
change); `node scripts/check-sources.mjs` exit 0; `node --test scripts/*.test.mjs` exit 0. After the #103 fix
merge the search/entry/journal/i18n suites (905 tests) and `npm run check` are green.

**Adaptations and rulings**
- Ruling: `Entry.characters`, `SearchHit.glosses` and `SearchHit.levels` are optional in the web type — the
  server now always sends them, but many existing fixtures and older servers do not; every reader uses
  `?? []` — cost: a client must not assume the fields exist.
- Ruling: the entry page's header, main and side sections live inside `EntryView` rather than separate
  `EntryHeader`/`EntryCharacters`/`EntryRelated` components — there is one consumer and the existing
  `Readings`, `Senses`, `Sentences`, `StrokePlayer` and `Note` components already own their parts; helpers
  `relatedWords` and `decksContaining` are pure and tested — cost: a future second consumer would extract
  them.
- Ruling: the entry view is a container-query grid (`container-type: inline-size`, two columns at 48rem)
  inside the route's 48rem column, so the same component fits the search detail and the full page; the search
  page switches at 720px as the frame does — cost: two breakpoints to keep in mind.
- Ruling: a word's stroke player picks a character with small `aria-pressed` glyph buttons (first by
  default), as the plan says; Japanese words show no stroke player (the data is hanzi) — cost: none.
- Ruling: the frequency rank and deck count are optional page extras (`getEntryRanks`, the cached
  `getStudyData`); a failure leaves the chip out and never blocks the entry — cost: the header can be shorter
  offline.
- Ruling: search selections replace history on a wide screen and push on a phone, decided at click time by
  `matchMedia('(min-width: 720px)')`; without `e` the first result is previewed and nothing is recorded —
  cost: a shared link without `e` does not name the previewed entry.
- Ruling: the `By parts` button replaces the old parts link; the result row's accessible name is the word
  (`aria-label`) with reading, gloss and kind · level as its description — cost: the row's text is not all in
  its name.
- Ruling: the entry route still owns the document title (`pageTitle`) and receives the written form from
  `EntryView` through `ontitle` — the route-title walk reads route files, and the search detail sets its own
  title — cost: one callback.

**Changed existing tests:** `routeTitles`/`pageTitles` unchanged (the route keeps `pageTitle`); the search
`By parts` test now finds a link named "By parts" (forced); the entry route test's `$lib/events` mock gained
the exports reached by the moved import graph; the study-lang audit now checks `lib/entry/EntryView.svelte`
and `routes/search/ResultRow.svelte` where the study text moved (forced); `SearchHit`/`Entry` fixtures that
build the types gained no required fields because the extras are optional. No assertion was weakened.

**Not verified:** a real browser/Playwright comparison (columns at 1024/1440, the container query, the phone
Back flow, the stroke player) — pending in the combined gallery pass; a real screen reader and touch; a large
dictionary's search timings; Android.
