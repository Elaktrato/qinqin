# 0011. Reminders, web push and the F-Droid-safe notification path

## Status

Accepted

Touched by: #36, #37, #137, #138, #139. A merge from one of these issues that changes what this record names updates
the record.

## Context

Study reminders (due cards, a goal not met, a streak at risk) must reach a learner on three surfaces: email, an
installed web app and the Android shell. The owner wants the Android app installable from F-Droid, so it cannot depend
on Google's push service. The server stores the review log but has no scheduler: due dates, the study clock, goals
and streaks are computed by the clients (`docs/contracts/scheduler/`, `goals/`). Design:
`docs/superpowers/specs/2026-11-25-reminders-design.md`; contract: `docs/contracts/reminders/`.

## Decision

- **Everything is opt-in, per account, in one keyed row** `reminders` (user-global): master switch off by default,
  kinds, up to three local times, quiet hours, and one switch per channel (`email`, `push`, `device`). Vacation days
  and the learner's zone history (`study-day/`) apply to every channel.
- **Clients publish facts, the server plans.** `PUT /api/reminders/facts` carries the due count, the schedule of
  upcoming due cards by hour, the goal status, the streak and the vacation dates; `reminders.Plan` (Go, pure,
  fixture-pinned) turns settings and facts into slots; `GET /api/reminders/plan` serves them. There is one
  implementation of the rule; the web mirror only parses.
- **The F-Droid-safe path is local notifications.** In the Android shell the web app fetches the plan and schedules
  notifications on the device through `lib/native/notifications`; no push service is involved. Real push on Android
  is possible only through **UnifiedPush** (FOSS, chosen by the user, a later option behind the same plan) or a
  **separate Play-only build flavour**. The default build ships no Firebase or other proprietary push SDK.
- **Web push runs in a browser or an installed web app, never in the shell.** VAPID web push is implemented in
  `server/internal/webpush` (RFC 8030, 8291, 8292) with the standard library only. The key pair is created on first
  use and its private scalar is sealed with `QINQIN_SECRET` (like the SMTP password); it never enters the repository
  or a log. Subscriptions are per device (`push_subscriptions`), validated as `https` URLs, sent through the
  network guard, deleted on 404/410, on sign-out of the device and with the account.
- **Email** goes through the existing mail service: a scheduler (`reminders.Scheduler`, started by `serve` under the
  background context and waited for at shutdown) sends one digest per tick, at most one delivery per (account,
  channel, kind, learner day) recorded in a log without bodies before it is sent. Every mail carries a signed
  one-click unsubscribe link and `List-Unsubscribe` headers. Subjects and notification texts carry no study data.
- **The service worker never caches reminder data** (`/api/` is not cached) and shows a push with texts the page
  stored for it.

## Consequences

- A phone that does not run the app for more than the plan's seven days gets no local reminders until it does;
  Android may delay a local alarm in Doze. An exact, always-on push needs UnifiedPush or the Play flavour.
  The web app replans on every start, every return to the foreground, every return of the network and once a day
  while it runs; nothing replans while it is closed. A periodic native background replan (WorkManager) is a follow-up.
- The text of a local notification (its counts) is fixed when it is scheduled. Study done **on this phone** is
  accounted for: if its facts or the new plan cannot be fetched (offline), the remaining device notifications are
  cancelled instead of showing old counts, and come back at the next replan. Study done on **another device** cannot
  be known offline: the counts may be wrong until the phone is online again.
- "Change server" cancels every scheduled and shown notification of the old account; a notification tap reaches the
  web app through a non-exported trampoline activity, never through an extra on the exported main activity.
- Server-side reminders depend on the last facts a client published (30-day staleness cap). A learner who never opens
  the web app after opting in has no facts and gets nothing.
- Web push needs HTTPS and a usable `QINQIN_SECRET`; on iOS only for a home-screen web app (16.4+).
- A failed send is final for that learner day (one claim per channel, kind and day): a late or doubled reminder is
  worse than a missed one. Web push messages carry a TTL of at most the rest of the two-hour window and stop at the
  start of quiet hours; a subscription is dropped after five consecutive failures.
- Due counts come in UTC-hour buckets, so a slot's count runs to the end of its UTC hour; in :30 and :45 zones this
  is off by that offset. Accepted for a nudge.
- Rotating `QINQIN_SECRET` re-seals the push key at start (with the previous secret supplied); without it the key is
  lost and must be recreated by hand (drop `push_vapid` and the subscriptions), which makes every device subscribe
  again. No in-app reset exists: it would need an admin route with re-authentication for a rare, recoverable case.
- Our own push implementation is ours to maintain; no push service was reachable in testing.

## Allowed / Not allowed

- Allowed: a new channel reading the same plan; a new kind in the contract (a line in `reminders/README.md`, the
  fixture and both implementations); UnifiedPush as a delivery behind the plan.
- Not allowed: a proprietary push SDK in the default build; web push or any `PushManager` call inside the shell;
  study text (card content, journal text, entries) in a subject, notification or payload; storing the VAPID private
  key unsealed; a reminder sent without the account's opt-in; a second implementation of the plan rule.

## Enforcement

- `server/internal/reminders` tests decode `docs/contracts/reminders/settings.json`, `plan.json` and `unsubscribe.json`; the scheduler
  tests use a fake clock, mailer and push sender.
- `server/internal/webpush` reproduces the RFC 8291 worked example byte for byte.
- `internal/api` route, error and gate walks cover the new routes; `docs/wiki/API-Routes.md` is generated.
- The web repo tests keep `lib/native` free of `@capacitor/*` imports (record 0010) and the service worker's routes
  out of the cache (`lib/pwa/sw/classify.test.ts`).
- Review: that no catalogue key of a reminder carries study content, and that a new background goroutine stops with
  the server's background context.

## Open questions

- UnifiedPush: a distributor-independent delivery behind the plan (later).
- Whether a Play-only flavour is ever shipped (owner decision; #149 is after v1.0).
- Email bounce handling (the mail service has no bounce state).
