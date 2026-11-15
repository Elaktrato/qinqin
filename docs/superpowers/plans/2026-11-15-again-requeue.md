# Again re-show within the session (issue #31)

Goal: a card graded Again comes back later in the same session, Anki learning-step style, without double counting.

## Rulings

- Ruling: an Again card re-enters after 4 other cards (REQUEUE_GAP = 4), or at the end when fewer remain — Anki's learning step feel, short enough to still be in working memory, long enough not to be an echo — cost if wrong: one constant to change.
- Ruling: at most one pending re-show per card — a second Again on the re-show schedules the next one only after the first is consumed — avoids piles of the same card — cost: none.
- Ruling: a re-show graded Hard, Good or Easy leaves the queue; Again re-queues again, capped at 3 re-shows per card (MAX_RESHOWS = 3) — a leech must not trap the session — cost: a card failed 4 times in one sitting is simply left to FSRS.
- Ruling: re-show grades are NOT recorded: no review event, no FSRS write, no XP/EXP, streak, heatmap or summary review count. The original Again is the single review — the re-show is in-session practice only, so stability and XP cannot be inflated or farmed — cost: the second answer does not feed FSRS (FSRS already treats Again as the lapse).
- Ruling: the re-show uses the same exercise kind and same sentence for word salad/writing/tone (tiles reshuffle through the existing review-count seed) — the learner failed that exercise; retrying it is the point, and switching would mix card kinds' scheduling — cost: none.
- Ruling: progress counts unique cards ("3 / 10"); during re-shows the position stays and the header adds "+ n to repeat"; re-shown cards carry an "Again" badge — the total never grows, which keeps the counter honest — cost: none.
- Ruling: re-shows do not consume the new/review limits (the queue is already built) and are independent of companions (a companion is its own card id). Level and deck sessions use the same logic — cost: none.
- Ruling: no persistence; the runner is in-memory today and a reload rebuilds the session from the log, where the Again card is now a reviewed card — adding storage for a few minutes of state is not worth it — cost: a reload forgets pending re-shows.
- Ruling: the summary keeps counting recorded reviews (= unique cards) and adds a "re-shown" line — cost: none.

## Tasks

1. `lib/study/requeue.ts` + tests (pure): requeueAfterGrade, removeAt, progressOf. Ordering rules pinned.
2. Wire runner: after a successful grade, call requeueAfterGrade; re-show grades skip gradeItem/recordReview; `{#key}` on index; Again badge; progress text; summary line; dropping a re-show removes by index.
3. Gates, real-app check.
