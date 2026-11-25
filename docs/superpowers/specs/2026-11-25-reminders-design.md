# Study reminders: due cards, goals and streaks; email and web push (#137, #138, #139)

Status: implemented on `feature/reminders-137`. Contract: `docs/contracts/reminders/`. Decision record:
`docs/architecture/0011-reminders-and-push.md`. Plan: `docs/superpowers/plans/2026-11-25-reminders.md`.

## 1. What this is

Opt-in reminders for three things: **cards are due**, **the daily goal is not met yet**, **the streak is about to
break**. Three channels, each its own switch: an **email** digest, **web push** to a browser or an installed web
app, and **device notifications** in the Android shell (local, scheduled on the phone). Per account, off by
default, with up to three preferred local times, quiet hours that wrap midnight, vacation days respected (#88)
and at most one message per kind per learner day. No message carries study content, only counts.

## 2. The facts the design stands on

- **The server has no scheduler.** It stores the review log; due dates come from an FSRS replay with the study
  clock (`scheduler/`, ts-fsrs in the web app), and goals and streaks from `goals/`, also client-only ("the
  server is unchanged"). "The server's due counts" do not exist. Porting FSRS, the study clock, the queue admission
  and the goal rules to Go would be a second implementation of a contract that has a fixture set per rule — months of
  work and a permanent drift risk — for a feature that needs three numbers.
- The Android app is the web app in a WebView (record 0010), so the shell runs the same JavaScript as the browser.
- Mail exists (`internal/mail`: queue, hourly cap, catalogue per language, no addresses in logs); the web app has a
  service worker; the keyed rows (`keyed/`) are the convention for per-user settings that sync.

## 3. Design

### 3.1 Settings: a keyed row

`reminders`, user-global, `{version, enabled, kinds, times, quiet, channels}` (contract). It syncs to every device,
the server reads it for email and push, the shell reads it for local notifications. Unknown keys are kept; a newer
version is read leniently and never overwritten. Push subscriptions are not in it: they are per device and live in
`push_subscriptions`; `channels.push` allows them.

### 3.2 Facts: clients publish what only they can compute

`PUT /api/reminders/facts` per workspace: `dueNow`, `dueBuckets` (cards that come due later, by UTC hour, 14 days),
the goal status of today, the streak, the vacation dates of the next 60 days. The web app computes them from the same
code that draws the decks page and the goal ring (`lib/reminders/facts.ts`) and publishes them, debounced, after start,
sync and study changes, **only when the account has reminders enabled**. A facts record is a cache: replaced by the
next one, deleted with the account or the workspace, never exported, never read as study data.

### 3.3 The plan: one pure function

`reminders.Plan(now, zone history, settings, facts, days)` (Go) answers "what to remind and when": for each local
date and kind, candidate times minus quiet hours minus the past; `due` at the first candidate with the count due
**by then** (due now plus the buckets before it, vacation workspaces excluded); `goal` and `streak` at the last
candidate (the evening) when a goal is open or a streak at risk. The rules, including how a plan reasons about days
after the facts (a streak survives one more day only if today is met), are in the contract and pinned by
`plan.json`. `GET /api/reminders/plan` returns the slots. The web mirror (`lib/reminders/plan.ts`) only parses the
answer: **one implementation of the rule**, in Go.

### 3.4 Delivery

- **Email (#138).** `reminders.Scheduler` ticks every 5 minutes under the server's background context (stops with
  it, #170, waited for before the database closes). For each account with the row enabled and the email channel on, a
  verified address, mail configured: slots whose time fell due within the last 2 hours; each (account, channel, kind,
  learner day) is **claimed** in `reminder_deliveries` before sending (`INSERT OR IGNORE`), so a restart or a second
  tick cannot send twice; kinds due in one tick go out as **one digest**. The subject never carries study data;
  the body has counts, the study link and a one-click unsubscribe link; the headers `List-Unsubscribe` and
  `List-Unsubscribe-Post` (RFC 8058) are set. Texts come from the mail catalogue (`mail.reminder*`), in the account's
  interface language, falling back to English. Hourly cap: the existing global cap. The log has no bodies and no
  addresses.
- **Web push (#139).** Own implementation of RFC 8291 (`aes128gcm`), RFC 8292 (VAPID, ES256) and RFC 8030
  (`TTL`, `Urgency`) in `internal/webpush`, standard library only, tested against the RFC 8291 worked example.
  Requests go through `netguard` (no private targets, no redirects); 404 and 410 delete the subscription. Payload
  `{v, kind, count, route}`. The VAPID key pair is made on first use; the private scalar is sealed with
  `QINQIN_SECRET` in `push_vapid`. The service worker shows the notification (texts from a small localised map the
  page stores for it) and opens `/study` on click. The same once-per-kind-per-day claim applies.
- **Device notifications (shell).** No push service. The web app, inside the shell and with the device channel on and
  the permission granted, fetches the plan (7 days) and schedules local notifications through the
  `lib/native/notifications` API; it re-plans on start, settings change, after facts are published (sync) and daily,
  and cancels everything on sign-out and opt-out. Facts first, then plan.

### 3.5 Unsubscribe

A signed token (`HMAC-SHA256` under a key derived from `QINQIN_SECRET`, no expiry) in every mail. `GET` shows a page
and changes nothing (link scanners), `POST` (the button, or a mail client's one-click) writes `channels.email = false`
into the row and keeps every other key. Re-enabling is the Settings switch.

## 4. Rulings

Ruling: the F-Droid-safe path is **local notifications scheduled on the device from the server's plan**; real push
reaches Android only through UnifiedPush (FOSS, a later option behind the same plan) or a separate Play-only build
flavour — no Firebase or other proprietary push SDK in the default build, and web push is never run inside the shell
— because the app must be installable from F-Droid and an Android push needs either Google's service or a
distributor the user chose — cost if wrong: a delivery that is not exact (Android may defer a local alarm in Doze,
and a plan is only as fresh as the last time the app ran), and a user who wants a push while the app has not run for
days gets what the last plan holds (7 days).

Ruling: clients publish **facts**, the server does not derive them — the scheduler, study clock and goal rules exist
only in the clients and porting them is out of proportion — cost if wrong: stale facts (a learner who stops opening
the app keeps getting the reminders the last facts imply, assuming nothing was studied, for at most 30 days; then
nothing) and a day-old count when another device studied.

Ruling: web push is **our own 250-line implementation**, not `webpush-go` — standard library only means no new
dependency to vet (the library is MIT, but it pulls in further modules to vet), no supply-chain surface, and
the code is tested against the RFC's own example — cost if wrong: we maintain the cryptography glue (HKDF, AES-GCM,
ES256); a push service that rejects a valid message is found only on a real service, which no test here reaches.

Ruling: the VAPID private key is sealed with `QINQIN_SECRET` like the SMTP password and the TOTP secrets; without
a usable secret web push is unavailable (`503 push_unavailable`) — because a key stored in clear would make every
backup of the database a push-forgery kit — cost if wrong: an instance without the secret cannot offer web push (it
cannot offer SMTP either, so email reminders are absent too). Losing or changing the secret without keeping the
previous one makes the stored key unreadable; push then stays unavailable until an administrator deletes the
`push_vapid` row, after which devices must subscribe again.

Ruling: subscription endpoints and keys are stored in clear in `push_subscriptions` — the endpoint is useless without
the sealed VAPID key, sealing every row would add a rotation column pair for no gain — cost if wrong: a database leak
exposes which push service each device uses.

Ruling: **at most one delivery per (account, channel, kind, learner day)**, claimed before sending, so a failed send
is not retried — a bug or a restart loop must never spam, and an hour-capped retry would complicate the log for a
reminder that is stale in two hours anyway — cost if wrong: one lost reminder on an SMTP error. The one exception
is the hourly mail cap, which releases the claim so the next tick retries.

Ruling: **one email digest** for the kinds due in one tick, one notification per kind for push and device — the
issue recommends a digest and an email is read as a whole, while notifications are tapped one by one — cost if
wrong: three taps instead of one on a day with all three kinds.

Ruling: a plan assumes the learner studies nothing before a slot, so tomorrow's goal reminder is planned even if
today's facts say everything is on track — facts cannot know tomorrow — cost if wrong: a reminder for a goal met on
another device that has not synced; the client re-plans after every sync, which cancels it.

Ruling: defaults are **off**, time **18:00**, quiet hours **22:00–08:00** (the user can switch them to none) —
the issue recommends opt-in and a default quiet window protects a user who picks 23:00 — cost if wrong: a night owl
who wants 23:00 must switch the quiet hours off.

Ruling: reminders are **per account**, not per workspace; due counts add across workspaces, a workspace on vacation
adds nothing that day — the issue's open question; one account, one phone, one set of notifications — cost if wrong:
a learner who wants Japanese reminders at 08:00 and Chinese at 20:00 cannot have them.

Ruling: the **weekly summary stays in-app**, and **no administrator switch** is added: an administrator controls
the channels by configuring (or not) SMTP and `QINQIN_SECRET` — fewer settings, the contract and the open questions
list stay small — cost if wrong: an administrator who wants email on but reminders off has no switch (a later setting
would be a new row, not a contract change).

Ruling: the unsubscribe token has **no expiry** and can only switch the email channel off — an old mail must still
work (RFC 8058 clients) and the worst a stolen link does is stop emails — cost if wrong: a leaked mail lets its holder
turn off that account's reminder emails; rotating `QINQIN_SECRET` without the previous one invalidates every old link.

## 5. Not covered, on purpose

Android native push (UnifiedPush, a Play flavour), reminders for the reader or journal, per-kind times, snooze,
a delivery report for the user, email bounces (the mail service has no bounce state; an address that rejects mail
fails at the SMTP hop and is logged by category only).

## 6. What was not verified here

No real SMTP server (a fake SMTP server in tests), no real push service (a local TLS server in tests; the RFC 8291
example proves the encryption, nothing proves a browser's acceptance), no browser, no device or emulator.
