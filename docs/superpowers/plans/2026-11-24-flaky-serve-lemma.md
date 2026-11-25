# Flaky `TestServeRebuildsTheRefreshedBundledPackage`

`server/cmd/qinqin` `TestServeRebuildsTheRefreshedBundledPackage` failed in about 1 run in 6 (8 of 50 here;
CI: `serve_lemma_test.go:172: lemma-rules.xa-lemma: revision 2 ready (<nil>), want 1 ready`). It was a real
product race, not a test bug.

## Cause

At serve start, `startPackages` started the package builder and queued the startup reconcile, and only then
did `loadLemmaTables` sync the bundled lemma-rules packs. So the reconcile and the sync ran at the same time.
`packs.Import` is two transactions: the type importer commits the pack's rows, then
`storeTextsAfterImport` stores its licence texts in a second transaction, and only then the `onChange`
hook kicks the package. When the reconcile planned between the two commits, it saw a live pack without
texts and built revision 1 **without the LICENSE file** (checked: that r1.qqpkg had no LICENSE, r2 had it).
The kick then built revision 2 with the texts. So on a fresh start a new bundled pack could get two
revisions, and the first one, briefly published, lacked its licence texts.

## Fix

`startPackages` takes a `prepare func(*datapkg.Builder)` that runs before the builder goroutine starts and
before the reconcile is queued. Serve passes the lemma-rules sync there, with `b.PackChanged` as the
onChange hook: its kicks only queue, and the builder then runs the reconcile and the kicks against the
finished import. Only one build sees the pack, and it has the texts.

`TestStartPackagesSyncsBeforeTheFirstBuild` (autoinstall_lemma_test.go) tests this deterministically. The
pack's rows are imported before start, as if the first transaction had committed. Then `prepare` waits
for any running build (`b.Wait`) before it stores the texts and kicks. With the old order the reconcile
always finishes first and the test always fails with revision 2. With the new order it gets revision 1
with the texts. The flaky test needed no change: it already polls for a condition with a deadline.

Ruling: fix the start order and keep `packs.Import` as two transactions — the only overlap of a build with
an import at start is this sync (autoSeed and autoInstallStrokes run before the builder exists).
Storing the texts in each type importer's transaction would mean changing all 11 importers — cost if
wrong: a pack upload while a build of the same package is running can still publish a short-lived
revision without texts. The upload's kick replaces it at once. Make the import atomic if that ever
matters.

## Execution record

- Reproduced: `-count=50` → 8 failures; a diagnostic run confirmed r1 without and r2 with LICENSE.
- The new test failed 3 of 3 runs before the reorder (revision 2) and passed after it.
- `-count=100` of the flaky test: pass. `go test -race ./cmd/qinqin`: pass. Full `./...` (vet + test, `gofmt -l` empty): 53 packages ok; only the known `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 in this sandbox) failed.
