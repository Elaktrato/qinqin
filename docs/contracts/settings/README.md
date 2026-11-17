# Settings: workspace settings keys and the `qinqin-core` user rows

Two kinds of shared settings a second client reads and writes. Design:
`docs/superpowers/specs/2026-11-17-v040p-contract-gaps-design.md` (Q10; issue #109).

Fixtures:

- `workspace-settings.json` — `keys` (the key table below), `parse` (how the web reads each key from a
  workspace's `settings`; web: `lib/audio/settings.test.ts`, `lib/dictionaryVisibility.test.ts`,
  `lib/features/reader/displaySettings.test.ts`) and `merge` (`PUT /api/workspaces/{id}` with
  `{"settings": patch}` over a stored object; Go: `server/internal/api/contract_settings_test.go`).
  `"$string:n"` is a JSON string of n `x` characters.
- `core-rows.json` — the user-global rows `home-layout` and `activity-view` of plugin `qinqin-core`
  (web: `lib/widgets/layout.test.ts`, `lib/activity/viewPrefs.test.ts`).

## Workspace settings

Every workspace carries one JSON object `settings` (`GET /api/workspaces`, the pull v2 `workspaces`
collection). Keys in use:

| Key | Shape | Default (absent or malformed) | Owner (web) | Written by |
| --- | --- | --- | --- | --- |
| `reader` | object | `reader/display-settings.json` (its own parse rules; not repeated here) | `features/reader/displaySettings.ts` | reader display options |
| `hiddenDictionaries` | array of dictionary ids | none hidden; only positive integers count, others are ignored, duplicates collapse; anything but an array hides nothing | `dictionaryVisibility.ts` | the dictionary visibility switches |
| `audioAutoplay` | boolean | `false` (anything but a boolean) | `audio/settings.ts` | audio settings |
| `audioDeviceVoice` | boolean | `true` (anything but a boolean) | `audio/settings.ts` | audio settings |

Readers ignore keys they do not know, and a writer never removes them: clients change settings only by a
**merge patch**, never by writing the whole object. A restore remaps `hiddenDictionaries` (`backup/`).

**Merge** (`PUT /api/workspaces/{id}` `{"settings": patch}`; also `name`; at least one of the two; no other
member): the patch must be a JSON object and is merged into the stored object by RFC 7396 (SQLite
`json_patch`): a member replaces the stored value, a new member is added, a `null` member deletes its key, an
object value is merged recursively, an array or scalar value replaces. `{}` changes nothing (the stamp still
moves). The **merged** object (the bytes of its JSON text) may be at most 64 KiB (`maxSettingsBytes`): above
it the answer is `413 {"error": "workspace settings too large"}` and nothing changes; deleting keys in the
same patch makes room. A non-object patch is `400 settings must be an object` (plain text); `settings: null`
without a name is `400 name or settings required`. Unknown and foreign workspaces are 404. The request body
itself is at most 16 KiB (`maxWorkspaceBody`): above it the answer is `413 {"error": "request body too large"}`
(JSON) and nothing changes — a settings object larger than one request is built by several patches.

Before the merge the server decodes the patch into a JSON object and encodes it again (Go `map[string]any`):
members come out in alphabetical order, numbers pass through a 64-bit float (an integer above 2^53 loses
precision), and `<`, `>`, `&` are escaped as `\u003c`, `\u003e`, `\u0026` — six bytes each toward the 64 KiB cap.
Compare stored settings as JSON values, never as text.

## `qinqin-core` user-global rows

Both are plugin data rows of `qinqin-core` with `workspaceId: null` (one per user, shared by every device,
last write wins; `sync/`).

**`home-layout`** — `{"version": 1, "widgets": [widget id, ...]}`: the home widgets in order.

- Read (`parseLayout`): an object with an integer `version` ≥ 1 and an array `widgets`; entries that are not
  non-empty strings are dropped; a **newer version is read leniently** (its string ids count). Anything else
  (or no row) is no layout: the default `defaultLayout` (`activity-heatmap`, `flashcards-summary`,
  `daily-goal`, `weekly-summary`) applies. An empty list stays empty.
- Show (`resolveLayout`): stored ids in order, each once (first position wins), skipping ids that are
  unknown, unavailable (plugin off, another language) or not on the surface. Skipped ids **stay stored**.
- Write (`serializeLayout`): always `version: 1` with the ids as given.
- Widget ids the web registry knows (`widgets`): `activity-heatmap`, `character-map-summary`, `daily-goal`,
  `weekly-summary`, `flashcards-summary`, `word-states`, `reading-time`.

Ruling: Android shares `home-layout` with the web (one per user) and keeps every widget id it does not know
stored, in place — a per-platform key would be a new row type and the web already keeps unknown ids — cost: a
widget only one platform has occupies a slot the other skips.

**`activity-view`** — `{"version": 1, "scope": "workspace" | "all", "hidden": [activity type, ...]}`: the
heatmap's scope and hidden activity types.

- Read (`parseActivityView`): only `version: 1` objects are read (any other version, or no row, is the
  default `{scope: "workspace", hidden: []}`); an unknown scope is `workspace`; non-string and repeated
  `hidden` entries drop.
- Write: `{version: 1, scope, hidden}`.

Ruling: Android writes `activity-view` with `version: 1` only — cost: none.
