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
2. **Context core**, test first: `AppContext` and `Session` lifecycle (created on a token, a user adopted, disposed
   on sign-out / expiry / a switch with the reason; owned disposers run once, a throwing one is logged; `alive`),
   `context.ts` accessors, `lib/testing/context.ts`. Not wired yet.
3. **Auth** into the app context (`lib/auth.svelte.ts`, class `Auth`): sign-in, `me`, sign-out, the 401 and
   restricted handlers, the cross-tab follow. The root layout creates the app context and keys the frame on the
   session (a new session mounts a new page tree). Every `$auth`/`$user`/`$token`/`$restriction` reader moves to
   `useApp().auth`; the session's dispose ends the old registry for the caches not moved yet.
4. **Workspaces, notices and the deleted-workspace recovery** into the session (`Workspaces`, `Notices`,
   `WorkspaceRecovery`).
5. **Plugin states** into the session (`PluginStates`); the registered manifests follow it.
6. **PWA and offline state** into the app context (`OfflineState`, the install prompt, the update banner, the
   sign-out prompt); the outbox user mirror goes (the outbox reads the session).
7. **Study data** into the session: the `StudyCache` of #193, the reads of `data.ts` and the commands, the
   unreadable report, the written-by-entry cache, the outbox, the recently sent reviews, the event log.
8. **The other per-user caches and memos** into the session: the study day (zone), weekly replay and week passes,
   milestones (load and reached), goals, day counts, audio, characters, components, entry bases, schemes, clips,
   starter decks, system deck items, stroke data, frequency ranks, lookups, the journal entries and provider names.
9. **The tab-wide runes singletons** into the app context: theme, navigation layout, font faces, page frame, the
   shared audio player.
10. **Guards and docs**: `onSessionEnd`/`sessionEpoch` removed; guard tests (no `svelte/store`, no exported
    `*ForTests`, no module-level state outside an allow-list with reasons); record 0009 `Accepted`; records 0002,
    0004, 0005; the wiki; this record.

## Rulings

(Filled while building; each `Ruling: <what> — <why> — <cost if wrong>`.)

## Execution record

(Filled per task.)
