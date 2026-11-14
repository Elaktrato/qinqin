# Stats page and home widgets — design

Status: Draft for review (2026-11-14). Nothing built yet. Requested by the owner; open points are listed at the end.

## Intent

Add a **Stats** area to the core app that shows how the user is learning, and make every piece of it a **widget** the user can also put on their **home page**, chosen and ordered in a new Settings tab. The character **map** moves into Stats and only exists for languages written with Han characters (Chinese, Japanese).

## What the owner decided

- The home layout is stored **per user, on the server**, so every device (web now, mobile later) shares it. One layout for all workspaces; a widget that does not apply to the current language hides itself.
- Stats are for the **active workspace only**. No all-languages tab.
- The map's home widget is a **compact summary tile** (learned N of M, stage bar, link to the full map). The full map lives only in Stats.
- Words are broken down as **New / Learning / Young / Mature**, derived from the flashcard schedule. "Unlearned" means the New cards still waiting in the user's decks.
- Widgets come from plugins where a plugin owns the data (flashcards, reader); the widgets of an uninstalled or disabled plugin do not exist.

## Rulings made while writing this (overrule in review)

1. **Stats is its own top-level nav item** ("Stats", with an icon) replacing the "Map" link. Stats has two views: **Overview** (the widgets, all of those that apply) and **Characters** (the full map, only for Han languages; hidden otherwise, including its tab). `/study/map` redirects to `/stats/characters`; for a non-Han workspace it shows the existing "not for this language" note.
2. **Overview shows every applicable widget** in a fixed order (core first, then plugins in plugin order). Only the **home page** is user-arranged.
3. **Today's home becomes the default layout**: `[activity-heatmap, flashcards-summary]`, so nobody sees a change until they edit it. Widgets are enabled by being in the layout.
4. **Plugin enable/disable stays the master switch**: a disabled plugin's widgets are unavailable everywhere and are dropped from the layout when rendering (the stored layout keeps them, so re-enabling restores them). The per-plugin "order" number stops affecting the home page; it remains in the Plugins list for now and is documented as legacy.
5. **Reading time is derived from the existing `read` events** (per workspace), like the heatmap. Totals, last 7 and 30 days, per-book top list. Note the reader credits a reading burst only when it was at least 30 s, so very short visits are not counted; the widget says "tracked reading time".
6. **Word states come from the merged flashcard data** (`loadStudyData`, duplicates already merged) and FSRS stability: New = never reviewed; Learning = learning/relearning state; Young = in review with stability under 21 days; Mature = 21 days or more (the same 21-day edge the Word Salad tiers use). Overall and per deck.
7. **Layout storage = user-global plugin data** (the table already supports rows with no workspace) under a new built-in core plugin id `qinqin-core`, key `home-layout`, value `{ "version": 1, "widgets": ["activity-heatmap", "flashcards-summary"] }`. Reusing plugin data means sync (`/api/sync`) and last-write-wins already work and the mobile client gets it for free. A missing row means the default layout.
8. **Widget sizes**: `normal` (one column cell) or `wide` (spans the row). Sizes are fixed per widget, not user-chosen, in v1.
9. **No new server endpoints** for stats in v1: everything is computed in the browser from data the app already loads (events, flashcard plugin data, characters, library). If the event log becomes large enough to hurt, a server-side summary endpoint is a follow-up (noted below).

## Architecture

### Widget registry (web)

New module `apps/web/src/lib/widgets/`:

```ts
export interface WidgetDef {
  id: string;                      // stable, e.g. 'activity-heatmap'
  title: string;                   // shown in Stats and Settings
  description: string;             // one line, shown in the Settings picker
  owner: 'core' | string;          // plugin id for plugin widgets
  size: 'normal' | 'wide';
  /** Show only for these languages; omitted = all. e.g. usesHan for the map. */
  appliesTo?: (language: string) => boolean;
  /** Where it can render. 'stats' always; 'home' marks it selectable for the home page. */
  surfaces: ('stats' | 'home')[];
  component: Component;            // Svelte component, no props (reads the workspace store)
  /** Optional compact variant used on the home page when the stats version is large. */
  homeComponent?: Component;
}
```

- Core widgets are declared in `lib/widgets/core.ts`; plugin widgets in the plugin manifest (`PluginManifest.widgets?: WidgetDef[]` next to the existing `sources`), collected by one `allWidgets(webPlugins, pluginStates, language)` function that applies the plugin-enabled and `appliesTo` filters. Pure and unit-tested.
- Every widget component must handle: no workspace selected, loading, error with retry, empty state. A shared `WidgetCard` wrapper gives the title, the frame and the states.

### Widgets in v1

| id | owner | Stats | Home | Notes |
|---|---|---|---|---|
| `activity-heatmap` | core | wide | wide | the existing `ActivityHeatmap` |
| `flashcards-summary` | flashcards | normal | normal | the existing flashcards widget (due, new, level, XP, streak, mascot) |
| `word-states` | flashcards | normal | normal | New/Learning/Young/Mature counts + stacked bar, per-deck table on Stats |
| `reading-time` | reader | normal | normal | tracked reading time: total, 7 days, 30 days, top books |
| `character-map-summary` | core | normal | normal | "N of M learned", stage bar, link; `appliesTo: usesHan`; the full map is the Characters view, not a widget |

Future stats = add a `WidgetDef`. The flashcards plugin supplies its two widgets only while it is installed and enabled.

### Layout store

`lib/widgets/layout.ts`: `loadLayout()`, `saveLayout(ids)`, `defaultLayout`, `resolveLayout(layout, available)` (drops unknown/unavailable ids, de-duplicates, keeps order). Reads/writes the user-global plugin data row; saves are optimistic with rollback and a visible error, like the bookmark store; two tabs: last write wins.

### Pages

- **Home (`/`)**: search box, then the user's layout rendered in a responsive grid (one column on phones, two from ~900 px; `wide` spans). Empty layout shows a hint linking to Settings → Home.
- **Stats (`/stats`)**: header with the two views (a tablist: Overview, Characters). Overview renders every available widget in the fixed order. The Characters view is the current map page, moved (`/stats/characters`), keeping all its behaviour (group-by, sections, search); `/study/map` redirects.
- **Settings**: the page becomes **tabs**: Workspaces, Home, Plugins (existing sections unchanged, moved into tabs, deep-linkable `?tab=home`). **Home** tab: the list of available widgets with an "On home page" toggle, **Move up / Move down** buttons (keyboard accessible, with live announcements) and drag to reorder as an enhancement, a preview order, "Reset to default". Saves immediately with the optimistic store.

### Navigation

Nav gets **Stats** (icon: bar chart) in place of **Map**; the Map link logic (`usesHan`) moves into the Stats Characters tab. The header 'Map' removal is mentioned in README. `/study` page's link to the map becomes a link to Stats → Characters.

## Data and API

- Server: register a built-in `qinqin-core` plugin (feature type, no surfaces) at start-up like the flashcards and reader manifests so its user-global data rows are accepted by the existing plugin-data endpoints; add its manifest constant and a registration test. No migration.
- Web types: `PluginManifest.widgets`.

## Tests and verification

- Pure units: `allWidgets` filtering (plugin disabled, language, duplicates), `resolveLayout`, layout (de)serialisation incl. corrupt values, word-state classification (boundaries 0/20.9/21 days, relearning, new), reading-time aggregation (day boundaries UTC, per-book, bursts, empty), the move up/down helper.
- Real-app checks (headless browser, 1280 and 390 px, light and dark): default home unchanged; add/remove/reorder widgets in Settings and see them on home after reload and on a second browser context (same user); disabling the flashcards plugin hides its widgets; Spanish workspace shows no map tile and no Characters tab; `/study/map` redirect; keyboard operation of the layout editor.

## Phasing

1. Registry, layout store, `qinqin-core` registration; wrap existing heatmap and flashcards widgets; home renders from the layout (behaviour unchanged by default).
2. Stats page (Overview + Characters move + nav + redirect).
3. New widgets: word states, reading time, map summary tile.
4. Settings tabs and the Home editor.
5. Docs, review, one fix wave.

## Open points and follow-ups

- Per-workspace layouts were deliberately not chosen; revisit if a single layout feels wrong across languages.
- Server-side stats summary endpoint if the event log makes the client-side totals slow (reading time and the activity heatmap read the event log; the heatmap already bounds its fetch to 91 days, reading time all-time totals need the full log).
- User-chosen widget sizes and widget settings (e.g. the heatmap window) are out of scope for v1.
- Widgets for other future plugins (journal, grammar) use the same `widgets` manifest field.
