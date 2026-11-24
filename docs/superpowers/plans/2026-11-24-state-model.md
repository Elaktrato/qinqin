# Plan — the web state model (#196)

Issue #196 (phase 3 of #190). Branch `feature/196-state-model` from `develop` at 55312f3e, worktree
`.claude/worktrees/196-state`. A refactor with no intended user-visible change: the web app's shared state moves
onto one model (runes classes built by factories with injected dependencies, owned by one app context and one
per-session context, reached by components through Svelte context). Owner direction (2026-11-24): no backwards
compatibility (internal APIs, module names and stored client keys may change) and stored data need not survive.
The decision is recorded in `docs/architecture/0009-web-state-model.md`.

## Where it starts (55312f3e)

- Two reactivity models: `svelte/store` in `auth.ts`, `workspaces.ts`, `notices.ts`, `pwa/offlineState.ts`,
  `plugins/states.ts`, `account/logoutFlow.ts`, `pwa/install.ts`, `pwa/register.ts`, `study/unreadable.ts`
  (and `get()` reads in `workspaceGone.ts`, `prepareRuntime.ts`, `signOut.ts`, `loadMilestones.ts`), read with
  `$store` in about 60 components; runes in 13 `*.svelte.ts` modules, five of them module singletons
  (`themeStore`, `navLayoutStore`, `packFaces`, `pageFrame`, the journal entries cache).
- 33 modules keep per-user data in module-level `Map`s and `let`s and register a clear with #173's
  `onSessionEnd`; 7 of them guard late answers with `sessionEpoch()`. `auth.ts` subscribes to its own store to
  end the session on a user switch, and the outbox user is mirrored into `study/outboxUser.ts`.
- Test resets: `resetOutboxForTests`, `resetMilestonesForTests`, `resetOutboxUserForTests`; about 80 test files
  `.set()` module stores before rendering.

## Target

`lib/context/`:
- `deps.ts`: the injected dependencies (`AppDeps`: the API client, the two Web Storage areas, the clock, timers,
  the window to listen on) and `browserDeps()`, the production set.
- `app.svelte.ts`: `AppContext`, created once by the root layout (`createAppContext(deps)`), disposed when it
  unmounts: auth, offline state, PWA state, the sign-out prompt, theme, navigation layout, font faces, the page
  frame slots, and the current `Session`.
- `session.svelte.ts`: `Session`, created by the app context when a token appears and disposed when the session
  ends (sign-out, a 401, another user under this tab): owns every per-user cache and state object.
- `context.ts`: `provideApp`, `useApp`, `useSession`, `useOptionalSession` over `setContext`/`getContext`.

`lib/testing/context.ts`: `testContext(options)` builds an app context and a signed-in session from fakes
(a fake `api`, memory storage, a manual clock and timers) and `ctx.with(props)` the render options that carry it.

## Tasks

1. **This plan and record 0009** (`Accepted, being implemented by #196`), the records index.
2. **Context core and auth**, the lifecycle test first: `AppContext` and `Session` (created on a token, a user
   adopted, disposed on sign-out / expiry / a switch with the reason; owned disposers run once, a throwing one is
   logged; `alive`), `context.ts` accessors, `lib/testing/context.ts`; auth into the app context
   (`lib/auth.svelte.ts`, class `Auth`: sign-in, `me`, sign-out, the 401 and restricted reactions, the cross-tab
   follow); the API client's three handler setters become one observer the app context installs. The root layout
   creates the app context and keys the page tree on the session. Every `$auth`/`$user`/`$token`/`$restriction`
   reader moves to `useApp().auth`; the session's end still runs the old registry for the caches not moved yet.
3. (merged into 2.)
4. **Workspaces, notices, the deleted-workspace recovery and the review outbox** into the session (`Workspaces`,
   `Notices`, `WorkspaceRecovery`, `Outbox`); the outbox user mirror (`outboxUser.ts`) goes.
5. **Plugin states** into the session (`PluginStates`); the registered manifests follow it.
6. **PWA and offline state** into the app context (`OfflineState`, the install prompt, the update banner, the
   sign-out prompt).
7. **Study data** into the session: the `StudyCache` of #193, the reads of `data.ts` and the commands, the
   unreadable report, the written-by-entry cache, the recently sent reviews, the event log.
8. **The other per-user caches and memos** into the session: the study day (zone), weekly replay and week passes,
   milestones (load and reached), goals, day counts, audio, characters, components, entry bases, schemes, clips,
   starter decks, system deck items, stroke data, frequency ranks, lookups, the journal entries and provider names.
9. **The tab-wide runes singletons** into the app context: theme, navigation layout, font faces, page frame, the
   shared audio player.
10. **Guards and docs**: `onSessionEnd`/`sessionEpoch` removed; guard tests (no `svelte/store`, no exported
    `*ForTests`, no module-level state outside an allow-list with reasons); record 0009 `Accepted`; records 0002,
    0004, 0005; the wiki; this record.

## Rulings

- Ruling: a session exists while a token does — created when a token appears (sign-in, a boot with a stored token,
  before `me` answered), it adopts the user `me` names, and it ends when the token goes (`signOut`, `expired`) or
  when `me` names another user than the one it holds (`switched`; a blanked user while another tab's token is
  checked counts, as #173's subscription did) — the outbox and an offline boot need a session before `me` answers
  — cost if wrong: a session briefly without a user id (it then owns nothing user-keyed until `me` answers).
- Ruling: the root layout keys its page tree on the session (`{#key app.session}`), so a new session mounts new
  components that read the new session at init; components read `useSession()` once — a switch in another tab used
  to leave the mounted page holding the previous user's data in its own `$state`; now it is gone. The sign-in pages
  are never shown signed in, so a sign-in remounts nothing visible — cost if wrong: a user switch in another tab
  loses unsaved input of the page (it belonged to the previous user).
- Ruling: the HTTP client stays a module function with one observer slot (`setApiObserver`: a 401, a restriction,
  a deleted workspace, every answer's headers, an unreachable server) that the running app context installs; the
  state objects receive `api` as a dependency and the plain helpers in `lib/api/*.ts` keep calling it — it is the
  tab's one transport and its token is the credential, not user data; making every helper take a client would only
  move the singleton — cost if wrong: a test that fakes `api` for a state object still mocks the module for a
  helper.
- Ruling: `testContext()` uses the module `api` unless the test passes `routes` (then `fakeApi`) — a test that
  mocks `lib/api/client` or stubs `fetch` then answers the state objects and the helpers alike — cost if wrong: none
  (both are fresh per test).
- Ruling: `testContext()` storage is the environment's (jsdom's, or a test's stub) and memory where there is none
  — tests written against the browser's storage keep reading what the code wrote; jsdom's storage is per file and
  the DOM setup clears it under Node 26 — cost if wrong: a test leaking storage into the next one of its file, as
  before.
- Ruling: a component that needs the session is not rendered signed out; components on the open pages use
  `useOptionalSession()`. EntryView's "no frequency ranks while signed out" test went: the entry page is private, so
  the case cannot occur any more — cost if wrong: none.
- Ruling: the outbox (`ReviewOutbox`) belongs to the session and sends only the session's user's items with the
  token the tab holds; a review recorded after the session ended is queued under that session's user (it used to be
  queued unowned and adopted by whoever signed in next) — cost if wrong: none; another user never sends it.
- Ruling: study reads and commands stay module functions that take the session's `StudyState` first, instead of
  methods of a session object — the pure modules (planners, the grade flow, card actions) already take the
  functions as dependencies, and the tests' module mocks keep working; a component binds with `withStudy` where a
  pure module wants a function — cost if wrong: one more argument at every call.
- Ruling: the study commands' "selected workspace" fixture (`selectWorkspace`) went: the study layer cannot reach
  the session's selection at all, so #174's guarantee holds by construction — cost if wrong: none.
- Ruling: a session's caches of server answers are data classes in one module (`context/caches.ts`) and the
  functions keep living with their API modules, taking the cache first — the session can then be built even where a
  test mocks an API module, and the call sites name the cache they use — cost if wrong: one more argument per call.
- Ruling: the audio player belongs to the session (`session.player`), not the tab — it plays through the session's
  clip cache, and a sign-out stops it — cost if wrong: none; there is never a player signed out.
- Ruling: content-keyed memos of derived data (weekly timelines and passes, reached milestones) and loads in flight
  (goals) live in the session's caches and are passed to the pure functions; the single-entry day-count memo became
  a WeakMap keyed by the cards array (holding nothing once the arrays go); the ts-fsrs instance memo stays
  module-level (numbers only, at most 16) — the owner named the weekly, milestone and goal memos; a scheduler
  instance carries no user rows — cost if wrong: a memo miss after a sign-in costs one recomputation.
- Ruling: tests that mocked `time/zone` or `events.ts` now spy on the class prototypes (`StudyDays.prototype.day`,
  `EventLog.prototype.record`) — every session the test builds sees the fake, as the module mock did — cost if
  wrong: a spy outliving its file (vitest isolates files).
- Ruling: the plugin SDK's `events.record` takes the poster first (the session's `EventLog.post`) instead of
  reaching a module function — the SDK stays a module per plugin until #199 removes it — cost if wrong: none.
- Ruling: `logout()` with no session (no token) clears nothing per user: there is nothing to clear; the workspace
  choice and the lookup buffer go with the session that held them — cost if wrong: none found; two tests now sign
  in before signing out.

## Execution record

Baseline (55312f3e, Node 26): 598 files, 12,651 passed, 8 skipped.

1. Plan, record 0009 (`Accepted, being implemented by #196`), the index row.
2. Context core and auth. `context/app.test.ts` was written before the classes; I ran it only once they existed
   (a deviation from strict test-first), then checked it by mutation: without the switch check one test fails.
   `auth.test.ts`, `authTabs.dom.test.ts`, `authCleanup.dom.test.ts` and the layout tests were moved onto the app
   context (their assertions unchanged, apart from signing in before a sign-out that expects something cleared);
   component tests render with `ctx.context`. Full vitest under Node 26: 599 files, 12,657 passed, 8 skipped.
   E2E: the first runs failed with `net::ERR_INSUFFICIENT_RESOURCES` (Chromium's storage quota: the root file system
   has about 100 MB available to non-root processes on this machine); with `TMPDIR=/dev/shm/...` (the browser
   profile on tmpfs) 13 passed. Every later e2e run uses that `TMPDIR`; the suite itself is unchanged.
4. Workspaces, notices, the recovery and the review outbox into the session (`workspaces.svelte.ts`,
   `notices.svelte.ts`, `workspaceGone.ts` `WorkspaceRecovery`, `study/events.ts` `ReviewOutbox`). Pure moves of
   existing behaviour: the existing tests (`workspaces.test.ts`, `workspaceGone.test.ts`, `events.test.ts`,
   `eventsSync.dom.test.ts`, `lateAnswers.test.ts`) are the guard, rewritten onto instances; their assertions are
   unchanged. Full vitest under Node 26: 599 files, 12,662 passed; e2e 13 passed.
5. Study data into the session (task 7 of the list, moved before plugin states and the PWA state because the
   other caches read it): `StudyState` in `study/data.ts` (the `StudyCache` of #193, the unreadable report as a
   runes class `study/unreadableReport.svelte.ts`, the history memo); every read of `data.ts` and every command of
   `commands/` takes it as its first argument; pure modules get bound functions (`withStudy`). A pure move: the
   data, command, cache and request-count tests are the guard; they now build a fresh session per test
   (`studyContext()`, `newSession()` instead of `endSession`), and mocked calls carry the study first. Full vitest
   under Node 26: 599 files, 12,662 passed; e2e 13 passed.
6. PWA and offline state into the app context: `Connectivity` (`pwa/offlineState.svelte.ts`, with the session-end
   reset and the window's online events), `InstallPrompt` (`pwa/installPrompt.svelte.ts`), the worker registration
   on runes (`pwa/register.svelte.ts`, created by the app context and registered by `start()`), the sign-out
   prompt as `app.logoutPrompt`. Pure moves; the existing tests are the guard (rewritten onto instances), plus two
   new cases for what moved into the class (the session-end reset, the watched window). Full vitest under Node 26:
   599 files, 12,663 passed (+ the lint's stale entries removed); e2e 13 passed. (The two new cases were written
   with the class, not before it.)
7. Plugin states and the event log into the session (task 5 of the list, with the event log because the plugin
   manifests decide which posted events drop the cached log): `PluginStates` (`plugins/states.svelte.ts`) replaces
   the store and `setRegisteredManifests` (`logChangingTypes(manifests)` takes them); `EventLog` (`events.ts`)
   replaces `postEvents`, `record`, `loadWorkspaceEvents`, `onEventLogChange`, `recordSessionOnce/WhenSettled`
   and the module log cache; the plugin SDK records through the poster it is given. Pure moves: `events.test.ts`,
   `states.test.ts`, `contract.test.ts` rewritten onto instances (one new case: a plugin-states answer after the
   session ended sets nothing, which the lateAnswers test also covers); tests that mocked the event functions spy
   on `EventLog.prototype`. Full vitest under Node 26: 599 files, 12,664 passed; e2e 13 passed.
   Environment: the root file system has about 35 MB available to this machine's processes; from here on vitest
   and e2e run with `TMPDIR` (and the e2e Go build with `GOCACHE`) on `/dev/shm`.
8a. The caches of server answers into the session (`context/caches.ts` `SessionCaches`: audio, characters,
   components, entry bases, schemes, clips, starter decks, level items, journal entries, provider names, written
   forms, frequency ranks, stroke data). Each cache is a data class in `context/caches.ts`; the functions that fill
   and read it stay in their module and take it first (`getEntryAudio(cache, id)`), so a test that mocks the module
   still builds a session. The shared audio player became `session.player` (its clips are the session's; the end
   stops it). The `sessionEpoch` checks of these caches went: a late answer lands in the old session's cache. Pure
   moves: each cache's tests now build a fresh cache per test instead of calling its `clear…` export. Full vitest
   under Node 26: 599 files, 12,664 passed. (No e2e run for this commit alone; the next commit's run covers it.)
8b. The derived state and memos into the session: the study day (`time/studyDays.ts` `StudyDays`, `session.zone`;
   `time/zone.ts` keeps the pure parts), the goal loads in flight, the weekly timelines and week passes, the reached
   milestones and the seen-milestone flushes (with the session's `online` listener), the journal's sent events, the
   lookup recorder (`lookups/state.ts`, `session.lookups`) — all in `SessionCaches` or the session. The
   `currentContext.ts` builders take the session's StudyDays first. The day-count memo of `limits.ts` became a
   WeakMap keyed by the cards array; the ts-fsrs instance memo of `scheduler.ts` stays module-level (allow-listed).
   `study/outboxUser.ts` is gone: what read it reads the session's user. No `onSessionEnd` registration is left in
   the app. Pure moves; the tests now build their memos, recorder and study day per test (`zone.test.ts` on a
   `StudyDays`, `currentContext.test.ts` on a fake view, tests that mocked `time/zone` spy on
   `StudyDays.prototype`). Full vitest under Node 26: 599 files, 12,664 passed; e2e 13 passed.
9. The tab-wide appearance state into the app context: the theme (`app.theme`, `createThemeStore` with the app's
   storage), the navigation layout (`app.navLayout`), the pack font faces (`app.fonts`) and the page frame
   (`frame/pageFrame.svelte.ts` `PageFrame`, `app.frame`; `setFrameTitle`/`setPageActions` reach it through
   `useApp()`). The module singletons `themeStore`, `navLayoutStore`, `packFaces` and the frame slots are gone; the
   theme cross-fade timer became a WeakMap keyed by the root element. Pure moves: the component tests render with a
   fresh test context instead of sharing the singletons. Full vitest under Node 26: 599 files, 12,664 passed; e2e
   13 passed.
