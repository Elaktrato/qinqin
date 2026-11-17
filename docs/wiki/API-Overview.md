# API overview

This page is for people writing a client (the web app is the reference client; a native Android client is planned). The rules that every client must implement identically live in the repository under `docs/contracts/`, each with JSON fixtures that the Go server and the web app run as tests. Fixtures win over code.

- [API routes](API-Routes) lists every route with its access class (generated from the real route table).
- [API errors](API-Errors) is the error-code catalogue (generated).
- The README's API section describes request and response shapes, body limits and per-route rules.

## Conventions

- JSON over HTTP, base path `/api`. A health check is `GET /healthz`.
- Errors are JSON `{"error": code, "message": "English sentence"}`. Branch on `error`, never on `message`: the `message` stays English for developers and logs, and clients show text translated by code from their catalogue ([API errors](API-Errors)). Some older routes answer plain-text 413s.
- Offsets in text routes count Unicode code points, not bytes.
- Most routes are scoped by the signed-in user; workspace-scoped routes take a `workspace` id and answer 404 for a foreign one.

## Authentication

Send `Authorization: Bearer <token>`.

1. `GET /api/auth/options` (public, never cached) tells the client what the sign-in page may offer: bootstrap state, registration mode, email policy, whether password reset and emailed-code sign-in exist, and the minimum password length.
2. `POST /api/auth/login` with `{username, password, deviceName?}` answers `{"status": "ok" | "password_change_required", "token", "user"}`. Both statuses carry a usable token. The token is 64 hex characters, shown once; store it in secure storage and never log it. `deviceName` (max 64 characters) names the session in the session list.
3. If two-step sign-in applies, login answers `mfa_required` instead and the client completes the second step (contract `auth/mfa-login.json`).
4. `POST /api/auth/logout` ends exactly that session (204).

A session unused for 90 days stops working; each use refreshes it.

### Access tokens for scripts

A script uses a personal access token instead of a session: `qq_pat_` plus 64 hex characters, created in Settings, shown once, read only or read and write, optionally limited to one workspace, always expiring. Only the routes marked in the Token column of [API routes](API-Routes) take one; everything else (account, sign-in, admin, backup, AI) answers 403 `token_not_allowed`. A client app signs in with a session, never with an access token. See [API access tokens](API-Access-tokens).

### 401 versus 403

- **401 `unauthorized`**: this session is gone (unknown, idle, revoked, user disabled or deleted). Drop the token and show sign-in. `401 bad_credentials` on login is the anonymous step, not a lost session.
- **403** never means the session is gone. A wrong re-entered password is `403 wrong_password` so the client keeps its token.

### Restricted sessions

`GET /api/auth/me` returns the user plus `restriction`: empty (full), `password_change` (an administrator set a temporary password), or `mfa_enrollment` (two-step sign-in is required and not set up). A restricted session may only call routes of access class "Any session" ([API routes](API-Routes)); everything else answers 403 `password_change_required` or `mfa_enrollment_required`, and the token stays valid.

### Throttling

Login and register are rate-limited per client, pair and username; limited answers are 429 `rate_limited` with `Retry-After`, or 503 `busy`. See `docs/contracts/auth/throttling.md`.

## Sync

Study data is an event log, typed study rows and plugin-data rows. `POST /api/events/batch` and `POST /api/sync/push` accept offline events idempotently by event id; cards, decks, deck settings, limits and FSRS sets travel as the typed collections `cards`, `decks`, `deckSettings`, `limits`, `fsrsSets` and `fsrsActive` of the push and the pull, last write wins like plugin data (`docs/contracts/study/`). `GET /api/sync/pull?v=2` pages the caller's own data (workspaces, plugin data and states, the typed rows, library books, bookmarks and highlights, overlays, own sentences, events) in rounds: at most `limit` rows (default 500) and 4 MiB per page, a `next` token per page and a `cursor` on the last page for the next round's `since`; the first page's `scope` lists the workspaces, the languages and the catalogue ETag (`docs/contracts/sync/`). The legacy form `GET /api/sync/pull?cursor=` (deprecated until v0.5.0, for cached v0.3 web shells) streams changes since a cursor; a pull naming only `pluginData` (and `pluginStates`) also gets the typed rows under their old plugin keys. Row-key conventions (`vacation:*`, `known:*`, `goals:workspace`, the typed rows) are in `docs/contracts/overview.md`.

## Data packages

Dictionary and other shared data is not in the pull. The server builds a versioned, checksummed **data package** per language lexicon and per installed pack (levels, sentences, frequency, components, audio, grammar, stroke data), each a zip holding a read-only SQLite database, a `NOTICE.md` and the packs' licence files. `GET /api/packages` is the catalogue (the caller's workspace languages by default, `?languages=zh,ja` or `all`; `ETag`), `GET /api/packages/{id}/{revision}` the file, resumable with `Range` (`Cache-Control: private, no-cache` with a strong `ETag`: a cached copy revalidates, 304 when unchanged); at most 2 downloads per user run at a time (429 `download_busy`, retry after `Retry-After`). A client verifies a file before use and replaces it on a new revision; it never merges package rows into its own data. Rules and fixtures: `docs/contracts/packages/`. Theme and font packs build no data package: `GET /api/themes` lists the themes, `GET /api/fonts` the installed font faces, whose WOFF2 slices a client fetches from `GET /fonts/<sha256>.woff2` as it needs them (`docs/contracts/fonts/`).

## Contracts for client implementers

Start with `docs/contracts/overview.md`, then the folder of the area you implement: `auth/` (sessions, errors, MFA, invites), `study-day/` (the learner's day and time zone), `scheduler/` (vacation, limits, FSRS clock), `cards/` (reverse, cloze, burying), `decks/` (deck numbers, level decks), `levels/`, `backup/` (the personal backup archive), `reader/` (display settings, furigana), `packages/` (data packages), `sync/` (the paged pull and the push answer) and `pwa/` (offline allowlist and the review outbox). The index is `docs/contracts/README.md`.

## When you add a route

The route table is checked against `apps/web/src/lib/pwa/sw/routes.fixture.json` by a Go test (`UPDATE_ROUTES_FIXTURE=1 go test -run RoutesFixture ./internal/api/` regenerates it); then run `node scripts/gen-api-docs.mjs` to refresh the wiki's route page.
