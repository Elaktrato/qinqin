# 0009. Web: one state model (runes, contexts, no hidden singletons)

## Status

Accepted

Touched by: #195, #199. A merge from one of these issues that changes what this record names updates the record.

## Context

The web app mixed two reactivity models: `svelte/store` writables (auth, workspaces, notices, offline state,
plugin states and a few more, read with `$store` in about 60 components) and runes in thirteen `*.svelte.ts`
modules. Per-user data lived in module-level singletons (caches, the review outbox, memos) for the whole tab, were
reset by hand in tests (resetOutboxForTests, resetMilestonesForTests, ...) and were cleared at sign-out through
the registry #173 added (onSessionEnd, with sessionEpoch checks against late answers). The owner decided in
#196 to rewrite this onto one model so it does not become a headache later.

## Decision

- **Shared state is a runes class** (`$state` / `$derived` fields in a `*.svelte.ts` module, or a plain class
  holding data), built by a factory or constructor that receives its dependencies: the API client, Web Storage,
  the clock, timers, the window and document to listen on, and the other state objects it reads
  (`AppDeps` in `apps/web/src/lib/context/deps.ts`; `browserDeps()` is the production set). Nothing in it
  reaches a browser global or another module's instance by itself.
- **One app context** per tab (`AppContext`, `apps/web/src/lib/context/app.svelte.ts`): what is tab-wide and
  outlives a sign-in: auth (`apps/web/src/lib/auth/auth.svelte.ts`), connectivity and the PWA state (the install
  prompt, the service worker's update), the sign-out prompt, the theme, the navigation layout, the font faces,
  the page frame (`apps/web/src/lib/frame/pageFrame.svelte.ts`), and the current session. The root layout
  (`apps/web/src/routes/+layout.svelte`) creates it, starts it (it installs the API client's one observer,
  `setApiObserver`) and disposes it when it unmounts.
- **One session context** per signed-in session (`Session`, `apps/web/src/lib/context/session.svelte.ts`):
  created by the app context when a token appears, disposed when the session ends (`signOut`; `expired`, a 401
  that ends it; `switched`, another user signed in under this tab). It owns every per-user cache and state
  object: the notices, the workspaces, the review outbox, the study state (the study cache and what derives from
  it), plugin and feature states, the event log, the study day, the lookup recorder, the audio player and the
  caches of server answers (`SessionCaches`, `apps/web/src/lib/context/caches.ts`: entry bases, audio,
  characters, schemes, clips, starter decks, goal and weekly memos, reached milestones, ...). Disposing it stops
  its timers and listeners; an answer that arrives later lands in the disposed objects, which nothing reads. A
  new session is a new set of objects, so nothing of one account can be reached from the next.
- **The end of a session is the session's dispose.** The registry of #173 (onSessionEnd, sessionEpoch)
  is gone: a cache registers nothing, because it belongs to a session; a load that must not store a late answer
  checks `session.alive` (the study cache's epoch is derived from it).
- **Components get state through Svelte context** (`useApp()`, `useSession()`, `useOptionalSession()` in
  `apps/web/src/lib/context/context.ts`), never by importing a module-level instance. The root layout keys the
  page tree on the session, so a new session mounts a new tree.
- **Plain modules stay pure.** Code outside components that needs state receives it as a parameter: the study
  reads and commands take the study state first (`withStudy` binds one), a cache's reader takes its cache first,
  a loader takes the session.
- **Tests** build a fresh app context and session from fakes (`apps/web/src/lib/testing/context.ts`); there are
  no global resets.

## Consequences

- Sign-out isolation holds by construction instead of by a list of clear functions.
- A component test passes the context it renders with; a module test passes the state objects it uses.
- Code that used to call a free function backed by a singleton now names the object it uses (one more argument
  or one more property read).
- A user switch in another tab remounts the signed-in page tree: what a page held of the previous user is gone.
- A session ends only when the user really changes: at a sign-out, at a 401, or when `me` names another user
  than the session's. A reload of `me` (after a settings change) and a new token for the same user (another tab
  signed in again) keep the session and the mounted page; while `me` is in flight the signed-in user is kept,
  never blanked.

## Allowed / Not allowed

Allowed:

- A module-level constant table, a compiled regular expression, a memo of a pure function of bundled or
  locale data (Intl formatters), listed in the guard's allow-list with its reason.
- Module-level state that holds nothing of a user, each named in the allow-list with its reason: the page's
  interface catalogue (a change of language reloads the page), the API client's one observer slot (the app
  context installs and removes it) and its in-memory token where storage is blocked, counters that tell objects
  apart, render queues of mounted components.
- Component-local `$state`, and runes classes instantiated by a component for its own lifetime.

Not allowed:

- `svelte/store` anywhere in the app.
- A module-level `let`, `Map`, `Set`, `$state` or store that holds data of a user.
- An exported reset for tests (`*ForTests`).
- A component importing a state instance from a module instead of reading it from context.

## Enforcement

- `apps/web/src/lib/context/stateModel.lint.test.ts` scans the sources and fails on a `svelte/store` import
  anywhere under `apps/web/src/`, an exported `…ForTests`, and module-level state in `src/lib` or `src/routes`
  that its allow-list does not name with a reason: a `let` or `var`, an empty `Map` or `Set`, an instance of
  another class, whatever a `create…(` factory builds, a store, `$state`, an empty array or object (cast or
  not), a small object of counters or slots (`{ current: null }`); a stale allow-list entry fails too. WeakMaps,
  regular expressions and filled `Map`/`Set` tables are not flagged.
- `apps/web/src/lib/session/signOutIsolation.test.ts`: two users; every cache read through its public reader
  answers with the second user's data after the first signs out, a load of the first still in flight never
  lands where the second reads, and no timer of the first session is left running.
- `apps/web/src/lib/context/app.test.ts`: the session's lifecycle (created with a token, disposed at sign-out,
  at a 401 and at a user switch, kept for the same user, disposed with the app; disposers run once and in order).
- Review: a component that receives state as a prop it could read from context is fine; a module object
  literal spread over several lines, or a filled table changed at runtime, is not caught by the scan.
