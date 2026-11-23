# Lemmatizer rule tables as a data pack (#176) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see
> it pass. One commit per task; every message ends with a blank line and
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Goal:** a `lemma-rules` data pack gives a language lemmatization without a code change: validated and
bounded, hot-reloaded, served as a data package, credited, listed in Settings → Data; the bundled Japanese
table also ships as the seed pack `ja-lemma`.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-23-lemma-rules-pack-design.md`.

**Branch / worktree:** `feature/hb-lemma-pack` (from `feature/hardening-batch`),
`/home/user/qinqin/.claude/worktrees/hb-lemma-pack` (`<wt>`).

## Gates

- Go (under `flock /tmp/qinqin-go.lock`, proxy variables unset, `GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false`):
  targeted packages per task; `gofmt -l` prints nothing; one full `./...` at the end (known environment
  failure: `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`). `-race` on `internal/lemma` and
  `internal/lemmapack` (new shared state).
- Web: targeted vitest per task; at the end `check`, `test`, `build` and the Node 26 vitest.
- `src/lib/contractsDocs.test.ts` and `src/lib/wikiDocs.test.ts` after every contract or wiki change.

## Tasks

### Task 1 — engine limits, candidate bound, installed overlay (`internal/lemma`)

- [x] Tests: each limit of the spec table rejected by `Parse` (one over) and accepted at the limit; an
  explosive table (many rules on one suffix, chaining into themselves, depth 8) returns exactly
  `MaxCandidates` candidates, the first ones in output order; the Japanese table stays ≤ 16 on every ≤ 12
  code-point substring of the contract fixtures; `SetInstalled` wins over `Register` and the built-in,
  `SetInstalled(nil)` restores, `Languages` is the union — FAIL.
- [x] Implement. PASS (`./internal/lemma/... ./internal/lang/... ./internal/lookup/... ./internal/segment/...`,
  `-race` on lemma). Contract README: "Limits" and the candidate bound. Commit
  `feat(lemma): table limits, a candidate bound and an installed-table overlay (#176)`.

### Task 2 — migration 043 `lemma_rule_packs`

- [x] `migrate_043_test.go`: columns, defaults, NOT NULLs, primary key — FAIL.
- [x] `043_lemma_rules.sql` (pure SQL; no Go step). PASS (`./internal/db/...`). Commit
  `feat(db): lemma_rule_packs registry (#176)`.

### Task 3 — pack type row, manifest, store and reload (`packtype`, `dict`, `lemmapack`, `packs`)

- [x] Tests: `lemmapack` (spec "Tests"), dict manifest (`rules-json` only for `lemma-rules`, one language),
  packs (import/list/uninstall through `packs`). The table tests (`TestEveryPackTypeHasItsOperations`,
  standard columns, contract, web pack types) fail once the row exists — FAIL.
- [x] Implement the row (after strokes), `FormatRulesJSON`, `internal/lemmapack`, the `operations` entry and
  `notFound`, `pack-types.json` + packages README, web `PackType`, `PACK_TYPES`, `PACK_TYPE_LABELS`, i18n key,
  `TYPE_ORDER`. PASS (Go targeted + web packTypes/packsView tests). Commit
  `feat(packs): lemma-rules pack type with validated, hot-reloaded tables (#176)`.

### Task 4 — data package `lemma-rules`

- [x] Tests: datapkg table test (fails until `Types`/`typeDefs`/idPattern), a build test reading `lemma_rules`
  back byte-identical; contract `schemas.json`/`manifest.json` cases; web `packages.ts` parser — FAIL.
- [x] Implement. PASS. Commit `feat(datapkg): lemma-rules packages (#176)`.

### Task 5 — upload review and hot reload through the API

- [x] Tests: staged upload of a bad table → 400 naming `rules.json`; a second pack for a language → 400 naming
  the installed pack; install via the staged flow then `/api/segment` uses the new table, uninstall restores
  the built-in (no restart) — FAIL.
- [x] Implement the review check (`lemmapack.CheckPack` with the DB). PASS. Commit
  `feat(api): review lemma-rules uploads; segmentation follows installs (#176)`.

### Task 6 — bundled `ja-lemma` seed pack and startup sync (`plugins/data`, `cmd/qinqin`)

- [x] Tests: `plugins/data/ja-lemma/rules.json` byte-identical to the embedded table; seed installs it; serve's
  sync installs when absent, refreshes when changed, leaves an uninstalled one; `serve` reloads the overlay
  before listening — FAIL.
- [x] Pack files, `docs/sources.md`, `plugins/data/README.md`; `syncBundledLemmaPacks`; reload in `serve`. PASS
  (incl. `node scripts/check-sources.mjs`). Commit `feat(seed): ship the Japanese rule table as the ja-lemma pack (#176)`.

### Task 7 — credits: `GET /api/lemma-packs` and the Sources section

- [x] Tests: route public, listed, token rule pinned; route-walk and PWA fixtures; web `lemmaSection` unit and
  Sources dom test — FAIL.
- [x] Implement; regenerate fixtures and `docs/wiki/API-Routes.md`. PASS. Commit
  `feat(sources): credit installed lemmatizer rule packs (#176)`.

### Task 8 — docs

- [x] Contract READMEs (lemma "Rule-table packs", packages ids table), wiki Data-pack-format and
  Admin-data-packs, Reader note; docs tests green. Commit `docs: lemma-rules packs (#176)`.

### Task 9 — real-app check, full gates, Execution record

- [x] Build from a scratch copy; serve on a free random high 127.0.0.1 port; seed; upload a toy-language
  table and a modified Japanese table; check `/api/segment` before/after install and uninstall; the
  catalogue lists `lemma-rules.*`; kill and clean up.
- [x] Full Go `./...`, web `check`, `build`, Node 26 vitest. Execution record. Commit
  `docs(plan): lemma-rules pack execution record (#176)`.

## Execution record

Executed 2026-11-23 in `.claude/worktrees/hb-lemma-pack`, unattended, while other agents ran suites on the same
cores.

**Commits:** `11c32bad` spec and plan, `2f64afbe` engine (Task 1), `65f01cc9` migration 043 (Task 2), `a21f7ba9`
pack type, store, reload (Task 3), `afa3b08f` packages (Task 4), `2c05556f` review and API (Task 5), `b7f59c3b`
ja-lemma and startup sync (Task 6), `350fe3e3` credits (Task 7), `c72fa649` docs (Task 8), `e3d82dd4` watcher fix
found in the real-app check, `b2c716c3` merge of `feature/hardening-batch` (e0339bf7: #167/#168/#173/#174), then
this record.

**Test-first, as run.** Task 1: build failure (`lemma.MaxRules` etc. undefined), then green; the limit cases
were therefore first seen red only as a compile failure, not one by one. Task 2: "no such table: lemma_rule_packs",
then green. Task 3: dict build failure (`FormatRulesJSON`), packs `unknown type "lemma-rules"`, lemmapack build
failure, then the pack-type invariant (`ident` refused the hyphen) and the contract count (10 vs 11) and the web
packTypes tests (3 failed), then green. Task 4: schemas, manifest, plan, build and table tests failed, web catalogue
contract test failed (2), then green; two existing datapkg tests pinned the old package lists and were extended
deliberately (`TestCatalogueLanguagesAdminETagInstance`, `TestPlanListsOnePackagePerLanguageAndPack`). Task 5: the
API test failed (no review check: 201 instead of 400; data-only languages answered 400) — which led to the
`segmentable` Ruling — then green. Task 6: vet failure (`syncBundledLemmaPacks` undefined; the implementation was
stashed for this run because the first queued run had compiled it already), then `TestCommittedPackNotices`
asked for a decision on `ja-lemma` (pinned), then green. Task 7: 404, route and token fixtures, web unit (3) and dom
(2) failures, then green after `UPDATE_ROUTES_FIXTURE=1`, `UPDATE_TOKEN_ROUTES_FIXTURE=1` and
`node scripts/gen-api-docs.mjs`; the route is not cached by the service worker (classify.ts default). Watcher fix:
compile failure, then a real failure of the first design (baseline taken after the outside write), redesigned
to compare with what the last Reload installed; green with `-race -count=3`.

**Merge.** Conflicts in `handlers_lookup.go` and `handlers_segment.go` (the language gate): kept `segmentable`
with #168's `writeError(..., "bad_request", "Unsupported language.")`. My new error paths now use
`writePackError` / `writeInternal`. No new error code; the Sources section uses the page's existing `message`
helper like its neighbours.

**Real-app check** (scratch copy of HEAD before the merge, 127.0.0.1:50990, checked free; killed and deleted
afterwards). A fresh data directory with a two-word Spanish dictionary seeded first, so the auto-seed skipped (as
designed): the startup sync still installed `ja-lemma` (log line). `POST /api/segment` es: 400 before, then after
uploading and installing a toy `es` table through the staged upload `hablaba` → `hablar` (reason imperfect) and
`con`, `/api/lookup` found hablar, `/api/lemma-packs` listed both packs, the catalogue had `lemma-rules.es-rules`
and `lemma-rules.ja-lemma` ready; uninstall → 400 again, no restart. After seeding JMdict (server stopped) and
changing the bundled `rules.json`: the start logged "updated the bundled rule table ja-lemma"; 勉強しています →
勉強する, 食べちゃった → 食べる, しました → する; a second Japanese table (`ja-alt`) was refused at review naming
`ja-lemma`; uninstalling `ja-lemma` kept the same results (built-in table) and a restart did not reinstall it. The
check showed that `qinqin seed` in a separate process does not reach the serving process's tables: fixed by the
watcher (`e3d82dd4`), which was **not** re-checked in the real app (tests only).

**Gates (after the merge):** full Go `./...` under the flock: gofmt clean, vet clean, 50 packages ok, only the known environment failure `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here); web `check` 0, `build` 0, full vitest under Node 26:
584 files, 12,509 passed, 2 skipped. Under Node 22, `AccountSettings.dom.test.ts` "a save that cannot be mirrored"
failed before and after my changes (also on the untouched branch); it passes under Node 26.

**Merge commit message:** `b2c716c3` carries git's `# Conflicts:` lines after the trailer (left as is: no history rewrite).

**Not verified:** no browser (the Settings → Data group, the uninstall dialog text and the Sources section are
covered by unit and jsdom tests only); Android consumption of the package; a real non-Japanese table beyond the
toy one; performance of a table at the limits on a long text (bounded by the limits and the 64-candidate stop,
not measured); the watcher end to end.
