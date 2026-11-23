# 0006. Core features, feature switches, language profiles and data packs instead of code plugins

## Status

Accepted, being implemented by #199

Touched by: #199. A merge from one of these issues that changes what this record names updates the record.

## Context

qinqin's code plugins are compiled into the app (`webPlugins`): nothing is installed at runtime, and the
Android plan would implement every plugin twice. The plugin layer gives no extensibility; it provides an on/off
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
- **Language profiles.** One core definition per language says what it has: reading system (pinyin/zhuyin,
  kana/romaji, ...), segmentation, tones, stroke data, kana, grammar lessons (when a pack is installed), and
  which card kinds and practice modes apply. Features and card kinds switch on by profile, not by special cases
  spread through the code. The profile is a shared contract, so Android uses the same one. A new language means
  its profile, any new reading code and its data packs.
- **Migration.** A frozen server migration step (like migration 038 for flashcards and the reader) moves the
  journal and grammar plugin data into the new storage. The backup restore keeps accepting archives with the
  old plugin-data rows, mapped to the new storage. Old routes and plugin ids for journal and grammar are not
  kept.

## Consequences

- One way to add a feature (core code plus a switch) and one way to add content (a data pack); Android
  implements each feature once, with "core features plus switches" instead of a feature-plugin host (#38).
- Typed storage with contracts replaces the generic plugin-data namespace for the journal and grammar.
- A language's capabilities are read from its profile; adding a language does not mean finding the special
  cases.
- The postponed AI features (#185, #186) and the avatar upload (#189) are built as core features after #199.

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

Planned by #199 ("done when"): no code-plugin machinery is left; feature switches and data packs work as before;
language profiles drive which features appear in a workspace, tested with Chinese, Japanese and the Spanish
demo; backups made before the change restore correctly. #199 names no automated guard against a new code
plugin or a language special case; until one exists: review.

## Open questions

- Where the remaining `qinqin-core` plugin-data rows go (home layout, widget options, notes, lookups,
  `nav-layout`): typed storage each, or one generic core "settings rows" store. Decided in #199's spec.
- The order of #199 relative to the study data layer (#193) and the state rewrite (#196), which it builds on.
  Agreed in the direction file.
- The form of the language-profile contract under `docs/contracts/`. Decided in #199.
