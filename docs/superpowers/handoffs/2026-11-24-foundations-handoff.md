# Foundations handoff (architecture clean-up, phase 1) — 2026-11-24

Phase 1 of #190, in the owner's order: #198, #133 (skipped), #191, #197, #157. Each issue had its own branch
from `develop` and went through these steps:
- a short plan in `docs/superpowers/plans/2026-11-23-*.md`, with Rulings and an Execution record;
- a test-first or test-guarded build;
- an independent review and one fix wave;
- mutation checks by the orchestrator;
- a `--no-ff` merge once CI was green.

Nothing went to `main`; no tag and no release.

## 1. What shipped

| Issue | Item | `develop` merge |
|---|---|---|
| #198 | v0.3 compatibility layer removed (see the list below). Old backups still restore. A contract changelog was started. A release-notes draft was written | `a2a5091b` |
| #133 | Skipped as the owner asked: the tooling is merged, and the packs must be built by the owner (tatoeba.org is not reachable from here) | — |
| #191 | Architecture decision records in `docs/architecture/` (0001–0006) with a doc test | `a609a10f` |
| #197 | `internal/dbtest`: a template database migrated once per process. Shared web study builders. No wall-clock assertions in unit tests. A test-only hash-cost hook. Go suite 422 s → 113 s | `c1ab7768` |
| #157 | Playwright end-to-end suite and a CI `e2e` job (record 0007). It also fixed offline preparation missing opt-in card kinds | `a5a2ed31` |

What #198 removed:
- the legacy pull;
- the legacy plugin-data view;
- the synthesized data-pack plugin rows (#169);
- the v1 offline outbox;
- the pre-v0.2.0 branches.

Contract changes are logged in `docs/contracts/CHANGELOG.md`, which #198 started. The next release notes are drafted
in `docs/releases/NEXT.md`.

## 2. What you must check by hand

The browser suite now covers these flows in Chromium on every push:
- sign-in;
- a study session, with Back/Z and mixed types;
- reader lookup;
- offline sync, exactly once;
- the phone bottom bar and the side-menu option;
- search, add to deck;
- workspace switch;
- registration.

You no longer need to check those by hand in Chromium. What is still manual (the full list is in
`docs/wiki/Development.md`):

1. **Firefox, Safari and a real phone:**
   - installing the app;
   - the home-screen app;
   - safe areas;
   - the on-screen keyboard;
   - the update bar.
2. **Card kinds the suite does not cover:** writing, tone, sentence and cloze cards; stroke animations; audio.
3. **Admin side:** admin pages, backups, two-step sign-in and email.
4. **Content:** the journal and grammar lessons.
5. **Removed v0.3 layer (#198):**
   - Settings → Plugins lists only real plugins.
   - The Grammar page lists every installed grammar pack.
   - Restoring an old personal backup still works.
6. **Offline with reverse cards (#157 fix):** with reverse cards switched on for a deck, a freshly opened
   installed app prepares those cards for offline use. "Could not load this word" must not appear offline.

## 3. Rulings worth knowing

All of them are in the plans.

- **#198:**
  - Old-format personal backups are still accepted, through restore only.
  - A data pack's id is now an unknown plugin everywhere (404).
  - Reviews that a pre-v0.4.0 copy cached and never sent are not sent after the upgrade. This is in `NEXT.md`.
  - A restore clears only the restoring user's queued reviews.
- **#191:**
  - A record's "Touched by" line names the issues whose merge must update it.
  - The doc test checks every path and identifier that an Accepted record names.
- **#197:**
  - Tests copy the template database and never migrate their own: there is a per-function AST guard, and a deliberate
    reopen is marked `// reopen`.
  - Timing tests count operations.
  - `auth.SetHashCostForTests` panics outside test binaries.
- **#157:**
  - The whole suite is the gate (no nightly split), Chromium only, with no retries.
  - Traces, screenshots, videos and server logs are uploaded only on failure and kept 7 days.
  - A browser request to any non-local host fails the test.
  - Locators are role and text based, so that #193, #195 and #196 can move code without breaking it.
  - The suite must stay green through phases 2 and 3.

## 4. Follow-ups noted for later issues

- **#193** (study data layer):
  - The study page reads only the first pull round, so a card written in the same second appears on the next
    visit. The sync contract allows this (the #157 review). Acceptance item: re-read or merge later rounds.
  - Derive `V2_STUDY_COLLECTIONS` from `STUDY_COLLECTIONS` (open item in record 0002).
- **#199:** `isHiddenBuiltin` keeps two core rows unhidden only for v0.3 shells. It is a contract change, so remove
  it with #199.
- **#195:** `lib/study/UnreadableRowsNotice.svelte` is a UI component in a logic folder (record 0004).

## 5. What's next

- **Phase 2:**
  - #192, one pack system: `internal/pack` and one pack-type table; the seed order stays the same; a "how to add a
    pack type" record.
  - #194, business logic out of the API handlers into domain packages.
- **Phase 3:** #193, #196, #199, then #185, #186, #189 and last #195.

## 6. Gates

On `develop` at `a5a2ed31`:
- web check: 0 errors; build ok;
- full vitest under Node 26: 12,592 passed;
- e2e: 13 tests, 10 runs in a row green, 21–25 s each;
- script tests and `gen-api-docs --check`: ok;
- full Go run: green apart from the sandbox-only `internal/ai` IPv6 test.

CI on `a5a2ed31`: `test` and the first `e2e` run both green. The e2e job took 2 min 42 s.
