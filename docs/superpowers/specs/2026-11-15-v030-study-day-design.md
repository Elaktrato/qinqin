# The learner's day and time zone — design (issue #84)

Status: Draft for review (2026-11-15), v0.3.0 work item 1. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`) and can be overruled. Nothing is built. This spec defines
**the learner's day** for everything after it: heatmap and activity (#48), streaks and XP, reading
totals, daily limits (#89), vacation mode (#88), sibling burying (#65), daily goals (#67) and the weekly
summary (#81). The rule is part of the Android contract (`docs/contracts/study-day/`).

## Intent and why

Every "day" in qinqin is a UTC date today: `substr(ts, 1, 10)` in `server/internal/stats/activity.go`,
`toISOString().slice(0, 10)` or `Math.floor(ms / 86_400_000)` in `lib/activity/activity.ts`,
`lib/stats/readingTime.ts`, `lib/study/exp.ts` (XP daily bonus, `dailyStreak`), `lib/events.ts` (session
receipts), `lib/plugins/journal/entryDraft.ts` and `lib/plugins/reader/browse.ts`. A learner in UTC+9
sees evening study on the next day; a learner in UTC−8 has a "day" that ends at 16:00. Limits and
vacation (item 4) need a day that matches the learner's calendar, identical on web and Android, stable
when a device is offline, and stable for the past when the learner moves.

## Goals

- One rule, `dayOf(instant) → YYYY-MM-DD`, with its inverse `dayStart(date) → instant`, implemented
  identically in Go and TypeScript (and later Kotlin) and pinned by shared JSON fixtures.
- The learner's zone is stored on the server **per user**, with a history of changes; the browser
  zone is the default; the learner can change it in Settings.
- `GET /api/stats/activity` buckets by the learner's day; every web consumer listed above moves to it.
- DST (23- and 25-hour days), skipped dates and zone changes never move a past day and never make a
  day repeat.

## Non-goals

- FSRS's own elapsed-day arithmetic (stays as ts-fsrs computes it; see Rulings).
- A "next day starts at 04:00" rollover hour (Anki's setting). YAGNI; the fixtures leave room for it.
- Per-workspace zones, retroactive zone corrections, editing the history.

## Approaches

1. **Snapshot per event**: each event carries the local day it was recorded on. Past days can never
   move, but the server stores `ts` as UTC and drops the offset (`events.Append`), so it needs a new
   column or a payload field on every event type, a backfill for the existing log, and trust in each
   device's own zone (a phone abroad writes "its" day, a laptop at home another). Rejected.
2. **Device-local days** (fold with whatever zone the reading device has): zero storage, but web and
   Android disagree whenever their zones differ and a past day moves when the learner travels. Rejected.
3. **Zone history on the server; every day is recomputed from `ts` with the zone in effect at `ts`
   (CHOSEN).** Events stay as they are (UTC `ts`), offline queues need no zone, all devices agree, and a
   zone change only affects instants after it, so past days never move.

## The rule (contract)

**History.** A user's zone history is an ordered list `H = [(Z₀, from₀ = null), (Z₁, from₁), …]` of IANA
zone names with strictly increasing UTC instants (whole seconds). `from₀ = null` means "since always":
the first zone a user ever sets also applies to all earlier events. A user with no rows has
`H = [("UTC", null)]` (today's behaviour).

**Local date.** `localDate(Z, t)` is the proleptic Gregorian calendar date of instant `t` on the wall
clock of zone `Z` (tzdb rules).

**Floors.** `floor₀ = −∞`; for k ≥ 1, `floorₖ = max(floorₖ₋₁, localDate(Zₖ₋₁, fromₖ))`: the day it
already was, in the old zone, when the change happened.

**dayOf(t).** Let `k` be the last segment with `fromₖ ≤ t` (segment 0 when `t` precedes every change) and
`d = max(localDate(Zₖ, t), floorₖ)`. While `startOfDay(Zₖ, d + 1) ≤ t`, `d` becomes `d + 1` (at most one
step in tzdb since 1970). `dayOf(t) = d`. It is monotone: moving east may skip dates (today ends early),
moving west makes the current day longer, and a clock that goes back across midnight (a DST end shortly
after 00:00, e.g. America/St_Johns until 2010, Antarctica/Casey 2010) keeps the new date; **a date never
repeats**. Equivalently `dayOf(t)` is the greatest `D` with `dayStart(D) ≤ t`.

**startOfDay(Z, D)** is the earliest whole second `t ≥ epoch` whose wall clock in `Z` has reached the
midnight of `D` (`wall(t) = t + offset(Z, t) ≥ UTC(D)`), found without assuming that `localDate` is
monotone (it is not around a clock that goes back across midnight). Let `lo = UTC(D) − 15 h`,
`hi = UTC(D) + 13 h` (every offset lies in −12:00…+14:00, so the interval brackets it), `oLo = offset(lo)`,
`oHi = offset(hi)`. If `oLo = oHi` the answer is `UTC(D) − oLo`. Otherwise there is exactly one
transition `T` in the interval (no two UTC-offset changes in tzdb lie within the 28 hour bracket: the smallest gap between consecutive offset changes of any zone from 1970 to 2037 is 167 h, America/Boa_Vista, America/Noronha and America/Recife in October 2000): `T` is the
first second in `(lo, hi]` with `offset = oHi` (bisection); with `c = UTC(D) − oLo` the answer is `c` when
`c < T`, else `max(T, UTC(D) − oHi)`. This handles midnight DST gaps (America/Santiago starts 2024-09-08
at 01:00 local), dates a zone skipped (Pacific/Apia 2011-12-30) and repeated midnights without relying on
how a platform resolves non-existent local times. **Domain:** the rule is defined for instants and dates
from 1970-01-01 on (local mean time offsets before ~1900 and in-zone date-line moves such as Alaska 1867
break the bracket); earlier instants are clamped to 1970-01-01T00:00:00Z and a `startOfDay` before the
epoch is the epoch.

**dayStart(D)** is the earliest instant with `dayOf(t) ≥ D`. For each segment `k` in order with
`[lo, hi) = [fromₖ, fromₖ₊₁)` (−∞ / +∞ at the ends): if `k ≥ 1` and `floorₖ ≥ D`, return `lo`; else
`c = max(startOfDay(Zₖ, D), lo)`; if `c < hi`, return `c`; otherwise continue with the next segment.

**Day window.** Day `D` is `[dayStart(D), dayStart(D + 1))`. A window is 23 h or 25 h around DST,
any length around a zone change, and empty for a skipped date (which then simply has no activity).
`D + 1` is civil-date arithmetic, never `+ 86 400 s`.

**Today.** `today = dayOf(now)`. "Yesterday", "the last 7 days" and every streak count civil dates
backwards from `today`.

**Retroactive first zone.** The FIRST zone a user ever sets (the web's `ifUnset` browser default or the first choice in Settings) applies to the whole existing log, not only to events after it; only later changes take effect from their instant.

**Events with no zone yet.** None exist conceptually: events before the first change belong to
segment 0, whose zone is either the first zone the user set (from = null) or UTC while the user has set
none. The web sets the browser zone on the first load after the upgrade, so the existing log is read
once, in the learner's real zone; that is the fix #84 asks for, not a moved day.

**Unusable zones.** A client whose time-zone database does not know a stored zone (an older ICU or
Android without `America/Ciudad_Juarez`) computes that segment in UTC and shows a warning in Settings;
it never throws. The server validates against Go's embedded tzdata only.

Ruling: a date never repeats inside a zone either (a clock that goes back across midnight keeps the new
date) and `startOfDay` is computed from offsets, not by bisecting `localDate` — an independent check of every
UTC offset transition 2010-2030 found `America/St_Johns` 2010-11-07 (and Antarctica/Casey) where raw
`localDate` is not monotone and a bisection returns the wrong start; the day windows the SQL join uses and
`dayOf` must agree on every instant — cost: for one hour a clock may show the previous date while the day
is already the next (zones affected: St_Johns/Moncton/Goose_Bay until 2010, Casey 2010).

Ruling: zone history per user, recomputed at read time (Approach 3) — one source of truth, no event
format change, offline-safe — cost if wrong: every client must load the (tiny) history before it
computes a day; a client that forgets falls back to UTC and shows yesterday's numbers.

Ruling: a zone change is effective at the server instant of the `PUT`, never backdated, and the
history cannot be edited — past days can never move — cost: a learner who set the wrong zone keeps it
for the days before the correction.

Ruling: days never repeat (the floor clamp) — limits, streaks and "first review today" stay simple
set-of-dates logic; the alternative (raw local dates) lets a westward flight replay yesterday — cost: the
day of a westward move can last up to 26 h longer.

Ruling: IANA names only (`Etc/GMT-9` style fixed zones are IANA too); no raw offsets — offsets have no
DST, so "+01:00" would be wrong half the year for most learners — cost: #84's body suggested offsets.

Ruling: no rollover hour (midnight is the boundary) — YAGNI; a later `rollover` field on the history
row can shift `localDate` by a fixed amount without changing the fixture format — cost: night owls
studying at 00:30 count for the new day.

## Storage and API

Migration `035_user_time_zones.sql` (032–034 are provisionally held by the accounts plans, #64; the
runner applies any missing version, the merger renumbers if needed):

```sql
CREATE TABLE user_time_zones (
    user_id INTEGER NOT NULL REFERENCES users(id),
    seq INTEGER NOT NULL,            -- 0, 1, 2 … in effect order
    zone TEXT NOT NULL,              -- IANA name as validated by Go
    effective_from TEXT,             -- NULL for seq 0; UTC RFC 3339 seconds otherwise
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, seq)
);
```

- `GET /api/me/time-zone` → `200 {"zone":"Europe/Berlin","history":[{"zone":"Europe/Berlin","from":null}]}`;
  with no rows `{"zone":null,"history":[]}` (the server then computes in UTC).
- `PUT /api/me/time-zone` body `{"zone":"Asia/Tokyo"}` or `{"zone":"Asia/Tokyo","ifUnset":true}` (cap
  1 KiB) → `200` with the same shape. With zero rows any valid zone (UTC too) becomes seq 0 with
  `from = null`. With rows: `ifUnset` → no change (the first-run default of a second device never becomes
  a zone change); the same zone as the current one → no row; otherwise a row with `from = server now`
  truncated to seconds, at least the previous `from + 1 s`.
- Errors are JSON `{"error","message"}` (the accounts convention, #64): 400 `unknown_time_zone` (empty,
  longer than 64 bytes, not `[A-Za-z0-9_+\-/]`, `Local`, `Factory`, `posixrules`, a `posix/` or `right/`
  prefix, or not loadable from Go's **embedded** tzdata via `time/tzdata`, never the host's zoneinfo, so
  the test image and the Alpine runtime agree), 400 `bad_request`, 413 `too_large`, 409
  `too_many_changes` beyond 500 rows, 401 without a token.
- Only the caller's own history is readable or writable (user isolation test). Never logged. The routes
  live under `/api/me/` on purpose (per-user settings, not authentication; `/api/auth/me` stays).

Ruling: no auto-update when the device zone differs — travelling would rewrite the learner's day on
every flight and two devices in different zones would fight; Settings shows a notice and a one-click
"Use Asia/Tokyo from now on" instead — cost: a learner who moves must notice the hint.

## Server bucketing

New package `server/internal/studyday`: `Date` (civil date: `ParseDate`, `String`, `AddDays`,
`DaysUntil`), `History` (`New([]Change)`, `UTCHistory()`, `DayOf`, `DayStart`, `Windows(from, to)`),
`Load` and `Set` over the table. `stats.Activity` takes `[]studyday.Window` instead of `from, to` and
replaces `substr(ts, 1, 10)` with a join against the windows passed as one JSON parameter, in exactly
this shape: `FROM json_each(?10) AS w CROSS JOIN study_events INDEXED BY idx_study_events_user_type_ts
WHERE user_id = ?1 AND type = ?2 AND ts >= ?3 AND ts < ?4 AND ts >= w.value->>'lo' AND ts < w.value->>'hi'`
(`CROSS JOIN` fixes `json_each` as the outer loop; `?3/?4` stay the overall bounds = first Start, last End;
the day is `w.value->>'d'`). Every statement then refers to `?10`, so `ruleArgs` always returns 10
arguments with nil in unused slots. Window bounds are formatted exactly like stored `ts`
(`2006-01-02T15:04:05Z`), so text comparison stays chronological. The browse seed default of
`GET /api/library/sources/{source}/browse` (`handlers_sources.go`, today the UTC date) becomes the
caller's learner day. `GET /api/stats/activity`: `from`/`to`
are learner dates, the default is `today` and the 90 days before, the 366-day cap stays, and the
response gains `"timeZone": "<current zone or UTC>"`. The issue's `tz` query parameter is not added: the
server already knows the zone, and a parameter would let two clients disagree.

## Web

- `lib/time/studyDay.ts` (pure): `studyDay(history) → { zone, dayOf(ms), dayStart(day), today(now) }`,
  `addDays(day, n)`, `daysBetweenDates(a, b)`, using `Intl.DateTimeFormat` with `timeZone`, a cache of
  `dayStart` results and a fast path: `dayOf` first checks the last few cached `[dayStart, nextStart)`
  windows by comparison, so folding 100k reviews needs only a few hundred `Intl` calls.
- `lib/time/zone.ts`: loads the history once per login (memory + a `localStorage` copy keyed by user id
  for offline starts), detects `Intl.DateTimeFormat().resolvedOptions().timeZone`, sends it with
  `ifUnset: true`, exposes `currentStudyDay()` (provisional browser-zone history until the load
  finishes) and clears the copy on logout.
- Settings → **Study** tab (new `study` entry in `lib/settings/tabs.ts`; vacation and limits join it in
  item 4): `lib/settings/StudyDaySettings.svelte` (thin; logic in `lib/settings/zoneSettings.ts`):
  current zone, a searchable select of `Intl.supportedValuesOf('timeZone')` (guarded when absent; the
  current zone is always listed), the mismatch notice comparing **canonicalised** names (Chrome reports
  `Asia/Calcutta` where Firefox and Go say `Asia/Kolkata`), and "Changes apply from now on; past days stay
  as they were."
- Consumers move to the learner's day: heatmap fold and window (`activity.ts`, `ActivityHeatmap.svelte`,
  `api/stats.ts`), `readingTotals` (+ `ReadingTimeWidget.svelte`), `xpFromReviews` daily bonus and
  `dailyStreak`, session receipts, the journal's once-per-day event and new-entry date
  (`journal/store.ts`), and the reader's daily browse seed (`browse.ts`, `SourceBrowser.svelte`). Each
  takes a `StudyDay` (or a `dayOf` function) argument; none calls `Intl` directly.

Ruling: the XP daily bonus and streaks are recomputed with local days for the whole history — they are
derived, never stored, and UTC days were the bug — cost: a learner's XP total and best streak may
change by a few points or days once after the upgrade. The once-per-day `session` receipt keys change
from the UTC to the local date, so the upgrade day may record one extra `session` event (accepted).

## Android notes (contract)

The client reads `GET /api/me/time-zone` at login and on every sync, caches it, and implements
`dayOf`/`dayStart` with `java.time` (`ZoneId`, `ZonedDateTime`) using the same binary search (not
`atStartOfDay`, to stay identical on odd zones). Offline it uses the cached history; it never writes
the zone on its own except the first-run default when the server has none. tzdb versions may differ
between Go, ICU and Android: the fixtures use past dates whose rules are settled.

## Contract fixtures (`docs/contracts/study-day/`)

- `README.md` — the rule above, verbatim, plus the fixture format.
- `day-of.json` — `{history, ts, day}` cases: UTC default (no history); Asia/Tokyo past midnight;
  America/New_York 23:59:59; Europe/Berlin 2025-03-30 (23 h) and 2025-10-26 (25 h); Asia/Kathmandu
  +05:45; Australia/Lord_Howe (30-minute DST); Pacific/Apia skipped 2011-12-30; America/Santiago
  midnight gap 2024-09-08; an eastward change (Berlin → Tokyo) and a westward change (Tokyo → Los
  Angeles, clamp to the floor, both sides of the change instant); a change exactly at the old zone's
  midnight; a change that skips a whole date (Etc/GMT+12 → Pacific/Kiritimati); a 2001 instant before the
  first change (from = null).
- `day-start.json` — `{history, day, start}` for the same zones and changes, including empty windows and
  the floor branch.
- `activity-days.json` — events at boundary instants plus a history → expected `GET /api/stats/activity`
  cells (server test fixture; documents how Android's heatmap reads them).
- `time-zone-api.json` — example GET/PUT bodies and every error status.

## Risks

- tzdb drift between platforms for future rules: fixtures stay in the past.
- `json_each` day join on 400k events: the existing large-log test must stay within its bound; the
  fallback is one range scan returning `ts` and a Go-side bucketing pass.
- Consumers forgetting the zone: every former UTC call site is listed in the plan and a test scans the
  web source (`import.meta.glob(..., '?raw')`) for UTC day patterns outside an allow-list.
- Revised after a builder check that verified all fixture instants against tzdb with Python `zoneinfo`.
