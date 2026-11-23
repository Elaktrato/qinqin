# Server fixes of the pre-Android hardening (#169, #170, #171, #172)

Part of #166. Four small server items, built together on `feature/hb-server-fixes`. Plan:
`docs/superpowers/plans/2026-11-23-server-fixes.md`.

## #169 Data packs listed as plugins

`GET /api/plugins` synthesizes a plugin row for every installed dictionary, levels, frequency, sentences,
grammar and audio pack (the "legacy data-plugin rows"). The web filters them with a list that lacks `audio`, so
an audio pack shows in Settings → Plugins with a switch that does nothing.

**Now (this branch):**

- Every synthesized data-pack row carries `hidden: true`. Every client already leaves hidden rows out of its
  plugin list: the current web (`listedPlugins`) and every v0.3.x shell (`settings/+page.svelte` filters
  `!plugin.hidden`), so Settings → Plugins lists only real plugins on old and new shells alike.
- The rows stay in the answer, with the same ids, manifests and enabled state. Reason: v0.3.x shells and the
  current Grammar browse page read a grammar pack's enabled state from this list (`pluginEnabled(packId, list)`),
  and `plugins.Exists`/`CanWriteData` accept data written under a pack id. Removing them is the Later part.
- Components, strokes, theme and font packs never had a row and get none. The web's own filter
  (`lib/plugins/dataPacks.ts`) covers every pack type of the shared list (see #172), not only the six with rows,
  so a future server that lists another type is filtered too.
- The six listers are driven by the pack-type table: a type either has a legacy row lister or is declared
  without one (`LegacyPluginRow`); a test fails when the table and the listers disagree.
- Contracts: `docs/contracts/overview.md` and `docs/contracts/packages/README.md` tell Android never to rely on
  these rows (data packs are listed by `GET /api/packs` and `GET /api/packages`).

Ruling: hide the rows on the server instead of only adding `audio` to the web filter — the server fix also
covers cached v0.3.x shells (their filter lacks `audio` too) and Android — cost if wrong: none for listing; a
client that showed hidden rows on purpose would lose them (none does).

Ruling: `sentencePlugins` keeps reading `sentences.source_pack` (legacy pre-027 packs have no registry row and
their plugin data is accepted through it) — the lister is deleted in the Later part, so changing its source now
would only risk old data writes — cost if wrong: a registered sentence pack with zero sentences has no hidden
row (nothing reads it).

Ruling: the dictionary row keeps its manifest without `language` (byte-compatible with v0.3.x) although the
lister is now generic — old shells compare manifests nowhere, but there is no reason to change the wire shape of
a deprecated answer — cost if wrong: none.

**Later (follow-up, tied to retiring the v0.3.x shells, after the release that follows v0.5.0):** stop emitting the
synthesized rows; remove the six listers; narrow `plugins.Exists`/`CanWriteData` to real plugins (check first
that no client writes plugin data under a pack id); move the grammar pack switch of `GrammarBrowse` off
`pluginEnabled` (today the switch is reachable only through `PUT /api/plugins/{id}/state`, no UI); note that
`prepareOffline.ts` caches `/api/plugins`, so an offline shell keeps the old list until it refreshes.

## #170 HTTP timeouts and graceful shutdown

`serve` ran `http.ListenAndServe`: no header or idle timeouts, no signal handling, so `docker stop` killed the
process mid mail or package build and no deferred cleanup ran (as PID 1 in the container a Go program without a
SIGTERM handler is not even stopped by SIGTERM; Docker kills it after its 10 s).

- `newHTTPServer(handler)` returns `http.Server{ReadHeaderTimeout: 10s, IdleTimeout: 125s}`, no `ReadTimeout` and
  no `WriteTimeout`: uploads, downloads and the streamed legacy pull set their own deadlines
  (`stream_deadline.go`, `http.ResponseController`).
- `serveCmd` wraps the work in `signal.NotifyContext(SIGINT, SIGTERM)` and calls `serve(ctx, data, listen)`.
- Startup steps that run before the listener (bootstrap admin, built-in plugins, study adoption, auto-seed,
  strokes install, sweeps) run under the signal context: a signal during the first-start auto-seed aborts it
  (each pack is one transaction; the marker is set only after the whole seed, so the next start retries), and
  `serve` returns without listening.
- Background workers (mail queue, package builder, stage sweeper, AI/auth/journal janitors, detached jobs of the
  API) run under a separate background context that is cancelled only after the HTTP server stopped, so requests
  that drain during the grace period can still queue mail and kick builds.
- Shutdown order: `srv.Shutdown` with 10 s grace (then `srv.Close` for what is left: long downloads), cancel the
  background context, wait for the mail worker, the package builder and the API's background jobs (stage
  sweeper, staged pack imports, restore validation and restores) in that order, each bounded by one shared 10 s
  deadline, then close the database. Each step logs one line; the last is `shutdown complete`.
- `api.WithBackgroundGroup(jobs)` (an `api.Jobs`) runs the API's background goroutines: the stage sweeper and every
  detached job go through `s.goBackground`. Once serve waits (`Jobs.Wait`), the group is closed and a handler still
  running after a forced close cannot start a new job (it is refused and logged). `WithStageSweeper(ctx, interval)`
  is unchanged and gets the background context. Staged pack imports end with the background context too (fix wave).
- The AI, auth and journal janitors are waited for after the API jobs, before the database closes (`janitors
  stopped`).
- `docker-compose.yml` gets `stop_grace_period: 30s` (10 s HTTP + up to 10 s background + margin).

Ruling: one shared 10 s deadline for the background waits, then exit anyway — an interrupted package build
leaves its row `building` (or `ready` at the old revision) and a stray `.tmp` file that the startup reconcile
removes and rebuilds; an interrupted pack import or restore is one SQLite transaction and rolls back; staged
uploads are swept on the next start — cost if wrong: a restore near its commit is lost and the user repeats it.

Ruling: queued mails that are not sent when the worker stops are dropped and counted in the log (`mail: N queued
mail(s) not sent`); the queue is in memory by design and every mail is one the user can trigger again
(reset, verification, invite) — cost if wrong: one sign-in code mail needs a resend.

Ruling: AI reviews that keep running after the browser disconnects are not waited for beyond the 10 s grace
(they can take 170 s); the review is lost and can be repeated — cost if wrong: one AI call is paid twice.

## #171 Migration 032 uses live code

`gosteps.go` (migration 032) calls `model.UsernameKey`. If its normalisation changes, upgrading an old database
silently changes with it.

- New frozen package `internal/db/step032` with `UsernameKey`, a verbatim copy of the live function as migration
  032 shipped it, and a golden test (`testdata/username-keys-032.json`, cases written once from the live function
  today, never regenerated).
- `fillUsernameKeys` uses `step032.UsernameKey`.
- `frozen_step_test.go` bans every `qinqin/internal/...` import from migration code (`internal/db/*.go`, not
  tests) except frozen `qinqin/internal/db/stepNNN` packages, and bans every `qinqin/` import from inside a
  frozen package.

Ruling: the frozen copy may import `golang.org/x/text` (a module dependency, not application code) — copying the
Unicode tables is not practical; the module version is pinned in `go.mod` and the golden test catches a table
change that alters a key on upgrade — cost if wrong: a dependency bump changes keys of exotic names; the golden
test fails first.

## #172 Licence check skips sentence packs; one pack-type table

`warnStalePackTerms` lists every registry table except `sentence_packs` ("sentence packs store no terms", false
since migration 027). The server lists pack types in about ten places.

- New leaf package `internal/packtype` (standard library only): `All`, an ordered slice of descriptors, one per
  manifest type:

  | field | meaning |
  | --- | --- |
  | `Type` | manifest type (`dictionary`, ...) |
  | `Registry` | registry table of the live packs (`pack_id, name, version, license, attribution, notice, updated_at, deleted_at`) |
  | `Languages` | `One` (column `language`), `Many` (JSON column `languages`) or `None` |
  | `Uploadable` | may be installed by an admin upload (audio: no) |
  | `Package` | data package type built per live pack; `""` none; the dictionary's is `lexicon` (per language) |
  | `RequiresLexicon` | its package requires `lexicon.<lang>` |
  | `OptionalPackage` | clients ask before downloading (audio) |
  | `LegacyPluginRow` | `GET /api/plugins` synthesizes a hidden row (v0.3.x compatibility, #169) |

  The slice order is the admin list order and the seed import order (they were two identical maps).
- Derived from it: `dict` manifest type validation; `packs` `Supported`, `Installable`, the list order, the
  registry queries of `List`, `Find`; `packcheck.go` (sentences now included); `seed.go` import order;
  `datapkg` registries, the package id pattern, `Optional`, `Requires`; the plugin listers of `plugins.go`.
- Per-type code stays per type (importers, uninstallers, package writers, legacy listers), each in a map keyed
  by type, and each map has a completeness test against `packtype.All`: a new type fails a test in every place
  that must decide something about it.
- A test opens a fully migrated database and checks every descriptor's registry table has the columns the generic
  queries read.
- Shared rule: `docs/contracts/packages/pack-types.json` lists the types with order, languages, upload and package
  fields; a Go test compares it with `packtype.All`, a web test compares it with the web's pack type lists
  (`PackType`, the Data list order set, `dataPacks.ts`).

Ruling: list order and seed import order are one sequence (they were identical) — cost if wrong: a later type
that must import earlier than it lists needs a second field.

Ruling: "one-place change" means one table row plus the per-type code the type really needs; the completeness
tests name each missing piece, rather than hiding importers behind a registry of function values in a leaf
package — cost if wrong: adding a type touches several files (but cannot miss one silently).

Ruling: `datapkg.Types()` keeps the contract order of package types (lexicon, levels, sentences, ...) and is
checked against the table as a set — cost if wrong: none.

## What #176 (lemma-rules pack type) needs

Add one row to `packtype.All`; then the failing tests point at: the importer and uninstaller maps in `packs`, the
registry table (a migration with the standard columns), `LegacyPluginRow: false`, a package writer only if
`Package` is set, `pack-types.json` and the web pack type lists and labels.
