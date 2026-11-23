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

- [ ] Extend `frozen_step_test.go`: no `qinqin/internal/` import in migration code except `qinqin/internal/db/stepNNN`;
  no `qinqin/` import inside any `stepNNN`. Run — FAIL (`gosteps.go` imports `qinqin/internal/model`).
- [ ] Golden fixture written once from the live `model.UsernameKey` (ASCII case, fullwidth, ß, Turkish dotted I,
  ligature, combining marks, Kelvin sign, CJK unchanged); `step032` test decodes it — FAIL (no package).
- [ ] Implement `step032.UsernameKey` (verbatim copy, FROZEN header); `fillUsernameKeys` uses it. PASS
  (`./internal/db/...`). Commit `fix(db): freeze migration 032's username key (#171)`.

### Task 2 (#170): HTTP server timeouts

**Files:** `server/cmd/qinqin/main.go`, `serve_test.go` (new).

- [ ] Test `newHTTPServer`: `ReadHeaderTimeout` 10 s, `IdleTimeout` 120 s, `ReadTimeout`/`WriteTimeout` 0; a real
  listener closes a connection that sends no complete header within the (test-shortened) timeout — FAIL.
- [ ] Implement. PASS. Commit `feat(server): header and idle timeouts (#170)`.

### Task 3 (#170): graceful shutdown

**Files:** `server/cmd/qinqin/main.go`, `serve_test.go`; `server/internal/api/api.go` (`WithBackground`,
`goBackground`), the three detached `go` statements (`handlers_backup_restore.go`, `handlers_packs_install.go`),
`pack_stage.go` comment; `server/internal/mail/service.go` (`Pending`).

- [ ] Tests: `serve` on a cancelled context returns nil, logs `shutdown complete`, after the listener served
  `/healthz`; `serve` with a context cancelled before listening returns without listening; an in-flight slow
  request finishes during the grace (via a test handler hook); API `goBackground` jobs are counted by the wait
  group; `mail.Service.Pending` — FAIL.
- [ ] Implement `serve(ctx, data, listen)`, the shutdown sequence, `api.WithBackground`. PASS (`./cmd/qinqin`
  with `-race` on the shutdown tests, `./internal/api` targeted, `./internal/mail`). Commit
  `feat(server): graceful shutdown on SIGINT and SIGTERM (#170)`.

### Task 4 (#170): compose grace period and wiki

**Files:** `docker-compose.yml` (`stop_grace_period: 30s`), `docs/wiki/Admin-deploying.md`,
`docs/wiki/Troubleshooting.md`, a deploy test asserting the grace period.

- [ ] Test (compose has `stop_grace_period` of at least 30 s) — FAIL; implement; wiki text; wikiDocs PASS.
  Commit `docs(deploy): stop grace period and shutdown (#170)`.

### Task 5 (#172): the sentence pack licence check

**Files:** `server/cmd/qinqin/packcheck.go`, `packcheck_test.go`.

- [ ] Test: an installed sentences pack whose manifest licence changed on disk is warned — FAIL. Add the row,
  fix the comment. PASS. Commit `fix(seed): check sentence packs for stale licence texts (#172)`.

### Task 6 (#172): the pack-type table

**Files:** create `server/internal/packtype/packtype.go`, `packtype_test.go`; modify `internal/dict/manifest.go`
(constants and `manifestTypes` from the table), `internal/packs/packs.go` (+ test), `cmd/qinqin/seed.go`,
`packcheck.go`.

- [ ] Tests: table invariants (unique types, non-empty registry, known `Languages`, every `Package` type known to
  datapkg ids); `packs` importer/uninstaller maps cover the table exactly; every registry table has the standard
  columns in a migrated DB; `packs.List` order equals the table order; `packcheck` checks every registry — FAIL.
- [ ] Implement; derive `typeOrder`, `importOrder`, `List` queries, `packcheck` table. PASS (`./internal/packtype`,
  `./internal/dict`, `./internal/packs`, `./cmd/qinqin`). Commit `refactor(packs): one pack-type table (#172)`.

### Task 7 (#172): datapkg from the table

**Files:** `internal/datapkg/spec.go`, `registry.go` (`AffectedIDs`), tests.

- [ ] Tests: `Types()` equals the table's package types as a set; `typeDefs` covers every package type; id
  pattern built from the table still matches `catalogue.json` `idPattern` — FAIL where derived functions are
  missing. Implement. PASS (`./internal/datapkg`). Commit `refactor(datapkg): package types from the pack-type
  table (#172)`.

### Task 8 (#169): hidden data-pack rows

**Files:** `internal/plugins/plugins.go`, tests.

- [ ] Tests: every synthesized row is `hidden: true` (all six types, incl. audio); manifests and enabled state
  unchanged; a lister exists for exactly the `LegacyPluginRow` types; `Exists` covers the same types — FAIL.
- [ ] Implement (listers keyed by type). PASS (`./internal/plugins`, `./internal/api` plugin tests). Commit
  `fix(plugins): data-pack rows are hidden (#169)`.

### Task 9 (#169, #172): the shared pack-type list

**Files:** create `docs/contracts/packages/pack-types.json`; modify `docs/contracts/packages/README.md`,
`docs/contracts/overview.md`, `docs/contracts/README.md`; Go test in `internal/packtype`; web
`lib/plugins/dataPacks.ts` (+ test), `lib/settings/packsView.test.ts` (types covered).

- [ ] Go and web tests decode the fixture — FAIL (no fixture, `audio`/others missing from `dataPacks.ts`).
  Implement. PASS; contractsDocs PASS. Commit `feat(contracts): the pack-type list; never rely on data-pack
  plugin rows (#169, #172)`.

### Task 10: real-app check (no files)

- [ ] Scratch-built server on a free port: `GET /api/plugins` with installed packs (no unhidden data-pack rows;
  old-shell filter applied in Python as v0.3.0 does it), a slow-header connection closed after 10 s, SIGTERM during
  a package build (logs, exit code, DB intact, next start rebuilds). Kill and delete afterwards.

### Task 11: final gates and the Execution record

- [ ] Full web gates, Node 26 vitest, one full Go run. Commit `docs: execution record of the server fixes
  (#169-#172)`.

## Execution record

(filled in at the end)
