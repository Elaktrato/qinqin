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

## Fix wave (independent review), 2026-11-23

Merged `feature/hardening-batch` at e952f609 (#175) first (`49034a37`, no conflicts). One commit per group:

1. **CPU denial of service (security), `e1989da9`.** A deterministic work budget: one `Deinflect` call spends at
   most `MaxWork` = 16,384 units (one per (form, rule) pair considered, one per predicate leaf, fixed evaluation
   order); the prefixes of a lookup window share 32,768, its compound checks 4,096, and a window keeps at most
   256 probes, with one compound probe per (stem, class) of a prefix and map de-duplication of forms and
   readings. Table-wide predicate caps: 16 children per `allOf`/`anyOf`, 4,096 predicates, 4,096 `notSuffix`.
   Contract: README "Bound", "Lookup bounds", Limits rows, new fixture `budget.json` (five cases, unit for unit).
   Measured: Japanese at most 4,352 units per call, 11,696 per window, 44 probes; the review's worst tables
   rebuilt within the new caps segment 5,000 runes of "a" in 3.6 s (heavy, 118,983,040 units) and 4.3 s
   (compounds) instead of 188 s and 51 s; the review's own `heavy.json` is now refused (118,784 `notSuffix`
   entries), its `compounds.json` spends 64 units per call. The segmentation test asserts the work count; its
   2-minute time bound is only a backstop. Test-first: lemma budget tests failed to compile (`MaxWork`
   undefined), then the Japanese headroom check failed (4,352 × 4 > 16,384; relaxed to ×3, Ruling); the lookup
   tests and the segment work test were written before the implementation but first ran after it (their red
   was only a compile failure). De-duplicating compound probes per (stem, class) of the whole window, as
   suggested, broke seven Japanese lookup and segment tests: now per prefix length (Ruling). Lookup and segment
   take the language's table once per request (`lookup.LangOf`, `LookupIn`) — the first NIT. Spec lines 18/95
   and wiki Data-pack-format corrected. Item 5 is in this commit too: `TestDeinflectStopsAtMaxCandidates` uses
   `maxDepth` 3.
2. **Package after a startup refresh, `dcc90e38`.** `serve` starts the package builder first and passes its
   `PackChanged` hook into the bundled sync, so a refreshed `ja-lemma` gets a new revision and content hash. Red:
   a reconcile-only datapkg test showed r1 → r1 with the same hash (the reconcile compares only manifest terms);
   that test was replaced by the cmd test that drives the real startup path (r1 → r2, hash changed).
3. **Trailing data and duplicate keys, `04ab5bdb`.** `Parse` requires `io.EOF` after the table and walks the
   tokens for a key named twice in any object. New fixture `parse.json` (8 cases); red: 5 cases failed.
4. **Serve wiring, `cd768e09`.** `TestServeUsesInstalledAndOutsideChangedTables` runs `serve` twice: with the
   watcher at one hour a pack row present before serve answers `/api/segment/at`; with it at 20 ms an outside
   `UPDATE` of `rules_json` takes effect. Mutation-checked: removing `loadLemmaTables` fails the first part (400),
   removing the watcher janitor fails the second ("never took effect"). `lemmaWatchEvery` is a variable for it.
5. See 1.
6. **Unique index, `6c913f2a`.** 043 edited in place (no other branch has a 043):
   `CREATE UNIQUE INDEX idx_lemma_rule_packs_live_language ON lemma_rule_packs (language) WHERE deleted_at IS NULL`.
   Red: the migration test accepted two live `ja` rows. Reload's duplicate branch is tested with the index
   dropped (keeps the first by pack id).

NITs (`934f97b3`): a reload that fails after a commit is logged, not returned (Watch retries; test swaps the
reload); Admin-deploying says the startup sync installs `ja-lemma` even with `QINQIN_AUTO_SEED=0`; Data-pack-format
no longer says words resolve "in the Reader" for any language; the `ja-lemma` attribution in the packages fixtures
and spec is the manifest's; the zh refusal stays exact-code with a Ruling (`zh-tw` is a separate data-only code
whose table works).

**Not verified in the fix wave:** no new real-app run (the serve-level test covers start-up load and the
watcher); timing numbers come from one loaded machine.
