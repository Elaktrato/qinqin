# Outbox durability, release check and update settings (v0.7.0 Stage 1 fix wave)

Branch `fix/v070-stage1-outbox`. Three findings of the independent Stage 1 review:

- **A. Unsent reviews lost on a kill (#35).** The review outbox was a localStorage array that Chromium flushes late
  (a kill within about 5 s of a grade lost reviews the UI had shown as saved), and a review was queued only after its
  POST had failed, so a hanging request left it only in memory.
- **B. Release check poisoned by a cancelled request.** `update.Checker` used the admin request's context for the
  GitHub call: a closed page was recorded as `offline` and cached for 15 minutes, and the mutex was held for the whole
  request.
- **C. `PATCH /api/admin/update/settings` not atomic.** Two UPDATEs and the audit records ran outside a transaction.

## Tasks (test first, small commits)

1. `outboxStore.ts`: IndexedDB store keyed by `event.id`, in-memory mirror, v2 migration, localStorage and memory
   fallback (`outboxStore.test.ts` with `fake-indexeddb`).
2. `ReviewOutbox`: write-ahead `#record`, per-record removal, in-flight guard, `ready()`, `dropWorkspace`,
   `dropForRestore`; the session passes the IndexedDB store; the study history awaits `ready()` (`outboxDurability.test.ts`).
3. `EventLog.post`: 20 s timeout.
4. Contract `pwa/outbox-v3.json` (renamed from v2, `migration` and `order` cases), README, overview, CHANGELOG, wiki, the
   Android spec's #35 finding marked resolved.
5. Server: `update.SaveSettings` in one transaction with its audit records; `Checker.Check` fetches detached from the
   caller's context, without the lock, one shared request.

## Rulings

- Ruling: IndexedDB, one record per review keyed by event id, `durability: 'strict'`, awaited before "saved" — a
  localStorage write is flushed late and a whole-array rewrite loses a concurrent tab's update; IndexedDB gives a commit
  signal and per-record writes — cost if wrong: a browser that ignores `durability` still commits at transaction end
  (no worse than before), and a platform without IndexedDB uses the old localStorage queue.
- Ruling: write-ahead (enqueue before the POST, delete after the answer) rather than a `pagehide` flush — a kill, a
  crash and a battery pull give no `pagehide`; the server already keeps an event id once, so the extra record and a
  crash between answer and delete cost one duplicate POST that is counted once — cost if wrong: one extra write
  transaction per grade (a few ms), and "saved" now waits for it.
- Ruling: the in-memory mirror is per session and filtered by the signed-in user; sign-out ends the session and its
  mirror, the stored items stay for their user (the v2 rule: sign out asks first, "delete them" removes the user's
  records) — #173's rule is "no per-user data leaks into the next session", which holds because every reader filters by
  user id, and the next user's mirror never sends or counts them — cost if wrong: another user's queued item visible
  to code that forgets the filter; the lint of 0009 and the user-switch test (`outboxDurability.test.ts`) guard it.
- Ruling: no contract version bump — the item, the event and the flush rules are unchanged and no route or answer
  changes; storage is web-client-own — cost if wrong: a future second client is not warned that the web changed its
  storage, which it never has to follow.
- Ruling: `fake-indexeddb` 6.2.8 (Apache-2.0) pinned as a devDependency, passed to the store as a factory, never
  installed as a global — tests need a real transaction model, jsdom has none; it ships in no build — cost if wrong:
  one dev dependency to drop.
- Ruling: a 20 s timeout on event writes (`AbortSignal.timeout`), a failure like any other network error — a request
  that never answers must end so the in-flight guard releases and the stored review is retried; offline fails at once
  and is unaffected — cost if wrong: a very slow upload connection retries a batch the server may already have
  (deduplicated by id).
- Ruling: `clearPending` is synchronous for the caller (the mirror is updated at once, the delete commits within
  milliseconds; it returns the promise) — the dialog flows stay as they were — cost if wrong: a kill within
  milliseconds of "delete them" brings the records back, and they would then be sent.
- Ruling: the release check is detached from the request (`context.WithoutCancel`, bounded by the client timeout) and
  shared by concurrent callers, the mutex held only to read and store — a cancelled admin request is not a GitHub
  failure and must not be cached — cost if wrong: one abandoned request still runs up to the 10 s timeout.
- Ruling: `update.SaveSettings` takes the actor and writes the audit records (domain package owns its SQL and
  transaction, 0003) — an audit failure then leaves the setting unchanged — cost if wrong: none beyond the signature.

## Not verified here

No emulator and no browser were available: the force-stop-after-grade step of the Android workflow has not been
re-run; `durability: 'strict'` and `complete` are tested with `fake-indexeddb`, which commits at once.
