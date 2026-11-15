# Feature plugin SDK — design (issue #39)

Status: Draft for review (2026-11-15). Written unattended under the owner's rule "licensing first, then
the best experience for the user even at higher development cost"; every call is a **Ruling** below
and can be overruled. Nothing is built. The core statistics design
(`2026-11-15-core-stats-design.md`, issue #48) builds on this one.

## Intent and why

The platform's core value is that the owner can add a widget, a page or a behaviour without touching
core code (`2026-11-10-chinese-learning-platform-design.md`, "Feature plugins"). Today a feature plugin
is a TypeScript manifest (`apps/web/src/lib/plugins/<p>/manifest.ts`) with `surfaces`, `sources` and
`widgets`, plus a **second, hand-copied** JSON manifest in `server/cmd/qinqin/main.go` that the server
stores verbatim after checking only `id`. Nothing declares what a plugin may do, nothing checks a
manifest, and the activity a plugin produces is a hard-coded list in core (`ACTIVITY_SOURCES`). The
Android host (#38) will need the same contract. This design makes the contract explicit, checked and
single-sourced, so #48 can let plugins contribute activity without core changes.

## Goals

- One canonical manifest per built-in plugin, read by both the Go server and the web build.
- Manifest fields `sdk` (contract version), `surfaces`, `permissions`, `hooks` and `events` (the event
  types a plugin emits, each with an optional activity rule; the rule itself is specified by #48).
- Server-side validation at registration (start-up and `POST /api/admin/plugins`), with error messages
  that name each problem.
- Server-side enforcement where the server can tell which plugin is involved: writes of plugin data.
- A documented web SDK (`createPluginSdk`) over the plugin-data and events APIs, scoped by workspace
  and checked against the manifest's permissions; the journal plugin migrates to it as the reference.
- One behaviour hook, `study-event`, dispatched by the web host.
- Settings → Plugins shows what each plugin may do and flags plugins this app build cannot run.

## Non-goals

- Runtime-loaded or third-party plugin code, sandboxing, iframes. Plugins stay compile-time modules the
  owner maintains (platform design, "Compile-time plugin registry (CHOSEN)").
- An entries/lookup wrapper or navigation helpers in the SDK (plugins keep using `$lib/api/*` and
  `goto`). `read:entries` is declared and shown, not wrapped.
- Migrating flashcards and reader to the SDK (follow-up issue; their manifests are made accurate now).
- Data plugins (dictionary, levels, frequency, sentences packs): unchanged.

## Anti-goals

- Losing user data. No study event or offline-queued plugin-data row that the server accepts today may
  be refused after an upgrade because of the new checks.
- A permission model that pretends to be security. All plugin code runs in one trusted bundle; the
  permissions are a contract the SDK and server check to catch mistakes and to tell the user.

## Approaches

1. **Canonical JSON next to the server, imported by the web build (CHOSEN).** `server/internal/plugins/
   builtin/<slug>.json` is embedded by Go (`//go:embed`) and imported by the web manifests through a
   `$builtin` alias. One copy; the server validates it on every start. Cost: a Dockerfile line (the web
   stage copies that directory) and a Vite `fs.allow` entry.
2. **TypeScript manifests stay the source, Go constants copied, a drift test compares them.** Cheaper
   today, but #48 puts scoring rules in the manifest, and two copies of rules in two languages drift.
3. **Runtime plugin bundles served by the server with enforced, sandboxed permissions.** The
   platform design defers this; nothing the owner needs requires it. Rejected (YAGNI).

## Design

### Manifest contract (sdk 1)

```jsonc
// server/internal/plugins/builtin/journal.json
{
  "id": "qinqin-journal",          // ^[a-z0-9]+(-[a-z0-9]+)*$, at most 64 chars
  "name": "Journal",               // 1..80 chars
  "version": "1.1",                // ^\d+\.\d+(\.\d+)?$  (the plugin's own version)
  "type": "feature",               // must be "feature"
  "sdk": 1,                        // contract version; the host accepts SDKMin..SDKMax = 1..1
  "description": "Dated entries…", // optional, at most 200 chars
  "surfaces": ["page"],            // subset of: home-widget, page, hook; no duplicates
  "permissions": ["owns-data", "write:study-events"],
  "hooks": [],                     // subset of: study-event; non-empty exactly when "hook" is a surface
  "events": [{ "type": "journal", "activity": { /* #48 rule */ } }]
}
```

- **Permissions** (closed list): `owns-data` (keep plugin data rows), `read:entries` (dictionary entries,
  lookup, search), `read:study-events` (the user's event log, every type), `write:study-events` (post
  events of the types the plugin declares).
- **Events**: each `type` matches `^[a-z][a-z0-9-]*$`, is unique within the manifest and is owned by
  exactly one registered plugin. A non-empty `events` list requires `write:study-events`. `activity`
  is optional; this design accepts it as any JSON object, and the #48 design (built after this one,
  on the same branch) replaces that with its typed rule and checks.
- Unknown top-level fields are rejected (`json.Decoder.DisallowUnknownFields`), so a misspelt
  `permision` fails loudly instead of being ignored.

Built-in manifests after this change:

| id | surfaces | permissions | hooks | events |
|---|---|---|---|---|
| qinqin-core | — | owns-data, write:study-events | — | session, view, lookup (no activity) |
| qinqin-flashcards | home-widget | owns-data, read:entries, read:study-events, write:study-events | — | review |
| qinqin-reader | page, home-widget | read:entries, read:study-events, write:study-events | — | read |
| qinqin-journal | page | owns-data, write:study-events | — | journal |

The reader gains `home-widget` (it already ships the reading-time widget). All four move to version
`1.1`, the first version with `sdk`.

### Server

- `plugins.ParseManifest(raw []byte) (Manifest, error)` decodes strictly and validates; every problem
  goes into one `ErrInvalidManifest`-wrapped error, e.g. `plugins: invalid manifest: permissions[1]
  "write:events" is unknown; hooks must be empty without the "hook" surface`.
- `plugins.Register` parses first, then, inside one transaction, rejects an event type already owned by
  another registered plugin (other rows that fail to parse are ignored for this check), then upserts
  the row verbatim. `POST /api/admin/plugins` answers 400 with the error text.
- `plugins.Builtin() [][]byte` returns the embedded files in a fixed order (core, flashcards, reader,
  journal); `registerBuiltinPlugins` in `main.go` registers them with `plugins.RegisterBuiltin` and
  keeps unregistering the retired `qinqin-heatmap`. A start-up failure (a built-in file that does not
  parse) stays fatal, as today.
- **Ruling: built-ins win event-type conflicts — `RegisterBuiltin` skips the ownership check and returns
  the ids of other rows that claim one of its types, which `main.go` logs as a warning; anything that
  maps types to plugins (the #48 `ActivityRules`) prefers the built-in owner — why: an admin row must
  never stop the server from starting — cost if wrong: an admin plugin's duplicate claim is silently
  shadowed (the log says so).**
- **Legacy rows.** A registry row whose manifest has no `sdk` (admin-registered before this change) is
  served as before. **Ruling: such rows are grandfathered — write checks treat them as before — why:
  the anti-goal on data loss — cost if wrong: an old admin row keeps writing data without declaring
  it; re-registering it fixes that.**
- `plugins.CanWriteData(ctx, db, id) (exists, allowed bool, err error)`: allowed for data plugins and
  grandfathered rows, and for an sdk ≥ 1 manifest only when it declares `owns-data`. Used by `PUT`/`DELETE
  /api/plugins/{id}/data/{key}` (403 `plugin does not declare owns-data`) and by `sync.Push`. Reads stay
  as they are.
- **Ruling: in `sync.Push` a refused row is skipped, not fatal — the push applies its events and every
  other row, and `PushResult` gains `dataRefused int` (JSON `dataRefused`) next to `dataSkipped`;
  unknown plugins and foreign workspaces keep failing the whole push as today — why: the anti-goal (one
  stale row must not take an offline batch's events with it) — cost if wrong: a client must read one
  more counter; Android (#38) handles it from the start.**
- `GET /api/plugins` keeps serving manifests verbatim, so clients see `permissions`, `hooks`, `events`.
- **Ruling: `POST /api/events/batch` and `sync.Push` keep accepting any event type — why: the log is
  append-only and an offline Android queue must never be refused after an upgrade; unknown types simply
  count for nothing in statistics — cost if wrong: junk types can be stored; a later cleanup can
  ignore them, nothing reads them.**

### Web

- `lib/plugins/contract.ts`: `SDK_VERSION = 1`, the closed lists `SURFACES`, `PERMISSIONS`, `HOOKS`,
  the type `ContractManifest` (mirrors the JSON), `PERMISSION_LABELS` (plain words, below) and
  `sdkSupported(manifest: unknown): boolean`.
- `PluginManifest = ContractManifest & { sources?; widgets? }`. Each `manifest.ts` spreads its JSON:
  `{ ...(journalJson as ContractManifest), sources: [...] }`. The `$builtin` alias
  (`svelte.config.js` `kit.alias`) points at `../../server/internal/plugins/builtin`; `vite.config.ts`
  allows that directory in `server.fs.allow`; the Dockerfile web stage copies it.
- A unit test checks every web plugin: `'page' ∈ surfaces ⇔ pages non-empty`, `'home-widget' ∈ surfaces
  ⇔ widgets non-empty`, and each `EventType` literal in `lib/events.ts` is declared by exactly one
  built-in manifest. (`hook` ⇔ `hooks` is the server's check; `onStudyEvent` enforces it at runtime.)

### The SDK

```ts
// apps/web/src/lib/plugins/sdk.ts
export class PermissionError extends Error {}           // message names the plugin and the permission
export interface DataRow<T = unknown> { key: string; data: T; version: number; updatedAt: string }
export interface DataScope {
  get<T = unknown>(key: string): Promise<T | null>;     // 404 or tombstone → null; string data JSON-decoded
  put(key: string, value: unknown, opts?: { keepalive?: boolean }): Promise<void>;
  list<T = unknown>(prefix?: string): Promise<DataRow<T>[]>;  // the prefix route, ordered by key
  delete(key: string): Promise<void>;                   // a missing row counts as deleted
}
export interface PluginSdk {
  readonly id: string;
  data: { user(): DataScope; workspace(id: number): DataScope };        // needs owns-data
  events: {
    list(opts: { workspace?: number; since?: string; types?: string[] }): Promise<StudyEvent[]>; // needs read:study-events
    record(type: string, workspace: number, payload?: unknown, at?: Date): Promise<void>;     // needs write:study-events
  };                                                     // and a type the manifest declares; rejects on failure
  onStudyEvent(handler: (events: StudyEventBody[]) => void): () => void;                       // needs the study-event hook
}
export function createPluginSdk(manifest: ContractManifest): PluginSdk;
```

- Checks run when the call is made and throw `PermissionError` synchronously from the accessor
  (`sdk.data.user()` without `owns-data` throws), so a missing declaration fails the first test.
- `events.list` without `workspace` spans every workspace (the server's combined read); `types` is
  filtered client-side. `events.record` builds the ULID body like `lib/events.ts` and goes through
  `postEvents`, so caches and hooks see it.
- `qinqin-core` uses the SDK for its own rows too (`lib/widgets/layout.ts` moves onto
  `createPluginSdk(coreManifest).data.user()`), replacing `lib/api/pluginData.ts`.

### Behaviour hook `study-event`

- `lib/plugins/hooks.ts`: `emitStudyEvents(events)` is called by `postEvents` after a successful POST;
  it calls every handler registered through `sdk.onStudyEvent` whose plugin is enabled (the host sets
  the enabled set with `setHookStates(states)` from the plugin-states store) and catches and logs each
  handler's error, so one plugin cannot break recording.
- Core keeps `onEventLogChange` for its caches; its hard-coded `LOG_CHANGING_TYPES` becomes "every event
  type declared by a built-in manifest other than `qinqin-core`" (`logChangingTypes()` in
  `contract.ts`; today `review`, `read`, `journal`, the same set). This works before #48 adds rules.
- **Ruling: ship exactly one hook, with no built-in plugin subscribing yet — why: #39 asks for the
  behaviour surface and the future SRS/achievement work needs it; one hook keeps the contract small —
  cost if wrong: a little unused code (about 40 lines plus tests).**

### Settings → Plugins

Each feature plugin row gets a muted line from `PERMISSION_LABELS`: "Stores its own data · Reads
dictionary entries · Reads your study history · Records study activity". A registry plugin with no web
module, or whose `sdk` is not supported, shows "Needs an app update" and its toggle stays usable (the
state syncs to other clients). Data plugins and `qinqin-core` are unchanged.

## Rulings

- Ruling: canonical JSON under `server/internal/plugins/builtin/`, imported by the web — one copy of
  rules that both sides execute — cost if wrong: moving four files and an alias.
- Ruling: `sdk` is a single integer and the host accepts a range (1..1) — semver ranges are overkill
  for compile-time plugins — cost if wrong: adding a minimum-minor field later.
- Ruling: four permissions only, no per-plugin cross-data grants — the reader writing flashcards cards
  goes through flashcards' own module (`$lib/study/cardFlow`), not through the SDK — cost if wrong: a
  `write:plugin-data:<id>` permission later.
- Ruling: unknown manifest fields are rejected — catches typos in the one place manifests are checked —
  cost if wrong: an admin manifest with extra fields is refused with a clear message.
- Ruling: write enforcement only (data PUT/DELETE, sync push); reads and event types are not enforced
  server-side — the server cannot attribute a request to a plugin and must not refuse queued data —
  cost if wrong: none for built-ins.
- Ruling: only the journal migrates to the SDK — it is the newest plugin and has the cleanest data layer;
  flashcards' store is large and well tested — cost if wrong: a follow-up issue for flashcards/reader.
- Ruling: event types are owned per plugin and the core owns `session`, `view`, `lookup` — #48 can then
  attribute every type to a plugin — cost if wrong: renaming a manifest entry.

## Tests and verification

- Go: `ParseManifest` table test (each rule, each error message, the four built-in files valid), type
  ownership conflict, built-ins winning a conflict, grandfathered row, `CanWriteData` matrix, 403 on
  the data routes, a sync push that skips a refused row and still applies its events, admin route 400 text, start-up registration of the embedded files.
- Web: `contract.ts`, `sdk.ts` (each permission, scopes, 404 → null, string decoding, record → hooks),
  `hooks.ts` (disabled plugin not called, a throwing handler isolated), the manifest consistency test,
  the journal store tests passing unchanged in behaviour.
- Real app: journal works end to end (write, list, delete, heatmap point), home layout saves, Settings
  shows the permission lines, and an admin `POST` of a bad manifest answers 400 with the reasons.

## Left to the builder

Exact error wording beyond the examples; whether `ParseManifest` lives in `manifest.go` or
`plugins.go`; the label text of permissions (keep it short and plain).
