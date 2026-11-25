# 0006. Core features, feature switches, language profiles and data packs instead of code plugins

## Status

Accepted

Touched by: #199, #185, #186, #204. A merge from one of these issues that changes what this record names updates the record.

## Context

qinqin's code plugins were compiled into the app (a list in the web build): nothing is installed at runtime, and the
then-native Android plan would have implemented every plugin twice. The plugin layer gives no extensibility; it provides an on/off
switch, a data namespace and a permission list, and core features already have switches (flashcards and the
reader since #85). With those two in the core, the plugin machinery serves only the journal and grammar, while
AI becomes a shared capability (#185, #186) and the AI service is already core on the server. The owner decided
on 2026-11-23 to retire the code-plugin system (#199).

## Decision

- **No code plugins.** The web plugin SDK, code-plugin manifests, the plugin registry rows for code plugins,
  plugin states as a separate concept and the generic plugin-data routes (once nothing uses them) are removed.
- **Core features with feature switches.** Each feature is part of the core and has a per-user feature switch
  (synced, backed up). Grammar and the journal become core features like flashcards and the reader:
  - grammar lesson progress moves from plugin data to typed rows with a contract; its content still comes from
    `grammar` data packs;
  - journal entries, AI reviews and annotations, photos and settings move from plugin data to typed storage with
    a contract; the AI provider service stays core and is shared with #185 and #186.
- **Data packs stay** the one content extension mechanism, unchanged.
- **Language profiles.** One core definition per language says what it has: script, reading system (pinyin,
  kana), segmentation, tones, stroke data, kana, script variants, and which card kinds and practice modes apply
  (grammar lessons come from packs of any language, so they are not in a profile). Features and card kinds switch on by profile, not by special cases
  spread through the code. The profile is a shared contract (Go and web tables pinned to one fixture). A new language means
  its profile, any new reading code and its data packs.
- **Order.** #199 builds on the study data layer (#193) and the state rewrite (#196): the owner's queue
  (2026-11-23) runs #193, then #196, then #199.
- **Migration.** Owner direction (2026-11-24): no backwards compatibility; stored data need not survive. The
  migrations copy what maps one to one and drop the rest (`docs/releases/v0.6.0.md` says what an upgrade wipes).
  The backup format becomes 2; format 1 archives are refused. Old routes and plugin ids are removed
  (`docs/contracts/CHANGELOG.md`).

### Where it lives (#199)

| Part | Server | Web | Contract |
| --- | --- | --- | --- |
| Feature switches | `server/internal/features/` (table `feature_switches`, migration 047), `GET /api/features`, `PUT /api/features/{id}` | `apps/web/src/lib/features/` (`index.ts`: the four core features; `switches.svelte.ts`: the session's switches), Settings → Features | `docs/contracts/features/` |
| Journal | `server/internal/journal/` (tables `journal_entries`, `journal_reviews`, `journal_suggestions`, `journal_settings`, migration 044; the conversation partner of #185: `journal_conversations`, `journal_messages`, migration 048, `conversation.go`), `/api/journal/*` | `apps/web/src/lib/features/journal/` (the partner in `conversation/`), route `/journal` (`/journal/talk`) | `docs/contracts/journal/` (`conversations.json`) |
| AI examples (#186, a core capability on the shared AI service, no switch) | `server/internal/sentences/examples.go` (kept ones are own `sentences` rows with `ai_provider`/`ai_model`; `example_drafts`, `example_reports`, migration 049), the `examples` task in `server/internal/ai/examples.go`, `/api/entries/{id}/examples*` | `apps/web/src/lib/entry/examples/`, `apps/web/src/lib/api/examples.ts`, the entry page | `docs/contracts/examples/` |
| Grammar progress | `server/internal/grammar/progress.go` (table `grammar_progress`, migration 045), `/api/grammar/progress` | `apps/web/src/lib/features/grammar/`, route `/grammar` | `docs/contracts/grammar/` |
| Writing-system trainer (#204, kana #63; a fifth core feature `scripts`, appears only where the profile's `writingSystems` is not empty) | server: the feature id (`features.IDs`), the activity rule of the event type `script` (`server/internal/stats/rules.go`); no table of its own: the progress is derived from `script` events | `apps/web/src/lib/features/scripts/` (pure logic, the CC0 script data in `data/`, the views), route `/scripts` | `docs/contracts/events/payloads.json` (`script`), `events/activity.json`, `features/switches.json`, `languages/profiles.json` (`writingSystems`) |
| Keyed rows (the core's small settings documents: notes, lookups, known marks, milestones, goals, the study setup, vacations, layouts, appearance) | `server/internal/keyed/` (table `keyed_rows`, migration 046; `plugin_data` dropped), `/api/rows`, pull/push `rows` | `apps/web/src/lib/sync/keyed.ts` | `docs/contracts/keyed/` |
| Activity sources | `server/internal/stats/rules.go` | `apps/web/src/lib/activity/sources.ts` | `docs/contracts/events/activity.json` |
| Language profiles | `server/internal/lang/profile.go` (`ProfileOf`) | `apps/web/src/lib/languages/profiles.ts` (`profileOf`) | `docs/contracts/languages/` |
| Old plugin URLs | — | `apps/web/src/lib/routing/legacyRoutes.ts`, `apps/web/src/routes/p/[plugin]/[...rest]/+page.ts` (the four features redirect, any other id is 404) | — |

### How to add a language

1. Write its profile: a row in `docs/contracts/languages/profiles.json` (with a `resolve` case) and the same row
   in `server/internal/lang/profile.go` and `apps/web/src/lib/languages/profiles.ts`. The tests of both tables
   compare them with the fixture. Without a row the language gets the fallback (no readings, space
   segmentation, the plain card kinds).
2. Add its data packs (dictionary, levels, sentences, grammar; `docs/contracts/packages/`).
3. Only when the profile names something the code cannot yet do (a reading system, dictionary segmentation,
   tones): add the reading code as a code pack in `server/internal/lang` and the web reading helpers.

No `if language is …` check is added for availability: a check asks the profile.

Later, a course (`docs/superpowers/specs/2026-11-24-courses-design.md` §9–10) hangs off the language profile and a
`course` pack of the language; nothing of it is built in #199.

## Consequences

- One way to add a feature (core code plus a switch) and one way to add content (a data pack). The Android app is
  the web app in a Capacitor shell (`docs/superpowers/specs/2026-11-23-android-shell-design.md`), so it gets every core
  feature and its switch with no plugin host at all; the contracts bind the server and the web app.
- Typed storage with contracts replaces the generic plugin-data namespace for the journal and grammar.
- A language's capabilities are read from its profile; adding a language does not mean finding the special
  cases.
- The postponed AI features (#185, #186) and the avatar upload (#189) are built as core features after #199
  (the owner's queue of 2026-11-23, phase 3).

## Allowed / Not allowed

Allowed:

- A new feature as core code with a per-user feature switch.
- New content as a data pack.
- Code that asks the language profile what a language has.

Not allowed:

- A new code plugin, plugin manifest or plugin SDK use.
- New feature data in generic plugin-data rows.
- A language special case (`if language is zh ...`) where the profile can say it.

## Enforcement

- `server/internal/api/legacy_removed_test.go` keeps the plugin routes and tables out; the route table test
  (`apps/web/src/lib/pwa/sw/routes.fixture.json`) lists every route.
- The profile tables are pinned to `docs/contracts/languages/profiles.json` (Go and web tests, with zh, ja and
  es); the feature list to `docs/contracts/features/switches.json`.
- No automated guard against a new `if language is …` check: review.

## Open questions

None. Resolved in #199: the remaining `qinqin-core` rows went to one generic store of keyed rows
(`docs/contracts/keyed/`), not typed storage each; the language-profile contract is
`docs/contracts/languages/profiles.json`.
