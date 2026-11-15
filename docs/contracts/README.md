# Contracts

Rules every qinqin client (Go server, web, future Android/Kotlin) must implement identically. Each rule
has a folder with a README (the rule) and JSON fixtures that all implementations run.

Fixture format: `{"version": 1, "rule": "<name>", "cases": [ ... ]}`. Go tests read the files with
`os.ReadFile` (relative to the test's package), web tests import the JSON directly
(`resolveJsonModule`). A fixture is only changed after re-deriving the value from its source of truth;
never to match an implementation. Add one row per area; a Go or web test must decode each fixture.

| Folder | Rule |
| --- | --- |
| [`study-day/`](study-day/README.md) | The learner's day: per-user zone history, `dayOf`, `dayStart`, `GET/PUT /api/me/time-zone`. Fixtures: `day-of.json`, `day-of-transitions.json`, `day-start.json`, `activity-days.json`, `time-zone-api.json` (Go: `studyday`, `stats`, `api`; web: `lib/time/studyDay.test.ts`) |
| [`levels/`](levels/README.md) | Level sessions of character schemes: unit/kind rules, writing unlock by learner day, ordering, virtual and created card ids. Fixtures: `character-level-queue.json`, `level-card-ids.json` (web: `lib/study/levelQueue.test.ts`, `cardFlow.test.ts`) |
| `auth/` | Sign-in throttling: order of checks, status codes, `Retry-After`, JSON error bodies of login and register. Files: `auth/throttling.md`, `auth/throttle-responses.json` |
