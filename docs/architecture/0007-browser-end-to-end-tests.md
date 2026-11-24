# 0007. Browser end-to-end tests

## Status

Accepted

Touched by: #195, #196, #199. A merge from one of these issues that changes what this record names updates the record.

## Context

CI ran the Vitest suite, the Go suite and `scripts/smoke-embed.sh` (HTTP checks of the embedded SPA), but nothing
drove a real browser: sign-in, a study session, the reader popup, offline study and the phone frame were checked
by hand before each release (#157). The architecture clean-up of phases 2 and 3 (#192 to #199) rewrites the
study data layer, the state model and the folder layout, so the owner asked for a browser suite that guards the
main flows through those refactors and stays green.

## Decision

- **One Playwright suite** in `apps/web/e2e/` (outside `src/`, so the `src/lib` folder rules of record
  [0004](0004-web-folder-rules.md) do not apply), run with `npm run e2e` in `apps/web`. Chromium only.
- **The real binary** with the built SPA embedded, built by the global setup
  (`apps/web/e2e/support/build.ts`) from a scratch copy of `server/`, as `scripts/smoke-embed.sh` does. No mock
  server, no dev server.
- **Throw-away data, fast fixture:** one template data directory seeded once per run from the tiny packs in
  `apps/web/e2e/fixtures/packs` plus an admin; each worker copies it and serves it on its own free loopback port
  with `QINQIN_AUTO_SEED=0` and an empty pack root (`apps/web/e2e/support/server.ts`). No network: no AI provider
  (no `QINQIN_SECRET`), no SMTP.
- **One user per test** (`apps/web/e2e/support/fixtures.ts`): tests share no study data and run in parallel.
  Study data is written through the push API in the contract shapes (`apps/web/e2e/support/study.ts`).
- **Stable by construction:** role and text locators; every wait is a web-first assertion or a poll on a
  condition, never a fixed sleep; no retries (a flaky test is fixed or quarantined with `test.fixme` and an
  issue); randomness the app draws from `Math.random` is seeded where a test depends on it.
- **Functional only:** no visual snapshots, no axe scan (both decided in #157, see the plan
  `docs/superpowers/plans/2026-11-23-e2e.md`).
- **No network** but the local server: the browser context aborts a request to any other host and the test
  fails (`apps/web/e2e/support/fixtures.ts`).
- **Secrets:** a failure's trace and video hold the learner's session token and, in the sign-in tests, the
  typed password. They belong to the throw-away instance, which is deleted with the runner, and are never
  real credentials. The server logs were checked to contain no token or password.
- **The gate:** the whole suite runs in CI on every push and pull request (the `e2e` job of
  `.github/workflows/build.yml`) and blocks like the unit tests.

## Consequences

- A refactor that breaks signing in, a study session (grade changes, the type mix), the reader lookup, offline
  study and its sync, or the phone navigation fails CI, even when every unit test still passes.
- A change to a flow's visible text, a role or an accessible name changes the suite in the same branch.
- The suite costs a Chromium install and a binary build in CI; the tests themselves take seconds.
- What the suite does not cover is listed in `docs/wiki/Development.md` (Browser end-to-end tests) and stays a
  manual check.

## Allowed / Not allowed

Allowed:

- A new spec in `apps/web/e2e/tests/` for a flow that is cheap and stable, with its fixture data written
  through the API.
- New tiny fixture packs under `apps/web/e2e/fixtures/packs` (hand-written, CC0).
- `seedRandom` and condition polls (`expect.poll`, `settled` in `support/study.ts`).

Not allowed:

- `page.waitForTimeout`, `setTimeout` or any other fixed sleep in a spec.
- Retries in `apps/web/e2e/playwright.config.ts`.
- A test that depends on another test's data or order, or on the full first-start seed.
- Network access to anything but the local server.

## Enforcement

- The `e2e` job in `.github/workflows/build.yml` runs the suite.
- `apps/web/e2e/tests/conventions.spec.ts` fails on a fixed sleep in a spec, and on a retry setting in the
  config, a spec, the support code or the CI command.
- The network guard in `apps/web/e2e/support/fixtures.ts` fails a test that reaches another host.
- `npm run check` type-checks the suite (`tsc -p e2e`).
- Review: shared data between tests, network access, and selectors by CSS class instead of role or text.

## Open questions

- Firefox and WebKit: not run (decided in #157); revisit with the Android work or an engine-specific bug.
- The update bar and the PWA install prompt are not covered; they need two builds with different ids in one run.
  Decided by a later issue.
