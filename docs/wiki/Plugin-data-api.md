# Plugin data API

A plugin that declares `owns-data` ([Plugin format](Plugin-format)) stores JSON documents under string keys. All routes need a signed-in session (see [API overview](API-Overview)); rows belong to the caller alone. Source: `server/internal/api/handlers_plugins.go`. The route list itself is in [API routes](API-Routes).

| Route | Behaviour |
|---|---|
| `GET /api/plugins/{id}/data?prefix=` | The caller's live rows whose key starts with `prefix` (all rows without it). Unknown plugin: 404. |
| `GET /api/plugins/{id}/data/{key}` | One row. Never stored or deleted: 404. |
| `PUT /api/plugins/{id}/data/{key}` | The request body is the value: any valid JSON, at most 256 KiB (`maxPluginDataValue`). Increments the row's version and revives a deleted row. |
| `DELETE /api/plugins/{id}/data/{key}` | Marks the row deleted (a tombstone that a sync pull sees). Missing or already deleted: 404. |

Rules:

- Keys from the web SDK may not be empty, `.` or `..`; a string value that is itself valid JSON text reads back decoded ([Plugin format](Plugin-format#the-web-sdk)).
- Scope: without `?workspace=<id>` a row is user-global; with it, the row belongs to that workspace. A non-integer id is 400, an id that is not the caller's workspace is 404.
- `PUT` and `DELETE` on an unknown plugin are 404 (a data pack's id is not a plugin); on a plugin whose manifest lacks `owns-data` they are 403. Invalid JSON in a `PUT` is 400.
- The same rows travel through `POST /api/sync/push` and `GET /api/sync/pull?v=2`, last write wins. Key conventions of the built-in plugins are in `docs/contracts/overview.md`.
- `qinqin-flashcards` is the study namespace, not a plugin. Cards, decks, deck settings, limits and FSRS sets are typed core rows since v0.4.0 (`docs/contracts/study/`); their old keys (`card:<id>`, `deck:<id>`, `deckcfg:<deckId>`, `limits:workspace`, `limits:deck:<deckId>`, `fsrs:set:<id>`, `fsrs:active`) are not plugin data: these routes answer 404 for them. Clients use the typed collections of the sync pull and push.
