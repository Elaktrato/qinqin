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
- Ruling: the study commands' "selected workspace" fixture (`selectWorkspace`) went: the study layer cannot reach
  the session's selection at all, so #174's guarantee holds by construction — cost if wrong: none.
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
