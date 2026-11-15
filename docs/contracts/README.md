# Contracts

Shared rules the web app and the future Kotlin client both follow, as prose plus JSON
fixtures. Add one line per area; a Go or web test should decode each fixture.

| Area | Files | What it fixes |
|---|---|---|
| auth throttling | `auth/throttling.md`, `auth/throttle-responses.json` | order of checks, status codes, `Retry-After`, JSON error bodies of login and register |
| auth sessions | `auth/README.md`, `auth/errors.json`, `auth/login-responses.json`, `auth/me.json`, `auth/sessions.json` | session tokens, 401 vs 403, restrictions, login statuses, device names, the one error-code catalogue |
