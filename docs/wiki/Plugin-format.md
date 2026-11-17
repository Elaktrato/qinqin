# Plugin format

A feature plugin is described by one JSON manifest. The server parses it strictly (`server/internal/plugins/manifest.go`, function `ParseManifest`): unknown fields are an error, nothing may follow the JSON object, and all problems are reported together. The web app mirrors the contract in `apps/web/src/lib/plugins/contract.ts`. This page documents only what that code enforces. The design background is `docs/superpowers/specs/2026-11-15-plugin-sdk-design.md`.

Plugins are built into the app today: the manifests live in `server/internal/plugins/builtin/` and are registered on start. There is no upload route for feature plugins.

## Example

The Grammar plugin (`server/internal/plugins/builtin/grammar.json`):

```json
{
  "id": "qinqin-grammar",
  "name": "Grammar",
  "version": "1.1",
  "type": "feature",
  "sdk": 1,
  "description": "Short grammar lessons with examples and practice.",
  "icon": "grammar",
  "surfaces": ["page"],
  "permissions": ["owns-data"],
  "hooks": [],
  "events": []
}
```

## Fields

| Field | Rule |
|---|---|
| `id` | Lowercase letters and digits in groups joined by single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), at most 64 characters. |
| `name` | Required, at most 80 characters. |
| `version` | `1.0` or `1.0.0` (digits only). |
| `type` | Must be `"feature"`. |
| `sdk` | A whole number; this server accepts 1 only (`SDKMin`..`SDKMax`). |
| `description` | Optional, at most 200 characters. |
| `icon` | Optional. The icon of the plugin's page in the app's navigation: a name of the app's icon set (the names in `apps/web/src/lib/ui/icons/lucide.ts`, such as `journal` or `grammar`). The server checks only the form: a lowercase letter, then up to 31 lowercase letters, digits and hyphens (`^[a-z][a-z0-9-]{0,31}$`); present but empty, `null` or not a string is an error. The apps show a generic icon for a name they do not know (or no icon field). |
| `surfaces` | Any of `home-widget`, `page`, `hook`; no repeats. |
| `permissions` | Any of the four below; no repeats. |
| `hooks` | Only `study-event` is known. Must be non-empty with the `hook` surface and empty without it. |
| `events` | Event types the plugin emits (below). |

## Permissions

| Permission | What the code does with it |
|---|---|
| `owns-data` | The plugin may store its own rows. The server answers 403 to `PUT` and `DELETE` on `/api/plugins/{id}/data/{key}` (and refuses such rows in a sync push) for a plugin without it; the web SDK throws on `data.user()` and `data.workspace()`. See [Plugin data API](Plugin-data-api). |
| `read:study-events` | The web SDK allows reading study events. |
| `write:study-events` | The web SDK allows emitting study events. The server rejects a manifest that declares `events` without it. |
| `read:entries` | Accepted and shown to the user in Settings. Neither the server nor the web SDK checks it at run time yet. |

## Events and heatmap activity

Each entry of `events` has a `type` (lowercase letter first, then lowercase letters, digits and hyphens; no repeats) and an optional `activity` object that makes the event count on the activity heatmap:

- `label`: 1 to 40 characters.
- `describe`: `{ "one": "...", "other": "..." }`, both containing `{n}`.
- Scoring is decided by the optional fields. Neither `measure` nor `distinctBy`: each event counts once. `distinctBy`: a field name (`^[A-Za-z][A-Za-z0-9_]*$`) whose distinct values are counted. `measure`: `{ "field", "unit": "seconds", "min", "max" }` with `0 <= min < max <= 86400`, together with `pointsPer` of at least 1. `measure` and `distinctBy` exclude each other, and `pointsPer` is only allowed with `measure`.
- `activity` may be `null` or absent; any other non-object is an error.

## Built-in manifests

| Id | Surfaces | Permissions |
|---|---|---|
| `qinqin-core` | none | `owns-data`, `write:study-events` (declares the `session`, `view`, `lookup`, `review` and `read` events) |
| `qinqin-grammar` | `page` | `owns-data` |
| `qinqin-journal` | `page` | `owns-data`, `write:study-events` |

`qinqin-flashcards` and `qinqin-reader` are reserved registry ids, not plugins: flashcards (the decks
page, study sessions) and the reader are core features of the app since v0.4.0, at `/flashcards` and
`/reader`. Their registry rows declare no surface and no event (`qinqin-flashcards` keeps `owns-data`: it
is the namespace of the keyed study rows such as `known:*`, `goals:workspace` and `vacation:*`), and each
user's state row of the two ids is that user's switch in **Settings → Features**. An admin cannot register
a plugin under a reserved id (409).

Data packs (dictionaries, level lists and so on) are a different kind of plugin: see [Data pack format](Data-pack-format).
