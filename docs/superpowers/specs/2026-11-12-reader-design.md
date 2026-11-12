# Reader Plugin & Core Tokenizer — Design

Date: 2026-11-12
Status: Implemented 2026-11-12 on feature/reader

## Intent

Let learners read real Chinese and Japanese text inside the app and look words up
**in place**, without leaving the page: hover a word and the dictionary entry
appears; select a span and the selection is looked up (one hanzi/kanji → character
meaning, several → word meaning). Text comes from public-domain sources the user
can search and browse in the app and import with one click, or from epubs the user
uploads. The point is lookup friction near zero while reading authentic text.

Three deliverables, built in this order:

1. **Core tokenizer / longest-match lookup** (core app, both languages).
2. **Generic plugin page mechanism** (core web app): lets a feature plugin contribute
   its own routes/pages and a nav entry.
3. **Reader plugin** (web feature plugin) consuming both.

## Goals

- Hover lookup on the word under the cursor; selection lookup on arbitrary spans.
- Works for Chinese (simplified and traditional text) and Japanese.
- Import with one click from Aozora Bunko and Project Gutenberg, via in-app
  search/browse per source. Only public-domain Aozora works are offered (see below).
- Upload of the user's own epubs.
- Attribution and source URL stored per book and shown in the reader.
- Webview only.

## Non-goals

- Mobile client (comes later; the core tokenizer API is the shared contract).
- Wikisource: left out of v1 (CC BY-SA terms unverified); may be added later.
- "Add to study" from the lookup popup: left out of v1; revisit once flashcards
  Round 2 has landed.
- Link-out-only sources: ctext.org, NHK News Web Easy, Tadoku, paid graded readers
  (licensing unclear or non-commercial). Users can still upload their own epubs.
- Tatoeba as reading material (possible later add-on, not in scope).
- Bulk crawling or mirroring of any source. Imports are user-triggered, one book at a time.
- Audio, annotations/highlights, and DRM-protected epubs.

## Anti-goals

- A second, divergent notion of "what is a word" inside the reader. The reader must
  use the core tokenizer, the same one flashcards Round 3 will use.
- Per-page-view calls to third-party sites. Everything shown is already stored locally.
- The reader quietly redistributing content without credit.

## Constraints

- Repo conventions: Go backend (`server/`, pure Go, no CGO), SvelteKit 2 / Svelte 5
  SPA (`apps/web/`), feature plugins are compile-time web components plus a
  server registry row (`registerBuiltinPlugins` in `server/cmd/qinqin/main.go`).
- Flashcards spec keeps plugin backends thin ("no backend logic beyond plugin
  registration"). The reader's fetching/parsing needs server support, so see
  "Left to the builder" and "Builder's calls": book storage and source fetching are
  **core generic capabilities**, not plugin-private endpoints.
- Flashcards Round 2 is in development. **Flashcards Round 3 waits until the
  tokenizer exists** (agreed); Round 2 is not blocked.
- No plugin extension point exists for routes or nav. **Decided: build a generic
  plugin page mechanism** (deliverable 2), not a hard-coded route. Existing
  `/study` routes may stay as they are; migrating them is out of scope.
- Dictionary data today: CEDICT, JMdict, KANJIDIC2, Unihan packs. `/api/search` has
  no segmentation; `GetByWritten` exists in the store without an HTTP route.
- Fetching third-party sources needs a descriptive User-Agent, rate limiting and
  caching (Wikimedia and Project Gutenberg policies).
- Licences: Aozora is public domain per work. **Decided: filter out works still
  under copyright.** The Aozora catalog CSV carries per-work and per-author
  copyright flags (from memory; builder to confirm the exact columns); only works
  where both mark "no copyright" are listed or importable. Gutenberg is public
  domain (US) and wants human-paced access. Verify before shipping.

## Part 1 — Core tokenizer

A generic, language-aware "longest dictionary match" service in core.

- Input: text, language, and an offset (or a whole string to segment).
- Output: the longest word at that position, with the matched surface form, its
  entry id(s) and span, so clients can highlight and fetch the entry.
- **Chinese:** longest-match against CEDICT written forms (simplified and
  traditional both match).
- **Japanese:** longest-match against JMdict plus **deinflection** (e.g. 食べた →
  食べる) in the Japanese language pack (`server/internal/lang/ja.go`), reporting
  the dictionary form and the matched surface span.
- Falls back to a single character (kanji/hanzi entry) when no word matches.
- Lives next to the dictionary code (`entries` / `lang`), exposed as a generic
  endpoint. Interface is designed so flashcards Round 3 (Word Salad) and the reader
  both consume it. Exact route shape, batch behaviour and performance approach are
  the builder's call.

## Part 2 — Reader plugin

### Library and sources

- A **library** of the user's books. Each book keeps: title, author, language,
  source (aozora | gutenberg | upload), source URL, attribution,
  licence note, import date, reading position.
- Each source has an in-app **search/browse** view and an **Import** action.
  Sources initially: Aozora Bunko and Project Gutenberg.
- Upload: the user adds an `.epub` file.
- Imports are fetched **server-side**, on user action, then stored. The reader only
  ever reads stored content.

### Reading and lookup

- The reader renders a book's text chapter by chapter.
- **Hover:** word under the cursor is resolved via the tokenizer; a popup shows the
  entry (reusing existing entry components: readings, senses, badges).
- **Selection:** selecting text looks up the selection (1 character → character
  entry; more → word entry via tokenizer).
- Japanese: ruby/furigana is preserved and can be shown or hidden.
- Chinese: books may be traditional or simplified; offer conversion (e.g. OpenCC-
  style) between them. Lookup must work on either.
- Attribution and source link visible per book.

## Parts decided by the user

- Both languages; webview only.
- Tokenizer is core; flashcards Round 3 waits for it.
- Sources: Aozora (public-domain works only), Project Gutenberg, plus epub upload;
  search/browse in app and one-click import. Wikisource is out of v1.
- A generic plugin page mechanism is in scope and built before the reader.
- Add to study is out of v1.

## Left to the builder

- Tokenizer route shape, caching and batching strategy.
- Whether epub parsing is client-side or server-side (see calls below).
- Storage layout for book content.
- Design of the plugin page mechanism (manifest surface, route registration, nav).
- Chinese variant conversion library and approach.
- Epub rendering approach and chapter navigation UX.
- Rate limiting, caching and User-Agent details for source fetching.

## Builder's calls (mine, not agreed — please check)

- Book content does **not** go into `plugin_data` (JSON text, poor fit for large
  text). Use a core file/blob store under the data directory plus a small metadata
  table (next migration is 012), exposed as generic core endpoints.
- Source fetching/import is a core generic capability, not plugin-private logic.
- Imported book content is stored per user or per workspace (builder decides) and
  is not shared between users.
- Reading position and library metadata sync like other plugin data where practical.
- **Hover latency:** the server answers per-offset lookups (target well under 100 ms,
  debounced on the client), and also offers a batch segment call for a whole
  paragraph/chapter so the client can pre-resolve words. No client-side dictionary.
- **Japanese deinflection:** a documented subset is "done" for v1 (common verb and
  adjective forms: polite, past, negative, te-form, potential, passive/causative,
  volitional, conditional). Rarer forms can follow. Chinese greedy longest-match is accepted.
- **Pointer input:** desktop mouse hover plus text selection first. Selection lookup
  should also work on touch; hover is not expected there.
- **Epub:** parsed server-side on upload, size-limited (suggest 20 MB). Rendering is
  text plus ruby and paragraph structure; no images, no vertical layout in v1.
- **Source search/browse:** downloading each source's **catalog index** (Aozora's
  CC BY 4.0 CSV, Gutenberg's public-domain catalog) and querying it locally is
  acceptable; downloading book **content** stays user-triggered, one book at a time.

## Implementation notes

Decisions that differ from or extend the spec above.

- **Storage is per user.** Books are rows in `library_books` (migration `012`) with
  chapter content in `<data>/books/<user id>/<id>.json`; nothing goes in
  `plugin_data`. The same work cannot be added twice per user (uploads are keyed
  by a content hash).
- **Reading position is not synced.** It is a string stored per book through
  `PUT /api/library/books/{id}/position` (at most 1024 bytes) and read back with
  the book; it is not part of plugin data sync.
- **Epub parser caps.** At most 2000 zip entries, 200 MiB uncompressed in total,
  50 MiB per entry, 5 MiB for the package document and `container.xml`, 32 MiB of
  extracted text, 2,000,000 runs, 500,000 paragraphs and 2000 chapters. Anything
  above is a 422 with nothing stored. Gutenberg epubs go through the same parser;
  Aozora texts get the same text, run, paragraph and chapter caps.
- **Segment text caps and access.** `POST /api/segment` needs a signed-in user (one
  request can run thousands of lookups and nothing in the web app calls it yet) and
  takes at most 5000 code points (and a 256 KiB body); `GET /api/segment/at` is
  public and takes at most 64 code points. Hover lookups are window based: the
  client sends at most 16 code points starting at the hovered offset with
  `offset=0` and shifts the result back, and caches by window.
- **Japanese kana words match by reading.** The JMdict importer stores a word that
  has a kanji form under its kanji forms only (the kana are readings), so する
  (為る), こと (事), りんご (林檎) never match by written form. Every kana-only
  candidate (surface prefix or deinflected form; hiragana, katakana, ー) is also
  looked up by `readings.plain` (type `kana`, normalized like the importer:
  katakana folded to hiragana) — indexed by migration `013` on
  `readings(plain, entry_id)`. Longest surface wins; at equal length a
  written-form hit beats a reading hit, and within each kind an exact hit beats a
  deinflected one (shallowest deinflection first). A reading hit lists up to 8
  candidates, flagged `"reading": true`: entries for which the kana is the first
  reading first, then by reading position and entry id. **Limitation:** JMdict
  priority tags (`ichi1`, `news1`, `nf01`...) are not imported, so homophones are
  not frequency ranked (する shows 為る, 刷る... in entry-id order among first
  readings). The popup says how many other entries share the reading and links
  to a search for it. Zh matching is unchanged (written forms only).
  The JMdict importer now gives a kanji form shared by several words the union
  of their kana readings (in file order), like cedict's homograph merge; before,
  the last word won and 為る was read only なる, 林檎 only りゅうごう. A kana
  surface that is itself a reading of some entry (した → 舌) wins over a
  deinflection of equal length (した → する past), per the ranking above.
- **Hover shows nothing for no word.** Latin letters, digits, punctuation and
  whitespace never start a lookup, and a hover lookup that finds nothing shows no
  popup; the not-found hint is for selections only.
- **Source search ranks before truncating.** Both adapters rank matches (exact
  title, title prefix, author, other substring; ties by id) and then cut at the
  limit; the client asks for the maximum of 100 and says when the list is cut off.
- **Source requests are bounded by the caller's context.** The client has dial/TLS
  and response-header timeouts (15 s each) but no whole-request timeout, so the
  21 MB Gutenberg catalog download runs within the 90 s catalog load and imports
  within their 60 s deadline. Malformed and unknown source ids are 404.
- **Gutenberg licence note** is "Distributed by Project Gutenberg as public domain
  in the USA; copyright status elsewhere may differ." — the catalog CSV has no
  rights column, so nothing stronger is claimed.
- **Epub chapter titles.** The heading a chapter title comes from is not repeated
  as a paragraph (unless it is all the chapter has); a chapter without a heading
  has an empty title and the reader shows "Chapter n".
- **One import per user at a time**, enforced in memory (429 for a second one),
  with a 60 second timeout for a whole import.
- **Deinflection** also covers irregular verb forms (suru, kuru and similar), on top
  of the forms the spec lists.
- **Aozora is https only**, from aozora.gr.jp only (the live catalog has no GitHub
  URLs), and the source client does not use environment
  proxies, so the dialer can refuse non-public addresses. See the README for the
  consequence for self-hosters behind a mandatory proxy.
- **opencc-js is loaded lazily**, only when a Chinese book is shown in a converted
  script. It is `MIT AND Apache-2.0`; the Sources page credits it and both licence
  texts ship in `apps/web/static/`.

### Known limitations

- Japanese deinflection is part-of-speech blind: rules do not check the part of speech, so a
  rewritten form can match an entry that is not a verb or adjective.
- No vertical text and no images.
- The traditional-script bundle chunk is large (about 466 kB gzipped); it loads only
  when that script is selected.
