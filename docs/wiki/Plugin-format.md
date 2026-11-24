# Plugin format

A feature plugin is described by one JSON manifest. The server parses it strictly (`server/internal/plugins/manifest.go`, function `ParseManifest`): unknown fields are an error, nothing may follow the JSON object, and all problems are reported together. The web app mirrors the contract in `apps/web/src/lib/plugins/contract.ts`. This page documents only what that code enforces. The design background is `docs/superpowers/specs/2026-11-15-plugin-sdk-design.md`.

Plugins are built into the app today. Each built-in feature plugin has one manifest, a JSON file in `server/internal/plugins/builtin/` that the Go server embeds, validates and registers at start (`server/cmd/qinqin/main.go`), and that the web build imports through the `$builtin` alias. An administrator can register a manifest with `POST /api/admin/plugins` (below), but plugin *code* only ships inside the web bundle: there is no way to upload a plugin's pages or logic.

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
| `hooks` | Only `study-event` is known (it no longer runs anything in the web app). Must be non-empty with the `hook` surface and empty without it. |
| `events` | Event types the plugin emits (below). |

## Permissions

| Permission | What the code does with it |
|---|---|
| `owns-data` | The plugin may store its own rows. The server answers 403 to `PUT` and `DELETE` on `/api/plugins/{id}/data/{key}` (and refuses such rows in a sync push) for a plugin without it; the web SDK throws on `data.user()` and `data.workspace()`. See [Plugin data API](Plugin-data-api). |
| `read:study-events` | Accepted for compatibility; the web SDK no longer reads the event log. |
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

## Registering a manifest on the server

`POST /api/admin/plugins` (administrators, body up to 64 KiB) answers 400 with every reason when a manifest breaks the contract (unknown fields, trailing data, and event types another plugin owns included) and 409 for the id of a built-in or reserved plugin. At start a built-in wins an event-type conflict with an administrator-registered plugin; the conflict is logged, never fatal.

- `PUT` and `DELETE /api/plugins/{id}/data/{key}` answer 403 `plugin does not declare owns-data` for a plugin whose manifest has an `sdk` but not that permission. A registry row registered before the contract has no `sdk` and keeps writing; Settings marks it "legacy". In a sync push such a row is skipped, not fatal: the events and every other row still apply, and the result's `dataRefused` counts the skipped rows next to `dataSkipped`.
- A registry row whose manifest no longer parses (for example one registered before the strict `activity` validation) keeps writing like a legacy row but neither claims event types nor contributes heatmap activity; the start logs `plugin registry rows that do not parse as manifests` with their ids once. This only concerns development databases: re-register or remove those rows.
- The retired `qinqin-heatmap` plugin of earlier builds is unregistered at start.

## The web SDK

`apps/web/src/lib/plugins/sdk.ts` (`createPluginSdk(manifest)`) wraps plugin data (per user or per workspace) and recording study events (`events.record`), and throws a `PermissionError` for anything the manifest did not declare. The SDK no longer reads the event log or runs the `study-event` hook (removed in #198: nothing used them); the manifest may still declare them, which grants nothing. Permissions are a contract that catches mistakes and tells the user what a plugin does, **not a sandbox**: all plugin code ships in one bundle. The journal and the home layout use the SDK.

SDK data keys may not be empty, `.` or `..`. A plain string value round-trips (`put('k', 'hello')` reads back `'hello'`); a string that is itself valid JSON text (`'123'`) reads back decoded, so store objects instead of such strings.

## Plugin pages and widgets

A web plugin can contribute pages. Declare the `page` surface and a `pages` list in `apps/web/src/lib/plugins/index.ts`:

```ts
import MyPage from './my/MyPage.svelte';

export const webPlugins: WebPlugin[] = [
	{
		manifest: { id: 'qinqin-my', name: 'My plugin', surfaces: ['page'] },
		pages: [{ title: 'My page', nav: true, component: MyPage }]
	}
];
```

The page renders at `/p/<slug>/<rest>`, where the slug is the plugin id without the `qinqin-` prefix; the component receives `rest` as a prop and routes inside it. `nav: true` adds a link to the navigation (with the manifest's `icon`). The page is shown only while the plugin is registered on the server and enabled for the user; the shell and the page route share one fetch of those states through the session's `PluginStates` (`apps/web/src/lib/plugins/states.svelte.ts`), which a sign-out discards with the rest of the session.

A web plugin can also contribute widgets: the optional `widgets` array of its manifest (`PluginManifest.widgets`, next to `sources`) lists `WidgetDef`s (`apps/web/src/lib/widgets/types.ts`: id, title, description, owner, size `normal` or `wide`, an optional `appliesTo(language)`, surfaces and a component without props). The app's own widgets are in `apps/web/src/lib/widgets/core.ts`. A plugin's widgets exist only while the server lists the plugin and it is enabled. The home page renders the user's layout, the ordered widget ids in the user-global plugin data row `qinqin-core` / `home-layout` (`{"version": 1, "widgets": [...]}`, no workspace; a missing row means the default layout; a higher version is read leniently, its string ids only, and saving writes version 1), through `apps/web/src/lib/widgets/layout.ts`. The per-plugin `order` in Settings no longer affects the home page (it orders the navigation links).

The widgets that ship, by id (`appliesTo` limits one to some languages; surfaces are where it can appear):

| Id | Widget | Owner | Size | Surfaces | Languages |
|---|---|---|---|---|---|
| `summary-numbers` | Summary | core | wide | stats, home | all |
| `word-states` | Words | `qinqin-flashcards` | normal | stats, home | all |
| `flashcards-summary` | Flashcards | `qinqin-flashcards` | normal | stats, home | all |
| `reviews-per-day` | Reviews per day | core | wide | stats, home | all |
| `activity-heatmap` | Activity | core | wide | stats, home | all |
| `character-map-summary` | Characters | core | normal | stats, home | Chinese, Japanese |
| `reading-time` | Reading time | `qinqin-reader` | normal | stats, home | all |
| `daily-goal` | Daily goal | core | normal | home | all |
| `weekly-summary` | This week | core | normal | home | all |

Options of single widgets live in another user-global row, `qinqin-core` / `widget-options`, one member per widget id; today only the activity heatmap has one (its home layout: `garden`, `month` or `week`). Unknown keys are kept, and a write re-reads the row first so keys another device wrote meanwhile survive (contract: `docs/contracts/settings/`).

A plugin that ships or fetches third-party material credits it in the optional `sources` array of its manifest ([Data and licences](Data-and-licences#credits-and-the-sources-page)).

Data packs (dictionaries, level lists and so on) are not plugins: they carry content, are managed in Settings → Data and have no plugin state. See [Data pack format](Data-pack-format).
