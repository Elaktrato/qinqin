# Keyed rows (`/api/rows`, pull collection `rows`)

Issue #199 (record 0006). The core's one generic store of small JSON settings documents: one row per user,
key and scope (one workspace, or user-global), with the sync rules of the paged pull and the push. It replaces
the plugin data store of the retired code plugins and has **no namespace**. The server
(`server/internal/keyed`) accepts only the key families of [`families.json`](families.json), each in its one
scope; the shapes of the documents are pinned by the folder each family names (`notes/`, `lookups/`,
`reader/`, `milestones/`, `goals/`, `scheduler/`, `settings/`, `themes/`).

| Family | Scope | Contract |
| --- | --- | --- |
| `note:<entryId>`, `notecfg` | workspace | `notes/` |
| `lookups` | workspace | `lookups/` |
| `lookupcfg` | user-global | `lookups/` |
| `known:<entryId>` | workspace | `reader/`, `frequency/` |
| `milestone:<id>` | workspace | `milestones/` |
| `goals:workspace` | workspace | `goals/` |
| `vacation:<ULID>` | user-global | `scheduler/` |
| `home-layout`, `activity-view`, `widget-options`, `nav-layout` | user-global | `settings/` |
| `appearance` | user-global | `themes/` |
| `reminders` | user-global | `reminders/` |

A prefix family is the prefix and at least one more character (`note:` alone is no key); any other family is the
exact key. Keys are 1 to 512 bytes. A new family is a contract change: a line here, in `families.json`, and in
the server's and the web's tables (each test compares them with the fixture).

## Wire shape

`{key, userId, workspaceId: int | null, data, version, updatedAt, deletedAt: string | null}` — the same in the
list and key routes and in the pull collection `rows` (`sync/pull-page.json` `shapes.rows`). `workspaceId:
null` is a user-global row. `version` counts writes; `updatedAt` is the server's write stamp (the pull cursor);
a tombstone keeps its last `data` with `deletedAt` set.

## Routes

Every route needs a user. `?workspace=<id>` scopes a row to one of the caller's workspaces (not an integer: 400
`bad_request`; unknown or foreign: 404 `workspace_not_found`); without it the row is user-global.

| Route | Answer |
| --- | --- |
| `GET /api/rows?workspace=&prefix=` | the live rows of the scope whose key starts with `prefix` (compared literally), by key |
| `GET /api/rows/{key}?workspace=` | the live row, or 404 `not_found` |
| `PUT /api/rows/{key}?workspace=` (the value as the body, any JSON, at most 256 KiB) | the stored row (version up, a tombstone revived) |
| `DELETE /api/rows/{key}?workspace=` | 204 (tombstoned), or 404 `not_found` when missing or deleted |

A key of no family is 404 `not_found` on every key route; a key in the other scope (a note without a workspace,
the home layout with one) is 400 `bad_request`. Personal access tokens may use these routes with the rules of
`auth/tokens-routes.json` (reads `read` + workspace query, writes `write` + workspace query).

## Push and pull

`POST /api/sync/push {rows: [{key, workspaceId, data, updatedAt, deletedAt?}]}` applies each row under last
write wins on the edit time (`study/lww.json`; second precision, the client clock clamped to the server's); a
row of a key no family accepts, or in the wrong scope, is refused alone (`dataRefused`). The paged pull ships
the caller's rows as the collection `rows`; `workspace=` narrows it to that workspace's rows plus the
user-global ones (`sync/README.md`).

| File | Rule | Decoded by |
| --- | --- | --- |
| `families.json` | the accepted key families and their scopes, accepted and refused keys | `server/internal/keyed/families_test.go`, `apps/web/src/lib/sync/families.contract.test.ts` |
