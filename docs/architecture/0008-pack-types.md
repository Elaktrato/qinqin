# 0008. Server: one pack system and how to add a pack type

## Status

Accepted

Touched by: #179, #182, #216, #221. A merge from one of these issues that changes what this record names updates the record.

## Context

Data pack types were listed by hand in about ten places of the server, and three copies drifted: audio packs
were shown as plugins (#169), sentence packs were missed by the licence check (#172). #172 added a table of
the types; the type's behaviour, the manifest, pack loading and the not-found errors still lived in
`internal/dict` and twelve type packages, so thirteen packages imported the dictionary importer to read a
manifest, `packs` held a twelve-way `errors.Is` chain, and the registry rows were written in three different
ways (some rewrote every row on every import). #192 made one pack system; the plan is
`docs/superpowers/plans/2026-11-24-pack-system.md`. #179 (measure words) and #182 (pitch accent) may add
types. #216 added `images` (pictures and a word mapping, no data package) as the last row, the way the record asks of a type that only adds; #221 appended `course` (one course's skeleton, no data package) after it.

## Decision

- **`server/internal/pack` is what every pack type shares**: `Manifest` and its validation, the notice rule
  (`ValidateNotice`), `LoadPack`, `LoadExtracted`, the zip extraction and its limits (`ExtractZipAt`,
  `DefaultZipLimits`), the type and format constants (`TypeDictionary` ... `TypeFont`, `Formats`),
  `ErrInvalidPack`, `ErrNotFound` with `NotFound`, the registry upsert `UpsertRegistry`, and the helpers
  `Now`, `Placeholders`, `Tuples` and `ReadCapped`. It imports only `internal/lang`, so every type package
  imports it. `server/internal/dict` only parses and imports dictionaries and reads the installed ones (`server/internal/dict/installed.go`, record [0003](0003-domain-packages-own-their-sql.md)).
- **One table of pack types, in two halves, row for row.** The data half is `All` in
  `server/internal/pack/types.go`: one `Descriptor` per type (its registry table, its language shape `One`,
  `Many` or `None`, whether an administrator may upload it, the data package it builds with
  `RequiresLexicon` and `OptionalPackage`, and its own `Format` if it has one). Its order is the order of the
  admin list and of `qinqin seed`: dictionaries first. The behaviour half is `handlers` in
  `server/internal/packs/handlers.go`: one `handler` per row, in the same order, with the import (which
  returns the seed line), the uninstall and, if the registry row differs from the manifest, the registry
  terms. `pack` cannot hold the behaviour: the type packages import `pack`.
- **Every generic place loops over the table**: the manifest validation, `List`, `Find`, `Supported`,
  `Installable`, `RegistryTerms`, `Import`, `Uninstall` (one `pack.ErrNotFound` check), the seed order
  (`importRank` in `server/cmd/qinqin/seed.go`), the startup licence check (`staleCheckTables` in
  `server/cmd/qinqin/packcheck.go`), the data package plan (`registries` and `Plan` in
  `server/internal/datapkg/spec.go`) and `AffectedIDs`.
- **One way to write a registry row**: `UpsertRegistry`, the `IS NOT excluded` upsert. An unchanged pack is
  not written, and its data rows are skipped (by a `content_hash` column, or by comparing the stored rows and
  passing `Force` when they differ), so a re-import of an unchanged pack changes no row. A changed column or
  data row is stored (`TestReimportOfAChangedPackStoresTheChange`).
- **Pack transactions take the write lock first** (`BeginWrite`): a transaction that read before writing
  failed with SQLITE_BUSY when another connection (the data package builder) committed in between.
- **Each type's not-found error** is `NotFound("<text>")`: its own text and identity, and a
  `pack.ErrNotFound`.

### How to add a pack type

1. **Migration** (`server/internal/db/migrations`): the registry table with a unique `pack_id`, `name`,
   `version`, `license`, `attribution`, `notice`, `updated_at`, `deleted_at` and the language column of its
   shape (`language`, or `languages` as a JSON array; none for `None`), plus its data tables.
2. **Type package** (a package under `server/internal`, like `server/internal/lemmapack`): `Import` validates
   the manifest type and format, parses the files (`pack.ErrInvalidPack` for a bad pack), begins its
   transaction with `BeginWrite`, writes the registry row with `UpsertRegistry` and its data rows only when
   that wrote; `Uninstall` (also in a `BeginWrite` transaction) soft-deletes and answers an unknown pack with
   its `NotFound` error. Every value the import stores either is a registry column the upsert compares, or is
   covered by one (a `content_hash` of the data rows), or is compared row by row and passed as `Force`.
3. **Table row** in `All` (`server/internal/pack/types.go`), at the position the seed order needs, with a
   `Type` constant; a format of its own goes into `Formats` (`server/internal/pack/formats.go`) and the row's
   `Format`.
4. **Handler** in `handlers` (`server/internal/packs/handlers.go`), at the same position.
5. **Contract**: the row in `docs/contracts/packages/pack-types.json` and a line in
   `docs/contracts/CHANGELOG.md`; on the web, the type in `PackType` (`apps/web/src/lib/api/packs.ts`), its
   label, order and uninstall text in `apps/web/src/lib/settings/packsView.ts` and the strings in
   `apps/web/src/lib/i18n/messages/en.json`.
6. **Data package**, if it builds one: its package type in `Types()` and its schema in `typeDefs`
   (`server/internal/datapkg/write.go`), `docs/contracts/packages/schemas.json` and `catalogue.json`, and on
   the web `PACKAGE_TYPES` and `PACKAGE_ID` in `apps/web/src/lib/api/packages.ts`.
7. **Tests that ask for it**: a case in `typeCases` (`TestReimportOfAnUnchangedPackWritesNothing`,
   `TestPackTransactionsTakeTheWriteLockFirst`) and in `typeChanges` (`TestReimportOfAChangedPackStoresTheChange`),
   and the pinned list of `TestSeedOrderIsPinned`. Appending the new type there at its table position is the
   expected amendment (a type that only adds to the end, like the planned measure-word packs of #179, keeps
   every existing type's place); moving an existing type is an owner's decision.
8. **Later migrations of the type**: a migration that adds or backfills a data column must clear the type's
   `content_hash` (or the import's comparison must include the new column), or an unchanged pack is never
   re-imported into the new column: the re-import would see the old fingerprint and write nothing.
9. **Upload**: a type that may not be uploaded sets `Uploadable` false; a stage check (as theme, font and
   lemma-rules have) goes into `server/internal/api/handlers_packs.go`.
10. **Docs**: `docs/wiki/Data-pack-format.md`, and `docs/sources.md` for a bundled pack.

## Consequences

- A new type is a migration, its type package, one row in each half of the table, the contract row and the
  web type and label. No server code lists the types besides the table; what still names them, each checked
  by a test or by the steps above: datapkg's package types (`Types()`, `typeDefs`) for a type with a package,
  the web lists (`PackType`, `PACKAGE_TYPES`, `PACKAGE_ID`, the labels in `packsView.ts`), the i18n strings and
  the wiki. `TestAFakePackTypeNeedsOnlyItsTableEntry` shows it for the `packs` steps (stage, import, list,
  re-import, package plan, uninstall) with a type that exists only in the test and has no data package; it
  does not drive the HTTP routes.
- Re-seeding or re-uploading an unchanged pack writes no row and does not restamp the admin list. The change
  hook still runs and the builder still builds the package to a temporary file; it only adds no new revision,
  because the content hash is the same.
- The two halves can disagree only in a way a test catches; a reader looks in two files for one type.

## Allowed / Not allowed

Allowed:

- A switch on a type for a feature of that type (the theme contrast review at upload, the strokes
  auto-install at start, the dictionary routes).
- Reading `All` (or `Lookup`, `Index`, `Types`, `Lexicon`) anywhere.

Not allowed:

- A new hand-written list, map or `switch` of every pack type, or a query per registry table outside a loop
  over `All`.
- A registry row written without `UpsertRegistry`; data rows rewritten when nothing changed.
- A not-found error of a type that is not a `pack.ErrNotFound`.
- An import or uninstall transaction of a type package begun without `BeginWrite`.
- Importing `server/internal/dict` to read a manifest.

## Enforcement

- `server/internal/packs/packtype_test.go`: `TestEveryPackTypeHasItsHandler` (the handler order is the table
  order), `TestEveryHandlerIsComplete`, `TestEveryRegistryTableHasTheStandardColumns`,
  `TestListOrderIsTheTableOrder`, `TestRegistryTermsFollowTheHandler`.
- `server/internal/packs/reimport_test.go`: `TestReimportOfAnUnchangedPackWritesNothing`, one case per row
  (a row without one fails), counting changed rows with `total_changes()`.
- `server/internal/packs/changed_reimport_test.go`: `TestReimportOfAChangedPackStoresTheChange`, every
  manifest term, the type's own columns and data rows changed in place.
- `server/internal/packs/concurrent_test.go`: `TestPackTransactionsTakeTheWriteLockFirst` (the
  `SetAfterBeginForTests` hook has another connection try to commit inside each pack transaction).
- `server/internal/packs/notfound_test.go`: `TestEveryNotFoundErrorIsPackNotFound`, over the handler table.
- `server/internal/packs/faketype_test.go`: `TestAFakePackTypeNeedsOnlyItsTableEntry` (`AddTypeForTest`).
- `server/internal/pack/contract_test.go`: `TestTableMatchesTheContract` against
  `docs/contracts/packages/pack-types.json`, which the web test `apps/web/src/lib/settings/packTypes.contract.test.ts`
  decodes too; `server/internal/pack/types_test.go`: `TestTableInvariants`.
- `server/internal/pack/manifest_messages_test.go`: `TestManifestMessagesArePinned`;
  `server/internal/pack/upsert_test.go`: `TestUpsertRegistry`.
- `server/cmd/qinqin/seed_order_test.go`: `TestSeedOrderIsPinned`, `TestSeedOrderAcrossRootsIsByPath`; `server/cmd/qinqin/packtype_test.go`:
  `TestLicenceCheckAndSeedCoverEveryPackType`; `server/internal/datapkg/packtype_test.go`:
  `TestPackageTypesFollowThePackTypeTable`.
- Review: a new hand-written list of types, a stage check that belongs to every type, a transaction that
  bypasses `BeginWrite` (the concurrency test catches it only for the transactions an import or uninstall of
  the cases runs), and a data migration that leaves `content_hash` stale.
