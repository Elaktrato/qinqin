# Web architecture handoff (architecture clean-up, phase 3) — 2026-11-24

Phase 3 of #190, in the owner's order:
- the web architecture: #193, #196, #199;
- the postponed features, built as core features: #185, #186, #189;
- last, #195.

Each issue had its own branch from `develop` and went through the same steps:
- a plan in `docs/superpowers/plans/2026-11-24-*.md`, with Rulings and an Execution record;
- a test-first build;
- an independent review (#199 had two: server and web);
- one fix wave;
- orchestrator mutation checks: 4–5 deliberate bugs per issue, every one caught by a test;
- a `--no-ff` merge once CI (`test` and `e2e`) was green.

Nothing went to `main`; there was no tag and no release.

Owner directions given during the phase (2026-11-24), which the plans follow:
- **No backwards compatibility:** routes, payloads, keys and contracts may change, and the changes are logged in
  `docs/contracts/CHANGELOG.md`.
- **Stored data need not survive an upgrade** ("a clean start is fine"). Every break is listed in
  `docs/releases/NEXT.md`. The server must still start on a populated database, and #199's migrations were made
  safe for that.
- **The approved design docs merged to `develop` mid-phase:**
  - `docs/superpowers/specs/2026-11-23-android-shell-design.md`: Android is the web app in a Capacitor shell, which
    replaces the native Kotlin plan.
  - `docs/superpowers/specs/2026-11-24-courses-design.md`: courses.

## 1. What shipped

| Issue | Item | `develop` merge |
|---|---|---|
| #193 | The study data layer. `store.ts`, `history.ts` and `studyData.ts` are gone. In their place: transport (`study/sync/`), a read model, commands (`study/commands/`), and one per-workspace `StudyCache` updated in place. A write no longer pulls all study data first: renaming a deck after the page loaded costs 1 request instead of 22 for 2,000 cards. Rows written in the same second as a load are caught by a follow-up round | `55312f3e` |
| #196 | One state model (record 0009). Runes classes built by factories with injected dependencies. One `AppContext` per tab and one `Session` per signed-in user, which owns every per-user cache and is disposed at sign-out or a user switch. No `svelte/store`, no `*ForTests` resets; #173's registry is replaced. Guard: `stateModel.lint.test.ts` | `b5765fb1` |
| #199 | Code plugins retired (record 0006):<br>- the journal and grammar are core features with typed storage and contracts;<br>- one `keyed_rows` store replaces plugin data;<br>- four feature switches (`flashcards`, `reader`, `journal`, `grammar`);<br>- language profiles (`docs/contracts/languages/profiles.json`: zh, ja, es and a fallback) decide what a language offers;<br>- backup format 2 | `42b690ec` |
| — | A flaky test was a real startup race: the startup reconcile could publish a package revision without its licence texts. The bundled lemma-rules sync now runs before the builder starts | `c04f6514` |
| #185 | AI conversation partner in the journal (`/journal/talk`):<br>- the workspace language at the learner's level, with the journal's corrections and the reader's lookups;<br>- save as an entry;<br>- the learner's own key, rate limits, idempotent turns | `ef0dc8c3` |
| #186 | AI example sentences on demand:<br>- generate, keep, delete or report;<br>- kept sentences are the learner's own, marked AI-written on the entry page and every card;<br>- they must contain the word (the cloze rule); generations are idempotent.<br>This merge also fixed two #185 turn races | `2422f03b` |
| #189 | Profile picture:<br>- upload, crop, replace and remove; "Take a photo" on touch screens;<br>- every upload is re-encoded on the server (no EXIF or metadata), and animated and oversized images are refused;<br>- visible to signed-in users only; audited admin removal;<br>- included in personal and server backups;<br>- image decodes share slots. | `c9a61718` |
| #195 | Web folder rules (record 0004, Accepted): `lib/ui`, `lib/frame`, feature folders, and `lib/components` only for widgets two or more features share. Every loose module and misplaced component moved with `git mv`. Repository tests moved to `apps/web/tests/repo/`. The guard is `tests/repo/folderRules.test.ts`. No behaviour change | `02083145` |

## 2. What changed for users and admins

Everything is in `docs/releases/NEXT.md` (Upgrading, What's new) and `docs/contracts/CHANGELOG.md`.

- **The upgrade wipes** whatever does not convert cleanly (#199):
  - admin-registered plugins, and plugin order and settings;
  - plugin data other than the core rows;
  - journal and grammar rows that do not convert;
  - the plugin origin of decks.

  **Old personal backups no longer restore** (format 2). Make a new backup after upgrading.
- **The Grammar page and the Journal** live at `/grammar` and `/journal`; `/p/<feature>` redirects.
  **Settings → Plugins is gone;** Settings → Features holds the four switches.
- **Regional language tags** such as `zh-TW` now get everything their language has. **Spanish** no longer offers
  writing or tone cards.
- **New:**
  - the conversation partner (#185);
  - AI example sentences (#186);
  - profile pictures (#189).

  All three use the learner's own AI key and the journal's rate limits, apart from the pictures.
- **Server backups** now include `avatars/`. Before #189 they carried no per-user files besides books, packs and audio.

## 3. What you must check by hand

The e2e suite (now 17 tests) covers in Chromium:
- the journal and the grammar page;
- a conversation and AI examples against the fake provider;
- a profile picture upload.

Still manual:

1. **Real AI providers** (your own key):
   - **conversation:** the partner stays in the workspace language, the level feels right, and corrections land
     on the right words;
   - **examples:** quality, level and readings; the "contains the word" check on more Japanese inflections than
     食べた/食べています/食べられない.
2. **A phone and the Android shell:**
   - the conversation box keeps the keyboard open after Send;
   - the camera and photo picker for the profile picture ("Take a photo" opens the front camera);
   - pinch to zoom in the crop;
   - the correction bottom sheet;
   - the back button.
3. **A screen reader:** the conversation's live region reads the reply; focus after Keep/Delete/Report on examples;
   the crop area.
4. **Upgrade an existing instance** with journal entries, grammar progress and settings:
   - the server starts;
   - what converts is there;
   - Settings → Features shows the switches;
   - a new personal backup restores.

   #199's migrations were tested on deliberately messy synthetic databases, never on a copy of a real one.
5. **Sign-in and accounts:**
   - **#196:** sign out and in as another user in a second tab: nothing of the first user shows.
   - **#196's blocker:** regenerate two-step recovery codes; they must stay on screen.
6. **Admin:** remove a user's picture (confirm step, audit log entry); take a server backup and restore it with
   pictures.

## 4. Rulings worth knowing

They are in the plans named above.

- **#193:**
  - The cache refreshes with a delta round when it is older than 8 s, and with a full round every 5 min or
    after a 410.
  - A write the server skipped re-plans once.
- **#196:**
  - A session ends only on sign-out, on expiry, or when `me` names another user; the page tree is keyed on the
    session.
  - #173's registry is removed, not wrapped.
- **#199:**
  - **Storage:** one generic `keyed_rows` store, with an allow-list of key families, for the small settings
    documents.
  - **Not offline:** the journal and grammar are not in the sync pull and not cached offline.
  - **Grammar scores:** the server keeps the best score.
  - **Copying:** migrations 044 and 045 copy in Go with the restore's rules, and 046 keeps one row per key.
- **#185 and #186:**
  - **Idempotency:** every AI call is idempotent by a client id (turn id or request id), and the result is
    stored before the AI slot is released.
  - **In flight:** `in_flight` re-sends with backoff, and a lost answer polls.
  - **Language check:** a reply needs at least half of its letters in the workspace script.
  - **Ownership:** AI examples are per user and entry, so a workspace delete keeps them.
- **#189:**
  - **Crop:** the crop happens on the client; the server re-encodes and centre-crops anyway.
  - **Stored format:** JPEG q85.
  - **Limits:** 5 MB, 8192 px a side, 25 MP and 100 MiB decoded.
  - **Caching:** `private, no-cache` with an ETag.
- **#195:**
  - `lib/features/` holds only the four switchable features; other feature folders stay at the top of `lib/`.
  - The frame counts as a user of a shared component.
  - `ActivityHeatmap`, `ReadingTable` and `ClozeChoice` moved into their single owners, unlike the issue's list:
    each has one user.
  - The "Touched by" line of a record may say `none.`.

## 5. Process notes

- The flaky-test fix (`c04f6514`) had no separate review: it is a small server-only fix. The orchestrator
  reviewed the diff and killed a mutant.
- One #195 fix-wave commit (`bb1d0345`) is not green on its own: a doc test fails until the next commit
  (`245dc3cd`). History was not rewritten. The merge and every commit after it are green.
- #199 and #186 found and fixed earlier bugs:
  - the journal box allowed 80,000 characters while the server takes 50,000;
  - a #185 turn answered 500 instead of the real cause;
  - server backups lacked user files.

## 6. Follow-ups

- **Orphan files:** a book or photo file whose removal fails after a workspace delete stays on disk (from phase 2;
  there is no sweep yet).
- **`qinqin backup`:** the command runs outside the server's users lock, so a picture replaced in the milliseconds
  between its snapshot and its file links can be missing from that backup (#189 Ruling).
- **Restore preview:** the personal restore preview does not list the profile picture.
- **#38:** Android is now the shell design, and a comment on #38 suggests closing it or retitling it to the shell's
  native pieces. The owner decides.

## 7. What's next

- **#190:** closed with this handoff.
- **Queued by the owner after phase 3,** with the same per-issue process:
  1. #211: a bootstrap administrator by default on a fresh install (a generated password shown once, and an
     opt-out).
  2. #42: drop the local-only TBCL and curriculum level-list tooling.
- **Later, by the owner's designs:**
  - the Android shell (`docs/superpowers/specs/2026-11-23-android-shell-design.md`);
  - courses (`docs/superpowers/specs/2026-11-24-courses-design.md`), after #214–#216.

## 8. Gates

On `develop` at `02083145`:
- **Go:** the full run is green, apart from the sandbox-only `internal/ai` IPv6 test.
- **Web:** check 0 errors; build ok.
- **Vitest under Node 26:** 612 files, 12,895 passed.
- **e2e:** 17 passed (3 runs on each branch).
- **Scripts:** script tests and `gen-api-docs --check` ok.
- **CI:** `test` and `e2e` green on every phase 3 merge. #199's `test` needed one rerun for the flaky test that
  `c04f6514` then fixed.
