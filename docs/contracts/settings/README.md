# Settings: workspace settings keys and the user-global keyed rows

Two kinds of shared settings a second client reads and writes. Design:
`docs/superpowers/specs/2026-11-17-v040p-contract-gaps-design.md` (Q10; issue #109).

Fixtures:

- `workspace-settings.json` — `keys` (the key table below), `parse` (how the web reads each key from a
  workspace's `settings`; web: `lib/audio/settings.test.ts`, `lib/workspace/dictionaryVisibility.test.ts`,
  `lib/features/reader/displaySettings.test.ts`) and `merge` (`PUT /api/workspaces/{id}` with
  `{"settings": patch}` over a stored object; Go: `server/internal/api/contract_settings_test.go`).
  `"$string:n"` is a JSON string of n `x` characters.
- `core-rows.json` — the user-global rows `home-layout` and `activity-view` (a keyed row, `keyed/`)
  (web: `lib/widgets/layout.test.ts`, `lib/activity/viewPrefs.test.ts`).
- `widget-options.json` — the user-global row `widget-options` (a keyed row, `keyed/`): `row` (an example),
  `parse` (`value` → the heatmap layout read) and `write` (`stored` + `layout` → the row written) (web:
  `lib/widgets/options.test.ts`; Go: `cmd/qinqin/core_rows_test.go`,
  `internal/backup/widget_options_test.go`).
- `nav-layout.json` — the user-global row `nav-layout` (a keyed row, `keyed/`) (the phone navigation): `row` (an
  example), `parse` (`value` → `{phone, bar}` read), `write` (`stored` + `change` → the row written) and `items`
  (visible section ids + `bar` → the bottom bar's items, the More rows and the current item; `bar: null` is the
  default pins) (web: `lib/frame/navLayout.test.ts`, `lib/frame/barItems.test.ts`; Go:
  `cmd/qinqin/core_rows_test.go`, `internal/backup/nav_layout_test.go`).

## Workspace settings

Every workspace carries one JSON object `settings` (`GET /api/workspaces`, the pull v2 `workspaces`
collection). Keys in use:

| Key | Shape | Default (absent or malformed) | Owner (web) | Written by |
| --- | --- | --- | --- | --- |
| `reader` | object | `reader/display-settings.json` (its own parse rules; not repeated here) | `features/reader/displaySettings.ts` | reader display options |
| `hiddenDictionaries` | array of dictionary ids | none hidden; only positive integers count, others are ignored, duplicates collapse; anything but an array hides nothing | `dictionaryVisibility.ts` | the dictionary visibility switches |
| `audioAutoplay` | boolean | `false` (anything but a boolean) | `audio/settings.ts` | audio settings |
| `audioDeviceVoice` | boolean | `true` (anything but a boolean) | `audio/settings.ts` | audio settings |
| `gradeHaptics` | boolean | `true` (anything but a boolean) | `native/haptics.ts` | Settings > Study > Feedback |
| `hints` | object: hint kind → card kind → `always` \| `hint` \| `never` | per cell the default of `cards/hints.json` (absent, unknown or invalid cells included) | `study/hints.ts` | Settings > Study > Hints (a cell at a time, by merge patch) |
| `visualAids` | object: aid (`pictures`, `toneColors`, `anatomy`) → boolean | each switch alone: `true` (absent, not a boolean, unknown members ignored); see `aids/visual-aids.json` | `aids/visualAids.ts` | Settings > Study > Visual aids (a switch at a time, by merge patch) |

Readers ignore keys they do not know, and a writer never removes them: clients change settings only by a
**merge patch**, never by writing the whole object. A restore remaps `hiddenDictionaries` (`backup/`).

**Merge** (`PUT /api/workspaces/{id}` `{"settings": patch}`; also `name`; at least one of the two; no other
member): the patch must be a JSON object and is merged into the stored object by RFC 7396 (SQLite
`json_patch`): a member replaces the stored value, a new member is added, a `null` member deletes its key, an
object value is merged recursively, an array or scalar value replaces. `{}` changes nothing (the stamp still
moves). The **merged** object (the bytes of its JSON text) may be at most 64 KiB (`maxSettingsBytes`): above
it the answer is 413 `too_large` and nothing changes; deleting keys in the same patch makes room. A
non-object patch, and `settings: null` without a name, are 400 `bad_request`. Unknown and foreign workspaces
are 404 `workspace_not_found`. The request body itself is at most 16 KiB (`maxWorkspaceBody`): above it the
answer is 413 `too_large` and nothing changes — a settings object larger than one request is built by several patches.

Before the merge the server decodes the patch into a JSON object and encodes it again (Go `map[string]any`):
members come out in alphabetical order, numbers pass through a 64-bit float (an integer above 2^53 loses
precision), and `<`, `>`, `&` are escaped as `\u003c`, `\u003e`, `\u0026` — six bytes each toward the 64 KiB cap.
Compare stored settings as JSON values, never as text.

## User-global keyed rows

All are keyed rows (`keyed/`) with `workspaceId: null` (one per user, shared by every device,
last write wins; `sync/`).

**`home-layout`** — `{"version": 1, "widgets": [widget id, ...]}`: the home widgets in order.

- Read (`parseLayout`): an object with an integer `version` ≥ 1 and an array `widgets`; entries that are not
  non-empty strings are dropped; a **newer version is read leniently** (its string ids count). Anything else
  (or no row) is no layout: the default `defaultLayout` (`activity-heatmap`, `flashcards-summary`,
  `daily-goal`, `weekly-summary`) applies. An empty list stays empty.
- Show (`resolveLayout`): stored ids in order, each once (first position wins), skipping ids that are
  unknown, unavailable (feature off, another language) or not on the surface. Skipped ids **stay stored**.
- Write (`serializeLayout`): always `version: 1` with the ids as given.
- Widget ids the web registry knows (`widgets`): `activity-heatmap`, `character-map-summary`, `daily-goal`,
  `summary-numbers`, `reviews-per-day`, `weekly-summary`, `flashcards-summary`, `word-states`, `reading-time`.

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

**`widget-options`** — `{"version": 1, "activity-heatmap": {"layout": "garden" | "month" | "week"}}`: options of
individual home widgets, one member per widget id. Today only the activity heatmap has one: its home layout
(Garden grid, Month calendar, This week; design §9 "Home"). No row = `garden`.

- Read (`parseWidgetOptions`): an object with an integer `version` ≥ 1; a **newer version is read leniently**
  (its `activity-heatmap.layout` counts when it is one of the three). A non-object row, a missing or
  non-integer `version`, a version below 1, an `activity-heatmap` that is not an object or an unknown layout
  reads as `garden`. Other members (top-level and inside `activity-heatmap`) are ignored for reading.
- Write (`withHeatmapLayout`): the stored object with only `activity-heatmap.layout` replaced. **Every other
  key is kept**, top-level and inside `activity-heatmap`; `version` is kept when it is an integer ≥ 1, else 1;
  a non-object row is replaced by a fresh version 1 row; an `activity-heatmap` that is not an object is
  replaced by `{"layout": …}`.
- Re-read before write (`saveHeatmapLayout`): a writer reads the row fresh (`find`) right before it `put`s, and
  applies its change to that copy, never to the copy it loaded with the page — so keys another device wrote
  meanwhile survive. Last write wins between two writes that race.
- Stats keeps the garden grid; the layout applies to the home page only (until #105 decides Stats).
- The server stores the row like any user-global keyed row (no code of its own); a restore brings it back
  unchanged.

Ruling: `widget-options` is a row of its own, not a member of `home-layout`, because the `home-layout` writer
rewrites the whole row (`serializeLayout`) and would drop added fields — cost: one more row per user.

Ruling: Android reads and writes `widget-options` the same way (lenient read, unknown keys kept, re-read before
write) — cost: none.

**`nav-layout`** — `{"version": 1, "phone": "bar" | "drawer", "bar": [section id, ...]}`: the phone frame's
navigation (below 720 px) and the sections pinned to its bottom bar, in order. Design:
`docs/superpowers/specs/2026-11-22-phone-bottom-bar-design.md` (issue #188). No row = `{phone: "bar", bar: ["home",
"flashcards", "reader", "search"]}`. Desktop and tablet widths ignore it. Section ids are the frame's
(`lib/frame/sections.ts`): `home`, `search`, a core feature's slug (`flashcards`, `reader`, `journal`,
`grammar`), `stats`.

- Read (`parseNavLayout`): an object with an integer `version` ≥ 1; a **newer version is read leniently** (its
  `phone` and `bar` count). A non-object row, or a missing, non-integer or below-1 `version`, is the defaults.
  `phone` other than `"bar"` or `"drawer"` (missing, unknown, not a string) is `"bar"`. `bar`: only non-empty
  strings count, each once (the first wins); a missing or non-list `bar` is the default pins; an empty list stays
  empty (every section under More).
- Show (`barItems`, the `items` cases): pins count when the section is visible; ids not visible (switched off,
  unknown) are **skipped and stay stored**, so they return in their place when the section does.
  At most **five items**: when all visible sections fit (five or fewer), all are shown — the pins in their order,
  then the others in frame order — and there is no More. Otherwise the first **four** visible pins, then **More**,
  whose rows are the remaining pins in their order, then the unpinned sections in frame order (Home first). The
  current item is the current section's, or More when the section is one of its rows, or none (Settings, Sources,
  the account pages).
- Write (`withNavLayout`): the stored object with only the changed members (`phone`, `bar`) replaced. **Every
  other key is kept**; `version` is kept when it is an integer ≥ 1 (so a newer version is never written back as
  1), else 1; a non-object row is replaced by a fresh version 1 row. A member not changed is not added (changing
  only `phone` on no row writes no `bar`, which keeps reading as the default pins). The written `bar` holds
  non-empty strings, each once.
- Re-read before write (`saveNavLayout`): like `widget-options`, a writer reads the row fresh (`find`) right
  before it `put`s. Last write wins between two writes that race.
- The server stores the row like any user-global keyed row (no code of its own); it syncs, and a restore brings
  it back unchanged.

Ruling: the five-item rule fills nothing: with more than five visible sections and fewer than four visible pins,
the bar shows those pins and More — cost: a person who unpins a lot gets a short bar (the editor's preview shows
it); filling the gaps would bring back a section the person just took out.

Ruling: Android reads and writes `nav-layout` the same way (its phone frame follows `phone` and `bar`; lenient
read, unknown keys kept, re-read before write) — cost: none.

**`appearance`** — the person's theme, accent and adjustments: a third user-global keyed row, specified
with the themes in [`themes/README.md`](../themes/README.md) ("The `appearance` row", fixture `themes/appearance.json`).
