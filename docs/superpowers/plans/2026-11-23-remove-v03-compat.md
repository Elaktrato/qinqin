# Plan — remove the v0.3 compatibility layer (#198)

Part of the architecture clean-up #190, phase 1. Branch `feature/198-remove-v03-compat` from `develop`
(`8b632f29`), worktree `.claude/worktrees/198-compat`. Owner decision (2026-11-23): v0.3.x clients are no
longer supported; the code whose only job was serving them goes now.

## Spec

**Remove (the issue's list):**

- Server: the legacy pull (`GET /api/sync/pull` without `v=2`, `sync.StreamLegacy`, the `Delta` shape); the
  legacy view (typed study rows served and accepted as `qinqin-flashcards` plugin data on the plugin-data
  routes and in a push, `study.LegacyGet/LegacyList/ApplyLegacy`, `handlers_plugins_legacy.go`); the
  synthesized data-pack rows of `GET /api/plugins` and the six listers (`internal/plugins/plugins.go`),
  with `Exists`/`CanWriteData` narrowed to real (registry) plugins and `packtype.LegacyPluginRow` gone; the
  pre-v0.2.0 branches: unregistered sentence packs in `packs.List`, `warnEntryIDUsers` in `seed.go`,
  `sentencePlugins` reading `sentences.source_pack`, and the stale wording in `datapkg` and `packcheck`.
- Web: the `legacyFamily` guard in `study/store.ts`; adoption of the v1 outbox (`qinqin.study.pending`) in
  `study/outbox.ts` / `study/events.ts`; the keyed-row parsers only tests use (`limits.ts`,
  `deckSettings.ts`, `fsrs/params.ts`); the plugin study-event hook and the SDK's `events.list`.
- Contracts: `study/legacy-view.json`, `sync/legacy-pull.json`, the legacy parts of `pwa/outbox-v2.json`
  and `scheduler/limits-rows.json`; `study/legacy-codec.json` leaves the study contract (see the backup
  Ruling); `overview.md`, `README.md`, a contract changelog line.

**Keep:** the migrations (and the frozen `step038` codec), `legacyRoutes.ts`, backup restore of keyed rows,
`study.AdoptLeftovers` (a downgraded binary's rows, taken over at start), the `GET /api/events` full-array
form (not in the issue), the plugin manifest vocabulary (`hook` surface, `study-event`, `read:study-events`).

**What answers now:**

- `GET /api/sync/pull` without `v=2`: 404 `not_found` (JSON), whatever the other parameters.
- Plugin-data routes of `qinqin-flashcards` with a typed-family key (`card:`, `deck:`, `deckcfg:`,
  `limits:workspace`, `limits:deck:`, `fsrs:set:`, `fsrs:active`): GET, PUT and DELETE answer 404
  `not_found`; a prefix list never contains such a key; a push item with such a key is refused alone
  (`dataRefused`); the paged pull never ships such a leftover row in `pluginData`.
- `GET /api/plugins`: registry plugins only. `PUT /api/plugins/{id}/state` and the data routes of a data-pack
  id are 404 like any unknown plugin.

## Rulings

- Ruling: old-format backups (keyed `qinqin-flashcards` study rows, every v1 archive including those a
  v0.3 server wrote) are still accepted, through the restore path only — format v1 *is* that keyed form (the
  export writes typed rows with `rows.ToLegacy`, the restore reads them with `rows.FromLegacy`), so refusing
  them would refuse every backup ever made — cost if wrong: none for users; the codec stays one more release.
- Ruling: `study/legacy-codec.json` moves to `backup/study-rows.json` (the codec is now the backup format's
  rule, not a study view); the frozen `step038` test reads the same file — the issue says retire the
  study `legacy-*` fixtures, and deleting the codec's only fixture would leave the backup form unpinned —
  cost if wrong: a rename.
- Ruling: the legacy pull answers 404 `not_found` rather than 400 or 410 — the brief asks for 404 coded
  JSON, and a removed endpoint form reads as "no such route" to scripts — cost if wrong: one status.
- Ruling: plugin-data requests on a typed-family key answer 404 `not_found` (not 400 `study_row_invalid`);
  `study_row_invalid` leaves the error catalogue because nothing emits it — the rows do not exist as plugin
  data for any client — cost if wrong: a script probing those keys sees 404 instead of 400.
- Ruling: a push item with a typed-family key is refused alone (`dataRefused`), not the whole push — the
  established "refused alone" rule for rows the server will not store — cost if wrong: none.
- Ruling: the paged pull leaves typed-family leftovers out of `pluginData` — the web guard that skipped them
  goes, so the server must not ship them — cost if wrong: an Android client relying on seeing them (it never
  should).
- Ruling: the v1 outbox key is neither read nor cleaned up — any browser that ran a v0.4+ copy already
  adopted and removed it; the release notes tell users to open the app online before upgrading — cost if
  wrong: reviews a v0.3 copy cached and never sent stay unsent in that browser's storage.
- Ruling: the Grammar page shows every installed grammar pack of the workspace language (no per-pack enabled
  state) — the pack's plugin state came from the synthesized row, which no UI could switch since #169;
  packs are managed in Settings → Data — cost if wrong: a user who switched a pack off in v0.3 sees it again
  (uninstall hides it).
- Ruling: Settings → Plugins drops the data-pack filter (`isDataPackPlugin`); `GET /api/plugins` no longer
  sends such rows. `prepareOffline` keeps caching `/api/plugins` (it still lists the real plugins) — cost:
  none.
- Ruling: the manifest vocabulary of the removed web hook stays valid (server and web contract) — removing
  permission names is a manifest contract change for #199, which retires code plugins — cost if wrong: an
  admin manifest may declare a hook that does nothing (it already did nothing).
- Ruling: `docs/contracts/CHANGELOG.md` is created as the general contract changelog (only `auth/README.md`
  had one, for #168, which it points to) — cost if wrong: one file.
- Ruling: the service worker no longer caches a pull without `v=2` — the server answers 404 for it, and the
  only client that sent it (a cached v0.3.x shell) is unsupported — cost if wrong: none.
- Ruling: `scheduler/fsrs.json` loses its `paramSet` cases and `scheduler/limits-rows.json` its `rows` cases
  (regenerated with `gen-scheduler-fixtures.mjs`): they pinned the keyed `fsrs:set:*` / `limits:*` parsers the
  issue removes; the typed rows are pinned by `study/rows.json`. `frequency/deckcfg-new-order.json` stays: its
  `newOrder` member rule is still `parseNewOrder`'s and the backup codec's — cost if wrong: re-adding cases.
- Ruling: the restore cleanup (`clearLocalAfterRestore`) works on the v2 outbox key (it still read only the
  v1 key, so a restore left the v2 queue of the old workspace ids behind). Fix wave M1: it drops only the
  restoring user's items and unowned ones (which that user's next flush would adopt, with pre-restore
  workspace ids), writes every other user's items back, counts only what it dropped, and with no known user
  drops nothing — the first fix cleared the whole queue, which on a shared browser lost another user's unsent
  reviews — cost if wrong: an unowned item recorded by another user before sign-in is dropped (rare: an item is
  unowned only while no user was known).
- Ruling: kept although v0.3-related, because the issue does not list them: `study.AdoptLeftovers` (a
  downgraded binary's rows), the full-array `GET /api/events` form, the unhidden core feature rows in
  `GET /api/plugins` (`isHiddenBuiltin`), the `legacySentences` usage count of `language_in_use`, and the
  test-only codec mirror `lib/study/testing/legacyCodec.ts` (test data builders; #197 replaces them) — cost if
  wrong: a follow-up removal.
- Ruling (fix wave S2): pre-v0.2.0 sentence packs without a registry row keep blocking a language delete
  (`legacySentences`), and the 409 message names each such pack (at most ten) with its removal route
  `DELETE /api/admin/sentences/{pack}`, which still removes them; users' own sentences (`source_pack = ''`) no
  longer count (an older bug). The admin list stays registry-only — the count is true data that blocks a
  delete, and the route already exists, so no new UI is needed — cost if wrong: the web shows the count, not the
  names; the admin reads them from the API message or the wiki (Admin-upgrading).
- Ruling: the release-notes draft is `docs/releases/NEXT.md`; no test enumerates `docs/releases` and the
  release workflow only reads `docs/releases/<tag>.md`, so the draft is never published by accident; it is
  renamed at tagging — cost if wrong: none.

## Tasks (one commit each)

1. This plan.
2. Server: the legacy pull and the legacy view go; the reintroduction guard (`api/legacy_removed_test.go`:
   404 coded JSON for every legacy request shape, a restored v0.3.0 archive pulls typed and its keys are 404
   on the plugin-data routes; a source scan for the removed identifiers) is written first and seen failing.
3. Server: the synthesized plugin rows and the pre-v0.2.0 branches.
4. Web: the guard (`study/legacyRemoved.test.ts`, the v1 key and `legacyFamily` outside the test helper),
   then the removals; Grammar and Settings move to supported sources (test-first).
5. Contracts, regenerated docs, wiki and the release-notes draft.

## Execution record

- Inventory: every caller of each removed item was grepped (server, web, contracts, wiki, tests, scripts).
  Legacy-only tests deleted with their code: `api/compat_old_shell_test.go`, `api/handlers_plugins_legacy_test.go`,
  `sync/{contract_legacy,legacy,legacy_equal,legacy_view,pull_semantics,sync_registry}_test.go`,
  `sync/export_test.go`, `study/legacy_test.go`, `plugins/{legacyrows,datamanifest}_internal_test.go`, the
  data-pack listing tests in `plugins_test.go`, the seed WARNING test, web `storeGuard.test.ts`,
  `hooks.test.ts`, `dataPacks.test.ts` and the keyed-parser cases. Tests that used the legacy pull or legacy
  view only as a read-out (sync push tests, the backup round trip, workspace delete, token routes, the
  `cmd/qinqin` core-row tests) now read the paged pull or push typed rows.
- Guards first: `api/legacy_removed_test.go` (`TestLegacyPullAndViewAreGone`,
  `TestOldFormatBackupRestoresIntoTypedRows`, `TestDataPackPluginRowsAreGone`, `TestLegacyCompatCodeStaysGone`)
  and web `study/legacyRemoved.test.ts` were written and run against the untouched code: every case failed
  (the legacy pull answered 200 with `Deprecation`, the plugin-data routes served and wrote typed keys, data-pack
  ids were plugins, the identifier scans found the code; the web scan found all five patterns). Then the code
  went and they passed. The backup test's restore half passed before too (the behaviour is kept; only its 404
  half was new). The route set is unchanged, so the route-walk, the pinned token set and the PWA route fixture
  needed no change (`UPDATE_ROUTES_FIXTURE=1` gave no diff; `gen-api-docs` changed only `API-Errors.md`).
- Test-first for the moved consumers: `grammar/browse.test.ts` (every pack shows) failed before `browseSections`
  lost its predicate; `backupView.test.ts` / `YourData.dom.test.ts` (the v2 key) failed before the fix;
  `classify.test.ts` (no legacy pull cached) failed before `classify.ts` changed.
- Gates: gofmt clean; one full `go vet ./... && go test ./...` under the flock: green apart from the known
  sandbox-only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`; web check 0 errors, build ok;
  full vitest under Node 26: 585 files, 12,499 passed, 8 skipped; `gen-api-docs --check`, `check-sources`,
  `node --test scripts/*.test.mjs` (156) ok; `gen-scheduler-fixtures --check` ok. Under the local Node 22 five
  dom tests (`BookView`, `AccountSettings`) fail on the untouched code too; Node 26 is green.
- Real app: a scratch build on a random 127.0.0.1 port (auto-seed off): the three legacy pull forms and
  GET/PUT/DELETE of a typed key answered 404 `not_found` JSON (401 anonymous); a typed push was accepted and a
  keyed card in the same push refused alone; the v2 pull shipped the card; `GET /api/plugins` listed only the
  five registry plugins with a grammar pack row inserted, and `PUT /api/plugins/<pack>/state` was 404; the
  v0.3.0 sample archive uploaded, staged, applied, and its cards, deck, limits, FSRS set and active set pulled
  as typed rows with no keyed row left. Server killed, scratch removed.
- Not verified: nothing in a browser or on a device (the Grammar page and Settings → Plugins were checked by
  unit and dom tests only); the real app ran without seeded packs, so the data-pack check used one inserted
  registry row; the web was not served by the real-app server.
