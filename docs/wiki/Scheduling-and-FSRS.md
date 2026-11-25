# Scheduling and the FSRS optimizer

qinqin schedules reviews with FSRS (the `ts-fsrs` library). A card's next due date is computed from its whole review history; schedules are never stored. That is why two devices that reviewed offline merge cleanly, and why vacation days can be removed from the history without rewriting it (see [Decks, limits and vacation](Flashcards-decks-limits-vacation)).

## The interval on each grade button

In a study session every grade button shows the interval that grade would give (see [Flashcards: study sessions](Flashcards-study-sessions)). It is computed by replaying the card's history with the same parameters and study clock as the grade itself, at the moment you finished the card, so it is exactly the schedule you get. The label rounds: up to a minute `<1m`, then minutes, hours (under a day), days (under 30 days), months (30 days each, under a year) and years with one decimal; the unit letters follow your interface language. The rule and its fixtures are in `docs/contracts/scheduler/` (`next-intervals.json`, `interval-text.json`).

## Scheduling page

The advanced study settings (`/study/advanced`, from **Advanced settings** in the study modal) have a link "Scheduling: …" (for example "Scheduling: default parameters" or "optimised on 3 Nov 2026") that opens `/study/scheduling`; Settings → Study links to it too. It tunes the FSRS parameters of the current workspace:

- **Active** shows which parameter set is in use ("Use defaults" returns to the standard parameters).
- **Optimise** fits parameters to your own review history in the browser (the work runs on your device, nothing is sent anywhere). It needs enough reviews: at least 400 labelled reviews, and it warns when you have fewer than 1000.
- A candidate set is shown with a **Preview** and a held-out check comparing it to the current parameters: how many cards would be due now and in the next 7 and 30 days, the median interval, the cards whose due date moves, and the fit on your earlier and most recent reviews (log loss). A warning appears when many more cards would be due right away. You **Apply** or **Discard** it; mastery scores and Word Salad tiers recompute too, since they use stability. Applying can be undone right after.
- **Saved sets** lists earlier sets (optimised or imported) to use again or delete.
- **Import / export** exchange the parameter weights as text (17, 19 or 21 numbers, as in Anki); **Copy active** copies the set in use.

Vacation days are ignored when the optimizer reads your history.

## Notes

- The design is in the repository: `docs/superpowers/specs/2026-11-15-fsrs-optimizer-design.md`.
- The optimizer has been checked by unit and fixture tests. Its behaviour on a long real-world review history on your devices has not been verified by the developers in a browser.
- Rules for other clients: `docs/contracts/scheduler/` (the optimizer steps fixture `optimizer-steps.json`).
