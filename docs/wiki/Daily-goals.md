# Daily goals

A daily goal is one target per study day for a workspace, for example "50 flashcard reviews" or "20 minutes of reading". qinqin shows how far today is, says when the goal is reached, and counts how many days in a row you reached it. Progress is worked out from what you did; it is never stored or typed in.

## What can be a goal

Set the goal under Settings, Study, **Daily goal** (`/settings?tab=study`). Pick what to count and a target:

| Choice | Counts | Target |
|---|---|---|
| Flashcard reviews | every review you grade, learning steps included (the same count as the heatmap) | 1 to 9999 |
| New cards | cards reviewed for the first time that day | 1 to 9999 |
| Flashcard study time | the time spent answering cards, at most 60 seconds per card, so an open tab does not count as study | 1 to 1440 minutes |
| Reading, Journal entries, Grammar lessons, Course lessons, drill answers and other activity | whatever the activity statistics count for that source (reading in minutes, journal entries as a count, grammar lessons finished, each lesson once a day; course lessons, unit tests and section exams, each once a day) | 1 to 9999, or 1 to 1440 minutes |

There is one goal per workspace. Choose **No daily goal** or press **Remove goal** to stop. If your new-card goal is above the workspace's daily new-card limit, Settings says so ("Your daily new-card limit is 20; raise it to reach this goal"); nothing is changed for you.

## Which day counts

Every day here is your learner's day in your time zone (see [Settings tour](Settings-tour)), not a UTC date: a review at 23:30 in Tokyo counts for that Tokyo date on every device.

A change to the goal applies from today, for the whole of today. Earlier days keep the goal they had, so raising the target never turns yesterday's reached goal into a missed one. Changing the goal several times on one day keeps only the last change.

## Reached, open and missed

- **Goal reached**, with a check mark, once the amount reaches the target.
- Today is open until then; a past day that did not reach the target is missed.
- A vacation day ([Decks, limits and vacation](Flashcards-decks-limits-vacation)) pauses the goal: "On vacation — goal paused", whatever you did that day.
- If the goal counts an activity that is no longer a source of the statistics, it says "This goal's activity is no longer counted" and those days count as no goal. That happens when a server update stops counting an activity type; switching a feature off in your own Settings does not do it (its activity still counts).

## Goal streak

The goal streak counts the days in a row on which you reached the goal, ending today, or yesterday while today is still open. Vacation days neither extend nor break it; a missed day or a day without a goal breaks it. It looks back one year at most; a streak that reaches that far shows a plus, for example "Goal streak: 340+ days" (vacation days in the year are not counted). Turn **Show goal streak** off to hide it; your review streak is not affected.

## Where it shows

- **Home**: the **Daily goal** widget with a progress ring, "32 of 50 flashcard reviews today" and the goal streak; without a goal it offers **Set a daily goal**. New accounts have it on the home page after the flashcards summary; an existing home layout is not changed (add it under Settings, Home).
- **Weekly summary**: "Daily goal met on 4 of 6 days" for the week ([Weekly summary](Weekly-summary)); vacation days and days without a goal are left out, and today counts once it is reached.
- **Flashcards widget**: a small ring ("32/50") and the goal streak next to the review streak. Without a goal the widget looks as before.
- **Activity heatmap**: in this workspace each day's tooltip names its progress and flower stage, for example "21 of 50 — Bud" (Nothing yet, Sprout, Bud, Opening, In bloom, Resting on vacation days). The stage is text only until the flower drawings exist ([Stats and the heatmap](Stats-and-heatmap)).

The ring is read out by screen readers with its numbers ("Goal reached: 62 of 50 flashcard reviews today"); the words are on screen too, so nothing depends on colour, and it does not animate when your system asks for reduced motion.

## Offline

New cards and flashcard study time count reviews waiting in this device's offline outbox at once. Reviews, reading and other activity are counted by the server, so a review recorded offline counts there once it has been sent ([Install and offline](Install-and-offline)). A goal on new cards or flashcard study time works fully offline; a goal on reviews, reading or other activity shows "Could not load" with **Try again** until the server can be reached.

## For client implementers

The goal is the workspace keyed row `goals:workspace` ([Core data API](Core-data-api)), with a history of target changes. Rules and fixtures: `docs/contracts/goals/` (see [API overview](API-Overview)).
