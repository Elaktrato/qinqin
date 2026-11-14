# Roadmap

Issues are the source of truth for work; this file is the narrative index. Milestones
group issues by release, labels by area (`backend`, `web`, `mobile`, `flashcards`,
`plugin`, `data`, `ci`, `dx`, `deferred`, `blocked`).

## Shipped

- **v0.1.0** — Go backend (auth, entries/readings, dictionaries incl. CC-CEDICT/Unihan/
  JMdict/KANJIDIC2 bundling, levels, sentences, overlays, events, plugins, search, sync,
  seed CLI, Docker) and the SvelteKit web app (entry/search/editing, stroke order,
  workspaces, sources).
- **On develop after v0.1.0** — flashcards Round 1 (study loop: decks, vocab cards,
  4-grade FSRS derived from review events, review heatmap, EXP) and Round 2 (level
  sessions, per-character mastery, the map at `/study/map`, since moved to
  Stats → Characters at `/stats/characters`).

## v0.2.0 — study experience (milestone)

- [#25](https://github.com/Elaktrato/qinqin/issues/25) flashcards Round 3 (umbrella)
- [#27](https://github.com/Elaktrato/qinqin/issues/27) Word Salad card type — **blocked** on
  the core sentence tokenizer being built by another workstream
- [#28](https://github.com/Elaktrato/qinqin/issues/28) writing exercise (stroke checking)
- [#29](https://github.com/Elaktrato/qinqin/issues/29) tone exercise
- [#30](https://github.com/Elaktrato/qinqin/issues/30) card management (delete, move, dedupe)
- [#31](https://github.com/Elaktrato/qinqin/issues/31) re-show Again cards within a session
- [#32](https://github.com/Elaktrato/qinqin/issues/32) EXP curve and mascot hooks
- [#33](https://github.com/Elaktrato/qinqin/issues/33) search filters UI
- [#26](https://github.com/Elaktrato/qinqin/issues/26) map backfill performance (deferred from R2)

## v0.3.0 — mobile client (milestone)

- [#34](https://github.com/Elaktrato/qinqin/issues/34) Flutter scaffold, auth, workspaces
- [#35](https://github.com/Elaktrato/qinqin/issues/35) offline-first store and sync engine
- [#36](https://github.com/Elaktrato/qinqin/issues/36) core views parity (entry, search, strokes)
- [#37](https://github.com/Elaktrato/qinqin/issues/37) entry editing on mobile
- [#38](https://github.com/Elaktrato/qinqin/issues/38) feature-plugin host (Dart) and study widgets

## Future (milestone)

- [#39](https://github.com/Elaktrato/qinqin/issues/39) feature-plugin SDK (permissions, views, data API)
- [#40](https://github.com/Elaktrato/qinqin/issues/40) data-plugin management UI
- [#41](https://github.com/Elaktrato/qinqin/issues/41) language and workspace management UI
- [#42](https://github.com/Elaktrato/qinqin/issues/42) Jōyō / TOCFL / curriculum level packs
- [#43](https://github.com/Elaktrato/qinqin/issues/43) audio pronunciation packs
- [#44](https://github.com/Elaktrato/qinqin/issues/44) FSRS optimizer UI

Engineering debt and review follow-ups carry the `deferred` label (issues #1–#22 and
#26); triage them before cutting a release.

Design documents: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
Branching and releases: `docs/git-flow.md`.
