# #295 — Stats becomes a feature a learner can switch off (2026-11-27)

Milestone v0.9.0, phase 2 (settings and small study changes). Branch `feature/v090-295-stats-feature`, after #294
(migration 055: `feature_switches` has no list of ids, `features.IDs` is the only one, so no migration is needed).

## What

Stats is a fixed frame section today (`lib/frame/sections.ts`). It becomes the sixth core feature `stats`, on by
default, with a switch in Settings → Features. Switched off, the client hides the Stats section (top bar, drawer,
bottom bar and its More sheet), the `/stats` pages (a direct link shows the usual "switched off" notice with a link
to Settings → Features), the stats widgets on Home and their entries in the widget editor, and the links into the
Stats pages from other screens. The server keeps counting; nothing is deleted.

## Tasks

1. This plan.
2. The feature id: `stats` in `features.IDs`, `docs/contracts/features/switches.json` (six ids) and its README
   (what Stats off hides and what stays), ContractVersion 17 with a CHANGELOG entry; the web registry
   (`lib/features/index.ts`, `lib/stats/manifest.ts`), its title and switched-off message. Tests first: the
   Go and web contract tests against the six-id fixture, the Go route test's list.
3. The widgets: the Stats widgets move from the core list into the Stats feature's definition (owner `stats`); a
   widget can name other features it needs (`WidgetDef.requires`), and the word-states widget (flashcards') needs
   Stats too. The widget editor names the switched-off feature of a parked widget. Tests first: registry, Home
   layout, editor.
4. The pages and the frame: a `FeatureGate` (the switched-off notice, shared with `FeaturePage`) around the Stats
   layout; the Stats section joins the frame only while the switch is on; the links into Stats from the weekly
   widget, the milestone card, the reader's display panel and Advanced study settings hide while Stats is off.
   Tests first: sections, the Stats layout while off, the links.
5. Docs: wiki (Finding your way, Settings tour, Stats and heatmap, Core data API, API reference, Weekly summary,
   Milestones where needed), record 0006, `docs/releases/NEXT.md`, the Settings → Features hint.
6. e2e: a learner switches Stats off: no Stats in the bar or the More sheet, `/stats` and `/stats/week` show the
   notice, Home shows no heatmap; switched on again, it is back.

## What Stats off hides, and what stays (recorded in the contract README)

Hidden: the Stats section and its pages `/stats`, `/stats/week`, `/stats/characters`; the widgets
`activity-heatmap`, `reviews-per-day`, `character-map-summary`, `summary-numbers` (owned by Stats) and
`word-states` (flashcards', needs Stats too), on Home and in the widget editor; the links into the Stats pages
(weekly widget "More", milestone card "See all", the reader's "What is the score?", Advanced study's mastery map).

Stays: streaks, EXP and the daily goal where other features show them (the flashcards widget, the study session,
the daily-goal widget), the weekly-summary widget, the milestone cards on Home, the other features' widgets
(flashcards summary, reading time, scripts progress), the weekly summary notification and every event.

## Rulings

- Ruling: the four core statistics widgets (`activity-heatmap`, `reviews-per-day`, `character-map-summary`,
  `summary-numbers`) move from `lib/widgets/core.ts` to the Stats feature's definition with owner `stats`; their
  components stay in `lib/widgets/` — the registry already shows a feature's widgets only while it is on, so the
  gating needs no new rule, and moving the components would only churn files the #290 builder touches — cost if
  wrong: while the switches load, or when they fail to load, Home shows no heatmap (as with every feature widget).
- Ruling: `word-states` stays a flashcards widget and gains `requires: ['stats']` (a new optional
  `WidgetDef.requires`: other features that must be on too) — its numbers are the flashcards schedule, so it must
  also hide with flashcards off, and the issue lists it as a Stats widget — cost if wrong: one field more on
  `WidgetDef`.
- Ruling: the flashcards summary, reading time and scripts progress widgets stay on Home with Stats off — they belong
  to their features (streak and EXP stay with study, issue) and are not in the issue's list — cost if wrong: a learner
  who wants no numbers at all also takes them off Home in Settings → Home.
- Ruling: the weekly summary widget and the milestone cards stay; their links into `/stats/week` hide while Stats is
  off — the week page is a Stats page and would only answer "switched off" — cost if wrong: with Stats off there is no
  full week view and no full milestone list; switching Stats on brings both back.
- Ruling: a link into Stats hides only when the switch is known to be off (loaded and off); while loading or after a
  failed load it shows, and the page itself then says what it knows — no link flickers in and out on every page load
  — cost if wrong: a link may be shown in the moment before the switches load.
- Ruling: the weekly-summary notification still opens `/stats/week` — it is the weekly summary's own switch, and the
  page tells a learner with Stats off how to switch it on — cost if wrong: one extra tap to Settings.
- Ruling: `CoreFeature.component` becomes optional; Stats has none, because its pages are routes of their own
  (`/stats`, `/stats/week`, `/stats/characters`) whose layout is wrapped in `FeatureGate`. `FeaturePage` becomes
  `FeatureGate` + the feature's component — one notice for every feature, and the Stats routes keep their URLs —
  cost if wrong: none for users.
- Ruling: the Stats code stays in `lib/stats/` (a feature folder of record 0004 already) and its routes in
  `routes/stats/`; its manifest is `lib/stats/manifest.ts`, not a new `lib/features/stats/` — one folder for Stats,
  and moving it is churn without a user-visible change — cost if wrong: a later move.
- Ruling: the Stats section's place does not change: last in the frame, after the features, as the feature order
  puts it last — cost if wrong: none. Before the switches load, only Search shows (Stats now waits like every
  feature, so a switched-off Stats never flashes in).
- Ruling: Stats applies to every language (no `appliesTo`); the Characters tab keeps its own Han-only rule.
- Ruling: contract version 17 (16 on the base; the orchestrator renumbers on merge).

## Execution record

- Task 2 (`feat(features)`): test-first. The fixture got `stats` and the Go route test six ids; `TestFeatureRoutes`
  and `TestFeaturesContract` failed (5 ids, `PUT /api/features/stats` 404), as did the web contract test, the
  registry test and two new frame tests (Stats before the switches load, Stats off). Then `features.IDs`, the
  registry, the frame and the catalogue (`features.stats.*`; `nav.stats` is unused now and removed). The frame change
  went into this commit, not task 4: with Stats a feature, a fixed Stats row would have listed it twice. Not caught at
  that commit: `routeTitles.test.ts` counts a page per feature and failed until task 3's commit fixed it (only the
  full run showed it); every other suite was green.
- Task 3 (`feat(widgets)`): test-first for the registry and the feature helpers (`widgetFeatures`,
  `widgetOffFeature`; six failures seen), then the move. The home layout editor's Stats-off test was written before
  the parked-name change and seen failing ("Words (Decks)") with the change stashed. The Home test (no heatmap with
  Stats off) was written after the move and passed at once. The contract fixture `settings/core-rows.json` lists the
  catalogue in registry order, so it changed (CHANGELOG).
- Task 4 (`feat(stats)`): test-first: `featureKnownOff`, the Stats layout off and loading, the weekly widget, the
  milestone card and the reader's display panel (six failures seen), then `FeatureGate`, the layout and the links.
  The Advanced study link has no test of its own (the same helper, one condition). Two guards followed the notice from
  `FeaturePage` to `FeatureGate` (`mainLandmark.test.ts`, the notice CSS test).
- Task 6 (`test(e2e)`): `e2e/tests/stats-switch.spec.ts` at 360 px (the off notice of the three Stats pages also goes
  through `expectNoSidewaysScroll`). No new screen, so `phone-width.spec.ts` is unchanged.
- Gates on the branch head: `npm run check` 0 errors 0 warnings (1998 files); `npm run build` ok; full vitest (Node
  26) 722 files, 14241 passed, 2 skipped; e2e 46 passed (one run; three runs are on the #163 branch built on this
  one); `node --test scripts/*.test.mjs` 190, 189 passed, 1 skipped; `gen-api-docs --check` clean; Go `gofmt` clean,
  `go vet ./...` ok, `go test ./...` 61 packages ok, one failure: the known `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here).
- Not checked: a phone or the Android shell by hand (Local follow-up).

## Local follow-up

- #295 on a phone and in the Android shell: Settings → Features → switch Stats off; the bottom bar and its More sheet
  have no Stats, Home has no heatmap, `/stats` says "Stats are switched off" and the Back button leaves it; switch it
  on again.
