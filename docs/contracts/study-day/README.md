# Study day contract

The learner's day and time zone (issue #84). The rule below is copied verbatim from
`docs/superpowers/specs/2026-11-15-v030-study-day-design.md`; every client (Go server, web, Android)
implements it and runs the JSON fixtures in this folder. Fixtures win over code.

## The rule

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
transition `T` in the interval (tzdb since 1970 never has two offset changes within 7 days): `T` is the
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

## Fixtures

All files are `{"version": 1, "rule": "...", "cases": [...]}`. Instants are RFC 3339 UTC with whole
seconds (`2026-11-15T15:30:00Z`); days are `YYYY-MM-DD`. A `history` is the list of
`{"zone": "<IANA name>", "from": "<instant>" | null}` in effect order; `[]` means UTC. Every `note` says
how the value was derived. All values were derived from tzdb (Python `zoneinfo`, with an independent
brute-force implementation of the rule) and are past dates with settled rules.

| File | Case fields | Meaning |
| --- | --- | --- |
| `day-of.json` | `name, note, history, ts, day` | `dayOf(ts) == day` |
| `day-of-transitions.json` | `[zone, ts, day]` rows | single-zone `dayOf` one second before every UTC offset change 2010-2030, at it, and 24 h later |
| `day-start.json` | `name, note, history, day, start` | `dayStart(day) == start` (an empty window has `dayStart(D) == dayStart(D + 1)`) |
| `activity-days.json` | `history, events, from, to, cells` | `GET /api/stats/activity` cells for a given history (server test) |
| `time-zone-api.json` | `name, request, status, body, setup?` | `GET`/`PUT /api/me/time-zone`; `"<server now>"` matches any instant |

Instants before 1970-01-01T00:00:00Z are clamped to it (`day-of.json`, "before 1970 clamps").
