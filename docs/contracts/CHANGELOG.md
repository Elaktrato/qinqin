# Contract changelog

Changes to the shared rules in `docs/contracts/`, newest first. One entry per change that a client must
follow (a removed route form, a new or retired fixture, a changed answer); typo fixes and rewording are not
logged. Earlier changes: the error catalogue's own changelog in [`auth/README.md`](auth/README.md#changelog)
(#168).

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
  v0.3.0 server's) still restore. `study/legacy-codec.json` moved to `backup/study-rows.json` (rule
  `backup/study-rows`, same cases).
- **Plugins and packs:** `GET /api/plugins` lists registry plugins only (no synthesized row per data pack,
  #169); a data pack's id is an unknown plugin for `PUT /api/plugins/{id}/state`, the data routes and a push.
  `packages/pack-types.json` drops its `legacyPluginRow` column. `GET /api/admin/packs` no longer lists
  sentences without a registry row (a pre-v0.2.0 import).
- **Web storage:** the v0.3.x review queue `qinqin.study.pending` is neither read nor removed;
  `pwa/outbox-v2.json` drops its `legacy` member and the adoption case. A pull without `v=2` is never cached
  by the service worker.
- **Scheduler:** `scheduler/limits-rows.json` drops its keyed-row `rows` cases and `scheduler/fsrs.json` its
  `paramSet` cases (the keyed `limits:*` and `fsrs:set:*` parsers went with the layer); the typed rows are
  pinned by `study/rows.json`.
