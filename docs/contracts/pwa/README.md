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

A changed grade (#131) is a new review event with `replaces: <id>` (`events/review-replace.json`), recorded the
same way. Outbox items are never rewritten or dropped to change a grade: an item may already have reached the
server while its answer was lost, so a rewritten item (same id) would be a duplicate the server ignores and a
dropped one would leave the stored wrong grade in place. Items flush oldest first, so a replacement normally
arrives after its target; if not, the rule still holds (the late target is replaced when it arrives).

## Outbox v2 (`outbox-v2.json`)

`localStorage['qinqin.study.pending.v2']` = `[{userId, queuedAt, event}]`.

- An item belongs to the user who was signed in when the review was recorded
  (`userId` null: no user was known yet, adopted by the next user to flush).
- The pre-v2 queue (`qinqin.study.pending`, bare events, v0.3.x) is neither read nor removed (#198):
  open the app online on every device before upgrading from v0.3.x, so an old copy sends its reviews first.
  A restore drops the restoring user's items and unowned ones from the v2 queue (their workspace ids are gone);
  another user's items on the same browser stay.
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
`/api/sync/pull` in two forms. Paged (`v=2`, `docs/contracts/sync/`): a round's first
page with `workspace=<id>` and `collections` a non-empty subset of
`pluginData,pluginStates,cards,decks,deckSettings,limits,fsrsSets,fsrsActive`
(optionally `limit` and `tombstones=1`, which the web study pull sends; never `since`, a delta is not offline data, never `events`,
`overlays`, `books` or a moved name), and its continuations `v=2&page=p2.<token>`
(nothing else in the query; the token carries its filters, the server validates
them, and the URL is the cache key). Each page is a separate saved copy, so offline
study reads the same pages in the same order; "Prepare offline" reads the round
through the study read and its receipt counts the pages. A pull without `v=2` (the removed legacy form, #198)
is never cached. Also `/api/plugins/{id}/data` and `/data/{key}`, `/api/events` with `workspace=` (the legacy array or a first page with `limit`, and a page continuation of exactly `page=e1.<token>&workspace=<id>`: the token holds no clock, so the URL is a stable cache key; each page is its own saved copy; after a complete read the page deletes the saved continuations of the workspace that no saved first page leads to, `events/` Paging),
`/api/entries/{id}` and the theme list `/api/themes` (public and not personal, but cached per credential like every other read; signed out, the web paints from its stored tokens and the compiled-in fallback, `themes/`); plus stroke data `/hanzi/U<HEX>.json` without credentials (served from the
installed strokes package; 404 when none is installed). The font list `/api/fonts` and the font slices `/fonts/<sha256>.woff2` (#97) are not cached by the worker yet (`bypass`): the web does not use them until it registers pack faces, which adds them (slices cache-first in a shared, content-addressed cache) together with their consumer. The package catalogue and package downloads
(`/api/packages…`) are never cached by the worker: the web reads the catalogue only for Settings and
installs no packages.
Everything else (every non-GET request, admin, account, auth except `me`, AI,
journal photos, audio, lookups, search) is never touched. The lookup history (#72,
`../lookups/`) never reaches the cache: `qinqin-core` data reads of `lookup*` keys (or with a `prefix` that can
match one; paths are compared decoded) are not cached, and a saved pull (any v2 page's `collections.pluginData`, or the body of a legacy pull an older worker saved) loses its `qinqin-core` `lookup*` rows
and a saved event log (the array, or a page's `events`) its `lookup` events before it is stored (`apps/web/src/lib/pwa/sw/scrub.ts`); after a
Clear or Remove the page filters copies saved earlier the same way. Only `200` responses are
stored, and never one whose `Cache-Control` says `no-store` (the paged reads answer `private, no-cache` so that
their pages are saved: `cacheControl` in `events/page.json` and `sync/pull-page.json`, which the worker tests
build their responses with); a 401 deletes the partition; a 4xx or 5xx other than 502/503/504 is
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
