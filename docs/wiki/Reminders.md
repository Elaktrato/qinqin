# Reminders

qinqin can remind you to study: **cards are due**, **today's daily goal is not met yet**, or **your streak is about to
break**. Reminders are **off until you turn them on**, they are per account, and they never contain what you study:
only counts ("12 cards are due"). Settings, **Notifications** (`/settings?tab=notifications`).

## What you choose

- **Reminders on or off** (the master switch). Off means nothing is sent or scheduled, whatever else is set.
- **Which reminders:** due cards, goal not met, streak at risk.
- **When:** up to three times of day in your own time zone (the one qinqin uses for your study day, see
  [Settings tour](Settings-tour)). The due-card reminder uses the first time that is allowed; the goal and streak
  reminders use the last one, the evening.
- **Quiet hours:** a window with no reminders, default 22:00 to 08:00; it may cross midnight, and you can turn it off.
- **Where:** each channel has its own switch: **email**, **web push** and, in the Android app, **device notifications**.
- **Send a test** for a channel, to see that it works.

At most **one reminder per kind per day** per channel. Nothing is sent when nothing is due, when the goal is met, or on
a [vacation](Flashcards-decks-limits-vacation) day. A reminder is dropped if its time passed more than two hours
ago (for example after a server restart).

## How it knows what is due

qinqin's server stores your reviews but does not schedule cards: the schedule is worked out in the app on your device.
So the app, while you use it, sends the server a small summary (how many cards are due now and by hour over the next
two weeks, the state of today's goal and streak, your vacation days) and the server plans from it. Only accounts that
turned reminders on send it. The summary has counts and dates, no card text. If you stop opening qinqin, the server
keeps using the last summary for up to 30 days, assuming you studied nothing since. Due counts are grouped **by UTC
hour**: a reminder set for 18:00 counts the cards due until 18:59 UTC, not until 18:00 in your zone. In a zone whose
offset is a whole number of hours that is exactly the hour you set; in a zone at :30 or :45 (India, Nepal, parts of
Australia) the grouping is shifted by half an hour or three quarters, so a count can include cards due up to that much
after the minute you chose, or leave out those due just before it. It is a count for a nudge, not a promise.

## Email

Needs a **verified email address** (Settings, Account) and an administrator who has set up
[email](Admin-email-and-security). The kinds that are due at the same time arrive as **one** email. The subject never
names your study; the body has counts, a link to qinqin and **one-click unsubscribe**: the link in every message, and
the unsubscribe button of mail apps that show one. Unsubscribing only turns the email channel off; turn it on again in
Settings. A failed send is final for that day, by design: nothing is retried, so a mail server
outage loses that day's reminder (a reminder that arrives hours late is worse than none, and a retry loop could send
twice). The same holds for web push.

## Web push (browser or installed web app)

Web push sends a notification to a device through its browser's push service, even when qinqin is not open. In
Settings, Notifications, **turn it on for this device** (the browser asks for permission; only after your click).
Every device that did so is listed there and can be removed. Limits:

- It needs **HTTPS**; a plain-HTTP address on your network cannot receive push.
- **Android (Chrome, Firefox, Edge):** works in the browser and in the installed web app.
- **iPhone and iPad:** only for qinqin **added to the Home Screen**, iOS 16.4 or later; not in a Safari tab.
- Desktop browsers work while the browser is running.
- The server needs `QINQIN_SECRET` (the push key is kept sealed with it). Without it the switch says push is not
  available.
- A notification is only held by the push service while it is still useful: until two hours after its time, and never
  across your quiet hours. A device that is off for longer does not get it later.
- A device whose push address stops answering is removed after five failed sends in a row (and at once when the push
  service says it is gone); turn push on again on that device to re-add it.
- Turning reminders on does not send the slot that has already passed today; the first one is the next time you set.
- Signing out on a device removes that device's subscription.
- It does not run in the Android app, which uses device notifications instead.

## Android app: device notifications

The Android app schedules the reminders **on the phone** from the server's plan: no Google service and no push server
is involved, so it also works from F-Droid. It re-plans when you open the app, after syncing and once a day, and
cancels everything when you sign out, change the server or turn the switch off. See [The Android app](Android).

Limits of device notifications:

- **Seven days.** The plan covers the next 7 days and nothing replans while the app is closed. If you do not open the
  app for a week, the notifications run out; opening it (or returning to it from another app) plans the next week.
  A background replan is planned as a later improvement.
- **Offline.** The counts in a notification ("12 cards are due") are fixed when it is scheduled. Reviews you do on this
  phone are taken into account: if they cannot be sent while you are offline, the remaining notifications of today are
  removed rather than shown with old numbers. Reviews done on another device cannot be known until this phone is
  online again, so a count may be out of date until then.

## For administrators

Email reminders use the SMTP settings; web push needs `QINQIN_SECRET`. There is no instance-wide reminder switch: no
mail setup, no email reminders; no secret, no web push. `QINQIN_VAPID_SUBJECT` (optional) is the contact address push
services may use ("mailto:you@example.org" or an https address; default: the project page). Per-account data:
subscriptions are deleted with the account; the delivery log (account, channel, kind, day, outcome; no text) is kept
for 90 days. Design and rulings: [the design](https://github.com/Elaktrato/qinqin/blob/develop/docs/superpowers/specs/2026-11-25-reminders-design.md),
[record 0011](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0011-reminders-and-push.md); the
routes are in [API routes](API-Routes), the rules in `docs/contracts/reminders/`.

**Rotating `QINQIN_SECRET`.** The push key is re-sealed with the new secret at the restart when the old one is in
`QINQIN_SECRET_PREVIOUS` ([rotating](Admin-backup-and-recovery#rotating-qinqin_secret)). If the old secret is lost and
was never kept as the previous one, the push key cannot be read any more: push stays unavailable and the test says so.
There is no button for it. Recover by hand: stop the server and, in the database in `/data`, run
`DELETE FROM push_subscriptions; DELETE FROM push_vapid;`, then start it. A new key is made on first use, and everyone
has to turn push on again on each device (the old subscriptions belong to the old key and could not be used with the
new one). Email and device reminders are unaffected.
