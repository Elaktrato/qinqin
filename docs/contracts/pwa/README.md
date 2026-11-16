# PWA offline rules

The web client is an installable app with offline study. These rules are the web
client's own (the Android client keeps its own store) and are written down so a
second client keeps the same data semantics. Only the outbox and the review event
are binding for every client.

## Review events offline (binding)

A review recorded offline is the unchanged `review` event of
`POST /api/events/batch`: the client-generated ULID `id`, `workspaceId`, `device`,
`ts` (the device clock at grading time) and `payload`. The server stores an id once
(`accepted` / `duplicates`), so a retry after an ambiguous failure can never count
twice. Offline sessions create no cards: a companion card (sentence, writing, tone,
reverse, cloze) is a plugin-data write and is only planned online. `PUT
/api/sync/push` is last-write-wins per row key, so the offline path never writes
rows and cannot create duplicate cards.

## Outbox v2 (`outbox-v2.json`)

`localStorage['qinqin.study.pending.v2']` = `[{userId, queuedAt, event}]`.

- An item belongs to the user who was signed in when the review was recorded
  (`userId` null: no user was known yet, adopted by the next user to flush).
- The pre-v2 queue (`qinqin.study.pending`, bare events) is adopted by the first
  signed-in user and removed.
- A flush sends only the current user's items, oldest first, one event per request.
  A 401 (revoked or expired session) or a 403 whose body names a restriction
  (`password_change_required`, `mfa_enrollment_required`) stops the flush and keeps
  everything; other permanent 4xx drop that item; 5xx, 408, 429 and network errors
  keep it.
- Items of another user are kept 30 days from `queuedAt`, never sent for anyone
  else, then removed. A user's own items never expire.
- Explicit sign-out with unsent items asks first; "delete them" removes only the
  signing-out user's items.
- The fixture holds the `settle(state, user, now)` cases: adoption, per-user
  flush, the same user's return, expiry, unowned items.

## Cache allowlist and partitions (web only, informational)

The service worker answers from its saved copy only for these `GET`s, and only
when the request carries an `Authorization` header: `/api/auth/me`,
`/api/workspaces`, `/api/plugins`, `/api/languages`, `/api/me/time-zone`,
`/api/sync/pull` with `collections` a non-empty subset of
`pluginData,pluginStates,cards,decks,deckSettings,limits,fsrsSets,fsrsActive` (the
typed study rows of `docs/contracts/study/` and the keyed `goals:*`, `known:*` and
`vacation:*` rows travel in it; the old `pluginData,pluginStates` form of a cached
v0.3.x shell stays cacheable), `/api/plugins/{id}/data` and `/data/{key}`, `/api/events` with `workspace=`,
and `/api/entries/{id}`; plus stroke data `/hanzi/U<HEX>.json` without credentials.
Everything else (every non-GET request, admin, account, auth except `me`, AI,
journal photos, audio, lookups, search) is never touched. The lookup history (#72,
`../lookups/`) never reaches the cache: `qinqin-core` data reads of `lookup*` keys (or with a `prefix` that can
match one; paths are compared decoded) are not cached, and a saved pull loses its `qinqin-core` `lookup*` rows
and a saved event log its `lookup` events before it is stored (`apps/web/src/lib/pwa/sw/scrub.ts`); after a
Clear or Remove the page filters copies saved earlier the same way. Only `200` responses are
stored; a 401 deletes the partition; a 4xx or 5xx other than 502/503/504 is
passed through.

The cache of an API response is named `qinqin-api-v1-` + the first 32 hex digits of
SHA-256 of the request's own `Authorization` header value. A different token
(another user, or a new login) can only ever find an empty partition. The page
deletes every other partition at sign-in and all of them at sign-out.

`apps/web/src/lib/pwa/sw/routes.fixture.json` lists every route pattern of the
server with its access class; a Go test fails when `routes()` and the file differ,
and the worker's tests classify every entry, so a new route is a conscious decision
(default: not cached).

## The offline day

The learner's day, the study clock (vacation days), vacation runs and daily limits
are computed from rows the client already holds (`GET /api/me/time-zone`, the
`vacation:*` rows with `workspaceId: null`, `limits:*` rows). The rules of
`docs/contracts/scheduler/` and `study-day/` apply unchanged; an offline client never
asks the server what "today" is.
