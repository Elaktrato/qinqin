# Search filters UI (#33)

Goal: kind, scheme and level filters on /search, in the URL, keyboard accessible.

## Design
- `lib/searchFilters.ts` (pure): parse/serialize URL params (`q`, `kind`, `scheme`, `level`), toggle rules, scheme list per language.
- Page: chip groups (`button` with `aria-pressed`) for kind, scheme (from `GET /api/schemes`, filtered to the workspace language), level (only after a scheme is chosen). "Clear filters" resets all three, keeps `q`.
- Filter changes `goto` with `replaceState: false` so back/forward walks filter states; the URL effect runs the search. A filter with no query shows a hint (the API requires `q`).
- Language always from the active workspace; never in the URL.

## Rulings
- Ruling: scheme chip value is the pack id (`packId`), level chip value is the level name — the API takes the manifest id and a level name — a stale/unknown value in a shared link just yields no results and is still shown as a pressed-less state with Clear available.
- Ruling: level chips appear only once a scheme is selected and selecting another scheme drops the level — the API rejects a level without a scheme and level names are per scheme — none.
- Ruling: schemes of other languages are hidden — the search is language-scoped, so they could never match — a scheme without `language` match is simply unreachable from the UI.
- Ruling: scheme/level are single-select (API takes one) — API contract — multi-select would need server work.
- Ruling: filter navigation pushes history entries — back/forward must work per the issue — slightly longer history.
- Ruling: schemes load failure degrades silently to kind-only filters — search must not break on an optional list — user sees no scheme chips without explanation (a small note is shown).

## Tasks
1. TDD `searchFilters.ts`. 2. Wire the page. 3. Gates + real-app check.
