# Decks, daily limits and vacation mode

## The Decks page

The flashcards plugin has its own page, **Decks** (`/p/flashcards`). At the top are your overall numbers: words, studied, mastered, retention, and reviews of the last 30 learner days. Each deck below shows its words and cards, what is due and new, a progress bar and a **Study** button that starts a session over that deck only, with your saved limits and the card types the deck enables.

Opening a deck lists its words. You can search by word, reading or id, filter by state, card kind or due now, sort, and select several words to **Move** or **Delete** (with a ten-second Undo). Per word you can **Remove** or **Turn back on** its reverse and cloze cards. A deck's **Settings** renames or deletes it (the confirmation says where its cards go) and holds the Reverse and Cloze switches. General can be configured but not renamed or deleted.

"Mastered" means a memory score of 80 or more. "Young" is a word in review that holds under 21 days.

## Level decks

Below your decks the page lists installed level packs (HSK, JLPT and others) as read-only **level decks**, collapsed by scheme. A level shows how many of its words are already in your decks, can be studied as a level session, and can be copied with **Add to my decks** into a new deck named like the level (adding again never makes a second one) or into a deck you pick. Adding again only adds what is new; words you already have join the deck without losing history.

## Daily limits

Each deck admits at most N new cards (default 20) and N reviews (default 200) per study day, however many sessions you start. Set the workspace value under Settings, Study, Daily limits; it is the default for every deck. A deck's own settings can use that value, its own number, or no limit. A card in several decks must fit every one. Cards you are not shown stay due and come back later; scheduling is not touched. The home widget shows what is left today ("18 reviews, 5 new left today"). A [daily goal](Daily-goals) of new cards above the workspace's new-card limit cannot be reached by studying; Settings says so, and does not raise the limit for you.

## Vacation mode

Settings, Study, Vacation freezes your reviews while you are away. On a vacation day nothing is due and no new cards are offered, your streak is neither extended nor broken, and when you come back there is no pile of overdue cards: the scheduler measures the time since your last review without the vacation days. Your review log is never rewritten.

- A vacation applies to all workspaces or the ones you choose, starts now or on a date, and ends on a date or when you end it.
- "Start now" after you studied today starts tomorrow, so what you did today stays as recorded.
- You see "Vacation until ..." on the study page, "On vacation until ..." in the home widget, "On vacation" in the decks view, and hatched dates in the heatmap.
- The FSRS optimizer ignores vacation time too.
- A [daily goal](Daily-goals) and its goal streak are paused on vacation days, like the review streak.

All days here are your learner's day in your time zone (Settings, Study); see [Settings tour](Settings-tour).

## For client implementers

Vacations are user-global plugin-data rows `vacation:<ULID>`; limits are the workspace rows `limits:workspace` and `limits:deck:<deckId>` of `qinqin-flashcards`; the daily goal is the workspace row `goals:workspace` (`docs/contracts/goals/`). Rules and fixtures: `docs/contracts/scheduler/` and `docs/contracts/decks/` (see [API overview](API-Overview)).
