# Weekly summary

The weekly summary shows what you did in one workspace over one week, Monday to Sunday, compared with the week before. It is in the app only: there is no email and nothing is sent anywhere. The numbers are worked out from what you did each time you open it; nothing is stored.

Open it under **Stats**, tab **Week** (`/stats/week`), or from the **This week** widget on the home page (its link **See the week**).

## Which week

A week is Monday to Sunday in your own days: your time zone, as set in [Settings tour](Settings-tour), not UTC dates. A review at 23:30 on a Monday in Berlin belongs to that Monday. A week in which the clocks change still has seven days. If you moved across the date line and a date never happened for you, that day is shown as "no such day" and is not counted.

The **Previous week** and **Next week** arrows step through the weeks; at the oldest week or in the current week the arrow is disabled rather than removed, so the layout does not jump. You can go back 52 weeks. The current week says **In progress**; its days after today are shown as upcoming and are not counted.

## What the numbers mean

| Row | Counts |
|---|---|
| Reviews | every flashcard review you graded (the same count as the heatmap and the daily goal) |
| New cards | cards reviewed for the first time that week |
| Flashcard study time | time spent answering cards, at most 60 seconds per card |
| Reading | minutes read in the Reader |
| Journal entries | journal entries written |
| Other activity | each further activity type the server counted this week or last week |
| Days active | days on which you did anything that counts (vacation days are left out, see below); today joins the count once you have done something today |
| Streak | your streak (days with a review or a finished grammar lesson) at the end of the week (today for the current week) |
| Words reaching mature | words whose flashcard became mature that week: in review with a stability of 21 days or more, as on the decks view. A word that became mature and slipped back in the same week does not count |
| Characters learned | Chinese and Japanese workspaces only: characters whose score reached 80 of 100 that week, as on the character map. This row appears a moment after the others ("Counting characters…") |
| Daily goal | the days on which you reached your [daily goal](Daily-goals) out of the days it counted; today counts once its goal is reached |

The Week tab puts four numbers first — **Reviews**, **New cards**, **Flashcard study time** and **Journal entries** — each with its change from last week. When the journal is switched off, **Reading** takes the fourth place; every other row is listed under **More this week**. Below the four numbers the paired bars show each day of the week beside the same weekday of the week before: the accent bar is this week, the muted one last week, both scaled to the busiest day of the two weeks. The whole of last week is drawn, even while the four numbers compare only up to the same weekday.

## Compared with last week

Each number says how it compares with the week before: "12 more than last week", "3 fewer than last week" or "Same as last week". While the week is in progress it compares with last week **up to the same weekday** ("Compared with Monday to Wednesday last week", the whole of last Wednesday included), so a Wednesday is not compared with a whole week. With nothing in the week before (your first week, or after a break) it says "Nothing last week to compare". The trend arrows are decoration; the words say the same.

## Vacation days

A [vacation](Flashcards-decks-limits-vacation) day is marked in the day strip (home widget) or the bar column (Week tab) and is neutral: it does not count for or against **Days active** or the daily goal, and it never breaks the streak. Anything you did on a vacation day still counts in the totals. A week that was vacation from start to end says **On vacation all week**.

## The day strip and the bars

On the Week tab the paired bars carry each day's state (active, not active, vacation, upcoming, "no such day") in the column's tooltip and in a screen-reader list, for example "Monday: 42 points this week, 30 last week, active"; the visible legend names **This week** and **Last week**. The home widget keeps the seven-box strip: active (a tick, filled), not active (a dot), vacation (V, dashed), upcoming (dotted) and "no such day" (a dash), each with its full description as a tooltip and for screen readers.

## Offline

Without a connection the summary still shows what this device knows: new cards, study time, the streak and mature words. Reviews, reading, journal entries and other activity say "Not available offline"; so does **Characters learned** when the language's character list was not loaded yet in this session. **Retry** loads them again. Days active then counts flashcard reviews only and says so.

## Milestones

Above the summary a card names milestones you reached and have not seen yet ("1,000 reviews", "a 7-day streak", "HSK 1 complete"); **Dismiss** puts it away for good. Below it, the **Milestones** section lists every milestone you have reached, newest first, with its date as muted text and new ones marked **New**. The summary's **Milestone this week** line names the milestones of the week shown. See [Milestones](Milestones).

## The home widget

**This week** shows the current week so far: reviews, new cards, study time (flashcards and reading together), days active with the day strip and the streak, each compared with last week up to the same weekday. Offline its study time is the flashcard time alone, marked "(flashcards only)". New accounts have it on the home page after the daily goal; an existing home layout is not changed (add it under Settings, Home).

## Related

[Stats and heatmap](Stats-and-heatmap), [Daily goals](Daily-goals), [Milestones](Milestones). Rules for other clients: `docs/contracts/weekly/`.
