# Contract changelog

Changes to the shared rules in `docs/contracts/`, newest first. One entry per change that a client must
follow (a removed route form, a new or retired fixture, a changed answer); typo fixes and rewording are not
logged. Earlier changes: the error catalogue's own changelog in [`auth/README.md`](auth/README.md#changelog)
(#168).

## #189 — profile pictures

- **Profile pictures:** new routes `POST /api/account/avatar` (multipart field `file`; JPEG, PNG or WebP, 5 MB,
  25 megapixels and 8192 px a side, not animated; 200 `{avatarUrl}`), `DELETE /api/account/avatar`, `GET
  /api/avatars/{user}/{hash}[?size=64]` (any signed-in user; `private, no-cache`) and `DELETE
  /api/admin/users/{id}/avatar` (audited `avatar_removed`), no access token (`auth/avatar.json`, new fixture). `GET
  /api/auth/me` and the administrator user object carry `avatarUrl` (string or null; `auth/me.json`,
  `auth/admin-users.json`); the deletion previews count `avatar`. New error code `animated_image` (415);
  `photo_too_large`, `unsupported_image` and `image_too_large` now also answer the picture upload.
- **Backups:** a personal archive may hold `account/avatar.jpg` with the manifest count `avatar`; the server backup
  holds `avatars/` (`backup/README.md`).
- **auth/README.md** no longer names a Kotlin client: the Android app is the web app in a Capacitor shell.

## #186 — AI example sentences on demand

- **AI examples:** new routes `GET/POST /api/entries/{id}/examples` (the caller's drafts; one AI call with the
  learner's own key, `{level, requestId}`, idempotent by `requestId`), `POST
  /api/entries/{id}/examples/{draftId}/keep`, `DELETE /api/entries/{id}/examples/{draftId}[?reason=]` and `DELETE
  /api/entries/{id}/sentences/{sentenceId}[?reason=]` (a kept AI example only), no access token
  (`examples/README.md`). New fixture `examples/examples.json`, new error code `examples_full` (409).
- **Sentences:** every sentence (the entry answer's `sentences`, the pull's `sentences` rows, the keep answer) has
  `ai`: `{provider, model}` for a kept AI example, else `null` (`sync/pull-page.json` shapes and rows). A backup
  line of `sentences/` carries `ai` for an AI example (optional member). The deletion previews count
  `exampleReports` (`auth/admin-users.json`).
- **Fix wave:** `GET …/examples` adds `lastRequest` and a generation's answer `requestId`; a generation that kept
  nothing is stored as a marker (answered on a retry) and leaves the earlier drafts. Readings must be in the reading
  system's letters. A kana-only segmenter match of a word written with Han counts only when the entry is its first
  candidate, for the AI examples and the cloze card alike (`cards/cloze.json`, two new cases). The backup's `ai` has
  `level` and a restore applies the live rules (`examples/README.md`).

## #185 — the conversation partner

- **Journal conversations:** new routes `GET/POST /api/journal/conversations`, `GET/DELETE
  /api/journal/conversations/{id}`, `POST /api/journal/conversations/{id}/turn` (one AI call with the learner's own
  key) and `POST /api/journal/conversations/{id}/save` (the conversation becomes an entry), all `?workspace=`,
  no access token (`journal/README.md#conversations`). New fixture: `journal/conversations.json`. New error codes
  `conversation_full` and `conversation_limit` (409). A backup carries each conversation as
  `journal:conversation:<id>`; the deletion previews count `journalConversations` (`auth/admin-users.json`).
- **Fix wave:** a turn takes `{text, turnId}` (required) and a message carries `turnId`; a retry with a stored id
  answers the stored turn. New error code `wrong_language` (422) for a reply not mostly in the workspace language.
  The transcript quotes every partner line and escapes a learner line starting with `>`
  (`journal/conversations.json` `transcripts`, replacing `transcript`).

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
- **Language profiles:** new fixture `languages/profiles.json` (zh, ja, es and the fallback): what a language
  has (script, readings, segmentation, tones, strokes, kana, variants, card kinds, practice modes), resolved by
  the primary subtag. Availability checks follow it; a regional tag such as `zh-TW` now gets everything `zh`
  has (word counts, the variant label, the journal's Han check), and a language without writing or tone cards
  no longer lists them in the study setup.
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
