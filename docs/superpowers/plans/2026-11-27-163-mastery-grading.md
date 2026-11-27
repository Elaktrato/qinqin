# #163 — the grading and levels the mastery map goes by (2026-11-27)

Milestone v0.9.0, phase 2. Branch `feature/v090-163-mastery-grading`, made from the finished #295 branch
(`feature/v090-295-stats-feature`).

## What

Stats → Characters has a "Group by" (built-in groupings and every installed level scheme, remembered per language in
the browser) and a "Level" select (all levels, or one level of any scheme, remembered per workspace in the browser).
"All levels" draws every character the workspace knows (10k+). The owner's decisions (issue body and the planning
comment) replace this with:

- **One grading** per workspace, chosen on the map: one installed level scheme (HSK, JLPT, a custom one) or a built-in
  grouping (Grade, Frequency, Strokes; Common, HK grade, Strokes). Stored in the synced workspace settings.
- **Defaults:** Chinese HSK, Japanese JLPT; neither installed: today's grouping (Common / Grade). An uninstalled
  stored grading falls back to that default.
- **"Include characters outside this grading"**, off by default: off, the map, its counts and the stage bars cover
  only the grading's characters; on, the rest join as a last group "Outside <grading>".
- **A study set of levels** inside the chosen grading (each level on or off). The study set limits the map first; the
  Level select then narrows within it.
- **The map only:** level sessions, the level check, courses, the Home widget are not affected.

## Tasks

1. This plan.
2. The contract: workspace-settings key `masteryMap` (`settings/mastery-map.json`: parse, resolve the grading, the
   study set, the patches; `workspace-settings.json` key row and merge cases; README; CHANGELOG; contract 17 → 18).
   Web `lib/stats/mapGrading.ts` decoding the fixture; Go: the merge cases through `PUT /api/workspaces/{id}` and the
   default packs against the bundled level packs (`internal/levels`). Tests first.
3. The map's pure filter: the study set and "outside" over a scheme's level members (which characters the map
   shows, which section each lands in, the "Outside" section's label), the Level select's options within the study
   set. Tests first.
4. The page: Grading select (stored in the workspace settings), the study-levels checkboxes and the outside switch
   (scheme gradings only), the Level select within the study set; the old Group by and Level storage go. DOM tests
   first.
5. Docs: wiki (Stats and heatmap: the character map), `docs/releases/NEXT.md`.
6. e2e: a learner opens the map in a Chinese workspace with HSK (bundled); the default is HSK with nothing outside;
   a study set of HSK 1 limits the map; "Include outside" adds the Outside group; the choice survives a reload; 360 px
   (the page is already in `phone-width.spec.ts`).

## Stored shape (`masteryMap`)

`{"grading": "<built-in key>" | "pack:<packId>", "includeOutside": boolean, "levels": {"<packId>": [ord, ...]}}`.
Each member is read alone; an absent or invalid member is the default. Written by merge patch, one member at a time.

## Rulings

- Ruling: a scheme grading is stored by its pack id (`pack:hsk-chars`), a study level by its level `ord`, never by
  database ids — the setting syncs to Android and survives a backup restored on another server, where scheme and level
  ids differ (hiddenDictionaries needs a remap for that reason) — cost if wrong: a pack that renumbers its levels
  resets that pack's study set to all levels.
- Ruling: built-in keys are the existing `GroupKey`s (`grade`, `freq`, `strokes`, `common`, `hkgrade`); a built-in is
  offered only for the language that has it (`ja`: grade, freq, strokes; `zh`: common, hkgrade, strokes) — cost if
  wrong: none.
- Ruling: the default grading of a language is the first installed pack of a fixed preference list (`zh`:
  `hsk-chars`, `hsk-words`; `ja`: `jlpt-kanji`, then any other installed pack whose id starts with `jlpt-`, so the
  estimated JLPT list of #219 and a local JLPT vocabulary pack qualify), else the language's first built-in (Common,
  Grade) — "HSK" and "JLPT" are the owner's words; the character list is the HSK list a character map is made of —
  cost if wrong: a learner with only HSK words installed starts on HSK words (still HSK).
- Ruling: samples (`hsk-mini`, `jlpt-mini`) and `joyo-grades` (already the built-in Grade) are never gradings, as in
  today's Group by — cost if wrong: none.
- Ruling: "Include characters outside" and the study set apply to scheme gradings only; a built-in grouping keeps
  every character in its own sections, as today, and shows neither control nor the Level select — a built-in grouping
  has no "outside" (every character has a stroke count; "Not graded" is a grade section of its own), and "falls back to
  today's grouping" means the map as it is today — cost if wrong: a learner who wants Grade 1–3 only picks the Jōyō
  levels nowhere; Grade stays a browse mode.
- Ruling: `includeOutside` is one switch per workspace, not one per grading — the owner names one switch; switching
  the grading keeps it — cost if wrong: none worth a second key.
- Ruling: the study set is stored per pack (`levels: {packId: [ords]}`), absent = every level; ords no longer in the
  pack are ignored, and a stored set that keeps no installed level means every level — switching gradings and back
  keeps each pack's set; a stale set never leaves an empty map — cost if wrong: none.
- Ruling: at least one level stays in the study set: the last checked level's box is disabled; "every level" is
  written as `null` (the member deleted) — an empty study set is no map — cost if wrong: none.
- Ruling: the Level select keeps its browser-remembered focus per workspace (as today) and offers "All study levels",
  the study set's levels, and "Outside <grading>" while outside characters are included; a remembered level that is no
  longer offered is "All study levels" — the focus is a browse state, the study set the setting — cost if wrong:
  another device starts on all study levels.
- Ruling: one grading at a time (owner): the Level select lists the grading's levels only. Today's "pick a level of
  another scheme and regroup it by strokes" goes — cost if wrong: a learner who wants JLPT N5 by strokes cannot.
- Ruling: the old browser keys (`qinqin.map.groupBy.<lang>`) are no longer read; the default grading applies once —
  stored data need not survive an upgrade — cost if wrong: one choice to make again.
- Ruling: a character lands in its level by the existing rule (its own glyph first, then a variant form, lowest level
  first); a character whose level is off in the study set is not shown (it does not move to a higher level that also
  lists it) — the server's "lowest level wins" is the badge rule everywhere — cost if wrong: none.
- Ruling: the Home widget "Characters" keeps counting every character — the owner: "the map only"; the widget is
  also #290's to change now — cost if wrong: its "N of M" differs from the map's; follow-up noted in the handoff.
- Ruling: the "Outside <grading>" section label replaces "Not in this scheme" — the owner's wording — cost: one
  catalogue string.
- Ruling: saving is optimistic: the page shows the new choice at once, a failed save puts it back and says so (the
  map's own alert) — the map is a browse page — cost if wrong: none.
- Ruling: contract 18 (17 after #295 on this base; the orchestrator renumbers).

## Execution record

- Task 2 (`feat(settings)`): test-first on the web: `lib/stats/mapGrading.test.ts` decodes the fixture and failed
  (34 of 34) against an empty module, then passed with `mapGrading.ts`. The Go side has nothing to implement (the
  server stores any settings key): `TestMasteryMapFixture` (`internal/levels`: the default packs are bundled level
  packs of their language with the prefix, the never-gradings exist) and the new merge case of
  `TestContractWorkspaceSettingsMerge` are guards that passed from the start.
- Task 3 (`feat(stats)`): `lib/stats/mapView.test.ts` written first and seen failing (the module had no exports),
  then `mapView.ts`. The catalogue gained `stats.map.slot.outside`; `stats.map.level.all` reads "All study levels".
- Task 4 (`feat(stats)`): the page's DOM tests were rewritten first (11 new: HSK default with nothing outside, the
  outside switch, the study levels and the disabled last one, the Level focus within the set, a remembered focus that
  left the set, a built-in grading, choosing and falling back, Japanese → JLPT, a failed save, a late answer, an empty
  level) and seen failing (11 of 11), then the page. The page loads again only on a workspace or language change, not
  on a settings write (the effect keyed on the id and the language). Dead code went with it: `levelGroupsFor`,
  `readLevelChoice`, `writeLevelChoice`, `filterByLevel` (charLevels) and `readGroupBy`, `writeGroupBy` (mapGrid),
  with their tests; `levelOf` keeps its tests.
- Task 6 (`test(e2e)`): `e2e/tests/mastery-grading.spec.ts` at 360 px. The fixture's Chinese universe has one
  character (好, Level 1 of the fixture list), so the e2e checks the wiring (default Common without HSK, choosing the
  list, the study levels, the outside switch and the Level options, the stored setting through the API, a reload); the
  map's rules are the DOM tests'.
- Gates on the branch head: `npm run check` 0 errors 0 warnings (2002 files); `npm run build` ok; full vitest (Node
  26) 724 files, 14277 passed, 2 skipped; e2e three full runs, 47 passed each; `node --test scripts/*.test.mjs` 190,
  189 passed, 1 skipped; `gen-api-docs --check` clean; Go `gofmt` clean, `go vet ./...` ok, `go test ./...` 61
  packages ok, one failure: the known `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here).
- Not checked: the map with the real HSK and JLPT packs in a browser or on a phone (the e2e fixture has no HSK pack;
  the default is covered by the fixture and DOM tests), and Android (Local follow-up).

## Local follow-up

- #163 with the bundled packs (`qinqin seed`): a Chinese workspace opens Stats → Characters on "HSK 3.0
  (characters)", 3,088 characters at most, no "Outside" group; switch HSK 4 to HSK 7–9 off and the map and its "X of
  Y learned" follow; "Include characters outside" adds the rest (about 8,000) as the last group; Level narrows within
  the study levels. A Japanese workspace opens on "JLPT kanji (approximate)". Reload, and open the same workspace on a
  second device or the Android shell: the grading, the study levels and the switch are the same (the Level focus is
  per device). At 360 px the study-level checkboxes wrap without sideways scrolling.
- The Home widget "Characters" still counts every character (ruling); decide whether it should follow the grading
  once #290 has landed.
