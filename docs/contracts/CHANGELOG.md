# Contract changelog

Changes to the shared rules in `docs/contracts/`, newest first. One entry per change that a client must
follow (a removed route form, a new or retired fixture, a changed answer); typo fixes and rewording are not
logged. Earlier changes: the error catalogue's own changelog in [`auth/README.md`](auth/README.md#changelog)
(#168).

## #199 — core features instead of code plugins

- **Journal:** entries, reviews, topic ideas and settings are typed storage with their own routes
  (`GET /api/journal/entries`, `GET/PUT/DELETE /api/journal/entries/{id}`, `GET
  /api/journal/entries/{id}/review`, `GET /api/journal/suggestions`, `GET/PUT /api/journal/settings`;
  `journal/README.md`). New fixture: `journal/entries.json`. The `qinqin-journal` plugin rows (`entry:`,
  `review:`, `suggestions`, `settings`) are gone; a backup carries the documents as `journal:entry:<id>`,
  `journal:review:<entryId>`, `journal:suggestions`, `journal:settings`. The deletion previews count
  `journalEntries`.
- **Grammar:** lesson progress is typed storage: `GET /api/grammar/progress?workspace=` lists it, `POST
  /api/grammar/progress?workspace= {packId, lessonId, score, total}` records a run; the server keeps the best
  score (`grammar/README.md`). New fixture: `grammar/progress.json`. The `qinqin-grammar` plugin rows
  (`lesson:<packId>:<lessonId>`) are gone; a backup carries the rows as `grammar:progress:<packId>:<lessonId>`.
- **Keyed rows replace plugin data:** the core's remaining rows (notes, lookups, known marks, milestones, goals,
  vacations, the home layout, the activity view, the widget options, the navigation layout, the appearance)
  live in one store without a namespace (`keyed/README.md`, new fixture `keyed/families.json`) that accepts
  only the listed key families, each in its scope. Routes: `GET /api/rows`, `GET/PUT/DELETE /api/rows/{key}`
  replace `/api/plugins/{id}/data[/{key}]` (removed). Pull collection `rows` replaces `pluginData`; the push
  member `rows` replaces `pluginData`; the row shape drops `pluginId`. A pushed row of an unknown family or in
  the wrong scope is refused alone (`dataRefused`); on the key routes an unknown key is 404 `not_found`, the
  wrong scope 400. Fixtures changed: `sync/pull-page.json`, `sync/pull-rounds.json`, `sync/push-result.json`,
  `sync/unreadable-rows.json`, `backup/remap.json` (op `row`), `settings/*.json` and `themes/appearance.json`
  (no `pluginId`), `auth/admin-users.json` (deletion preview `keyedRows`).
- **Feature switches replace plugin states; the code plugins are retired:** `GET /api/features` lists the
  caller's switch of the four core features (`flashcards`, `reader`, `journal`, `grammar`; no row is on), `PUT
  /api/features/{id} {enabled}` stores one (`features/README.md`, new fixture `features/switches.json`). Removed:
  `GET /api/plugins`, `PUT /api/plugins/{id}/state`, the admin registry route `POST /api/admin/plugins`,
  every plugin id (`qinqin-core`, `qinqin-flashcards`, `qinqin-reader`,
  `qinqin-journal`, `qinqin-grammar`) and the plugin manifest format. The pull collection `features` (`{id,
  enabled, updatedAt}`) replaces `pluginStates`; a backup's `account.json` carries `features: [{id,
  enabled}]`. The web's study pull no longer asks for the switches.
- **Activity sources:** `GET /api/stats/activity` `sources` are `{type, feature, unit}` (no `plugin`, `label`
  or `describe`: a client words a source from its catalogue, `activity.source.<type>.*`); `events/activity.json`
  `rules` name the `feature`. The `plugin.*` catalogue keys are retired (`i18n/retired-keys.json`).
- **Deck sources:** the variant `{type:"plugin", pluginId, key}` is gone (`study/rows.json` now refuses it,
  `decks/system-deck-ids.json` drops the `d-plg-` case); migration 047 turns such a deck into a plain deck. The
  legacy codec keeps an old plugin source in `extra` (`backup/study-rows.json`). The flashcards route
  `system/plugin/...` is gone.
- **Error catalogue:** `plugin_no_data` leaves `auth/errors.json` (nothing sends it).
- **Backup format 2:** the family `plugin-data` becomes `rows` (no `pluginId`); typed study rows, journal
  documents and grammar progress travel there in their keyed form. A format 1 archive is refused
  (`backup_version_unsupported`; `backup/reject.json`). The dry-run report drops `pluginsNotInstalled`; its
  counts say `rows` for `pluginData`. The sample archive is `backup/sample-v2/`.

## #192 — one pack system on the server

No fixture changes; `packages/pack-types.json` is unchanged and still decoded by the Go and web tests. Two
answers can differ:

- **`GET /api/admin/packs`:** re-importing an unchanged components, audio or font pack (a re-seed, the same
  upload again) no longer changes its `updatedAt`, as for the other types already; nothing is rewritten.
- **`pack_invalid` detail:** a manifest that breaks two own-format rules at once (for example a lemma-rules
  pack with the format `themes-json`) now names the rule of its own type. Every other validation message is
  unchanged.

## #198 — the v0.3 compatibility layer is removed

v0.3.x clients are no longer supported.

- **Sync:** a pull without `v=2` (the legacy streaming form, `cursor=`) answers 404 `not_found`. The paged
  pull never ships a `qinqin-flashcards` row of a typed family in `pluginData`. A push item of `pluginData`
  with such a key is refused alone (`dataRefused`). Retired: `sync/legacy-pull.json`;
  `sync/push-result.json` replaces its two legacy cases with the refusal.
- **Typed study rows:** the legacy view is gone. `GET`, `PUT` and `DELETE
  /api/plugins/qinqin-flashcards/data/{key}` of a typed-family key (`card:`, `deck:`, `deckcfg:`,
  `limits:workspace`, `limits:deck:`, `fsrs:set:`, `fsrs:active`) answer 404 `not_found`, and a prefix list
  leaves such keys out. Retired: `study/legacy-view.json`. The error code `study_row_invalid` leaves
  `auth/errors.json` (nothing sends it).
- **Backups:** the keyed form of the typed rows is now only the backup format's; old-format archives (a
  v0.3.0 server's) still restore. A leftover `plugin_data` row of a typed family is never exported (a
  readable unshadowed one was), and the server no longer takes such rows over at start. `study/legacy-codec.json` moved to `backup/study-rows.json` (rule
  `backup/study-rows`, same cases).
- **Plugins and packs:** `GET /api/plugins` lists registry plugins only (no synthesized row per data pack,
  #169); a data pack's id is an unknown plugin for `PUT /api/plugins/{id}/state`, the data routes and a push.
  `packages/pack-types.json` drops its `legacyPluginRow` column. `GET /api/admin/packs` no longer lists
  sentences without a registry row (a pre-v0.2.0 import); `language_in_use` still counts them as
  `legacySentences` (own sentences, `source_pack = ''`, no longer count) and its message names each such
  pack with its removal route `DELETE /api/admin/sentences/{pack}`.
- **Web storage:** the v0.3.x review queue `qinqin.study.pending` is neither read nor removed;
  `pwa/outbox-v2.json` drops its `legacy` member and the adoption case. A pull without `v=2` is never cached
  by the service worker.
- **Scheduler:** `scheduler/limits-rows.json` drops its keyed-row `rows` cases and `scheduler/fsrs.json` its
  `paramSet` cases (the keyed `limits:*` and `fsrs:set:*` parsers went with the layer); the typed rows are
  pinned by `study/rows.json`.
