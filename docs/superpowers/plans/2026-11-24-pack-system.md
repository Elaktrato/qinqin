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

## Execution record

- Task 1: `TestSeedOrderIsPinned` and `TestManifestMessagesArePinned` pass on 86fe13a4 unchanged (the seed
  test asserts the 15-line order of one root holding all 11 types). They pass again after every later task.
- Task 2: files moved with `git mv` (history kept): `dict/{manifest,pack,notice}.go`, their tests, and
  `packtype/*`. The rewrite of the call sites was a script (`dict.X` to `pack.X` for the moved names, the
  `packtype` names) after an AST rename of local `pack` variables; one composite-literal key the rename
  touched was fixed by hand, and the lemmapack test helper `pack(...)` became `rulesPack(...)`. Full Go
  `./...` green apart from the known `internal/ai` IPv6 test. `dict` is now imported by `api` (dictionary
  routes), `packs`, `packcheck` and `tools/tatoeba` (they import dictionaries) and by `packs/texts.go` and
  `packcheck.go` for `RegistryTerms` (task 4); 14 non-test packages import `pack`.
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
