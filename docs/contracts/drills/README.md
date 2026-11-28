# Drills (`drill.<id>` events) and the Practice area

The drills framework (v0.9.0 plan §3; plan `docs/superpowers/plans/2026-11-28-drills-framework.md`). A **drill** asks
about **items** outside the flashcard queue: the conjugation trainer (#178), measure words and counters (#179), tone
pairs (#180) and look-alike characters (#228). Each answer is a study event; each item has its own spaced schedule,
replayed from its answers through FSRS exactly as a card's reviews are; nothing is stored. The drills live in one
**Practice** area (the core feature `practice`, `features/`), with a round per drill and a "Practise weakest" round
across them. Drill work counts in the heatmap, the weekly summary, goals, EXP and the streak.

## Drills and items

- A **drill id** matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at most 32 characters, and is never `weakest` (the name of
  the round across drills, `/practice/weakest`).
- An **item key** names one scheduled item inside a drill: a string of **1 to 200 code points** (not UTF-16 units)
  with no white space (the Unicode property `White_Space`, the ideographic space U+3000 and the no-break space
  included) and no control character (`Cc`, C0, DEL and C1). Its inner structure is the drill's own. The planned
  shapes (each drill's builder pins its own in its contract):

  | Drill | Item | Example |
  | --- | --- | --- |
  | conjugation (#178) | word × form family: `<entryId>:<formFamily>` | `1234:te-form` |
  | measure words and counters (#179) | the noun: `<entryId>` | `5678` |
  | tone pairs (#180) | the pair of citation tones: `<t1>-<t2>` (`5` neutral) | `3-4` |
  | look-alike characters (#228) | the set: its characters in the set's order | `未末` |

- The **schedule key is the item**, whatever the mode: a drill that wants separate schedules per direction puts the
  direction into its item keys.

## The event

```
{type: "drill.<id>", payload: {item: "<item key>", mode: "<mode>", grade: 1 | 2 | 3 | 4}}
```

- One type per drill: `drill.` and the drill id.
- `mode` is the drill's direction or exercise (`produce`, `recognise`, `choose`, …): the id pattern, at most 32
  characters. Every mode of a drill counts for the same item.
- `grade` is an FSRS grade as for a review: 1 Again, 2 Hard, 3 Good, 4 Easy. A drill that only knows right and wrong
  writes 3 or 1; a right answer after a hint can be 2.
- Member order is part of the shape (`build`). A drill may add members **after** these (#228 the character chosen,
  `given`); a client ignores members it does not know.
- Written once per answered question, in the item's workspace, through the normal event path (the web: the session's
  outbox, `ReviewOutbox.recordEvent`, write-ahead, retried, seen by the study history while it waits).

A client reads an event as an **answer** (`parse`) when its type is `drill.` + a valid drill id, the payload is an
object (not an array) with a valid item key, a valid mode and an integer grade 1..4, and `ts` parses as an instant.
A client parses **every** valid drill id, also one it does not offer (a newer client's drill). Anything else is no
answer and counts nowhere.

## The registry

`registry` in `drills.json` lists the drills a **server counts as activity** and a client offers as an activity
source (goals, the weekly summary): `tone-pairs` (#180, items and rules in `tones/pairs.json`). Go `drills.IDs` and the web's `DRILL_IDS`
(`lib/studycore/drills.ts`) must equal it (both decode the fixture).

### Adding a drill

1. Its id and item key shape in its own plan and contract; the id in `registry` (`drills.json`), Go `drills.IDs`
   (`server/internal/drills/drills.go`) and web `DRILL_IDS`. The activity rule follows (one `count` rule, feature
   `practice`); add it to `events/activity.json` `rules` too.
2. The activity words `activity.source.drill.<id in camel case>.label` / `.count`, as literal keys in
   `DRILL_WORDS` (web `lib/activity/sources.ts`; a test checks one pair per registered id).
3. The web drill definition (`lib/features/practice/drills.ts`, `DrillDef`): title, description, the languages it
   applies to, its candidate items and its question component, and optionally an `overview` shown under the drill on
   the Practice list (its items, its own answers, the states; the tone-pair grid). The framework does the rest: the
   Practice list, the rounds (also the drill's own weakest round, `/practice/<id>/weakest`), the events, the
   schedule, the counting.

## Schedule (`schedule.json`)

Per drill item of a workspace: its answers in `(instant of ts, id)` order are replayed as a card's reviews
(`scheduler/README.md`, "Replay"): `createEmptyCard(t₀)`, then `next(card, tᵢ, grade)` for each answer, on the
**study clock** (vacation days frozen, `scheduler/README.md`: the instants fed are `max(v(tᵢ), fᵢ₋₁)`, the due is
mapped back with `inverse`), with the **default FSRS weights** `default_w` (never the workspace's flashcard parameter
set). The result: `due`, `stability`, `difficulty`, `state` (0 New, 1 Learning, 2 Review, 3 Relearning) and the
number of `answers`.

**Retrievability** at `now`: `forgetting_curve(w, elapsed, stability)` (ts-fsrs) with
`elapsed = max(0, v(now) − f_last) / 86 400 000` days, `f_last` the study-clock instant of the last answer as fed.

The fixture is generated from plain ts-fsrs by an oracle that shares no code with the web module
(`scripts/contracts/gen-drills-fixtures.mjs`, `--check` exits 1 when it is stale); `clock` lists frozen runs
`{a, days}` as the study clock's runs. Compare `due` as an instant and the numbers to 8 decimals.

## Rounds (`pick.json`)

- **A drill's round** (`round`): from the drill's candidate items (the items the learner can practise now, in the
  order the drill introduces them; duplicates count once), in this order and at most **20** (`roundSize`):
  1. the **due** items (`due <= now`), earliest due first, then by item key;
  2. **new** items (no answer), in the drill's order, at most **10** (`newPerRound`);
  3. the items **not due yet** (`ahead`), lowest retrievability first, then earliest due, then item key.

  An answered item that is no longer a candidate (the word left the decks) is not picked. A round is never empty
  while the drill has candidates. A wrong item is not asked again inside the round; FSRS makes it due a minute later.
- **Practise weakest** (`weakest`): over the drills that apply to the workspace (`candidates`, each with its candidate
  items), every candidate item with at least one answer, **lowest retrievability at `now` first**, then drill id, then
  item key; at most 20. Unseen items have no measure and are not weak.

String order is plain UTF-16 code unit order.

## What an answer counts for (`counting.json`)

- **Activity** (`events/activity.json`, `stats/`): one `count` rule per **registered** drill: type `drill.<id>`,
  feature `practice`. Every answer is a point (the payload is not read, as for the scripts trainer); `raw` is the
  same number, so a daily goal `activity:drill.<id>` (`goals/`) counts answers, and the weekly summary shows it as an
  activity row. A drill the server has not registered scores nothing.
- **EXP** (`scheduler/xp.json`): `answerXp` 5 plus the review grade bonus (Again 0, Hard 0, Good 5, Easy 10) per
  answer; the daily bonus stays a bonus for a day with a review.
- **Streak** (`scheduler/streak.json`): a learner day with an answer counts like a day with a review, everywhere the
  streak is shown, and for the milestones' `streak` and `days-active` families (`milestones/`). Vacation days are
  neutral.

## The Practice area (web)

`/practice` lists the drills that apply to the workspace language, each with its due, learning and new counts and a
"Practise" button, and "Practise weakest" once an item has an answer; `/practice/<id>` is a drill's round and
`/practice/weakest` the round across drills; `/practice/<id>/weakest` is the `weakest` pick over that drill alone (the
tone-pair grid's "Practise my weakest pairs"). Practice is in the navigation only while a drill applies to the
workspace language. Every screen fits a 360 px phone and shows readings only through the romanisation settings
(`settings/README.md`, `romanisation`).

| File | Rule | Decoded by |
| --- | --- | --- |
| `drills.json` | `constants`, `registry`, `ids`, `items`, `build`, `parse` | web: `apps/web/src/lib/studycore/drills.contract.test.ts`; Go: `server/internal/drills/drills_contract_test.go` |
| `schedule.json` | the replay and retrievability of each item | web: `apps/web/src/lib/studycore/drills.contract.test.ts` |
| `pick.json` | `round`, `weakest` | web: `apps/web/src/lib/studycore/drills.contract.test.ts` |
| `counting.json` | `activity` (cells of registered drills), `xp`, `streak` | Go: `server/internal/stats/contract_drills_test.go` (`activity`); web: `apps/web/src/lib/studycore/drills.counting.test.ts` (`xp`, `streak`) |

The server has no FSRS (schedules are derived on the client, as for flashcards), so `schedule.json` and `pick.json`
are web fixtures; a second client (Android) decodes them too.
