# Web polish batch (issues #19, #12, #14, #15, #16, #17, #13, #18, #53)

Branch `feature/web-polish`, cut from develop e3d06d9. Test-first; one commit per issue.
Each bullet is re-verified against current code before it is acted on.

## Rulings

- Ruling: add devDependencies `vitest` jsdom + `@testing-library/svelte` (both MIT, Svelte 5 supported, peer `svelte ^5`) — issue #19 allows it, no production dependency changes — cost if wrong: dev-only removal.
- Ruling: component tests opt into jsdom per file (`// @vitest-environment jsdom`), the default environment stays node, so existing pure tests are unaffected — cost: one comment line per file.

## Tasks (in order)

1. #19 Component-test harness: vitest config (`svelteTesting` plugin, `$app/*` mocked per test), tests for auth guard redirects (layout), editor baseline/overlay, search URL mirroring + stale-response guard.
2. #12 Default `<title>`, per-route titles, search result count announced via aria-live, heatmap per-cell accessible exposure (visually hidden list).
3. #14 Auth hygiene (goto catches, loadMe with known token, clear workspace on logout, off-origin token guard, duplicate 401 redirect, load race).
4. #15 Settings/plugin UX (order number validation, workspaces retry, loading state, plugin-state gating, session event on workspace switch).
5. #16 Search UX (retry on same query, trim drift, goto catch, result cap note, disabled input without workspace).
6. #17 Entry view robustness (allSettled for /chars, skip /chars for words, reading formatting unification, licence links).
7. #13 Editor follow-ups (revert-to-shared, saved snapshot, comment fix, blank reading validation, baseline retry); Go change only if the overlay API needs it.
8. #18 Stroke player (retrying loader, placeholder, catch); asset size ruling after investigation.
9. #53 Distinct terms for word states vs character stages.

Gates before each commit: `npm run check`, `npm test`, `npm run build` in apps/web (Go gate when Go is touched). Final: real-app check in headless Chromium on a scratch copy.

## Rulings made while executing

- Ruling: stroke data stays in the bundle (47 MB in 9,575 files, ~13 MB gzipped as an archive) — browsers fetch only the one ~5 KB file per character shown, so the cost is binary and image size, not page weight; serving it from outside the embed needs a server data pack and a download path (a larger change touching licensing attribution and the Dockerfile) — cost if wrong: a bigger binary until a data-pack change lands (tracked on #18).
- Ruling: login/logout/401 no longer call `goto`; the layout guard is the single redirect owner — removes the duplicate redirect and the unhandled-rejection sources at once — cost if wrong: a 401 with no layout mounted would not navigate (the layout is always mounted).
- Ruling: revert-to-shared needs no server change — PUT already stores an omitted field as "no overlay" (overlay.Put), so the editor reverts by sending a smaller or empty patch — cost if wrong: none, the server contract is covered by overlay tests.
- Ruling: the heatmap exposes only days with activity in its hidden list (plus the window summary) — 91 "no activity" items would be noise — cost if wrong: empty days are not individually readable.
- Ruling: licence text on the entry page stays plain — mapping free-text licence names to URLs risks a wrong or misleading link — cost if wrong: one extra click for readers.
- Ruling: the home flashcards flash (#15) is already gone — widgets render only for plugins whose state is loaded and enabled (`allWidgets`), no change needed.
- Ruling: character stages are shown as Not studied / Started / Growing / Solid / Learned and the combined filter as "In progress"; word states keep New/Learning/Young/Mature (the established Anki-style terms) — only the visible labels change, the internal stage ids (`fresh`, `learning`, `mature`) stay to avoid churn in data keys and CSS — cost if wrong: renaming again is a label-only change in `STAGE_INFO` and one filter label.
