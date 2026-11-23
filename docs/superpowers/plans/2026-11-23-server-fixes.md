# Server fixes of the pre-Android hardening (#169, #170, #171, #172) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see
> it pass. One commit per task; every message ends with a blank line and
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Goal:** data packs no longer listed as plugins; HTTP timeouts and a graceful shutdown; migration 032 frozen;
the licence check covers sentence packs, and one pack-type table drives every list of pack types.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-23-server-fixes-design.md`.

**Branch / worktree:** `feature/hb-server-fixes`, `/home/user/qinqin/.claude/worktrees/hb-server-fixes` (`<wt>`).

## Gates

- Go (under `flock /tmp/qinqin-go.lock`, proxy variables unset, `GOTOOLCHAIN=auto`): targeted packages per task;
  `gofmt -l` prints nothing; one full `./...` at the end. `-race` on `cmd/qinqin` for the shutdown test only.
- Web (Task 9 changes web files): targeted vitest per task; at the end `check`, `test`, `build` and the Node 26
  vitest.
- `src/lib/contractsDocs.test.ts` and `src/lib/wikiDocs.test.ts` after every contract or wiki change.

## Tasks

### Task 1 (#171): frozen step032

**Files:** create `server/internal/db/step032/username.go`, `step032_test.go`, `testdata/username-keys-032.json`;
modify `gosteps.go`, `frozen_step_test.go`.

- [x] Extend `frozen_step_test.go`: no `qinqin/internal/` import in migration code except `qinqin/internal/db/stepNNN`;
  no `qinqin/` import inside any `stepNNN`. Run — FAIL (`gosteps.go` imports `qinqin/internal/model`).
- [x] Golden fixture written once from the live `model.UsernameKey` (ASCII case, fullwidth, ß, Turkish dotted I,
  ligature, combining marks, Kelvin sign, CJK unchanged); `step032` test decodes it — FAIL (no package).
- [x] Implement `step032.UsernameKey` (verbatim copy, FROZEN header); `fillUsernameKeys` uses it. PASS
  (`./internal/db/...`). Commit `fix(db): freeze migration 032's username key (#171)`.

### Task 2 (#170): HTTP server timeouts

**Files:** `server/cmd/qinqin/main.go`, `serve_test.go` (new).

- [x] Test `newHTTPServer`: `ReadHeaderTimeout` 10 s, `IdleTimeout` 120 s, `ReadTimeout`/`WriteTimeout` 0; a real
  listener closes a connection that sends no complete header within the (test-shortened) timeout — FAIL.
- [x] Implement. PASS. Commit `feat(server): header and idle timeouts (#170)`.

### Task 3 (#170): graceful shutdown

**Files:** `server/cmd/qinqin/main.go`, `serve_test.go`; `server/internal/api/api.go` (`WithBackgroundGroup`,
`goBackground`), the three detached `go` statements (`handlers_backup_restore.go`, `handlers_packs_install.go`),
`pack_stage.go` comment; `server/internal/mail/service.go` (`Pending`).

- [x] Tests: `serve` on a cancelled context returns nil, logs `shutdown complete`, after the listener served
  `/healthz`; `serve` with a context cancelled before listening returns without listening; an in-flight slow
  request finishes during the grace (via a test handler hook); API `goBackground` jobs are counted by the wait
  group; `mail.Service.Pending` — FAIL.
- [x] Implement `serve(ctx, data, listen)`, the shutdown sequence, `api.WithBackgroundGroup`. PASS (`./cmd/qinqin`
  with `-race` on the shutdown tests, `./internal/api` targeted, `./internal/mail`). Commit
  `feat(server): graceful shutdown on SIGINT and SIGTERM (#170)`.

### Task 4 (#170): compose grace period and wiki

**Files:** `docker-compose.yml` (`stop_grace_period: 30s`), `docs/wiki/Admin-deploying.md`,
`docs/wiki/Troubleshooting.md`, a deploy test asserting the grace period.

- [x] Test (compose has `stop_grace_period` of at least 30 s) — FAIL; implement; wiki text; wikiDocs PASS.
  Commit `docs(deploy): stop grace period and shutdown (#170)`.

### Task 5 (#172): the sentence pack licence check

**Files:** `server/cmd/qinqin/packcheck.go`, `packcheck_test.go`.

- [x] Test: an installed sentences pack whose manifest licence changed on disk is warned — FAIL. Add the row,
  fix the comment. PASS. Commit `fix(seed): check sentence packs for stale licence texts (#172)`.

### Task 6 (#172): the pack-type table

**Files:** create `server/internal/packtype/packtype.go`, `packtype_test.go`; modify `internal/dict/manifest.go`
(constants and `manifestTypes` from the table), `internal/packs/packs.go` (+ test), `cmd/qinqin/seed.go`,
`packcheck.go`.

- [x] Tests: table invariants (unique types, non-empty registry, known `Languages`, every `Package` type known to
  datapkg ids); `packs` importer/uninstaller maps cover the table exactly; every registry table has the standard
  columns in a migrated DB; `packs.List` order equals the table order; `packcheck` checks every registry — FAIL.
- [x] Implement; derive `typeOrder`, `importOrder`, `List` queries, `packcheck` table. PASS (`./internal/packtype`,
  `./internal/dict`, `./internal/packs`, `./cmd/qinqin`). Commit `refactor(packs): one pack-type table (#172)`.

### Task 7 (#172): datapkg from the table

**Files:** `internal/datapkg/spec.go`, `registry.go` (`AffectedIDs`), tests.

- [x] Tests: `Types()` equals the table's package types as a set; `typeDefs` covers every package type; id
  pattern built from the table still matches `catalogue.json` `idPattern` — FAIL where derived functions are
  missing. Implement. PASS (`./internal/datapkg`). Commit `refactor(datapkg): package types from the pack-type
  table (#172)`.

### Task 8 (#169): hidden data-pack rows

**Files:** `internal/plugins/plugins.go`, tests.

- [x] Tests: every synthesized row is `hidden: true` (all six types, incl. audio); manifests and enabled state
  unchanged; a lister exists for exactly the `LegacyPluginRow` types; `Exists` covers the same types — FAIL.
- [x] Implement (listers keyed by type). PASS (`./internal/plugins`, `./internal/api` plugin tests). Commit
  `fix(plugins): data-pack rows are hidden (#169)`.

### Task 9 (#169, #172): the shared pack-type list

**Files:** create `docs/contracts/packages/pack-types.json`; modify `docs/contracts/packages/README.md`,
`docs/contracts/overview.md`, `docs/contracts/README.md`; Go test in `internal/packtype`; web
`lib/plugins/dataPacks.ts` (+ test), `lib/settings/packsView.test.ts` (types covered).

- [x] Go and web tests decode the fixture — FAIL (no fixture, `audio`/others missing from `dataPacks.ts`).
  Implement. PASS; contractsDocs PASS. Commit `feat(contracts): the pack-type list; never rely on data-pack
  plugin rows (#169, #172)`.

### Task 10: real-app check (no files)

- [x] Scratch-built server on a free port: `GET /api/plugins` with installed packs (no unhidden data-pack rows;
  old-shell filter applied in Python as v0.3.0 does it), a slow-header connection closed after 10 s, SIGTERM during
  a package build (logs, exit code, DB intact, next start rebuilds). Kill and delete afterwards.

### Task 11: final gates and the Execution record

- [x] Full web gates, Node 26 vitest, one full Go run. Commit `docs: execution record of the server fixes
  (#169-#172)`.

## Execution record

Built 2026-11-23 on `feature/hb-server-fixes` from `d696557e` (develop after v0.5.0). Commits: spec and plan
`51ffc17b`; Task 1 `1c95dc0c`; Task 2 `2fd01781`; Task 3 `859943dc`; Task 4 `3373cd46`; Task 5 `b0cd9f15`;
Task 6 `c0341d60`; Task 7 `8ba09a1e`; Task 8 `dfbef817`; Task 9 `ff7837b0`; this record. Task 10 (real-app check)
changed no files.

Test-first, seen failing before the implementation: Task 1 (`gosteps.go imports live code qinqin/internal/model`;
then `undefined: UsernameKey` in step032); Task 2 (`undefined: newHTTPServer`); Task 3 (`undefined: serve`,
`s.Pending undefined`, `undefined: api.WithBackgroundGroup`; after the first implementation
`TestWaitStepBoundedByDeadline` failed for real: a step that had already stopped was reported as timed out once
the deadline had passed — `waitStep` now checks `done` first); Task 4 (no `stop_grace_period`); Task 5 (no warning
for the sentence pack); Task 6 (`undefined: operations`, `typeIndex`, no `packtype` package); Task 7 (missing
`optional`/`requiresLexicon` registry fields); Task 8 (`undefined: legacyRows`; then every data-pack row
`hidden false`); Task 9 web (`PACK_TYPES is not iterable`).

Deviations, honestly:

- Task 9's Go test (`packtype/contract_test.go`) passed at once: the fixture `pack-types.json` was written from the
  table in the same task (a pinning copy, not derived independently). The web side failed first.
- Tasks 6 and 7 are behaviour-preserving refactors: the existing pack, seed, datapkg and api tests passed before
  and after; the new completeness tests fail first only because their hooks did not exist yet.
- The golden fixture of step032 was generated once from the live `model.UsernameKey` (a throwaway test, deleted),
  as the spec says; it pins today's behaviour, it was not derived by hand.
- `TestPluginDataRoute` (`internal/api`) fails when run alone with a `-run` filter (`POST workspace: 422`), on the
  untouched base too; it passes in the full package run.
- Web gates on Node 22: `check` 0, `build` 0, `test` exit 1 with 5 failures in `AccountSettings.dom.test.ts` (1)
  and `BookView.dom.test.ts` (4); the same failures occur with the base versions of this branch's web files (and
  `AccountSettings` on the untouched tree), so they are not from this branch. The full vitest on Node 26 (what CI
  runs): 574 files, 12383 passed, 2 skipped, exit 0.

Real-app check (scratch build of this branch, 127.0.0.1:18731, data seeded with CC-CEDICT, JMdict, HSK words, the
Chinese grammar pack and Jiten frequency, plus one audio pack row inserted by hand): `GET /api/plugins` listed 6
data-pack rows (2 dictionaries, levels, frequency, grammar, audio), all `hidden: true`, enabled state intact;
applying the v0.3.0 shell's filter (its 5-type list without audio, then `!hidden`) left only the four feature
plugins, so the audio row no longer shows on old shells. A connection that sent an incomplete header was closed
after 10.0 s. SIGTERM on an idle server and SIGTERM 2 s into the startup reconcile (package files deleted, so it was
rebuilding; a `frequency...work.tmp` was being written): logs `shutting down` → `http server stopped` → `mail queue
stopped` → (`packages: reconcile: context canceled`) → `package builder stopped` → `background jobs stopped` →
`shutdown complete`, exit 0, `PRAGMA integrity_check` ok, no `.tmp` left; the next start rebuilt all six packages
(rows `ready`, revision 1). Everything was killed and deleted afterwards.

Not verified: the 120 s idle timeout in the real app (only the field is tested); a shutdown while a pack upload
import or a backup restore runs (only the sweeper is tested as counted in the group); `docker stop` itself (no Docker
here; the compose value is tested statically); SIGINT (same handler as SIGTERM).

One full Go run (`gofmt -l .` empty, `go vet ./...`, `go test -count=1 -p 2 ./...`, proxy variables unset): 49
packages ok; the only failure is the known environment one, `internal/ai`
`TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 sockets here). `-race` was run on the shutdown tests of
`cmd/qinqin` and on the sweeper/restore/staged-import tests of `internal/api` (filtered), both clean.
