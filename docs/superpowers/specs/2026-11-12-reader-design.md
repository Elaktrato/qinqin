# Reader Plugin & Core Tokenizer — Design

Date: 2026-11-12
Status: Draft for approval. Design agreed in conversation; nothing built yet.

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
