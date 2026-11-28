-- Grammar lesson progress becomes study events (#277, docs/contracts/grammar/):
-- a finished lesson run is a `grammar` event {point, mode, score, total} like
-- every other study progress, and the progress is replayed from the events.
-- The Go step of this migration (step056.go) writes one event per
-- grammar_progress row (its best score at its completedAt) and then drops
-- the table; SQL cannot make ULIDs or parse the stamps. A row the rules
-- refuse is dropped (NEXT.md says what an upgrade loses).

SELECT 1;
