# Data packages

Every data set a client needs (dictionaries per language, level lists, pack sentences, frequency, components,
audio, grammar, stroke data, lemmatizer rules) is a versioned, checksummed **package** the server builds from its own database
and serves for download. A package is read-only data: it never holds user rows. Design:
`docs/superpowers/specs/2026-11-16-v040p-packages-design.md` (issue #93). User data travels in the paged pull
(`docs/contracts/sync/`).

Owner code: `server/internal/datapkg` (ids, writers, content hash, registry, builder),
`server/internal/api/handlers_packages.go` (routes). Web: `apps/web/src/lib/api/packages.ts` (`parseCatalogue`)
and `apps/web/src/lib/packages/versioning.ts` (`packageAction`, the reference client rule; the web installs no
packages).

Fixtures:

- `catalogue.json` — valid and invalid catalogues of `GET /api/packages`.
- `manifest.json` — valid manifests (one per type) and invalid ones.
- `versioning.json` — `server` cases (pack operations → catalogue rows) and `client` cases (`packageAction`).
- `schemas.json` — the exact `data.sqlite` schema of format 1 per type, and the row order of each table.
- `pack-types.json` — every data **pack** type (the manifest `type` of a pack an administrator installs) and
  what it builds; see "Pack types" below.

## Ids and types

| Type | Id | Source rows | `requires` |
| --- | --- | --- | --- |
| `lexicon` | `lexicon.<lang>` | every live entry of the language (forms, readings), its links, the senses of every live dictionary of the language, those dictionaries | — |
| `levels` | `levels.<packId>` | one level scheme, its levels and members | `lexicon.<lang>` |
| `sentences` | `sentences.<packId>` | the pack's live sentences; `pinyin` may be `""` (no reading: the pack left it out rather than guess; show no reading line) | `lexicon.<lang>` |
| `frequency` | `frequency.<packId>` | the pack's frequency rows | — |
| `components` | `components.<packId>` | the pack's component index | — |
| `audio` | `audio.<packId>` | the pack's clips (index and files); `optional: true` | — |
| `grammar` | `grammar.<packId>` | the pack's lessons and its levels | — |
| `strokes` | `strokes.<packId>` | the pack's stroke-order data; `languages: ["ja", "zh"]` | — |
| `lemma-rules` | `lemma-rules.<packId>` | the pack's lemmatizer rule table: one `lemma_rules` row, `rules_json` byte for byte as imported (`docs/contracts/lemma/README.md`, Rule-table packs) | — |

An id matches `catalogue.json` `idPattern`. `.` separates type and pack id (pack ids and language codes have
no dot). A lexicon package exists per language that has at least one live dictionary; installing or removing
a dictionary of the language rebuilds it, and removing the last one makes it a tombstone. Every other package
belongs to exactly one installed pack.

## Pack types (`pack-types.json`)

Packages are built from installed **packs**. `pack-types.json` lists every pack type in the server's order (the
admin list `GET /api/admin/packs` and the seed order): its language shape (`one`: the manifest states
`language`; `many`: `languages`; `none`: neither), whether an administrator may install it by an upload
(`uploadable`; audio packs are seeded), the package type it builds (`package`, `null` for none; the
dictionaries' `lexicon` is per language), and that package's `requiresLexicon` and `optionalPackage`. The
server keeps one table of these (`server/internal/pack/types.go`) and a Go test compares it with the fixture; the web
test `lib/plugins/packTypes.contract.test.ts` checks the web knows every type. How the server adds a type:
[architecture record 0008](../../architecture/0008-pack-types.md). A client meets a pack type it does
not know only in admin and Sources views; it shows it by its `type` string.

**Data packs are content, not features.** There are no code plugins (#199): a pack id has no feature switch
and no rows of its own (`features/`, `keyed/`). Packs are listed by
their own routes (`GET /api/dictionaries`, `/api/frequency-packs`, `/api/sentence-packs`, `/api/audio-packs`, ...;
`docs/wiki/API-Routes.md`) and, for administrators, `GET /api/admin/packs`; their data by this catalogue.

## Catalogue: `GET /api/packages[?languages=zh,ja|all]`

Signed-in users (read tokens allowed). Without `languages` the catalogue lists the packages of the caller's
workspace languages; `all` lists every package. A row is listed when any of its `languages` is in the set.
`ETag` and `If-None-Match` (304); `Cache-Control: no-cache`.

```jsonc
{"format": 1, "instanceId": "<ULID>", "languages": ["zh"], "building": false,
 "packages": [ /* sorted by id */ {
   "id": "lexicon.zh", "type": "lexicon", "languages": ["zh"], "formatVersion": 1,
   "revision": 3, "contentHash": "sha256:<64 hex>", "sha256": "<64 hex>", "bytes": 24117248,
   "url": "/api/packages/lexicon.zh/3", "state": "ready", "builtAt": "2026-11-16T10:00:00Z",
   "requires": [], "optional": false, "licenseTexts": true,
   "sources": [{"type": "dictionary", "packId": "cedict", "name": "CC-CEDICT", "version": "2026-11-11",
                "license": "CC BY-SA 4.0", "attribution": "CC-CEDICT, MDBG (https://cc-cedict.org)", "notice": ""}],
   "updatedAt": "2026-11-16T10:00:00Z", "deletedAt": null}]}
```

- Every key of `rowKeys` is always present; `error` (non-empty string) is added only in the catalogue of an
  administrator's own session (never through an access token), on a row whose last build failed. Top-level `languages` is the language set applied (sorted);
  `building` is true while the server builds or reconciles packages. The `ETag` of the default catalogue
  (no `languages`) is what a pull round's `scope.catalogue` carries for the same caller (`docs/contracts/sync/`).
- `languages` of a row is a non-empty sorted list. Times are RFC 3339 UTC.
- `state`:
  - `ready` — `revision >= 1`, `url = /api/packages/<id>/<revision>`, `contentHash`, `sha256`, `bytes`,
    `builtAt` of that revision. A later build that is running or failed leaves the row `ready` (the older
    revision stays downloadable).
  - `building` — first build pending: `revision` 0, `url` null, `contentHash`/`sha256` `""`, `bytes` 0,
    `builtAt` null. Clients wait.
  - `failed` — first build failed: as `building`.
  - `deleted` — tombstone of an uninstalled package: `url` null, `deletedAt` set; `revision`, hashes, `bytes`
    and `builtAt` stay those of the last build (revision 0 if it never had one). Tombstones stay listed.
- `requires` names the packages whose ids this one references. `optional` is true for audio: clients ask
  before downloading. `licenseTexts` is false for a pack imported before the server kept licence files
  (its package carries the licence names and attribution only; an administrator re-seeds to add them).

## Download: `GET /api/packages/{id}/{revision}`

Signed-in users (read tokens allowed). The zip file of that revision: `ETag: "<sha256>"`,
`Content-Type: application/zip`, `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`, `Range`/`If-Range` (206), `Cache-Control: private, no-cache` (a cached copy revalidates:
`If-None-Match` with the ETag answers 304; not `immutable`, since a server restored from a backup may build a
revision number again with other bytes).
404 `package_not_found` (unknown id or revision, or not a package id; a catalogue read may briefly precede the file of a revision it just listed, so a 404 for such a revision is retried after a short delay), 410 `package_revision_gone` (a replaced
revision whose file was purged; the previous revision is kept 7 days), 429 `download_busy` with
`Retry-After: 5` (at most 2 concurrent downloads per user; unlike `rate_limited` a client may retry it
automatically after the wait). Error codes: `docs/contracts/auth/errors.json`.

## The package file

```
<id>-r<revision>.qqpkg      a zip (Store or Deflate, no encryption)
  manifest.json             the manifest below (never listed in its own files)
  NOTICE.md                 per source: name, version, licence, attribution, notice
  LICENSES/<packId>/<name>  the source pack's LICENSE*, ATTRIBUTION*, NOTICE*, COPYING* files, verbatim
  data.sqlite               the package database (schemas.json)
  clips/<sha256>.<ext>      audio packages only
```

Manifest (`manifest.json` `keys`): `format` is `"qinqin-package"`; `formatVersion`, `id`, `type`, `languages`,
`revision`, `contentHash`, `instanceId`, `builtAt`, `requires`, `sources` as in the catalogue; `files` lists
every other file `{name, bytes, sha256}`. A file name is relative, `/`-separated, without empty, `.` or `..`
segments or backslashes, unique, and one of the places above (`LICENSES/<packId>/` only for a source pack,
`clips/` only in audio packages); `data.sqlite` and `NOTICE.md` are always listed.

### Verification (a client, in this order)

1. The downloaded file's SHA-256 equals the catalogue `sha256` (else discard it and retry once).
2. `manifest.json` `id`, `revision`, `contentHash` and `instanceId` equal the catalogue row and the server.
3. Every listed file's size and SHA-256 match.
4. `formatVersion` is one the client knows.

Only then the client swaps the file in. A package file is never used partially.

### `data.sqlite`

`schemas.json` holds the exact statements of format 1: `qq_package(key, value)` (`packageKeys`: `id`, `type`,
`formatVersion`, `revision`, `contentHash`, `instanceId`, `builtAt`, `languages`; grammar adds `levels_json`),
`qq_sources` (one row per source pack; `license_files` is a JSON array of the names under
`LICENSES/<packId>/`) and the type's tables and indexes. Ids are the server's ids (entry ids are stable per
server, so user data that names an entry needs no re-keying across revisions). Live rows only: a package is
a snapshot and has no tombstones. JSON lists and objects are TEXT columns holding JSON, as on the server.
Senses carry no ids: key them by `(entry_id, dictionary_id, ord)`.

Clients open package databases **read-only and replace the file on update; they never copy or merge package
rows into their own database.** An update is an atomic file swap; user data can never be lost by a package
change.

## Versioning

- `formatVersion` — the schema of `data.sqlite` for the type (1 for every type now). A client accepts exactly
  the versions it knows.
- `contentHash` — `sha256:` over a canonical stream of the package content (type, format version, every data
  table in `schemas.json` order with rows in its `order`, `qq_sources`, the licence texts); not over
  `qq_package`. Opaque to clients: compare it, never compute it. Equal content gives an equal hash whatever
  the SQLite version or row insertion order.
- `revision` — +1 whenever `contentHash` changes, or the manifest's `languages` or `requires` (which the hash
  does not cover) change, so `manifest.json` always agrees with the catalogue row; never reused, continued
  after an uninstall and reinstall. A rebuild with an equal hash and equal manifest fields changes nothing (no
  new revision, no new file; a change of the catalogue-only `optional` updates the row in place).
- `sha256`, `bytes` — of the file; what a download is checked against.
- `instanceId` — a ULID the server creates once (migration 039, `server_meta`). It is in the catalogue, every
  manifest and every pull page. A different one means another database: discard packages and local user
  data and start over.

### Client rule (`versioning.json` `client` cases, `packageAction`)

Applied in this order:

1. local instance set and different from the remote one → `reset`;
2. row `deleted` → `delete` when a file is installed, else `keep`;
3. row `building` or `failed` → `keep` when a file is installed, else `wait`;
4. row `formatVersion` not known → `unsupported` (keep using an installed file);
5. nothing installed → `download`;
6. installed `revision`, `contentHash` or `formatVersion` differs from the row → `download` (never compare
   magnitudes: a server restored from an older backup goes back in revision and still wins);
7. else `keep`.

`download` of an `optional` package is asked of the user first.

## Server rules (`versioning.json` `server` cases)

Packages are built by the server from its database (never in CI), one builder at a time, after a pack import
or uninstall commits and at startup (reconcile: build what is missing, stale or of an old `formatVersion`).
A failed build keeps the previous revision `ready` and records the error (administrators see it). Files live
under `<data>/packages/<id>/r<revision>.qqpkg`; the previous revision is kept 7 days. `<data>/packages` is not
backed up: a restored database rebuilds to the same revisions and hashes.
