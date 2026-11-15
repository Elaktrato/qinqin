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
