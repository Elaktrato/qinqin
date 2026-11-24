# Plan — one pack system (#192)

Issue #192 (phase 2 of #190). Branch `feature/192-pack-system` from `develop` at 86fe13a4, worktree
`.claude/worktrees/192-pack`. A refactor: no change for users, administrators or clients (same routes, answers,
error codes and seed order). The suite stays green after every commit; new helpers are test-first; one commit
per task. Go gates under `flock /tmp/qinqin-go.lock`; the e2e suite (record 0007) at the end.

## The places of the issue, today

The issue predates #172, #176 and #198. Its places, checked in the code at 86fe13a4:

| Place (issue) | State at 86fe13a4 | This branch |
|---|---|---|
| `packs.go` `typeOrder` | done before: `packtype.Index` (#172) | the table moves to `internal/pack` |
| `packs.go` `importData` / `uninstall` switches | done before as the `operations` map keyed by type, checked complete by `TestEveryPackTypeHasItsOperations` (#172) | done here: one handler per type (import, uninstall, summary, registry terms) in table order |
| `packs.go` 10-way `errors.Is` chain | open (12 errors by now) | done here: every domain not-found error wraps `pack.ErrNotFound` |
| `packs.go` nine registry queries in `List` | done before: one query per table row (#172) | unchanged, reads `pack.All` |
| `cmd/qinqin/seed.go` `importOrder` | done before: `importRank` = table index | pinned by `TestSeedOrderIsPinned` before any change |
| `cmd/qinqin/packcheck.go` | done before: `staleCheckTables` loops the table; a dictionary special case for the registry terms remained | done here: the terms come from the type's handler |
| `datapkg/spec.go` `registries` | done before: loops the table; the lexicon query was hand-written | done here: the lexicon row is read from the table too |
| `datapkg.Types()` and `typeDefs` | the package types in contract order and their schemas | not needed: a package's schema is datapkg's own per-type code; `TestPackageTypesFollowThePackTypeTable` checks it against the table |
| `datapkg` `AffectedIDs` dictionary check | `typ != dict.TypeDictionary` | done here: "the type whose package is the lexicon" from the table |
| `dict/manifest.go` `manifestTypes` | done before: from the table | moves to `internal/pack` |
| `dict/manifest.go` `manifestFormats` and the three type/format pairs | open | done here: the formats move to `pack`; a type's own format is a table field |
| `plugins.go` six listers and the `UNION` in `Exists` | done before: removed with the synthesized rows (#198) | — |
| `Supported` / `Installable` | done before: read the table | unchanged |
| The uninstall not-found check | open (the chain above) | done here |
| `api/handlers_packs.go` stage: the dictionary registry terms | open | done here (handler) |
| `api/handlers_packs.go` stage: audio refusal text, theme review, font and lemma-rules checks | per-type features, not lists of types | not needed (see Rulings) |
| 13 packages import `dict` only to read a manifest | open | done here: they import `pack` |
| Registry upserts | three forms: `IS NOT excluded` (dictionary, levels, sentences), read-compare-update (frequency, grammar, strokes, lemma-rules, theme), always rewrite (components, audio, font) | done here: one helper, `pack.UpsertRegistry` |
| Copied `now()`, placeholders, capped readers | copies in the pack packages | done here for the pack packages |

## Tasks

1. **Pins first** (no code change): `TestSeedOrderIsPinned` (`server/cmd/qinqin/seed_order_test.go`): one pack
   of every type in one root, directories named against the type order, two dictionaries and two level
   packs; the seed log must be in the literal order of the issue. `TestManifestMessagesArePinned`: every
   validation message with its exact text. Both pass on 86fe13a4.
2. **`internal/pack`**: `Manifest`, `Pack`, `LoadPack`, `LoadExtracted`, `PackRoot`, zip extraction and
   limits, `ValidateNotice`, the type and format constants, `ErrInvalidPack`, `ErrNotFound`; the pack-type
   table of `internal/packtype` merges in (`pack.All`, `Descriptor`, `Lookup`, `Index`, `Types`). `dict`
   keeps dictionary parsing and import. Every importer of `dict` that only read a manifest imports `pack`.
   The tests move with the code.
3. **Not-found errors**: each domain package's not-found error wraps `pack.ErrNotFound` with its own text
   (`pack.NotFound`, test-first); the `errors.Is` chain in `packs` is one check.
4. **One handler table** in `packs`: import, uninstall, summary and registry terms per type, in table order;
   `Import`, `Uninstall`, `RegistryID`, the packcheck terms and the stage's terms go through it; `datapkg`
   reads its lexicon row and `AffectedIDs` rule from the table; the exclusive formats are a table field.
5. **One registry upsert** (test-first): `pack.UpsertRegistry` (the `IS NOT excluded` form); a re-import test
   per type through `packs.Import` counts changed rows (`total_changes()`) and fails for components, audio
   and fonts (and the licence texts) until they use it.
6. **Shared helpers** (test-first): `pack.Now`, `pack.Placeholders`, `pack.ReadCapped`, replacing the copies
   in the pack packages.
7. **A fake pack type** in a test, only a table entry and its handler: stage (zip, extract, load,
   `Installable`), import, list, the licence check, uninstall and the data package plan.
8. **Record 0008** "how to add a pack type" (Accepted, Touched by), README index, the step list moved out of
   the packtype comments and the contracts README; wiki paths; this plan's Execution record; the real-app check.

## Rulings

- Ruling: `internal/packtype` merges into `internal/pack` (`pack.All`, `pack.Descriptor`, `pack.Lookup`,
  `pack.Index`, `pack.Types`, `pack.LexiconPackage`) — the table is what the manifest validation reads, so it
  belongs with the manifest, and `pack` is a leaf like `packtype` was (it imports only `internal/lang`), so every
  package that used `packtype` can use `pack` — cost if wrong: a later split is a rename of one package.
- Ruling: the type constants are `pack.TypeDictionary` ... `pack.TypeFont` (the `dict.Type*` names), not
  `packtype.Dictionary` — one spelling for the call sites that used `dict` (most of them) — cost if wrong: none.
- Ruling: local variables named `pack` became `pk` where the package `pack` is now imported (an AST rename of
  resolved identifiers, no hand edits), so the package name of the issue could be kept — cost if wrong: a
  reader meets `pk`.
- Ruling: `Result` does not move to `pack`. The issue lists it because `freq` returned `dict.Result`; `freq`
  now has its own `Result{Entries}` and `dict.Result` keeps the dictionary's counters (senses, skipped and
  unconverted lines). The generic per-type result is the handler's summary line — cost if wrong: none.
- Ruling: `ErrInvalidPack`'s text becomes `pack: invalid pack` (was `dict: invalid pack`). The API's
  `pack_invalid` detail starts at "invalid pack: ", so no answer changes; only the CLI and log text of an
  invalid pack does. `pack.ErrNotFound` keeps the text `packs: not found` of `packs.ErrNotFound`, which is now
  the same error — cost if wrong: a log grep for `dict: invalid pack` finds nothing.
- Ruling: a type's own format (themes-json, font-slices, rules-json) is the table field `Descriptor.Format`,
  replacing three hand-written cases, and every other message keeps its exact text
  (`TestManifestMessagesArePinned`). One message changes: a manifest that breaks two own-format rules at once
  (a lemma-rules or font pack with another type's own format) now names the rule of its own type; before, a
  fixed theme, font, lemma-rules precedence chose. Both texts are true, the new one names the type the pack
  declares, and the two cases are pinned — cost if wrong: an administrator with such a doubly wrong pack reads
  the other one of two true messages.
- Ruling: `dict` keeps `RegistryTerms` (it is the dictionary's rule); it is the dictionary handler's `terms`, and
  every caller asks `packs.RegistryTerms` (task 4).
- Ruling: the one table has two halves in two packages, row for row: the data in `pack.All` and the behaviour
  (import with its summary line, uninstall, registry terms) in `packs.handlers`, in the same order
  (`TestEveryPackTypeHasItsHandler` compares the two orders; `TestEveryHandlerIsComplete`). One literal in
  `pack` cannot hold the behaviour: the type packages import `pack`, so `pack` cannot name their importers
  (an import cycle). Registration at init (the `database/sql` driver pattern) was rejected: a type package's
  own tests, which link no `packs`, would see a table without behaviour, and the table order would depend on
  init order. One literal in `packs` was rejected: the manifest validation in `pack` needs the types, and
  `pack` cannot import `packs` — cost if wrong: a new type is two rows (one per half) instead of one; both
  are named in record 0008 and a test fails until both exist.
- Ruling: the upload stage's per-type steps stay in `api/handlers_packs.go`: the audio refusal text, the theme
  contrast review (a typed part of the stage answer), the font and lemma-rules checks. They are features of
  those types, not lists of types; a new type needs none of them. Only the registry terms, which were a list
  in two places, moved to the handler — cost if wrong: a new type that needs a stage check adds a branch
  there, as theme, font and lemma-rules did.
- Ruling: `datapkg.Types()` (the package types in contract order, which the catalogue's `idPattern` string
  follows) and `typeDefs` (each package type's schema and copy queries) stay datapkg's own: they are the
  package format, not the pack type, and `TestPackageTypesFollowThePackTypeTable` checks them against the
  table. The lexicon's source registry and the `AffectedIDs` rule now come from the table
  (`pack.Lexicon()`) — cost if wrong: a new type with a package still adds its schema in datapkg (record
  0008 says so).

- Ruling: `pack.UpsertRegistry` returns the row's rowid and whether it wrote; a type whose data rows are
  fingerprinted by a registry column (`content_hash`: frequency, components, strokes, lemma-rules, theme)
  skips its data rows when the row is unchanged. Audio and font packs have no such column; instead of a
  migration they compare their stored rows (clips in id order, slices sorted) with the pack's and pass
  `Force` when those differ, so a data-only change still restamps the row as before — cost if wrong: a
  re-import of an unchanged audio pack reads its clip rows once (a few thousand rows) before writing nothing.
- Ruling: an unchanged re-import of a components, audio or font pack no longer restamps its registry row, so
  its `updatedAt` in `GET /api/admin/packs` stays (it changed on every re-seed before; the other eight types
  already kept it). This is the issue's goal and the only answer that changes for an unchanged pack; it has
  a line in `docs/contracts/CHANGELOG.md` with the message change above — cost if wrong: an administrator
  who read `updatedAt` as "last seeded" sees the last change instead.
- Ruling: the licence texts (`packs.StoreTexts`) write nothing when the stored rows equal the pack's files;
  they were rewritten on every import (2 rows for a pack without licence files) — cost if wrong: none.
- Ruling: the error texts of a failed registry write are now "register <type> pack <id>: write <table> row
  of <id>: ..." style (internal errors, logged, never in an answer) — cost if wrong: none.

- Ruling: the shared helpers (`pack.Now`, `pack.Placeholders`, `pack.Tuples`, `pack.ReadCapped`) replace the
  copies in the pack packages only (`dict`, `freq`, `levels`, `sentences`, `grammar`, `audio`, `components`,
  `strokes`, `lemmapack`, `themes`, `fonts`, `pack`). The other copies (`auth`, `events`, `plugins`,
  `overlay`, `lexicon`, `study`, `api`) are not pack code; #194 moves the API ones anyway — cost if wrong:
  a few `now()` copies outside the pack system remain.
- Ruling: the theme and font readers keep their `io.LimitReader(max+1)` reads: their parsers own the size
  rule and its message (shared with the contract tests), so `ReadCapped` would change a message — cost if
  wrong: two capped reads stay spelled out.

- Ruling: the fake-type test lives in `internal/packs` (`faketype_test.go`) and goes through the steps of the
  HTTP stage (unzip, load, `Supported`, `Installable`, `RegistryTerms`, `Find`), import with the change hook,
  list, an unchanged re-import, the package plan and `AffectedIDs`, and uninstall. It does not drive the
  HTTP routes: the `api` tests cannot reach `packs`' test hook (`AddTypeForTest`), and the stage handler has
  no per-type code for a type like it. Its type has no data package: a type with one also needs its schema
  in `datapkg` (`typeDefs`, `Types()`, the contract), which is the package format, not a table entry — cost
  if wrong: a route-level regression for a new type is caught only by that type's own api tests.

- Ruling: record 0008 is `docs/architecture/0008-pack-types.md`, Accepted, "Touched by: #194, #179, #182"
  (#194 moves the dictionary and pack handlers' SQL, #179 and #182 may add types); the step list of how to
  add a type moved there from the packtype comments, and the contracts README and the wiki link it — cost if
  wrong: none.

- Ruling (fix wave): every transaction of an import or an uninstall of the pack packages begins with
  `pack.BeginWrite`, which runs a write statement that changes no row (`UPDATE schema_migrations SET version =
  version WHERE 0`) first and so holds SQLite's write lock from the start, like `BEGIN IMMEDIATE`, while
  staying a `*sql.Tx` that the importers' helpers take. `_txlock=immediate` on the connection was rejected: it
  would make every transaction of the server a writer (reads in a transaction would queue behind the builder);
  a `BEGIN IMMEDIATE` on a raw `sql.Conn` (as `plugins` does) was rejected because twenty helpers take a
  `*sql.Tx`. It covers the reads-first transactions that predate #192 too (themes' owner check, fonts'
  `packShas`, lemmapack's `CheckLanguage`, the uninstalls' id lookups) — cost if wrong: an import waits for
  the builder's write (busy_timeout 5 s) instead of failing; nothing else changes.

- Ruling (fix wave): the legacy `POST /api/admin/dictionaries` and `DELETE /api/admin/dictionaries/{id}`
  now go through `packs.Import` and `packs.Uninstall` (by the row's pack id) instead of `dict` directly, so a
  dictionary installed there gets its licence texts and loses them on uninstall like any upload. Same answers
  (201 with the row, 204, 404 `not_found` for an unknown or uninstalled id, 400 `pack_invalid`); new: a
  failure to store the texts after the import committed is a 500, as on the upload route. The rest of the
  dictionary handlers (their SQL) is #194's — cost if wrong: none found; the route tests pass unchanged.
- Ruling (fix wave): the components fingerprint stays as it is: parts are read with `strings.Fields`, so no
  part holds a space and the space-joined list is unambiguous; a new encoding would rewrite every installed
  components pack once for nothing — cost if wrong: none while the parser splits on whitespace.

## Execution record

- Task 1: `TestSeedOrderIsPinned` and `TestManifestMessagesArePinned` pass on 86fe13a4 unchanged (the seed
  test asserts the 15-line order of one root holding all 11 types). They pass again after every later task.
- Task 2: files moved with `git mv` (history kept): `dict/{manifest,pack,notice}.go`, their tests, and
  `packtype/*`. The rewrite of the call sites was a script (`dict.X` to `pack.X` for the moved names, the
  `packtype` names) after an AST rename of local `pack` variables; one composite-literal key the rename
  touched was fixed by hand, and the lemmapack test helper `pack(...)` became `rulesPack(...)`. Full Go
  `./...` green apart from the known `internal/ai` IPv6 test. After task 2, `dict` was still imported by `api`, `packs`, `packcheck` and `tools/tatoeba`;
  task 4 removed it from `packcheck.go`, `packs/texts.go` and `api/handlers_packs.go`, and the fix wave
  (group 3) from `api/handlers_dict.go` (corrected in the fix wave: today only `packs/handlers.go`, the
  dictionary handler, and `tools/tatoeba`, which imports dictionaries, import `dict` outside tests); 14
  non-test packages import `pack`.
- Task 3: `TestNotFoundIsErrNotFound` and `TestEveryNotFoundErrorIsPackNotFound` written first and seen
  failing (12 errors), then `pack.NotFound`. The texts of the domain errors are unchanged.
- Task 4: `packs/handlers.go` holds the handlers in table order; `packcheck` and the upload stage ask
  `packs.RegistryTerms`, so `dict` leaves `packs/texts.go`, `packcheck.go` and `api/handlers_packs.go`.
  Test-guarded refactor (the handler bodies are unchanged); new tests: `TestEveryHandlerIsComplete`,
  `TestRegistryTermsFollowTheHandler`.
- Task 5: `TestUpsertRegistry` (insert, unchanged writes nothing, change, revive, insert-only columns,
  `Force`) written first against a stub and seen failing; `TestReimportOfAnUnchangedPackWritesNothing`
  (one case per table row, a missing case fails) seen failing for every type before the change: 2 changed
  rows for each (the licence texts), 7 for audio, 9 for components and fonts, 4 for strokes and themes.
  After: 0 for all 11. All eleven importers write their registry row through the helper. One run of the
  `api` package failed `TestPackageDownload` once under the parallel targeted run; it passed in the next
  full `api` run and 40 times alone (not reproduced; watched in the final gates).
- Task 6: `TestNowIsAnRFC3339UTCSecond`, `TestPlaceholders`, `TestReadCapped` written first against stubs and
  seen failing, then the helpers; the copies replaced (imports fixed with goimports).
- Task 7: `TestAFakePackTypeNeedsOnlyItsTableEntry` passes with `AddTypeForTest` (a row of `pack.All` and of
  `handlers`, restored at cleanup) and nothing else; before the entry the stage refuses the pack (unknown
  type). It checks existing behaviour, so it passed at once; a mutation (List looping over the first 11
  rows only) made it fail.
- Task 8: record 0008 and its README index row; the README's "records still to write" no longer names #192;
  the contracts README, the wiki Data-pack-format page and the contract changelog updated.
  `architectureDocs.test.ts`, `wikiDocs.test.ts`, `readmeDocs.test.ts` green.
- Real-app check: two binaries built from scratch copies (`git archive` of 86fe13a4 and of this branch, with
  the committed placeholder SPA), each seeded with `qinqin seed --packs plugins/data` into its own data
  directory: the 15 pack lines of the seed log are identical in order and text (dictionaries first: cedict,
  es-demo, jmdict, kanjidic2, unihan, then jiten-frequency, the five level lists, the two grammar packs,
  kanjivg-components, ja-lemma), and so are the startup logs of `qinqin serve` (apart from the port). Served on
  a random free 127.0.0.1 port above 20000; as an administrator through the API: `GET /api/admin/packs` lists
  the same 15 packs (type, id, version, language, licence) on both. A components pack zip uploaded,
  installed, uploaded and installed again unchanged, uninstalled (204, then 404 `not_found`, gone from the
  list): on 86fe13a4 the re-install restamped the registry row (`updated_at` one second later), on this
  branch it wrote nothing (same `updated_at`, same row ids of the registry, data and licence-text rows).
  Servers stopped, scratch copies and data deleted.
- Final gates: `gofmt -l` empty; `go mod tidy -diff` clean; full Go `./...` under the flock green apart from
  the known `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here), 51 packages ok
  (the `TestPackageDownload` failure of task 5 did not come back); web `check` 0 errors, `build` ok; full
  vitest under Node 26.13.1: 588 files, 12,602 passed, 2 skipped; e2e 13 passed (one run); `node --test
  scripts/*.test.mjs` 156 passed; `gen-api-docs --check` ok; `check-sources` ok.
- Not verified: the HTTP stage and install routes with the fake type (see the Ruling; the steps are tested
  in `packs`); audio and font packs through the real app (no audio pack is bundled and uploads refuse audio;
  the font case is covered by the re-import test only); a re-seed of the full bundled packs into an already
  seeded database counted for changed rows (the per-type test counts with tiny packs; the real app was
  checked with one components pack); the `TestPackageDownload` failure seen once in task 5 was not
  reproduced or explained.

### Fix wave (independent review)

- Group 1, SQLITE_BUSY (must-fix 1): reproduced on the reviewed HEAD, `TestPackageDownload -count=30` failed
  with "licence texts were not stored ... database is locked (5)": `StoreTexts` read (`storedTexts`) before
  its first write, and the builder kicked by the previous import committed in between. `pack.BeginWrite`
  with a test hook came first as a plain `BeginTx` (all 22 pack transactions switched);
  `TestPackTransactionsTakeTheWriteLockFirst` (per type: import and uninstall; the hook reads in the
  transaction and has a second connection with `busy_timeout(0)` try to commit) failed for every type
  ("database is locked (517)", the other connection committed inside every transaction). With the write
  lock taken first it passes, also `-count=60`; `TestPackageDownload -count=60` passes; the re-import test
  still counts 0 changed rows.
- Group 2, a changed re-import (must-fix 2): `TestReimportOfAChangedPackStoresTheChange`
  (`server/internal/packs/changed_reimport_test.go`): for every type, each manifest term (name, version,
  license, attribution, notice), its language or languages, its own registry columns (levels `unit`, grammar
  `levels_json`, lemma-rules `rules_json`) and one or more data-row fields, changed in place and re-imported;
  the stored value is asserted (a type without a case fails). It passes on the fixed code (it guards the
  existing behaviour). The review's mutations all fail it (13 runs, each restored): insert-only themes
  `content_hash`, strokes `languages`, grammar `levels_json` and `language`, levels `unit`, the `language` of
  dictionary, sentences, components and audio, `version` and `license` for every type, and audio's and fonts'
  `Force` replaced by a length check (the audio run first failed to compile because of the unused `slices`
  import; rerun with it kept used, it fails on the clip licence, file and same-count form changes).
- Group 3 (should 3–5, nits 6–9): record 0008 names the places that still list types (datapkg `Types()` and
  `typeDefs`, the web `PackType`, `PACKAGE_TYPES`, `PACKAGE_ID` and labels, the i18n strings, the wiki), adds
  `apps/web/src/lib/api/packages.ts` to step 6, says the fake-type test covers the `packs` steps only,
  corrects the "nothing rebuilt" wording (the hook runs, the builder builds to a temporary file and adds no
  revision), adds the `content_hash` rule for later data migrations and the `BeginWrite` step, and words the
  seed pin as an expected amendment for an appended type. `TestSeedOrderAcrossRootsIsByPath` (two roots given
  z-root first; the a-root dictionary imports first) pins the existing order by full path; it passed at once
  (existing behaviour). `TestEveryNotFoundErrorIsPackNotFound` now walks the handler table (raw handler error
  and `Uninstall`); a mutation (audio's error back to `errors.New`) fails it.
  `TestLegacyDictionaryRoutesKeepTheLicenceTexts` failed first (no texts stored by the legacy route), then
  passes. Components fingerprint: no change (Ruling). Task 2's line about `dict`'s importers corrected.
- Seen while gating group 3: `cmd/qinqin` `TestServeRebuildsTheRefreshedBundledPackage` failed once ("revision
  2 ready, want 1"). Pre-existing: with `-count=20` it fails 3 times on 86fe13a4 and 2 times on the reviewed
  head a2bce403 (also "no rows" once on the base); not caused by #192 and not fixed here (a startup race
  between the lemma-rules sync and the reconcile; a follow-up for the next server issue).

