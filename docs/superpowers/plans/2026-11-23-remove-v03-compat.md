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

(filled in as the work goes)
