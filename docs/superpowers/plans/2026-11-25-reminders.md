# Study reminders — plan (issues #137, #138, #139)

Design: `docs/superpowers/specs/2026-11-25-reminders-design.md`. Contract: `docs/contracts/reminders/`. Test first in
every task; small commits. Server work and web work ran in parallel against the contract.

## Server (Go)

1. **Contract and fixtures** — `docs/contracts/reminders/` (README, `settings.json`, `plan.json`, `unsubscribe.json`),
   keyed family `reminders`.
2. **Settings and plan** — `internal/reminders/settings.go`, `plan.go`; tests decode the fixtures (the plan cases
   were derived by hand from the rules, not from the code).
3. **Unsubscribe token** — `token.go`, `secretbox.Sealer.MAC`; the fixture was computed independently (Python HMAC).
4. **Web push** — `internal/webpush`: RFC 8291 encryption (RFC example as the test), VAPID ES256, the guarded sender,
   endpoint validation; stdlib only.
5. **Storage** — migration 052 (`reminder_facts`, `push_subscriptions`, `reminder_deliveries`, `push_vapid`), user
   deletion registry, workspace deletion rule, `store.go` (facts, subscriptions, claims, sealed VAPID key).
6. **Mail** — `List-Unsubscribe` headers, the reminder kind and its counts-only lines, `SendReminder`.
7. **Scheduler** — `scheduler.go`: tick, window, claim-before-send, digest, cap handling, push fan-out and 404/410
   cleanup; fake clock and fake mailer/push in tests; started in `serve` under the background context.
8. **API** — `handlers_reminders.go`: facts, plan, test, vapid-key, subscriptions, unsubscribe; route table, error
   catalogue (`push_unavailable`, `no_subscription`, `too_many_subscriptions`, `delivery_failed`), routes fixture,
   wiki API pages; contract version 3 and CHANGELOG.

## Web

9. **Settings row, facts, plan parser, publisher** (`lib/reminders/`).
10. **Settings → Notifications tab** (opt-in, kinds, times, quiet hours, channels, test, device list).
11. **Web push** — `lib/pwa/push.ts`, the service worker `push`/`notificationclick` handlers and the page-stored text
    map, never cached.
12. **Android scheduler** — `lib/reminders/device/`: port interface, fake, scheduler; the real port is wired at
    integration (`setDevicePort`).

## Docs

13. ADR 0011 and the index, wiki page Reminders, sidebar, Install-and-offline, Android notifications paragraph,
    environment variable `QINQIN_VAPID_SUBJECT`, contracts README and overview, CHANGELOG.

## Verify

`go vet ./... && go test ./...`; `npm run check` and the full vitest in `apps/web`; the scripts tests; the pull
request's CI (test and e2e).

## Review fixes (stage 2)

Server findings from the stage 2 review. Test-first; branch `fix/stage2-reminders-server`.

- Ruling: an http public URL sends reminder mail without List-Unsubscribe and List-Unsubscribe-Post (the body link stays); `Compose` stays strict about https — RFC 8058 one-click requires https and a lenient `Compose` could let a bad header through — cost if wrong: a mail app shows no unsubscribe button on http-only installs (they should use https anyway).
- Ruling: push TTL = min(rest of the 2 h window, time to the next quiet-hours start), floor 1 minute, and 1 minute when already inside quiet hours — a push held by the service past the window or into the night defeats both — cost if wrong: a device that is offline for a few minutes may miss a reminder it would otherwise have shown.
- Ruling: slots earlier than the settings row's `updated_at` are ignored — enabling (or editing) at 18:30 must not fire the 18:00 slot — cost if wrong: saving any settings change inside the two-hour window skips a slot that was due before the save.
- Ruling: a push subscription is dropped after 5 consecutive failed sends (`failures` column, reset on success; 404/410 still drop at once); each account's sends share a 45 s context deadline and the per-send HTTP timeout is 10 s (was 20 s), and a send cut off by our own deadline is not counted as a failure — a dead endpoint otherwise costs 20 s per kind forever and one slow account stalls everyone behind it — cost if wrong: a flaky endpoint failing 5 times in about two days is removed and the user must re-enable push on that device. Sends stay serial per account (no extra concurrency to reason about).
- Ruling: a failed send is final for that day — deliberate; documented in the wiki and ADR 0011 — one claim per channel, kind and day is what stops doubles after a restart — cost if wrong: a transient outage loses that day's reminder.
- Ruling: due counts stay in UTC-hour buckets; documented that an 18:00 slot counts through 18:59 UTC and what that means in :30 and :45 zones — the facts contract is fixed and the client publishes it — cost if wrong: a count in such a zone can be off by the zone's offset (a nudge, not a promise).
- Ruling: no "reset push keys" admin action; documented a manual recovery instead (stop, delete `push_subscriptions` and `push_vapid`, start) — a safe route needs an admin endpoint with re-authentication, contract, UI and tests for a rare recoverable case — cost if wrong: an admin who lost the secret needs shell access to the database.
- Ruling: rotation at start now also re-seals the push key (it was only re-sealed on first push use, so dropping `QINQIN_SECRET_PREVIOUS` right after the restart could lose it) — small, covered by a test — cost if wrong: none beyond one extra read at start.
