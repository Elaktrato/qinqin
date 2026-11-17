# Data packages and a bounded sync pull — design (issue #93, covers #18's asset-size bullet)

Status: Draft (2026-11-16), v0.4.0 prep item 5. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built. Depends on item 4
(`2026-11-16-v040p-core-features-design.md`): its typed study collections (`cards`, `decks`,
`deckSettings`, `limits`, `fsrsSets`, `fsrsActive`), its legacy view for old shells and its library
`updated_at` columns and `library_deletions` log exist when this is built. Prepares #35 (Android sync).

Owner decision (authoritative): every data set a client needs comes as a versioned, checksummed package
the client downloads — dictionaries per language, stroke data, audio, level lists, frequency,
components. The ~47 MB of stroke JSON leaves the web bundle. `GET /api/sync/pull` carries the user's own
data and changes only: paged or streamed, never one unbounded response, limited to the languages of the
user's workspaces. A client gets a first copy by package download, then changes by a package version
check plus paged deltas; pack updates and uninstalls reach it. The PWA keeps working. Contract fixtures
for the push/pull shapes and the package manifest/versioning rules.

## What is there today (read before deciding)

- `sync.Pull` (`server/internal/sync/pull_all.go`, `pull_lexicon.go`) builds one `Delta` in memory: every
  entry with its forms and readings, every sense, link, level member, pack sentence, dictionary, scheme
  and level, plus the user's plugin data, states, overlays and own sentences; `writeJSON` then marshals
  the whole value. From the zero cursor on a fully seeded server that is the whole lexicon (CC-CEDICT,
  Unihan, JMdict, KANJIDIC2, ...) twice in RAM (structs, then bytes). The cursor is RFC 3339, lags the
  clock by 30 s and is inclusive. `collections=` selects a subset; an unknown name is 400.
- The web never asks for lexicon collections: its only pull is
  `cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates` (item 4 adds the typed names). Entries
  come one at a time from `GET /api/entries/{id}` (cached by the PWA for today's due cards), search,
  segmenting and lookup are server-side, frequency ranks are a server call, audio clips are
  `/api/audio/clips/{file}`. Nothing in the web needs a full dictionary.
- Entry ids are stable per server: `lexicon.Store.Put` upserts by `(language, kind, ext_key)` and revives a
  soft-deleted row; nothing hard-deletes entries; a dictionary uninstall tombstones its senses and keeps
  the entries. Sense ids churn (clients key senses by `(entryId, dictionaryId, ord)`). Pack sentences are
  kept by content key `(entry, hanzi, pinyin, translation)`: an unchanged sentence keeps its id on
  re-import, a changed one gets a new id and the old row a tombstone. So user data referencing entry ids
  (cards, notes, known marks, lookups, overlays) never needs re-keying after a re-import on the same
  server; ids differ only across servers (the backup remap handles that).
- Stroke data: `apps/web/scripts/prepare-hanzi-data.mjs` copies `hanzi-writer-data` (9,575 files, Arphic
  Public License) to `static/hanzi/U<HEX>.json`; Vite and `go:embed` put it in the binary; the player and
  `prepareOffline` fetch `/hanzi/U<HEX>.json` per character; the service worker keeps them in
  `qinqin-hanzi-v1`; `strokeIndex.ts` (committed) says which characters have data.
- Pack files on disk: seed packs under `QINQIN_PACKS` roots, uploads under `<data>/packs/<type>/<id>/<ver>/`,
  audio clips under `<data>/audio`. The database keeps each pack's licence, attribution and notice strings
  but not its `LICENSE` / `ATTRIBUTION.md` files.

## Goals

- Server-built, versioned, checksummed **data packages** for every client data set, with licences and
  attribution inside each package, a catalogue route and a resumable download route.
- **Pull v2**: the user's own data only, paged with a hard row and byte budget, ordered and stable under
  concurrent writes, workspace and language scoped, tombstones and the 30 s lag kept, typed study,
  library and event collections included.
- The **legacy pull** form keeps working for old web shells and item 4's legacy view until v0.5.0, streamed
  so its memory is bounded; lexicon collections leave it.
- Stroke data out of the web bundle and served by the Go server from an installed strokes pack at the
  same URL; the stroke player and writing cards keep working online and offline.
- The web on the new model (it pulls v2 pages; it downloads no packages). Fixtures for every shape.

## Non-goals

- Android code. Binary diffs between package revisions. Paging `GET /api/events` (see Open). New pack
  formats. Moving search, segmenting or lookup to clients.

## Questions I asked myself

**Q1. What is a package (the unit)?** One per language for dictionaries, one per installed pack otherwise.

- Ruling: package ids are `lexicon.<lang>` (every live entry of the language with its forms, readings,
  links, and the senses of every live dictionary of that language), and `<type>.<packId>` for
  `levels`, `sentences`, `frequency`, `components`, `audio`, `grammar`, `strokes` — why: entries are
  shared by the dictionaries of a language (radical stubs, kanjidic2 and JMdict both touching characters),
  so a per-dictionary package would need client-side reference counting on uninstall, while the owner asked
  for "dictionaries per language"; the other types own their rows outright — cost if wrong: installing a
  second dictionary of a language makes clients re-download the whole lexicon of that language.
- Ruling: sentences and grammar are packages too (types `sentences`, `grammar`) — why: pack sentences back
  sentence and cloze cards offline, and grammar lessons are read-only pack data like any other; the user's
  own sentences are user data and travel in the pull — cost if wrong: two small package types nobody
  downloads yet.
- `.` is the separator because pack ids match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and language codes contain
  no dot. Audio packages carry `"optional": true` (the client asks before downloading tens of MB).

**Q2. Format?** A zip holding a prebuilt SQLite database, its manifest and the licence texts.

```
<id>-r<revision>.qqpkg (zip; Store or Deflate only, no encryption)
  manifest.json          package manifest (shape below)
  NOTICE.md              generated: per source pack name, version, licence, attribution, notice
  LICENSES/<packId>/...  the source packs' licence and attribution files, verbatim
  data.sqlite            the package database (schema per type, `formatVersion`)
  clips/<sha256>.<ext>   audio packages only (Store), named as in <data>/audio
```

- Ruling: the data is a SQLite file, not JSONL — why: Android (Room/SQLite) opens it read-only as it is (or
  ATTACHes it) with no parse-and-insert step over half a million rows; the server writes it with the
  SQLite driver it already has; SQLite is public domain — cost if wrong: the schema of `data.sqlite` is a
  contract (pinned by `docs/contracts/packages/schemas.json`), and a non-SQL client would need a reader.
- Ruling: clients use package databases read-only and replace the file on update; they never copy package
  rows into their user database — why: an update is then an atomic file swap with no merge, and user data
  can never be lost by a package change — cost if wrong: cross-database joins (cards to entries) need
  ATTACH on Android.
- Ruling: licences travel inside every package (NOTICE.md, `LICENSES/`, `qq_sources` table) and the
  importer now keeps each pack's `LICENSE*`, `ATTRIBUTION*`, `NOTICE*`, `COPYING*` text files (≤ 256 KiB
  each, ≤ 8 per pack) in a new `pack_texts` table — why: licensing first; CC BY-SA and EDRDG terms travel
  with the data, and a package must be self-describing when a user copies it off the device — cost if
  wrong: a pack imported before this release has no stored texts; its package carries the licence names and
  attribution (which name the licence and its URL), is flagged `licenseTexts: false`, and the server warns
  "re-seed to include licence texts" like the stale-terms warning.
- Package tables per type (format 1; every package also has `qq_package(key, value)` and
  `qq_sources(type, pack_id, name, version, license, attribution, notice, license_files)`):
  `lexicon`: `entries(id PK, language, kind, ext_key, pri, uk, attrs)`, `forms(entry_id, ord, text, flags,
  pri)`, `readings(entry_id, ord, type, value, plain, flags, pri)`, `senses(entry_id, dictionary_id, ord,
  pos, tags, glosses, xrefs)`, `links(from_id, to_id, type)`, `dictionaries(id, pack_id, name, version,
  language, license, attribution, notice)`, indexes on `forms(text)` and `readings(plain)`; `levels`:
  `schemes`, `levels`, `level_members(level_id, entry_id, derived)`; `sentences`: `sentences(id, entry_id,
  hanzi, pinyin, translation)`; `frequency`: `frequency(term, reading, rank, display)`; `components`:
  `components(char, parts)`, `component_parts(part, strokes)`; `audio`: `clips(id, kind, form,
  reading_key, sha256, ext, bytes, license, attribution, source)`; `grammar`: `lessons(lesson_id, level_id,
  ord, title, summary, content)` plus `levels_json` in `qq_package`; `strokes`: `strokes(char PK, data)`.
  JSON lists are TEXT columns as on the server. Ids are the server's ids. Live rows only: a package is a
  snapshot, so it has no tombstones.

**Q3. Versioning and checksums?** A content hash decides, a revision counts, a format version gates.

- Ruling: each package has `formatVersion` (integer; the schema of `data.sqlite` for its type; a client
  accepts exactly the versions it knows), `contentHash` (`sha256:` over a canonical logical stream: every
  table in schema order, rows by primary key, as JSON lines, plus the licence texts), `revision` (integer,
  +1 whenever `contentHash` changes, never reused, continued after an uninstall and reinstall), `sha256` and
  `bytes` of the file — no semver — why: packages are machine snapshots, so "did the content change" is the
  only question; a logical hash is stable across SQLite library versions whose file bytes differ, and the
  file hash is what a download is checked against — cost if wrong: a client cannot tell a small update from
  a big one before downloading (it sees `bytes`).
- Ruling: a client replaces its copy whenever `(revision, contentHash)` in the catalogue differs from what it
  holds, never by comparing magnitudes — why: a server restored from an older backup goes backwards in
  revision and must still win — cost if wrong: none known.
- Ruling: the server keeps a random `instanceId` (ULID, created by the migration) in `server_meta`; it is in
  the catalogue and in every pull page; a client that sees a different one discards packages and local user
  data and starts over — why: entry ids, workspace ids and card ids are per database; a reinstalled server
  or a personal archive restored elsewhere reuses no ids — cost if wrong: a server backup restored onto a
  new volume keeps the id (it is in the database), which is right because the ids survive too.
- A rebuild whose `contentHash` equals the current one changes nothing (no new revision, no new file).

**Q4. Who builds packages, when, and with how much memory?** The server, from its own database.

- Ruling: packages are built by the server from its database, never prebuilt in CI — why: they must carry
  this server's entry ids, which user data references; the source packs are already on the server — cost if
  wrong: each server spends CPU and disk building them (about a minute for zh + ja on first start).
- A single builder goroutine (`datapkg.Builder`) owns a queue of package ids; `packs.Import` and
  `packs.Uninstall` (admin API and `qinqin seed`) enqueue the affected ids after their transaction commits,
  and `serve` reconciles at startup (every package that should exist and is missing, stale or of an old
  `formatVersion`). A burst of imports coalesces per id. `qinqin seed` builds synchronously before it exits.
- Ruling: a build reads under one read transaction (a consistent snapshot) and streams rows into the
  package database in batches of 1,000 inside one write transaction on the new file; memory is O(batch),
  never O(package) — why: the issue's point is bounded memory; WAL lets writers continue meanwhile — cost
  if wrong: a long read transaction delays WAL checkpoints for the build's duration.
- Files: `<data>/packages/<id>/r<revision>.qqpkg`, written as `.tmp` and renamed; the previous revision is
  kept 7 days so a download in progress can finish; startup deletes stray `.tmp` files and expired
  revisions. A failed build keeps the previous revision live and records `state: "failed"` with the error
  (shown to admins).
- Ruling: `<data>/packages` is not in the server backup (`qinqin backup`, admin backup) — why: it is
  derived and rebuilt on start from the restored database with the same content hashes and revisions —
  cost if wrong: the first start after a restore rebuilds packages.

**Q5. Routes, auth, tokens, caching, range requests?**

| Route | Access | Token | PWA | Notes |
| --- | --- | --- | --- | --- |
| `GET /api/packages[?languages=zh,ja\|all]` | user | `tokReadGlobal` | not cached | catalogue; default languages = the caller's workspace languages; `ETag` + `If-None-Match` 304; `Cache-Control: no-cache` |
| `GET /api/packages/{id}/{revision}` | user | `tokReadGlobal` | not cached | the file; `Range`/`If-Range` (206), `ETag: "<sha256>"`, `Cache-Control: private, max-age=31536000, immutable`; 404 `package_not_found`; 410 `package_revision_gone` for a purged revision; at most 2 concurrent downloads per user (429 `rate_limited`, `Retry-After: 5`) |
| `GET /hanzi/{file}` | public | `noTok` | `hanzi` (as today) | stroke JSON of `U<HEX>.json` from the strokes store; 404 for anything else; `Cache-Control: public, max-age=86400`, `ETag` |
| `GET /api/stroke-packs` | public | `tokReadGlobal` | not cached | registry rows for the Sources page, like `/api/component-packs` |

- Ruling: catalogue and downloads need a signed-in user — why: whole-dataset downloads are a bandwidth
  cost a self-hoster should not offer to the internet, while the public routes serve one entry at a time —
  cost if wrong: a script needs a token (allowed, below) to mirror data.
- Ruling: read tokens may use the catalogue, the download and `/api/stroke-packs` (`tokReadGlobal`; the
  pinned token route set grows by these three) — why: the data is not personal, a workspace-limited token
  is harmless here, and exporting a dictionary to another tool is a real script use; the `pat` budget caps
  abuse — cost if wrong: a leaked read token can download packages until revoked.
- Ruling: `/hanzi/{file}` stays public at the same URL and joins `routes()` (`rootHandler` forwards
  `/hanzi/` to the API mux) — why: old shells, the worker's stroke cache and `strokeData.ts` keep working
  unchanged, and the worker fetches it without credentials — cost if wrong: anyone can read stroke data,
  as today.
- Downloads are served with `http.ServeContent` on the open file (resume via Range, bounded memory).

Catalogue (`GET /api/packages`), fixture `docs/contracts/packages/catalogue.json`:

```json
{"format": 1, "instanceId": "01JD8Z3Q4M5N6P7R8S9T0V1W2X", "languages": ["zh"], "building": false,
 "packages": [
  {"id": "lexicon.zh", "type": "lexicon", "languages": ["zh"], "formatVersion": 1, "revision": 3,
   "contentHash": "sha256:9f2c…", "sha256": "4b1e…", "bytes": 24117248, "url": "/api/packages/lexicon.zh/3",
   "state": "ready", "builtAt": "2026-11-16T10:00:00Z", "requires": [], "optional": false,
   "licenseTexts": true,
   "sources": [{"type": "dictionary", "packId": "cedict", "name": "CC-CEDICT", "version": "2026-11-11",
     "license": "CC BY-SA 4.0", "attribution": "CC-CEDICT, MDBG (https://cc-cedict.org)", "notice": ""}],
   "updatedAt": "2026-11-16T10:00:00Z", "deletedAt": null},
  {"id": "levels.hsk-words", "type": "levels", "languages": ["zh"], "requires": ["lexicon.zh"], "…": "…"},
  {"id": "audio.kanjialive-audio", "type": "audio", "languages": ["ja"], "optional": true, "…": "…"},
  {"id": "sentences.zh-demo", "type": "sentences", "revision": 2, "url": null, "state": "deleted",
   "deletedAt": "2026-11-15T09:00:00Z", "…": "…"}]}
```

- `state`: `ready` (url set), `building` (first build pending: `revision` 0, `url` null; clients wait),
  `failed` (first build failed; `error` is present for admins only), `deleted` (tombstone). A package with a
  live older revision stays `ready` while its next build runs. Tombstones stay in the catalogue for good
  (one small row each). `requires` names packages whose ids this one references (levels and sentences
  need the language's lexicon). The `strokes` package lists `languages: ["zh","ja"]`.

Manifest (`manifest.json` in the zip), fixture `docs/contracts/packages/manifest.json`:

```json
{"format": "qinqin-package", "formatVersion": 1, "id": "lexicon.zh", "type": "lexicon",
 "languages": ["zh"], "revision": 3, "contentHash": "sha256:9f2c…", "instanceId": "01JD8Z…",
 "builtAt": "2026-11-16T10:00:00Z", "requires": [], "sources": [ … as in the catalogue … ],
 "files": [{"name": "data.sqlite", "bytes": 81264640, "sha256": "…"},
           {"name": "NOTICE.md", "bytes": 912, "sha256": "…"},
           {"name": "LICENSES/cedict/LICENSE", "bytes": 20123, "sha256": "…"}]}
```

A client verifies, in order: the file's SHA-256 equals the catalogue `sha256` (else discard, retry once);
`manifest.json` `id`, `revision`, `contentHash`, `instanceId` equal the catalogue; each listed file's hash;
`formatVersion` known. Only then it swaps the file in.

**Q6. What does pull v2 page over, and how?** The user's rows, one collection at a time, by keyset.

Request: `GET /api/sync/pull?v=2[&since=<cursor>][&limit=1..2000, default 500][&collections=a,b]
[&workspace=<id>]`, continued with `GET /api/sync/pull?v=2&page=<next>` (the other parameters are inside the
token and must not be repeated).

- Collections, in this fixed round order: `workspaces`, `pluginStates`, `pluginData`, `cards`, `decks`,
  `deckSettings`, `limits`, `fsrsSets`, `fsrsActive` (item 4), `books`, `bookmarks`, `highlights`
  (metadata; chapters stay `GET /api/library/books/{id}/chapters/{n}`), `overlays`, `sentences` (own
  only), `events` (all types but `lookup`).
- Ruling: a round fixes `until` = the server clock at its first page; every page holds rows with
  `since <= updatedAt < until`, collection by collection in round order, each ordered by
  `(updated_at, rowid)`; a page that finishes a collection goes on with the next one; the last page returns `cursor` = `until − 30 s` — why: an upper bound makes paging
  stable (a row rewritten mid-round gets a stamp `>= until` and comes next round, so it is never lost and
  never interleaves), the lag keeps today's guarantee for rows stamped before a slow commit, and keyset
  paging over an index stays fast at any depth — cost if wrong: rows of the last 30 s arrive twice (upsert
  by key, as today).
- Ruling: rowid is the tiebreak and never on the wire; the page token is opaque base64url JSON
  (`p2.` + `{u,s,n,i,k,f,l}`: user, since, until, collection index, last key, filter hash, language hash),
  not signed — why: every request re-derives authorization from the session and filters by `user_id`, so a
  forged token can only move a position; a token of another user or other filters is 400
  `sync_page_invalid` — cost if wrong: none for isolation; a malformed token is a clean 400.
- Ruling: a page stops at `limit` rows or when its encoded rows exceed 4 MiB, whichever comes first, but
  always holds at least one row when rows remain — why: plugin rows can be 256 KiB, so a row count alone
  does not bound memory; the server holds one page at most — cost if wrong: clients make more requests for
  heavy collections.
- From no `since` a round ships live rows only (as today); with a `since` it ships tombstones
  (`deletedAt`): plugin data and typed rows as stored, library rows from `library_deletions`
  (`{id, workspaceId, updatedAt, deletedAt}`), own sentences as stored. Overlays and events have none.
- Ruling: the cursor is opaque too (`c2.` + `{t, f, l}`) and binds the filters (collections, workspace)
  — why: today's "never mix subset pulls with one global cursor" becomes enforced (400
  `sync_page_invalid`) instead of a silent data gap — cost if wrong: a client must keep one cursor per
  filter set (the web keeps one per workspace).
- Ruling: `lookup` events never ship in v2 — why: the web no longer writes them, the lookup history is the
  `lookups` row, and `DELETE /api/events/lookups` hard-deletes, so shipping them would need tombstones for
  data no client reads — cost if wrong: an old lookup-event analysis on Android would need
  `GET /api/events`.
- Ruling: a `410 sync_cursor_expired` answer is defined now (client discards local user data and pulls
  from no `since`) though no tombstone is purged yet — why: a later purge must not need a protocol change —
  cost if wrong: an error code that does not fire before v0.5.

Page (fixture `docs/contracts/sync/pull-page.json`):

```json
{"format": 2, "instanceId": "01JD8Z…", "until": "2026-11-16T10:00:00Z",
 "scope": {"workspaces": [{"id": 7, "language": "zh"}, {"id": 9, "language": "ja"}],
           "languages": ["ja", "zh"], "catalogue": "\"k-3fa9\""},
 "restarted": [],
 "collections": {"workspaces": [], "pluginStates": [], "pluginData": [ {…model.PluginData…} ],
                 "cards": [ {…item 4 typed row…} ], "…": [], "events": []},
 "more": true, "next": "p2.eyJ1IjoxLCJzIjoiIiwibiI6…", "cursor": null}
```

- Every requested collection key is present on every page (non-null arrays, mostly empty). `scope` is on the
  first page of a round only (null after): the full list of the caller's workspaces (a client deletes the
  local data of every workspace not listed — workspace deletion hard-deletes rows, so there is no
  tombstone) and the catalogue ETag for the caller's languages (a changed value means "re-read
  `/api/packages`"). The last page has `more: false`, `next: null`, `cursor: "c2.…"`.
- Row shapes: `workspaces` `{id, language, name, settings, updatedAt}`; `pluginStates`, `pluginData` as
  today; typed collections as item 4's `study/rows.json`; `books`, `bookmarks`, `highlights` as item 4's
  `library/rows.json` plus `deletedAt`; `overlays` `{entryId, written, readings, updatedAt}`; `sentences`
  `{id, entryId, sourcePack: "", userId, hanzi, pinyin, translation, updatedAt, deletedAt}`; `events`
  `{id, workspaceId, device, ts, type, payload, updatedAt}`.

**Q7. The language filter.** Workspace rows are already scoped; entry-bound rows are filtered.

- Ruling: `overlays` and own `sentences` ship only for entries whose language is a language of one of the
  caller's workspaces at round start; workspace rows (plugin data, typed, library, events) are scoped by
  owned workspaces as today; `workspace=<id>` narrows workspace rows to that workspace plus user-global rows
  (`workspaceId: null`, plugin states) and entry-bound rows to its language — why: these are the only user
  rows that outlive their language (a deleted ja workspace leaves ja overlays behind) — cost if wrong: an
  overlay of a language with no workspace is invisible until a workspace of it exists again (it is kept).
- Ruling: when the caller's language set differs from the one in the `since` cursor, the round ships
  `overlays` and `sentences` from no `since` (live rows, all languages now in scope) and lists them in
  `restarted` — why: rows filtered out earlier are older than the cursor and would never come otherwise;
  both collections are user-sized — cost if wrong: one larger round after adding a language.
- A new language reaches packages the same way: the first page's `scope.catalogue` changes (the catalogue
  default follows the workspace languages), the client re-reads the catalogue and downloads that language's
  packages. A removed language: the client may drop its packages and local rows of entries in it.

**Q8. The legacy form and the item-4 old-shell layer.**

- The legacy form is any pull without `v=2`: `cursor` (RFC 3339, optional) and `collections` exactly as
  today; one answer; item 4's legacy view applies (typed rows as `qinqin-flashcards` plugin rows when
  `pluginData` is named without a typed collection).
- Ruling: the legacy answer is streamed by a JSON encoder that writes each row as it is scanned (one row in
  memory) — why: old shells (and token scripts) keep working until v0.5.0 with bounded server memory,
  satisfying "paged or streamed" — cost if wrong: an error mid-stream truncates the JSON (logged; the client
  fails to parse and retries, as on a network cut).
- Ruling: lexicon collections leave the pull: `collections` naming `entries`, `links`, `senses`,
  `levelMembers`, `dictionaries`, `schemes` or `levels` is 400 `sync_collection_moved` (message names
  `GET /api/packages`); a legacy pull without `collections` keeps those keys as `[]`; legacy `sentences`
  carries own sentences only; v2 rejects the moved names the same way — why: the owner's rule (own data
  only); no web build ever pulled them; keeping the keys spares old decoders — cost if wrong: a token script
  that pulled the lexicon breaks with a clear error (documented in the wiki and release notes).
- Legacy answers carry `Deprecation: true` and `Link: </api/sync/pull?v=2>; rel="successor-version"`.

**Q9. What does the web need, offline and online?** API reads online; nothing from packages.

- Ruling: the web downloads no packages; it stays online-first (search, entries, lookup, segment, audio,
  levels by API) and its offline scope stays "today's due cards": the saved v2 pages of the workspace,
  `/api/entries/{id}` of the planned cards, stroke files per character — why: a browser holding 60 MB+ per
  language in IndexedDB costs storage and a SQLite-in-WASM dependency for a scope the PWA does not have —
  cost if wrong: reading a book offline in the browser stays impossible (as today).
- Ruling: the web's study pull moves to v2 with `workspace=<current>` and the study collections
  (`pluginStates`, `pluginData`, the six typed ones), always from no `since` — why: the shipping client
  exercises the protocol Android will use, and the workspace filter bounds the answer to one workspace —
  cost if wrong: two or more requests where there was one (500-row pages; a typical workspace fits in 2–5).
- The service worker may cache `GET /api/sync/pull?v=2` when `workspace` is set and `collections` is a
  non-empty subset of the study set (first page and `page=` continuations alike; the token holds the same
  filters); the `qinqin-core` `lookup*` scrub applies to every saved page. Offline, the same page URLs are
  answered from the saved copies of the last complete online load (the first page's saved answer leads to
  the saved continuation URLs). The legacy pull rule of the allowlist stays for cached old shells.
- Settings → Data reads the catalogue (`?languages=all`) to show each package's revision, size and state
  (admins also see build errors); the Sources page lists stroke packs from `/api/stroke-packs`.

**Q10. Stroke data.** A `strokes` pack type, built from `hanzi-writer-data` at image build time.

- Ruling: `scripts/prepare-strokes-pack.mjs` builds pack `hanzi-writer-strokes` (`type: "strokes"`,
  `languages: ["zh","ja"]`, `license: "Arphic Public License"`, attribution Make Me a Hanzi and
  hanzi-writer-data, `strokes.jsonl.gz` with `{"char", "data"}` lines, the package's `ARPHICPL.TXT` copied as
  `LICENSE` and checked byte-equal to `apps/web/static/ARPHICPL.TXT`) from the pinned npm package
  (lockfile integrity); `hanzi-writer-data` becomes a devDependency; the Docker web stage runs the script
  and the image ships the pack under `/opt/qinqin/strokes` (a `QINQIN_PACKS` root; locally
  `plugins/data-strokes/`, gitignored, a default seed root when present) — why: the licence is clear and
  redistributable, the data comes from the source the web used, and no 47 MB lands in git or the binary —
  cost if wrong: a repo checkout must run the script once (`npm --prefix apps/web ci` first) to have strokes.
- The importer stores rows in `strokes(pack_id, char, data, PRIMARY KEY (char, pack_id))` plus a
  `stroke_packs` registry; `GET /hanzi/U<HEX>.json` answers the data of the live pack that registered
  first for that character; the data is served byte for byte as the npm file.
- Ruling: `serve` installs the bundled strokes pack at startup when no strokes pack is installed and one is
  found in the pack roots (one log line) — why: v0.3 shipped strokes unconditionally; without this every
  upgraded install loses stroke animation until an admin re-seeds — cost if wrong: a few seconds of startup
  once; an admin who uninstalled it on purpose gets it back only if the stroke table is empty (it is not
  re-installed while any strokes pack is live, and an uninstall records an `auto-install off` flag in
  `server_meta`).
- `strokeIndex.ts` stays (it describes the pinned `hanzi-writer-data` version the pack is built from).
  `/ARPHICPL.TXT` stays in the web static files for the licence link.
- Docker image: the binary loses the embedded stroke files (~47 MB); the image gains the gzipped pack
  (measured in the plan; expected well under 15 MB). Data volumes gain `<data>/packages` (roughly the
  compressed size of the installed datasets, audio included) and the strokes rows in the database.

**Q11. Audio.** Clips stay server-side files; the audio package bundles index and clips.

- Ruling: an audio package carries `clips` (with each clip's own licence and attribution) and the clip files
  in the zip — why: one resumable download is what an offline phone needs, and per-clip credits must travel
  with the clips — cost if wrong: `<data>/packages` duplicates `<data>/audio` (about 70 MB for Kanji alive).

**Q12. User data that touches packages: overlays, own sentences, ids, uninstall.**

- Overlays (`user_edits`) and own sentences are user data in the pull; packages never contain user rows.
- Ruling: no re-keying protocol: entry ids are stable per server (Q-intro), so cards, notes, known marks,
  lookups and overlays keep pointing at the same entry across package revisions; an entry a new revision
  lacks shows as unresolved until it returns (it is never deleted server-side) — cost if wrong: a future
  hard delete of entries would need a re-key table; the schema guard keeps `entries` soft-delete only (test).
- A sentence card whose pack sentence was replaced (changed text, new id) shows the "sentence gone"
  fallback, as the web does for a tombstoned sentence today.
- Uninstall: the catalogue row becomes `state: "deleted"` with `deletedAt`; the client deletes the file and
  nothing else (user rows that referenced it, such as level decks, stay as they are on the server).
  Uninstalling the last dictionary of a language tombstones `lexicon.<lang>`; any other dictionary change
  of a language rebuilds it.

**Q13. Push.** Unchanged, now pinned.

- `POST /api/sync/push` keeps its body (events, `pluginData`, item 4's typed arrays) and answer
  `{eventsAccepted, eventDuplicates, dataAccepted, dataSkipped, dataRefused}` (every key always present);
  400 malformed item (nothing applied), 404 foreign workspace or unknown plugin (nothing applied), 413 body
  over 8 MiB or an item over 256 KiB. Fixture `docs/contracts/sync/push-result.json` (Go decodes and drives
  the handler; web decodes the shape for `store.ts`'s `PushResult`).

## Client flows (text diagram)

```
FIRST RUN (signed in)
  GET /api/packages ............ catalogue (my languages) ─┬─ instanceId → store
                                                            └─ for each ready, non-optional package:
                                   GET url (Range resume) → sha256 check → manifest check → install file
  GET /api/sync/pull?v=2 ........ page 1 (scope: workspaces, languages, catalogue etag)
  GET /api/sync/pull?v=2&page=… . until more=false → store cursor c2.… (per filter set)
DAILY SYNC
  POST /api/sync/push ........... outbox (events, typed rows, plugin rows); counters
  GET /api/sync/pull?v=2&since=c2.… → pages … → new cursor
     scope.catalogue changed? ─yes→ GET /api/packages (If-None-Match) → PACK UPDATE / UNINSTALL / NEW LANGUAGE
     instanceId changed? ─yes→ wipe everything → FIRST RUN
     410 sync_cursor_expired → drop user rows → pull without since
PACK UPDATE     catalogue (revision, contentHash) ≠ local → download new revision → verify → swap file
                (410 package_revision_gone mid-download → re-read catalogue → restart)
UNINSTALL       catalogue state deleted → delete local file
NEW LANGUAGE    new workspace → next round: scope lists it, restarted [overlays, sentences],
                catalogue etag changed → packages of that language downloaded
WEB (PWA)       online: v2 pages with workspace=<id> from no since; offline: saved pages + saved entries
                + saved stroke files; never packages
```

## Compatibility matrix

| Client / artefact | After this item | Proven by |
| --- | --- | --- |
| Cached v0.3.x web shell | Legacy pull `cursor=…&collections=pluginData,pluginStates` (item 4 legacy view), streamed; writes as item 4; `/hanzi/U<HEX>.json` now served by Go at the same URL; its worker's stroke cache keeps working | Go legacy-form tests (`sync/legacy-pull.json`), old-shell scenario test extended with a stroke fetch; real-app step 6 |
| Item-4 web (collection branch only, never released) | Legacy form with typed collections keeps working | same tests |
| v0.4 web (this item) | v2 pages per workspace; worker caches them; strokes from Go | web pager and store tests, classify tests, real-app step 5 |
| Outbox v2 | Unchanged (`POST /api/events/batch`) | `pwa/outbox-v2.json` |
| Token scripts | Legacy `collections=pluginData` unchanged; naming a lexicon collection is 400 `sync_collection_moved`; a full legacy pull returns `[]` for them; catalogue and downloads usable with read tokens | Go token tests, `auth/tokens-routes.json` |
| Android (#35) | Catalogue + downloads + v2 + push; `instanceId`; versioning rules | `packages/*.json`, `sync/*.json` fixtures |
| Personal backups v1 | Unchanged (packages and package tables are never in an archive; the restored user does a full v2 pull) | backup tests unchanged |
| Server backups | Unchanged set of directories; packages rebuilt on start with the same revisions | Go test: reconcile after restore keeps revisions |
| Existing installs | Migration adds tables; first start builds packages and installs the bundled strokes pack; old packs lack licence texts until re-seeded (warning) | real-app steps 1–3 |

## Testing and verification (summary; details in the plan)

- Go: fixtures (catalogue, manifest, versioning server cases, schemas, pull page, rounds, push, legacy);
  content hash determinism; builder memory (streaming, batch bound) and coalescing (`-race`); registry
  revisions, retention, tombstones, failure; routes (auth 401, tokens, Range 206, ETag 304, 410, 429, two
  users); v2 keyset under concurrent writes, lag, tombstones, filters, language restart, byte budget,
  isolation for every collection; legacy streaming bound; strokes import, serving and auto-install.
- Web: pager, store on v2, classify/scrub/prepareOffline, the stroke URL unchanged, Sources and Settings →
  Data views, `packageAction` reference rule.
- Real app: peak RSS of a first pull on a fully seeded server before and after; package download, checksum
  and SQLite row counts; stroke files served; offline-flow requests; uninstall and new-language rounds.

## Open (not in this item)

- `GET /api/events?workspace=` (the web's review history) is still one answer per workspace; the v2 pull
  carries events for Android. Paging it needs the web's history loader rewritten — follow-up issue.
- Binary package diffs; tombstone purging (the 410 is ready); serving packages from a CDN.

## Left to the builder

Go package names (`internal/datapkg` proposed), exact SQL of the keyset queries, NOTICE.md wording, the
Settings → Data layout of package rows.
