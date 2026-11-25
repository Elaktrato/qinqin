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
reverse, cloze) is a typed card write and is only planned online. `PUT
/api/sync/push` is last-write-wins per row key, so the offline path never writes
rows and cannot create duplicate cards.

A changed grade (#131) is a new review event with `replaces: <id>` (`events/review-replace.json`), recorded the
same way. Outbox items are never rewritten or dropped to change a grade: an item may already have reached the
server while its answer was lost, so a rewritten item (same id) would be a duplicate the server ignores and a
dropped one would leave the stored wrong grade in place. Items flush oldest first, so a replacement normally
arrives after its target; if not, the rule still holds (the late target is replaced when it arrives).

## Outbox v3 (`outbox-v3.json`)

The queue is an IndexedDB object store (database `qinqin-outbox`, store `items`, key = `event.id`) of
`{userId, queuedAt, event}` records: the same item as v2 (the item, the ownership and the flush rules below
are unchanged). What v3 adds is how the web client keeps them (#35, measured on Android: a process kill within
about 5 s after grading lost reviews that localStorage had not yet written):

- **Write-ahead.** A review is committed to the store before its POST is made; "saved" is reported only after the
  transaction's `complete` (`durability: 'strict'`). The record is deleted after the server answered (or refused it
  permanently). A crash between the answer and the delete is harmless: the server keeps an event id once, so the
  retry is a duplicate (exactly once in effect).
- **One record per review**, no whole-queue rewrite: two tabs add and remove records without overwriting each other.
  The page reads an in-memory copy for its synchronous needs (counts, the offline banner, the study history) and
  refreshes it from the store before each flush and when the app returns to the front.
- **Event writes time out** (20 s) so a request that never answers becomes a retryable failure and the review,
  already stored, waits for the next flush.
- **Migration.** On start the v2 localStorage array `qinqin.study.pending.v2` is put into the store by event id (an
  id already in the store keeps the stored record), then the key is removed (`migration` in the fixture).
- **Fallback.** Where IndexedDB is missing or refuses (private mode, a blocked database) the queue stays the v2
  localStorage array, and with no storage at all it lives in memory for the session: reviews are still queued and
  retried, only not durable.
- **Sign-out** ends the session and its in-memory copy. The stored items stay for their user unless the user chose
  "sign out and delete them" (which deletes their records from the store).
- An item (`{userId, queuedAt, event}`) belongs to the user who was signed in when the review was recorded
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
`/api/workspaces`, `/api/features`, `/api/languages`, `/api/me/time-zone`,
`/api/sync/pull` in two forms. Paged (`v=2`, `docs/contracts/sync/`): a round's first
page with `workspace=<id>` and `collections` a non-empty subset of
`rows,cards,decks,deckSettings,limits,fsrsSets,fsrsActive`
(optionally `limit` and `tombstones=1`, which the web study pull sends; never `since`, a delta is not offline data, never `events`,
`overlays`, `books` or a moved name), and its continuations `v=2&page=p2.<token>`
(nothing else in the query; the token carries its filters, the server validates
them, and the URL is the cache key). Each page is a separate saved copy, so offline
study reads the same pages in the same order; "Prepare offline" reads the round
through the study read and its receipt counts the pages. A pull without `v=2` (the removed legacy form, #198)
is never cached. Also `/api/rows` (with a `prefix` that cannot match a lookup row) and `/api/rows/{key}`, `/api/events` with `workspace=` (the legacy array or a first page with `limit`, and a page continuation of exactly `page=e1.<token>&workspace=<id>`: the token holds no clock, so the URL is a stable cache key; each page is its own saved copy; after a complete read the page deletes the saved continuations of the workspace that no saved first page leads to, `events/` Paging),
`/api/entries/{id}` and the theme list `/api/themes` (public and not personal, but cached per credential like every other read; signed out, the web paints from its stored tokens and the compiled-in fallback, `themes/`); plus stroke data `/hanzi/U<HEX>.json` without credentials (served from the
installed strokes package; 404 when none is installed). The font list `/api/fonts` and the font slices `/fonts/<sha256>.woff2` (#97) are not cached by the worker yet (`bypass`): the web does not use them until it registers pack faces, which adds them (slices cache-first in a shared, content-addressed cache) together with their consumer. The package catalogue and package downloads
(`/api/packages…`) are never cached by the worker: the web reads the catalogue only for Settings and
installs no packages.
Everything else (every non-GET request, admin, account, auth except `me`, AI,
journal photos, audio, lookups, search) is never touched. The lookup history (#72,
`../lookups/`) never reaches the cache: keyed row reads of `lookup*` keys (or with a `prefix` that can, an empty one included;
paths are compared decoded) are not cached, and a saved pull (any v2 page's `collections.rows`) loses its `lookup*` rows
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

## Push notifications (#139)

Web push (`docs/contracts/reminders/`) adds two event handlers to the service worker and one small stored text map.
Nothing about it is cached: the worker's cache never stores a push payload, `/api/push/*` or `/api/reminders/*`
(`/api/` is `bypass` unless it is on the allowlist above; `classify.test.ts` asserts it for these paths).

- **Subscribing** is the page's job (`lib/pwa/push.ts`), only from a click (the permission prompt needs the gesture),
  only in a normal browser (never in the Android shell, which schedules local notifications), only in a secure
  context, and on iOS only in a home-screen install (`display-mode: standalone`). The page remembers the id the
  server answered per user in `localStorage` (`qinqin.push.device.<user id>`), marks this device in the Settings list
  and deletes the subscription at sign-out (best effort, started before the token is cleared, never blocking).
- **`push`** (`lib/pwa/sw/push.ts`): the payload is JSON `{v: 1, kind, count, route}` with no text. It is parsed
  defensively: no data, malformed JSON, a non-object or an unknown `kind` shows a generic notification, and the
  handler never throws. The notification is shown with `tag` = the kind (a newer one replaces an older one of the
  same kind) and `data: {route}`. `route` is kept only when it starts with a single `/` (no `//`, no scheme, no
  backslash, no control character); anything else is `/study`.
- **Text**: the worker cannot use the page's catalogue. The page stores the raw catalogue messages of the
  `settings.reminders.notify.*` keys (title and body of `due`, `goal`, `streak`, `test`, `generic`; `{count}` and
  plurals as in the catalogue) and its format locale as JSON in the Cache API: cache `qinqin-push-texts-v1`, entry
  `https://push-texts.invalid/v1` (never fetched). The worker formats them with the same message formatter. With no
  stored map it uses an English constant (`ENGLISH_FALLBACK`, `lib/pwa/sw/pushTexts.ts`); a test pins that constant
  to `messages/en.json`, and another that the page's map holds exactly the worker's keys. The cache is neither a
  shell cache nor an API partition, so `activate` and sign-out leave it alone (the page clears it when the session
  ends).
- **`notificationclick`**: the notification is closed; an open window client is focused and, when it does not already
  show the route, navigated to it (`client.navigate`); with no window, `clients.openWindow(route)`. The route is
  validated again from `notification.data`.
