# Version, build metadata and release check — plan (issue #154)

Design: `docs/superpowers/specs/2026-11-25-version-check-design.md`. Test first in every task; one commit per task.

1. **Semver** (`server/internal/update/semver.go`): parse, compare, prerelease order, `v` and `+build` handling.
2. **Checker** (`server/internal/update/check.go`): GitHub list request against an injectable base URL, ETag and
   304, freshness windows, failure state with stale answer, force floor, timeout, rate-limit and bad-response
   mapping, token only in the header, notes cap, release URL check; tests on `httptest`.
3. **Settings** (`051_update_settings.sql`, `update.LoadSettings/SaveSettings`).
4. **Routes** (`api/handlers_version.go`, `handlers_admin_update.go`, `api.WithBuild`, `WithUpdateChecker`):
   `GET /api/version` public and signed-in; the three admin routes; route table, gate and error walks pass;
   `ContractVersion` and its CHANGELOG test.
5. **Build metadata**: `main.go` vars and `buildInfo()`, serve wiring, Dockerfile ARGs, `build.yml`, the
   dockerfile script test.
6. **Contracts and docs**: `docs/contracts/version/` (README, `version.json`, `bridge-compat.json`,
   `update-check.json`), README row, overview, CHANGELOG `(contract 1)`.
7. **Web helper**: `lib/api/version.ts` with `bridgeCompatibility`, tests against the fixture.
8. **Admin UI**: `lib/api/adminUpdate.ts`, `lib/admin/updateView.ts`, `UpdatesAdmin.svelte`, the `updates` section
   in `tabs.ts`, i18n keys, jsdom test.
9. **Wiki**: `Admin-updates.md`, sidebar, environment variables, upgrading link, git-flow/release notes note.
10. **Verify**: `go vet`, `go test ./...`, `npm run check`, vitest, `scripts` node tests, a built server answering
    `GET /api/version` over HTTP.
