# Plan — core features instead of code plugins; language profiles (#199)

Issue #199 (phase 3 of #190), record [0006](../../architecture/0006-core-features-instead-of-code-plugins.md).
Branch `feature/199-core-features` from `develop` at b5765fb1, worktree `.claude/worktrees/199-core`. The web side
follows record [0009](../../architecture/0009-web-state-model.md) (runes classes, `Session`), the server side
record [0003](../../architecture/0003-domain-packages-own-their-sql.md) (domain packages own their SQL).

Owner direction (2026-11-24) overrides the issue's "Migration" section: no backwards compatibility, and stored
data need not survive ("a clean start is fine"). Old routes, plugin ids, contract fields and backup formats go
without shims; each break is logged in `docs/contracts/CHANGELOG.md`, and `docs/releases/NEXT.md` says in one
line what an upgrade wipes.

## What exists at b5765fb1

- **Server registry** (`server/internal/plugins`): five embedded manifests (`qinqin-core`, `qinqin-flashcards`,
  `qinqin-reader`, `qinqin-journal`, `qinqin-grammar`) registered at start-up into `plugin_registry`; admin
  registration (`POST /api/admin/plugins`); `plugin_states` (per-user `enabled`, `ord`) behind
  `GET /api/plugins` and `PUT /api/plugins/{id}/state`; `isHiddenBuiltin`; the manifests' event declarations
  feed the heatmap's activity rules (`plugins.ActivityRules`).
- **Plugin data** (`plugin_data`, migration 010): one keyed JSON store with sync columns behind
  `GET/PUT/DELETE /api/plugins/{id}/data[/{key}]`, the pull collections `pluginStates`/`pluginData`, the push
  member `pluginData`, the backup family `plugin-data` and `account.pluginStates`. Its users:
  - `qinqin-core`: `note:<entryId>`, `notecfg`, `lookups`, `lookupcfg`, `home-layout`, `activity-view`,
    `widget-options`, `appearance`, `nav-layout`;
  - the study namespace `qinqin-flashcards`: `goals:workspace`, `known:<entryId>`, `vacation:<ULID>`,
    `milestone:<id>`;
  - `qinqin-journal`: `entry:<id>`, `review:<id>`, `suggestions`, `settings` (photos already have their own
    table `journal_photos`);
  - `qinqin-grammar`: `lesson:<packId>:<lessonId>`.
- **Web**: `lib/plugins/` (the SDK `sdk.ts`, `contract.ts`, `manifestText.ts`, `states.svelte.ts`,
  `webPlugins` with the journal and grammar under `lib/plugins/{journal,grammar}`), the generic page route
  `routes/p/[plugin]/[...rest]`, Settings → Plugins (order, enable, permission lines, "needs app update"),
  `lib/features` for flashcards and the reader with their switches as plugin-state rows of reserved ids.
- **Language special cases**: about thirty `lang === 'zh'`, `usesHan`, `isChinese`, `isCjk` tests in the web
  app decide which card kinds, practice modes, stats tabs, widgets, reader panels and search tools a
  workspace gets; a few in the server (`api/entry_characters.go`, `journal/script.go`).

## Design

### Feature switches

`server/internal/features`: the closed list of core features `flashcards`, `reader`, `journal`, `grammar` (in
this order, the order of the nav) and the table `feature_switches (user_id, feature, enabled, updated_at)`. No
row is "on". `GET /api/features` answers all four `{id, enabled, updatedAt|null}`; `PUT /api/features/{id}
{enabled}` stores one and answers it. The pull collection `features` ships the stored rows `{id, enabled,
updatedAt}`; the backup's `account.json` carries `features: [{id, enabled}]`. Switching off still only hides the
feature in the client (record 0006); the server keeps accepting its data and events. Contract:
`docs/contracts/features/` (`switches.json`).

### Keyed rows: one generic core settings-rows store

`server/internal/keyed`: the table `keyed_rows (user_id, workspace_id NULL, key, data, version, updated_at,
modified_at, deleted_at)` with `plugin_data`'s sync rules (last write wins by edit time, tombstones, the
`IFNULL(workspace_id, 0)` unique key) and **no namespace**. Unlike plugin data it accepts only the key families
the contract lists (`docs/contracts/keyed/families.json`), each with its scope:

| Family | Scope |
| --- | --- |
| `note:<entryId>`, `notecfg`, `lookups`, `known:<entryId>`, `milestone:<id>`, `goals:workspace` | workspace |
| `lookupcfg`, `home-layout`, `activity-view`, `widget-options`, `appearance`, `nav-layout`, `vacation:<ULID>` | user-global |

Routes `GET /api/rows?workspace=&prefix=`, `GET/PUT/DELETE /api/rows/{key}?workspace=`: an unknown key is
404 `not_found` (as a typed study key on the plugin-data routes was), a key used in the wrong scope is 400
`bad_request`. Pull collection `rows` (`{key, userId, workspaceId, data, version, updatedAt, deletedAt}`), push
member `rows`; a pushed row of an unknown family or the wrong scope is counted `dataRefused`, the rest applies.

### Journal and grammar as typed storage

- `server/internal/journal` (store.go): `journal_entries (user_id, workspace_id, id, date, title, text, source,
  created_at, updated_at)`, `journal_reviews (… entry_id, text_hash, annotations, overall, model, provider,
  fallback_from, dropped, created_at)`, `journal_suggestions (… items, model, provider, created_at)` and
  `journal_settings (… guidance, explanation_language, updated_at)`; JSON columns are checked by `json_valid`
  and their type. Routes: `GET /api/journal/entries?workspace=`, `GET/PUT/DELETE
  /api/journal/entries/{id}?workspace=` (a delete removes the review), `GET
  /api/journal/entries/{id}/review?workspace=` (`{review: … | null}`), `GET /api/journal/suggestions?workspace=`
  (`{suggestions: … | null}`), `GET/PUT /api/journal/settings?workspace=`. The AI routes (`POST
  /api/journal/review`, `/suggestions`, `/transcribe`, photos) stay and read and write the new tables.
  Contract: `docs/contracts/journal/` (`entries.json`, `settings.json` beside the review documents).
- `server/internal/grammar` (progress.go): `grammar_progress (user_id, workspace_id, pack_id, lesson_id,
  completed_at, best, total, updated_at)`. `GET /api/grammar/progress?workspace=` lists it, `POST
  /api/grammar/progress?workspace= {packId, lessonId, score, total}` records a finished run and answers the
  stored progress. The keep-the-best rule moves from the web into the server, inside one statement (two tabs
  can no longer lower a best score). Contract: `docs/contracts/grammar/progress.json`.
- Neither is in the paged pull: the journal and grammar are online pages (AI, packs), as they were in practice
  (the study read model never read their plugin rows).

### Backup format 2

`plugin-data` becomes the family `rows` (`{workspaceId|null, key, data, version, updatedAt, modifiedAt}`, no
`pluginId`) and `account.pluginStates` becomes `account.features`. The typed rows travel in their keyed form,
as typed study rows already did (`card:`, `deck:`, …): `journal:entry:<id>`, `journal:review:<entryId>`,
`journal:suggestions`, `journal:settings`, `grammar:progress:<packId>:<lessonId>`; a restore remaps their
workspace and decodes them into the typed tables (a row that does not decode is dropped and counted). Format
version 2; an archive of version 1 is refused as unsupported (owner direction).

### Retiring the code plugins

Removed: `server/internal/plugins` (registry, manifests, `isHiddenBuiltin`, activity rules from manifests,
`Register`/`Unregister`/`RegisterBuiltin`, `CanWriteData`), `POST /api/admin/plugins`, `GET /api/plugins`,
`PUT /api/plugins/{id}/state`, the plugin-data routes, the pull collections `pluginStates`/`pluginData`, the
push member `pluginData`; on the web `lib/plugins/` (SDK, contract, manifests, manifest texts, states),
`routes/p/[plugin]`, Settings → Plugins, `webPlugins`. The heatmap's activity rules become one core table
(`server/internal/stats` `Rules`, the web `lib/activity/sources.ts`), pinned by `events/activity.json`. The
journal and grammar move to `lib/features/journal` and `lib/features/grammar` and are served at `/journal`
and `/grammar` like `/flashcards` and `/reader`; their switches join Settings → Features. The tables
`plugin_registry`, `plugin_states` and `plugin_data` are dropped by the migrations of this branch.

### Language profiles

`docs/contracts/languages/profiles.json` (+ README): one profile per language and a fallback for any other
code, resolved by the primary subtag (`zh-TW` → `zh`):

`{code, script: "han" | "latin" | "other", readings: [reading type], segmentation: "dictionary" | "spaces",
tones, strokes, kana, variants: bool, grammarLessons: bool, cardKinds: [card kind], practiceModes: ["decks",
"levels", "characterMap"]}`

The web table is `apps/web/src/lib/languages/profiles.ts` (`profileOf`), the Go table
`server/internal/lang/profile.go` (`ProfileOf`); each is pinned to the fixture by a test. The special cases that
decide availability go through it: the card kinds of a session and of the setup (`tone` from `cardKinds`), tone
and writing eligibility, the word salad's tokens and the reader's word counts and readings (`segmentation`), the
Characters tab, the character-map widget, the parts search and the radical filter, the weekly characters, the
han milestones (`practiceModes` / `script`), the variant label and stroke player (`variants`, `strokes`), the
server's character breakdown of a word and the journal's script check. Reading code itself (pinyin, kana,
deinflection) stays language code: a profile says *whether* a language has tones, not how to parse them.

## Tasks

1. **This plan.**
2. **Journal typed storage** (test-first): store, routes, the AI routes on the new tables, contract, migration
   (tables; the old journal plugin rows dropped), workspace and account delete rules, backup in keyed form;
   the web journal store on the new routes.
3. **Grammar progress typed storage** (test-first): the same for `grammar_progress`; the best-score rule on the
   server; the web on the new routes.
4. **Keyed rows store** (test-first): `internal/keyed`, `keyed_rows` (the core and study rows copied over 1:1),
   the families contract, routes, pull/push `rows`, backup format 2 (`rows`), the web `sync/keyed.ts` without
   namespaces, the service worker's rules, `plugin_data` dropped.
5. **Feature switches and the end of the plugins** (test-first): `internal/features`, `feature_switches` (the
   switches of the four features copied from `plugin_states`), routes, pull `features`, `account.features`; the
   activity rules as a core table; `internal/plugins` and its routes removed; `plugin_states` and
   `plugin_registry` dropped; the web `FeatureStates` in the session, the journal and grammar as core features,
   Settings → Features with four switches, `lib/plugins/` and `/p/…` removed.
6. **Language profiles** (test-first): contract, Go and web tables, the special cases routed through them;
   tests with zh, ja and es.
7. **End-to-end**: one spec opens the journal (writes an entry) and a grammar lesson.
8. **Docs**: record 0006 Accepted with real paths and a "how to add a language" section; the wiki pages that
   name plugins; `docs/ROADMAP.md` Android section; `docs/releases/NEXT.md`; the comment for #38; this plan's
   Execution record. API routes are regenerated in every task that changes routes.

## Rulings

- Ruling: one generic store (`keyed_rows`) for the remaining core rows, not typed storage per row — the
  thirteen families are small JSON settings documents whose shapes are already pinned by fixtures and read
  with lenient rules (newer versions, unknown members kept); typed tables would multiply schema, sync and backup
  code by thirteen without a reader that needs SQL access to their members — cost if wrong: a later typed
  table per family, migrated from one store (cheap, the rows are keyed).
- Ruling: the store accepts only the families of `keyed/families.json`, each in its one scope — "no new feature
  data in generic rows" (record 0006) is then a contract change, not an accident, and a row in the wrong scope
  (a workspace note written user-global) is refused instead of silently unreachable — cost if wrong: a new
  settings row needs a contract line and a server release.
- Ruling: no namespace in the store; the former `qinqin-core` and `qinqin-flashcards` key spaces are disjoint —
  a namespace without plugins is a second key prefix — cost if wrong: none found; a clash would be a new family
  name.
- Ruling: journal and grammar are not in the paged pull — the web reads them online through their routes (it
  never read their plugin rows from the pull), and the Android app is the web app in a shell (#200) — cost if
  wrong: an offline journal would add two pull collections.
- Ruling: the service worker caches none of the new journal and grammar routes (default no); `GET /api/rows`,
  `GET /api/rows/{key}` (lookup rows still excluded) and `GET /api/features` take over the cache rules of the
  plugin routes they replace — cost if wrong: the journal is not readable offline (it needs the AI for its main
  work anyway).
- Ruling: grammar's keep-the-best rule moves to the server (`POST /api/grammar/progress` with the run's score)
  — the client's read-then-write could lower a best score when two tabs finish a lesson — cost if wrong: none;
  the web shows what the server answers.
- Ruling: personal access tokens keep the reach they had where the token design allows it: `/api/rows` keeps
  the plugin-data rules (`tokReadWS` for reads, `tokWriteWS` for writes) and `/api/features` the plugin-state
  rules (`tokReadAny`/`tokWriteAny`); the journal document routes take **no** token, because the token design
  forbids every `/api/journal/` route (`TestTokenRuleConsistency`) and the old reach through plugin data was a
  side door; grammar progress (`/api/grammar/progress`) takes none either, like the journal (a learning record
  of a feature page, never needed by a script so far). The pinned token route set changes only by the routes
  that replace the plugin routes — cost if wrong: a script that read journal entries or lesson progress through
  a token stops working; a later amendment can open the grammar route.
- Ruling: backup format 2 refuses version 1 archives — the owner said old backups need not restore, and
  mapping `plugin-data` rows into three stores would keep the plugin ids alive in the restore — cost if wrong:
  a user restores an old archive on an older release first, exports again.
- Ruling: the migrations copy what maps one to one — the core and study keyed rows (same columns), the switches
  of flashcards and the reader, and the journal and grammar rows whose JSON decodes — and drop the rest with the
  three plugin tables (admin-registered plugins, the plugin order, unreadable rows) — the owner allows a clean
  start, but a column copy costs a few SQL lines and keeps people's notes, known words, goals and entries —
  cost if wrong: a row that decoded badly is lost (NEXT.md says so).
- Ruling: feature ids are the short names (`flashcards`, `reader`, `journal`, `grammar`) — the `qinqin-`
  prefix named a plugin package — cost if wrong: none (no compatibility).
- Ruling: `/p/journal` and `/p/grammar` redirect to `/journal` and `/grammar` through `legacyRoutes.ts` — the
  file exists for old bookmark URLs (#198 kept it), two lines — cost if wrong: two lines to delete.
- Ruling: the activity sources of `GET /api/stats/activity` are `{type, feature, unit}`; labels and wordings
  come from the client's catalogue — the English `label`/`describe` of a manifest were only a fallback for
  third-party plugins, which no longer exist — cost if wrong: a client without a catalogue entry for a new
  type shows the type id.
- Ruling: a language profile says what a language has, not how its reading code works; the fallback profile
  (every code without a profile) has no readings, space segmentation and the card kinds vocab, sentence,
  reverse and cloze — the Spanish demo is exactly that plus `script: "latin"` — cost if wrong: a new language
  without a profile gets the plain set until its profile lands.

## Execution record

(filled in as the tasks land)
