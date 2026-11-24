# API overview

This page is for people writing a client or a script (the web app is the reference client; a native Android client is planned). The rules that every client must implement identically live in the repository under [`docs/contracts/`](https://github.com/Elaktrato/qinqin/tree/develop/docs/contracts), each with JSON fixtures that the Go server and the web app run as tests. Fixtures win over prose; start with `docs/contracts/overview.md`.

- [API reference](API-Reference) describes each route's request and response, area by area, and the request body limits.
- [API routes](API-Routes) lists every route with its access class and token rule (generated from the real route table).
- [API errors](API-Errors) is the error-code catalogue (generated).
- [API access tokens](API-Access-tokens) is the guide for scripts.

## Conventions

- JSON over HTTP, base path `/api`. A health check is `GET /healthz`.
- Errors are JSON `{"error": code, "message": "English sentence"}`. Branch on `error`, never on `message`: the `message` stays English for developers and logs, and clients show text translated by code from their catalogue ([API errors](API-Errors)). Every error of every route has this shape, unknown API paths (404 `not_found`) and wrong methods (405 `method_not_allowed`) included.
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

Login and register are rate-limited per client, pair and username; limited answers are 429 `rate_limited` with `Retry-After`, or 503 `busy`. Never retry a 429 or 503 automatically (the one exception is `download_busy` on a package download). See `docs/contracts/auth/throttling.md` and [Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting).

### Interface language

`GET /api/auth/me` carries `interfaceLanguage` (`""` until set: follow the browser or device). `PUT /api/me/interface-language {language}` stores it for every device of the user; the server checks the syntax of the tag only, never whether a client supports it. The server's mails use it too. Negotiation, catalogue format and the Android conversion: `docs/contracts/i18n/` and [Translating qinqin](Translating-qinqin).

## Sync

Study data is an event log, typed study rows and keyed rows ([Core data API](Core-data-api)). `POST /api/events/batch` and `POST /api/sync/push` accept offline events idempotently by event id; cards, decks, deck settings, limits and FSRS sets travel as the typed collections `cards`, `decks`, `deckSettings`, `limits`, `fsrsSets` and `fsrsActive` of the push and the pull, last write wins like the keyed rows (`docs/contracts/study/`). `GET /api/sync/pull?v=2` pages the caller's own data (workspaces, the feature switches, the keyed rows, the typed rows, library books, bookmarks and highlights, overlays, own sentences, events) in rounds: at most `limit` rows (default 500) and 4 MiB per page, a `next` token per page and a `cursor` on the last page for the next round's `since`; the first page's `scope` lists the workspaces, the languages and the catalogue ETag (`docs/contracts/sync/`). There is no other pull form: `GET /api/sync/pull` without `v=2` answers 404. Row-key conventions (`vacation:*`, `known:*`, `goals:workspace`, the typed rows) are in `docs/contracts/overview.md`.

## Search hits and entries

Two additive fields serve the search page and the entry page, so a client can show a result's gloss and level and a word's characters without extra requests:

- `GET /api/search` hits carry `glosses: [{"dictionaryId", "gloss"}]` — the first gloss of each dictionary in the entry's sense order, at most three, from active dictionaries only — and `levels: [{"scheme", "level"}]`, the lowest level of each installed scheme in scheme order (`[]` when the entry is in none).
- `GET` and `PUT /api/entries/{id}` carry `characters: [{"id", "written", "reading": {"type", "value"} | null, "gloss", "radical": {"id", "written"} | null, "strokes", "levels"}]` for a Chinese or Japanese word: the distinct Han characters of the written form in order, at most eight, each resolved to the character entry whose own written form is that character. `written` is the character the word writes; `strokes` is `0` when the dictionary does not carry a count. It is `[]` for a character entry, other languages and characters without an entry.

Both are additive: an older client can ignore them. The fields are public like the routes themselves — no user data is included.

## Data packages

Dictionary and other shared data is not in the pull. The server builds a versioned, checksummed **data package** per language lexicon and per installed pack (levels, sentences, frequency, components, audio, grammar, stroke data), each a zip holding a read-only SQLite database, a `NOTICE.md` and the packs' licence files. `GET /api/packages` is the catalogue (the caller's workspace languages by default, `?languages=zh,ja` or `all`; `ETag`), `GET /api/packages/{id}/{revision}` the file, resumable with `Range` (`Cache-Control: private, no-cache` with a strong `ETag`: a cached copy revalidates, 304 when unchanged); at most 2 downloads per user run at a time (429 `download_busy`, retry after `Retry-After`). A client verifies a file before use and replaces it on a new revision; it never merges package rows into its own data. Rules and fixtures: `docs/contracts/packages/`. Theme and font packs build no data package: `GET /api/themes` lists the themes, `GET /api/fonts` the installed font faces, whose WOFF2 slices a client fetches from `GET /fonts/<sha256>.woff2` as it needs them (`docs/contracts/fonts/`).

## Contracts for client implementers

Start with `docs/contracts/overview.md` (the read order, device-local state and what is deliberately unspecified), then the folder of the area you implement:

| Area | Folders |
|---|---|
| Sign-in and accounts | `auth/` (sessions, errors, two-step sign-in, invites, reset links, access tokens, throttling, profile pictures) |
| Sync and shared data | `sync/` (the paged pull and the push answer), `packages/` (data packages), `events/` (the event envelope and payloads), `study/` (typed study rows), `settings/`, `overlays/` (a user's edits of entries) |
| Studying | `study-day/` (the learner's day and time zone), `scheduler/` (FSRS, vacation, limits), `cards/`, `decks/`, `levels/`, `frequency/`, `goals/`, `milestones/`, `weekly/`, `stats/`, `radicals/` |
| Reading and writing | `reader/` (display settings, furigana), `library/` (books, bookmarks, highlights), `journal/`, `notes/`, `lookups/` |
| Appearance and text | `themes/`, `fonts/`, `i18n/` |
| Offline and backup | `pwa/` (offline allowlist and the review outbox), `backup/` (the personal backup archive) |

The index with one line per folder is `docs/contracts/README.md`.

## When you add a route

See [Development](Development#when-you-add-a-route): the route table is checked against `apps/web/src/lib/pwa/sw/routes.fixture.json` by a Go test, the token rules against `docs/contracts/auth/tokens-routes.json`, and `node scripts/gen-api-docs.mjs` refreshes the wiki's route and error pages.
