# Core data API

qinqin has no plugins (#199, [record 0006](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0006-core-features-instead-of-code-plugins.md)). Flashcards, the reader, the journal and grammar are core features; their data has typed routes, and the core's small settings documents live in one store of keyed rows. All routes need a signed-in session ([API overview](API-Overview)); rows belong to the caller alone. The route list itself is in [API routes](API-Routes).

## Feature switches

| Route | Behaviour |
|---|---|
| `GET /api/features` | The caller's switch of each core feature, in the order `flashcards`, `reader`, `journal`, `grammar`: `[{id, enabled, updatedAt}]`. A feature never switched is on (`updatedAt` null). |
| `PUT /api/features/{id}` `{enabled}` | Stores one switch. Any other id is 404. |

Switching a feature off only hides it in the app; nothing is deleted or refused. Contract: `docs/contracts/features/`.

## Keyed rows

| Route | Behaviour |
|---|---|
| `GET /api/rows?workspace=&prefix=` | The caller's live rows of the scope whose key starts with `prefix`. |
| `GET /api/rows/{key}?workspace=` | One row; never stored or deleted: 404. |
| `PUT /api/rows/{key}?workspace=` | The body is the value (any JSON). Increments the row's version and revives a deleted row. |
| `DELETE /api/rows/{key}?workspace=` | Marks the row deleted (a tombstone the sync pull sees). |

Without `?workspace=<id>` a row is user-global; with it, it belongs to that workspace. Only the listed key families are accepted, each in its one scope (notes, lookups, known marks, milestones, goals, vacations, the layouts, the appearance): an unknown key is 404, the wrong scope 400. The same rows travel through `POST /api/sync/push` and `GET /api/sync/pull?v=2` (collection `rows`), last write wins. Cards, decks, deck settings, limits and FSRS sets are typed collections of the sync pull and push, never keyed rows (`docs/contracts/study/`). Contract: `docs/contracts/keyed/`.

## Journal and grammar

- The journal's entries, reviews, topic ideas and settings: `GET /api/journal/entries`, `GET`/`PUT`/`DELETE /api/journal/entries/{id}`, `GET /api/journal/entries/{id}/review`, `GET /api/journal/suggestions`, `GET`/`PUT /api/journal/settings`, each with `?workspace=` ([Journal and AI](Journal-and-AI); contract `docs/contracts/journal/`).
- Grammar lesson progress: `GET /api/grammar/progress?workspace=` and `POST /api/grammar/progress?workspace=` `{packId, lessonId, score, total}`; the server keeps the best score ([Grammar lessons](Grammar-lessons); contract `docs/contracts/grammar/`).

Access tokens cannot reach the journal or grammar routes; they may read and write the feature switches and the keyed rows ([API access tokens](API-Access-tokens)).
