# 0009. Web: one state model (runes, contexts, no hidden singletons)

## Status

Accepted, being implemented by #196

Touched by: #195, #199. A merge from one of these issues that changes what this record names updates the record.

## Context

The web app mixed two reactivity models: `svelte/store` writables (auth, workspaces, notices, offline state,
plugin states and a few more, read with `$store` in about 60 components) and runes in thirteen `*.svelte.ts`
modules. Per-user data lived in module-level singletons (caches, the review outbox, memos) for the whole tab, were
reset by hand in tests (`resetOutboxForTests`, `resetMilestonesForTests`, ...) and were cleared at sign-out through
the registry #173 added (`onSessionEnd`, with `sessionEpoch` checks against late answers). The owner decided in
#196 to rewrite this onto one model so it does not become a headache later.

## Decision

- **Shared state is a runes class** (`$state` / `$derived` fields in a `*.svelte.ts` module), built by a factory
  or constructor that receives its dependencies: the API client, Web Storage, the clock, timers, and the other
  state objects it reads. Nothing in it reaches a browser global or another module's instance by itself.
- **One app context** per tab (`AppContext`): what is tab-wide and outlives a sign-in: auth, the offline and PWA
  state, the sign-out prompt, theme, navigation layout, font faces, the page frame slots, and the current session.
  The root layout creates it and disposes it when it unmounts.
- **One session context** per signed-in session (`Session`): created by the app context when a token appears,
  disposed when the session ends (sign-out, a 401 that ends it, another user signing in under this tab). It owns
  every per-user cache and state object: the study cache, the outbox, reader lists, milestones, the weekly and goal
  memos, workspaces, notices, plugin and feature states, the study day, the server-answer caches. Disposing it
  stops its timers and listeners; an answer that arrives later lands in the disposed objects, which nothing reads.
  A new session is a new set of objects, so nothing of one account can be reached from the next.
- **Components get state through Svelte context** (`setContext`/`getContext` behind typed accessors), never by
  importing a module-level instance. The root layout mounts a new page tree for a new session.
- **Plain modules stay pure.** Code outside components that needs state receives it as a parameter.
- **Tests** build a fresh app context and session from fakes; there are no global resets.

## Consequences

- Sign-out isolation holds by construction instead of by a list of clear functions.
- A component test passes the context it renders with; a module test passes the state objects it uses.
- Code that used to call a free function backed by a singleton now names the object it uses (one more argument
  or one more property read).
- A user switch in another tab remounts the signed-in page tree: what a page held of the previous user is gone.

## Allowed / Not allowed

Allowed:

- A module-level constant table, a compiled regular expression, a memo of a pure function of bundled or
  locale data (Intl formatters), listed in the guard's allow-list with its reason.
- Component-local `$state`, and runes classes instantiated by a component for its own lifetime.

Not allowed:

- `svelte/store` anywhere in the app.
- A module-level `let`, `Map`, `Set`, `$state` or store that holds data of a user.
- An exported reset for tests (`*ForTests`).
- A component importing a state instance from a module instead of reading it from context.

## Enforcement

Planned by #196: a source scan that fails on a `svelte/store` import, an exported `*ForTests` function and a
module-level mutable declaration outside an allow-list with reasons; the sign-out isolation tests (two users, the
data of the first never visible to the second, its timers stopped). Until then: review.
