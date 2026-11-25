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
