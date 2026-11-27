# Reminders contract: settings row, facts, plan, push subscriptions, unsubscribe

Issues #137 (reminders), #138 (email), #139 (web push). Design: `docs/superpowers/specs/2026-11-25-reminders-design.md`;
decision record: `docs/architecture/0011-reminders-and-push.md`. The learner's day and zone are `study-day/`, goals and
streaks `goals/`, vacation `scheduler/`. Everything is **opt-in and off by default**, per account.

Fixtures (format: `docs/contracts/README.md`; fixtures win over code):

- `settings.json` — `parse` of the `reminders` row (Go: `server/internal/reminders/settings_test.go`; web:
  `lib/reminders/settings.test.ts`).
- `plan.json` — `plan`: the pure "what to remind and when" computation (Go: `server/internal/reminders/plan_test.go`;
  web: `lib/reminders/plan.test.ts` decodes the answer shape).
- `unsubscribe.json` — the signed unsubscribe token (Go: `server/internal/reminders/token_test.go`).
- The routes are pinned by `server/internal/api/handlers_reminders_test.go` and the generated wiki page `API-Routes.md`.

## Why the clients publish "facts"

The server stores the review log but has **no scheduler**: due dates come from an FSRS replay with the learner's study
clock (`scheduler/`), goals and streaks from `goals/`, and all three exist only in the clients. So a client that has
just loaded or changed its study state publishes a small derived snapshot, the **facts**, and the server (email, push)
and the shell (local notifications) plan from it. Facts are a cache, never an authority: a newer facts row replaces
the older one, nothing else reads them as study data, and they are deleted with the account.

## The settings row `reminders` (a keyed row, `keyed/`, user-global)

```json
{ "version": 1, "enabled": false,
  "kinds": { "due": true, "goal": true, "streak": true },
  "times": ["18:00"],
  "quiet": { "start": "22:00", "end": "08:00" },
  "channels": { "email": false, "push": false, "device": false } }
```

Parsing (`settings.json`, `op: "parse"`): not an object, or `version` not an integer ≥ 1: the defaults; a newer version
is read leniently. `enabled`: a boolean, else `false`. `kinds.<k>` (`due`, `goal`, `streak`): a boolean, else `true`.
`times`: an array of `"HH:MM"` strings (`00:00`–`23:59`, two digits each); invalid entries drop, repeats collapse, the
rest sort ascending and at most the first **3** count; none left (or not an array) is `["18:00"]`. `quiet`: absent or
malformed is the default `{start: "22:00", end: "08:00"}`; `null` is **no quiet hours**; an object with two valid
times that differ is active (**start inclusive, end exclusive, wrapping midnight when `end <= start`**); start equal to
end is none. `channels.<c>` (`email`, `push`, `device`): a boolean, else `false`. A writer keeps every key it does not
know and writes `version: 1`; a newer-version row is never overwritten.

`enabled` is the master switch: off, nothing is sent or scheduled whatever else is set. `channels.push` allows web push
to the account's **subscribed devices** (below); `channels.device` allows local notifications in the Android shell;
`channels.email` allows the email digest. The three are independent.

## Facts: `PUT /api/reminders/facts`

Access: a full session, no access token. One facts record per workspace of the caller (the body names it); the newest
write wins. Body (at most 16 KiB):

```json
{ "workspace": 3, "asOf": "2026-11-25T10:00:00Z",
  "dueNow": 12,
  "dueBuckets": [ { "at": "2026-11-25T14:00:00Z", "count": 3 } ],
  "goal": { "set": true, "status": "open" },
  "streak": { "current": 5, "todayMet": false },
  "vacation": ["2026-11-27", "2026-11-28"] }
```

`dueNow`: cards due now (the study queue's count, `lib/features/flashcards/session/dueCounts.ts`, daily limits not applied). `dueBuckets`:
cards that come due later, grouped by the **start of the UTC hour** (`at`, whole hours) within the next 14 days, at most
400 buckets. `goal.status`: the day status of the learner's today (`goals/`: `open`, `met`, `vacation`, `none`;
`set` is true when a goal is in effect). `streak`: the goal streak (`current`, `todayMet`; 0 / false with no goal).
`vacation`: the learner days of the next 60 days covered by vacation for this workspace (at most 120 dates).
Rules: counts integers 0..1,000,000; `asOf` RFC 3339, not more than 5 minutes in the future (else it is stored as the
server's now); the workspace must be the caller's (404 `workspace_not_found`); malformed is 400 `bad_request`; answer
204. No card text, no entry ids, nothing else about study content is carried.

## The plan: `GET /api/reminders/plan?days=N`

Access: a full session, `no-store`. `days` 1..14, default 3. Answer:

```json
{ "generatedAt": "2026-11-25T10:00:00Z", "zone": "Europe/Berlin", "enabled": true,
  "channels": { "email": false, "push": false, "device": true },
  "available": { "email": false, "push": true },
  "slots": [ { "id": 200541, "kind": "due", "at": "2026-11-25T17:00:00Z", "local": "2026-11-25T18:00",
               "day": "2026-11-25", "count": 15 } ] }
```

`slots` is empty when reminders are off, nothing applies or no facts exist. `available.email` is true when SMTP is
configured and the account has a verified address; `available.push` when the server can send web push (VAPID key
usable). A slot is a reminder the account would get **in the plan's window**; the shell schedules the slots when
`channels.device` is on. `count` is the due count (`due`), the streak length in days (`streak`) and `null` for `goal`.
The client builds the text from its own catalogue (`reminders.notify.<kind>.title|body`, argument `count`); the server
sends no text. `id` is stable for one (learner day, kind): `daysSinceEpoch(day) % 100000 * 10 + {due: 1, goal: 2,
streak: 3}`, a positive 32-bit integer, so a re-plan replaces a notification instead of doubling it. `route` is not
sent: every kind opens `/study`.

### The computation (`plan.json`, `op: "plan"`)

Input: `now`, the zone history (`study-day/`), the settings, the facts of every workspace, `days`. For each calendar
date `d` from the local date of `now` for `days` dates and each kind enabled in `kinds`:

1. The **candidate times** are `times` on `d` in the **current** zone (the last of the history; a gap time of a
   daylight change moves forward by the gap, as Go `time.Date`), minus those inside the quiet hours, minus those at or
   before `now`. A slot's **learner day** is `DayOf(instant)`. No candidate: no slot.
2. `due`: the **first** candidate; `count` = `Σ` over workspaces that are not on vacation on the learner day of
   `dueNow + Σ bucket.count with bucket.at <= instant` (a bucket is due from the start of its hour); `count >= 1` or no
   slot. A workspace whose facts are older than 30 days counts nothing.
3. `goal`: the **last** candidate; a slot when some workspace has `goal.set`, is not on vacation on the learner day,
   and either the learner day is the learner day of its `asOf` and its `goal.status` is `open`, or the learner day is
   later (the plan assumes nothing was studied since). Status `met`, `vacation`, `none` on the facts' day: no slot.
4. `streak`: the **last** candidate; a slot when some workspace has `streak.current > 0` and the learner day is the
   facts' day with `todayMet` false, or the day after it with `todayMet` true (any other day the streak is broken or
   unknown); `count` is the largest such `current`, plus 1 for the day after. Not on vacation that day.
5. At most one slot per kind per learner day; slots sort by `at`, then kind.

Ruling: a slot never exists in the past and a plan assumes the learner studies nothing before it, so a client
re-plans after every sync and study session (a stale local notification is cancelled by the re-plan) — cost if wrong:
a notification for work done on another device that has not synced.

## Push: routes

All need a full session, no access token; `Cache-Control: no-store`.

| Route | Answer |
| --- | --- |
| `GET /api/push/vapid-key` | `{"publicKey": "<base64url, 65-byte uncompressed P-256 point>"}`; generates and stores the key pair on first use; 503 `push_unavailable` when the server has no usable `QINQIN_SECRET` |
| `GET /api/push/subscriptions` | `{"subscriptions": [{"id", "label", "createdAt", "lastSuccessAt"}]}` — never the endpoint or keys |
| `POST /api/push/subscriptions` | body `{endpoint, keys: {p256dh, auth}, label?}` (a browser's `PushSubscription.toJSON()`), at most 4 KiB; `201 {"id"}`; the same endpoint again updates it (200); `endpoint` must be an `https` URL without credentials (400 `bad_request`); `p256dh` 65 bytes and `auth` 16 bytes base64url; `label` at most 80 characters; at most 10 per account (409 `too_many_subscriptions`) |
| `DELETE /api/push/subscriptions/{id}` | 204; another account's id is 404 `not_found` |
| `POST /api/reminders/test` | body `{"channel": "email" \| "push"}`; sends one test message now to the caller's address or to every subscription; 204; 409 `email_unverified`, `mail_unavailable`, `push_unavailable`, `no_subscription`; at most one per account per minute (429 `rate_limited`) |

A subscription is a credential: it is deleted with the account and on a push service answer 404 or 410; sign-out of a
device deletes that device's subscription (the web app remembers the id). The service worker's cache never stores these
routes (`pwa/`: `/api/` is not cached).

**Payload** (encrypted with `aes128gcm`, RFC 8291; VAPID, RFC 8292; `TTL` 12 h, `Urgency: low`): JSON
`{"v": 1, "kind": "due" | "goal" | "streak" | "test", "count": 15 | null, "route": "/study"}`; no text, no ids.

## Email unsubscribe (`unsubscribe.json`)

Every reminder mail carries the link `<public URL>/api/reminders/unsubscribe?t=<token>` and the headers
`List-Unsubscribe: <that link>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Token:
`v1.<userId>.<base64url(HMAC-SHA256(key, "qinqin reminder unsubscribe v1\n" + userId))>` with `key` derived from
`QINQIN_SECRET` (label `qinqin reminder token v1`); the previous secret's key is also accepted. It carries no expiry
(an old mail must still work) and can do one thing: switch the account's **email channel off**.

- `GET /api/reminders/unsubscribe?t=` (public): a small HTML page, text in the language the browser asks for, a
  button that POSTs. It changes nothing (link scanners open links). A bad token is the coded JSON 400 `bad_request`
  like every API error.
- `POST /api/reminders/unsubscribe?t=` (public; form body `List-Unsubscribe=One-Click` or empty): sets
  `channels.email` to `false` in the account's `reminders` row (other keys kept; the row is created disabled when there
  is none) and answers 200 with a "you are unsubscribed" page. Idempotent. Re-enabling is the Settings switch.

## Delivery rules shared by email and push (server)

At most **one delivery per (account, channel, kind, learner day)**, recorded in a log without message bodies; a
delivery needs `enabled`, the channel switch, the kind, a slot whose `at` lies within the last 2 hours and not in the
future, and (email) SMTP configured and a verified address, (push) at least one subscription. Quiet hours and vacation
are part of the plan. Kinds that fall due in the same check go out in **one** email.
