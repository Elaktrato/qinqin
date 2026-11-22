# Paging `GET /api/events` (issue #110) — design

**Status:** built on `feature/sb-events-paging` (collection branch `feature/study-batch`). Plan:
`docs/superpowers/plans/2026-11-22-events-paging.md`. Contract: `docs/contracts/events/` (`page.json`).

## Problem

`GET /api/events?[since=][&workspace=]` answers one JSON array with every matching event. The server builds the
whole list (`events.Since` → `[]model.StudyEvent`) and marshals it in one buffer, so memory grows with the log
(20 000 events ≈ several MiB per request, doubled by the marshal). The web reads it three ways: the widgets' log
cache (`lib/events.ts` `loadWorkspaceEvents`), the study load (`lib/study/store.ts` `fetchEvents`) and the plugin
SDK (`sdk.events.list`). The service worker caches the per-workspace answer for offline study. The v2 pull
(`docs/contracts/sync/`) already pages events for Android; it is the model, not the reader (it leaves `lookup`
out and orders by `updatedAt`, while the web replays by `(ts, id)`).

## Shape

Two forms on the same route, chosen by the query:

- **Paged** (any `limit` or `page` parameter):
  - first page `GET /api/events?limit=1..2000[&since=<RFC 3339>][&workspace=<id>]`
  - continuation `GET /api/events?page=<next>[&workspace=<id>]` — the `workspace` of the first page, repeated
    exactly (absent when the first page had none); `since` and `limit` may not be repeated.
  - answer `200 {"events": [...], "more": bool, "next": "e1.…" | null}`, `Cache-Control: no-store`. Items are
    the legacy items byte for byte (`{id, userId, workspaceId, device, ts, type, payload}`); `next` is a string
    exactly when `more` is true.
- **Legacy** (neither): the unchanged array, now **streamed** row by row, with `Deprecation: true` and
  `Link: </api/events?limit=500>; rel="successor-version"`.

Rules of the paged form:

- Order `(ts, id)` (the legacy order and the replay order of `events/README.md`); keyset on the last shipped
  `(ts, id)`. The concatenation of a walk's pages equals the legacy answer for the same `since`/`workspace`
  when nothing is written meanwhile.
- A page stops at `limit` rows or before the row that would take its encoded items past 4 MiB, but always
  holds at least one row while rows remain (the pull v2 budget, `sync.MaxPageLimit`/`MaxPageBytes`). `more` is
  false exactly when no row remains (the server reads one row ahead), so only an empty log ends on an empty
  page.
- `next` is opaque: `e1.` + base64url JSON binding the user, workspace (0 = none), `since`, `limit` and the
  position. Only the `e1.` prefix is a contract. Another user's token, a garbled token, a continuation whose
  `workspace` differs from the token's, a continuation repeating `since` or `limit`, an empty `page`, or a
  `limit` outside 1..2000 (or not an integer) is 400 JSON `events_page_invalid`. A bad `since` or `workspace`
  stays the route's plain-text 400, a foreign workspace its plain-text 404 (checked on every page).
- Personal access tokens: `tokReadWS`, unchanged. A workspace-limited token sends its workspace on the first
  page and on every continuation (that is why a continuation repeats it), so the gate needs no change.

## Rulings

Ruling: paging is opt-in by `limit`/`page`; without them the route answers the full legacy array, uncapped
but streamed — a cached v0.4 shell and third-party scripts read a bare array and know nothing of
continuations, and a capped array would silently drop the newest reviews (the log is ascending), so cards
would show as due again; streaming bounds server memory to one row and a 60 s write deadline (the legacy
pull's `newDeadlineWriter`) cuts a stalled reader — cost if wrong: one very large legacy response can still
take long to send; it no longer costs memory, and the web itself never asks for it.

Ruling: the legacy form is deprecated (headers as the legacy pull) and kept at least until v0.5.0 — the same
horizon as the legacy pull, whose old shells are the same population — cost: none until removal is decided.

Ruling: order and keyset on `(ts, id)`, not the pull's `(updatedAt, rowid)` window — the web replays and the
widgets bucket by `ts`, `since` filters `ts`, and events are immutable, so a position never moves; the existing
indexes `(workspace_id, ts)` / `(user_id, ts)` serve the scan (SQLite sorts only within one second's ties), so
no migration — cost if wrong: an event appended mid-walk with a `ts` before the position (an offline review
arriving late) is absent from that walk and present in the next read; the same one-round window the pull
accepts for from-scratch reads.

Ruling: no cursor, no `until`, no 30 s lag rule — the route is a from-scratch history read; deltas are the
pull's job (`events` collection with its cursor) — cost: a client wanting deltas uses the pull.

Ruling: the paged form carries exactly the legacy content, `lookup` events included — paging is transport,
not a filter; the service worker keeps scrubbing `lookup` events before it saves a page — cost: none (no new
data leaves the server).

Ruling: the token is unsigned, like the pull's — every page re-derives the user from the credential, filters by
it, re-checks the workspace and binds the token to the user, so a forged token only moves a position inside the
caller's own rows — cost: none.

Ruling: the paging code lives in `server/internal/events` (`ParsePageRequest`, `ListPage`, `StreamSince`), not
in `sync` (which imports `events`); its constants equal the pull's and a test pins that — cost: two constants
kept in step by a test.

Ruling: the web reads every page with `limit=2000` (`lib/eventPages.ts`, strict decode) and stops after 1000
pages with an error; a bare array answer is accepted as the whole log (a server without paging ignores
`limit`) — cost: a client of a newer server never sees an array, so the branch only serves a rollback.

Ruling: the service worker caches first pages (as today: `workspace=` set) and continuations
`page=e1.<token>&workspace=<id>` (nothing else); first pages are only cached with `workspace=` — offline study
needs the whole per-workspace log, and the token makes the URL a stable cache key (no clock in it: the same
position gives the same URL) — cost: a walk cut mid-way offline mixes a new first page with older later pages;
those miss at most the events of the cut walk, as an older full copy would.

Ruling: the plugin SDK's `events.list` reads the paged form too (same reader), its result unchanged (an array,
`types` filtered client-side) — cost: a plugin reading a huge combined log makes several requests.

## Memory

Per paged request the server holds at most one page (≤ 2000 items, ≤ 4 MiB plus one row) and the legacy form
one row; the before/after peak RSS of a 20 000-event workspace is in the plan's Execution record.

## Out of scope

Server-side type filters, a delta cursor, removing the legacy form, Android (it reads the pull).
