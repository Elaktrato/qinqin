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

(filled in as decided; see below)

## Execution record

(filled in per task)
