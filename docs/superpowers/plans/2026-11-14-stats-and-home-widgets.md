# Stats page and home widgets — implementation plan

**Spec (binding):** `docs/superpowers/specs/2026-11-14-stats-and-home-widgets-design.md` (owner approved 2026-11-14, including the rulings in it). Branch `feature/stats` (worktree `.claude/worktrees/stats`), cut from develop 545bb17.

## Global constraints

- Work only in `/home/user/www/github/qinqin/.claude/worktrees/stats`; never touch `/home/user/www/github/qinqin` or other worktrees/branches. Plain single git commands (no compound shell commands, no command substitution with git); explicit `git add <paths>`; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; no push/merge (the controller pushes/merges).
- No new dependencies. Go is not installed locally: gates via `docker run --rm -v <worktree>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.23 sh -c "go vet ./... && go test ./..."` (+ `-race` for touched packages; check `git status` for root-owned artefacts you created). Web gates: `npm --prefix <worktree>/apps/web run check|test|build` (absolute path; `npm ci` first if node_modules is missing; one build at a time). Node is 26: `node scripts/check-sources.mjs` and `node --test scripts/*.test.mjs` must keep passing.
- TDD for pure logic. UI has no component tests: keep logic in pure modules. Accessibility: keyboard operable, labelled controls, live regions only for state announcements, works at 390 px, light/dark.
- Real-app checks use playwright-core 1.52 in the scratchpad `pw` dir under `/tmp/claude-1000/-home-user-www-github-qinqin--claude-worktrees-feature-reader/1d3c08e8-dc56-419d-b83b-906f4b7d5053/scratchpad/` (Chromium headless shell 1161), a server built from a scratchpad copy of the committed tree with the web build embedded (see earlier reports in that scratchpad for the recipe), seeded data copied from a scratch dir (e.g. `sources-t1/data`), a free port (check `ss`), 127.0.0.1 only, never 8080/localhost; kill what you start; read the screenshots.
- HSK syllabus files must never enter the repo (hard rule from earlier work).

## Interfaces fixed up front (all tasks code against these)

```ts
// apps/web/src/lib/widgets/types.ts
export interface WidgetDef {
  id: string; title: string; description: string;
  owner: 'core' | string;                 // plugin id for plugin widgets (e.g. 'qinqin-flashcards')
  size: 'normal' | 'wide';
  appliesTo?: (language: string) => boolean;
  surfaces: ('stats' | 'home')[];
  component: Component;                   // reads the workspace store itself
  homeComponent?: Component;              // compact variant for the home page
}
// PluginManifest (apps/web/src/lib/plugins/index.ts) gains: widgets?: WidgetDef[]
// apps/web/src/lib/widgets/registry.ts
export function allWidgets(plugins: WebPlugin[], states: PluginInfo[], language: string | null): WidgetDef[]   // core widgets first, then plugin widgets in webPlugins order; drops widgets of disabled/unknown plugins; applies appliesTo(language) when language is set (null language = no filter)
// apps/web/src/lib/widgets/layout.ts
export const DEFAULT_LAYOUT = ['activity-heatmap', 'flashcards-summary'];
export function resolveLayout(stored: string[] | null, available: WidgetDef[], surface: 'home'): WidgetDef[]   // unknown/unavailable ids dropped, duplicates removed, order kept; stored null -> DEFAULT_LAYOUT
export function loadLayout(): Promise<string[] | null>; export function saveLayout(ids: string[]): Promise<void>   // user-global plugin data row (workspace NULL), plugin id 'qinqin-core', key 'home-layout', value {"version":1,"widgets":[...]}
```

## Tasks

**T1 — registry, layout store, server registration, home from layout** (opus)
Server: register the built-in plugin `qinqin-core` (`{"id":"qinqin-core","name":"Core","version":"1.0","type":"feature","surfaces":[]}`) in `registerBuiltinPlugins` (server/cmd/qinqin/main.go) with a registration test; confirm user-global plugin-data PUT/GET/sync work for it (add a test that writes and reads the `home-layout` row with no workspace and that sync pull returns it). Web: `lib/widgets/{types,registry,layout}.ts` + tests (filtering by plugin enabled state via `pluginState`, language predicates, ordering, `resolveLayout` edge cases, corrupt stored values, default layout); `WidgetCard.svelte` wrapper (title, loading/error/empty states); register the two existing widgets: `activity-heatmap` (core, wide; existing `ActivityHeatmap.svelte`) and `flashcards-summary` (owner `qinqin-flashcards`, in the flashcards manifest `widgets`; existing `FlashcardsWidget.svelte`, wrap/refactor minimally so its look is unchanged); `PluginManifest.widgets`; the home page renders `resolveLayout(loadedLayout, allWidgets(...), 'home')` in a responsive grid (1 column on phones, 2 from ~900 px; `wide` spans); default behaviour must be pixel-equivalent in content to today's home (heatmap, then flashcards widget); empty layout → hint with a link to /settings?tab=home; loading/error handling for the layout fetch (fall back to the default layout on error, quietly). Remove the old per-plugin-order dependence from the home page (`homeWidgets`), keep the function only if still used elsewhere. Commits: `feat(widgets): registry and layout store`, `feat(web): the home page renders the user's widget layout`.

**T2 — Stats page, nav, map move** (opus; after T1)
`/stats` with a tablist: Overview (renders every widget with `surfaces` including 'stats' that is available, fixed order; wide widgets span) and Characters (the current map page content moved to `/stats/characters`, hidden tab/not reachable for non-Han languages: direct visit shows the existing 'not for this language' note with a link to Overview); `/study/map` redirects (replace history entry) to `/stats/characters`; nav: replace the Map item with **Stats** (bar-chart icon in `NavIcon`, keep the bottom tab bar behaviour) — the nav item shows for every workspace; update `routeAccess`, `/study` page links to the map, README/docs mentions of the Map page and nav; keep all map behaviour/tests intact (move files with `git mv`, keep history). A11y: tablist with arrow keys, `aria-selected`, panels labelled. Commits: `feat(web): Stats page with Overview and Characters`, `refactor: the map moves under Stats`.

**T3 — new widgets** (opus; parallel with T2 after T1; touches only new files under `lib/widgets/*`, `lib/stats/*`, the two plugin manifests, and `lib/widgets/core.ts`)
- `word-states` (flashcards, normal): pure `lib/stats/wordStates.ts` (`classifyCard`, `wordStateCounts(cards, reviews, now)` per deck and overall; New = never reviewed; Learning = learning/relearning; Young = review state, stability < 21 days; Mature ≥ 21 days; uses the merged data from `loadStudyData`, the existing scheduler for stability: read `lib/study/scheduler.ts`/`mastery.ts` for the FSRS state/stability helpers) + tests; component: stacked bar + counts, 'N new cards waiting in your decks', per-deck table on Stats (home variant: overall only).
- `reading-time` (reader, normal): pure `lib/stats/readingTime.ts` (from `read` events: total tracked seconds, last 7 and 30 UTC days, top books with titles from the library list API, formatting helpers `formatDuration`) + tests incl. UTC boundaries, missing/invalid seconds (reuse the clamping rules of `readingPoints` in `lib/activity/activity.ts`), empty; component with total, 7/30 days and top 5 books; event fetch for the workspace (all history; note the cost in a comment).
- `character-map-summary` (core, normal, `appliesTo: usesHan`): reuses the map's data loading/mastery (`lib/study/charGroups.ts`, `mastery.ts`, `fetchCharacters`) to show 'N of M learned', the stage bar and a link to `/stats/characters`; load lazily and cache so Home does not fetch 13k characters needlessly twice; handles stale/`dataGap` gracefully. 
Register them in `lib/widgets/core.ts` and the plugin manifests. Commits per widget.

**T4 — Settings tabs and the Home layout editor** (opus; after T1; parallel-safe with T2/T3 except the shared README)
Settings becomes a tablist (Workspaces, Home, Plugins; existing sections moved unchanged; `?tab=` deep link, remembers nothing else); Home tab: list of available widgets (from `allWidgets` for the active workspace's language... note: show all widgets of enabled plugins regardless of language but mark 'not available for this language' ones as disabled-with-reason), toggle 'On home page', Move up/Move down buttons with live-region announcements, optional drag-and-drop reorder (pointer events; keyboard path must remain complete), live preview order, Reset to default; optimistic save through the layout store with error + retry; pure helpers (`moveWidget`, `toggleWidget`) with tests. Commits: `feat(web): Settings tabs`, `feat(web): home layout editor`.

**T5 — review and fix wave** (me): independent read-only review (opus/fable), real-app checks per the spec, one fix wave, docs (README sections for Stats/widgets/Settings Home tab, `docs/` mentions, `docs/sources.md` untouched unless credits change), final gates, merge per the owner's standing pattern.

## Order

T1 → (T2 ∥ T3 ∥ T4) → T5. T2/T3/T4 each rebase onto T1's commits (they start from the branch tip after T1) and must avoid editing each other's files; shared files (`README.md`, `lib/plugins/index.ts`, plugin manifests) are edited in small, re-read-before-edit hunks.
