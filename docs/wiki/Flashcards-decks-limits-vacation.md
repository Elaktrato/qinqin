# Decks, daily limits and vacation mode

## The Decks page

Flashcards have their own page, **Decks** (`/flashcards`; old `/p/flashcards` links still work). At the top are your overall numbers: words, studied, mastered, retention, and reviews of the last 30 learner days. Each deck below shows its words and cards, what is due and new, a progress bar and a **Study** button that starts a session over that deck only, with your saved limits and the card types the deck enables.

Opening a deck lists its words. You can search by word, reading or id, filter by state, card kind or due now, sort, and select several words to **Move** or **Delete** (with a ten-second Undo). Per word you can **Remove** or **Turn back on** its reverse and cloze cards. A deck's **Settings** renames or deletes it (the confirmation says where its cards go) and holds the Reverse and Cloze switches and **New cards**: the order new cards come in — in the order added (the default), most frequent first (offered when a frequency list of the workspace language is installed; the list's name is shown), or by the levels of an installed scheme (HSK, JLPT, …). The order changes only which new cards come first: reviews, due order and your daily limits stay as they are. General can be configured but not renamed or deleted.

"Mastered" means a memory score of 80 or more. "Young" is a word in review that holds under 21 days.

## Level decks

Below your decks the page lists installed level packs (HSK, JLPT and others) as read-only **level decks**, collapsed by scheme. A level shows how many of its words are already in your decks, can be studied as a level session, and can be copied with **Add to my decks** into a new deck named like the level (adding again never makes a second one) or into a deck you pick. Adding again only adds what is new; words you already have join the deck without losing history.

## Starter decks

When the server has a frequency list for the workspace language, the page shows **Starter decks · <list name>** above the level decks: **Top 500**, **Top 1000** and **Top 2000**, the most frequent words of that list, computed by the server from the installed list (nothing extra is shipped). A list word written in kana is the word written only in kana when the dictionary has one with a priority (で is the particle, not 出), and it is shown (and copied into your cards) in the list's kana. Each names the list and its licence ("From Jiten frequency list · CC BY-SA 4.0", with a link to Data and licences). Words you already know (a memory score of 80 or more, or marked with **I know this** in the Reader) are left out and counted ("12 known words skipped"). **Add to my decks** copies the rest into a deck named like the starter deck, ordered most frequent first ("Added 480 words; 20 you know were skipped"); adding again adds only what is new, and **Open my copy** opens it. A starter deck has no session of its own: study the copy. Without a frequency list for the language the page says so; an administrator can install one in Settings, Data (Japanese ships with the Jiten list; no Chinese list with a clear licence is bundled).

## Daily limits

Each deck admits at most N new cards (default 20) and N reviews (default 200) per study day, however many sessions you start. Set the workspace value under Settings, Study, Daily limits; it is the default for every deck. A deck's own settings can use that value, its own number, or no limit. A card in several decks must fit every one. Cards you are not shown stay due and come back later; scheduling is not touched. The home widget shows what is left today ("18 reviews, 5 new left today"). A [daily goal](Daily-goals) of new cards above the workspace's new-card limit cannot be reached by studying; Settings says so, and does not raise the limit for you.

## Vacation mode

Settings, Study, Vacation freezes your reviews while you are away. On a vacation day nothing is due and no new cards are offered, your streak is neither extended nor broken, and when you come back there is no pile of overdue cards: the scheduler measures the time since your last review without the vacation days. Your review log is never rewritten.

- A vacation applies to all workspaces or the ones you choose, starts now or on a date, and ends on a date or when you end it.
- "Start now" after you studied today starts tomorrow, so what you did today stays as recorded.
- You see "Vacation until ..." on the study page, "On vacation until ..." in the home widget, "On vacation" in the decks view, and hatched dates in the heatmap.
- The FSRS optimizer ignores vacation time too.
- A [daily goal](Daily-goals) and its goal streak are paused on vacation days, like the review streak.
- The [weekly summary](Weekly-summary) marks vacation days in its day strip and leaves them out of days active and goal days; what you did on them still counts in the totals.

All days here are your learner's day in your time zone (Settings, Study); see [Settings tour](Settings-tour).

## For client implementers

Vacations are user-global plugin-data rows `vacation:<ULID>` of the study namespace `qinqin-flashcards`; decks, cards, deck settings and limits are typed rows of the sync pull and push (`docs/contracts/study/`); the daily goal is the workspace row `goals:workspace` (`docs/contracts/goals/`). Rules and fixtures: `docs/contracts/scheduler/` and `docs/contracts/decks/` (see [API overview](API-Overview)). The new-card order is the field `newOrder` of the deck's settings row (legacy key `deckcfg:<deckId>`) (`{by: "added"}`, `{by: "frequency"}` or `{by: "level", packId}`; absent or malformed = added), applied only to new items by the rule of `docs/contracts/frequency/` (`new-order.json`); ranks come from `POST /api/entries/frequency-ranks`, starter decks from `GET /api/frequency-packs/{id}/top?size=500|1000|2000`, and a copy's id is `d-frq-…` (`starter-deck-ids.json`). Known words follow `known.json`.
