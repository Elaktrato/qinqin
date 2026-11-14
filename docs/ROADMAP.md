# Roadmap

Issues are the source of truth for work; this file is the narrative index. Milestones
group issues by release, labels by area (`backend`, `web`, `mobile`, `flashcards`,
`plugin`, `data`, `ci`, `dx`, `deferred`, `blocked`).

## Shipped

- **v0.1.0** — Go backend (auth, entries/readings, dictionaries incl. CC-CEDICT/Unihan/
  JMdict/KANJIDIC2 bundling, levels, sentences, overlays, events, plugins, search, sync,
  seed CLI, Docker) and the SvelteKit web app (entry/search/editing, stroke order,
  workspaces, sources).
- **On develop after v0.1.0**
  - Flashcards Round 1 (study loop: decks, vocab cards, 4-grade FSRS derived from review
    events, EXP), Round 2 (level sessions, per-character mastery, `/study/map`) and
    Round 3 (Word Salad, writing quiz, tone swipe, card-type opt-out, XP curve, streaks,
    mascot hooks; [#25](https://github.com/Elaktrato/qinqin/issues/25)). Duplicate-proof card ids across devices.
  - Reader and library plugin (Aozora Bunko and Project Gutenberg import, bookmarks,
    highlights, side rail) and Yomitan-style hover lookup (`/api/lookup`, `/api/segment`).
  - Core activity heatmap fed by flashcard reviews and reading.
  - Character grid on the map (grouped by grade and level), the official HSK 3.0 word and
    character lists and approximate JLPT kanji levels.
  - Workspace deletion, kunrei/particle romaji search, request body limits.
  - Sources page built from pack and plugin manifests, public.

## v0.2.0 — study experience (milestone)

- [#30](https://github.com/Elaktrato/qinqin/issues/30) card management (delete, move between decks; dedupe is done)
- [#31](https://github.com/Elaktrato/qinqin/issues/31) re-show Again cards within a session
- [#33](https://github.com/Elaktrato/qinqin/issues/33) search filters UI
- [#26](https://github.com/Elaktrato/qinqin/issues/26) map backfill performance (deferred from R2)

## v0.3.0 — mobile client (milestone)

- [#34](https://github.com/Elaktrato/qinqin/issues/34) Flutter scaffold, auth, workspaces
- [#35](https://github.com/Elaktrato/qinqin/issues/35) offline-first store and sync engine
- [#36](https://github.com/Elaktrato/qinqin/issues/36) core views parity (entry, search, strokes)
- [#37](https://github.com/Elaktrato/qinqin/issues/37) entry editing on mobile
- [#38](https://github.com/Elaktrato/qinqin/issues/38) feature-plugin host (Dart) and study widgets

## Future (milestone)

- [#39](https://github.com/Elaktrato/qinqin/issues/39) feature-plugin SDK (permissions, behavior hooks, data API; page surfaces exist)
- [#40](https://github.com/Elaktrato/qinqin/issues/40) data-plugin management UI
- [#41](https://github.com/Elaktrato/qinqin/issues/41) language and workspace management UI (rename/delete exist)
- [#42](https://github.com/Elaktrato/qinqin/issues/42) Jōyō / TOCFL / curriculum level packs
- [#43](https://github.com/Elaktrato/qinqin/issues/43) audio pronunciation packs
- [#44](https://github.com/Elaktrato/qinqin/issues/44) FSRS optimizer UI
- [#45](https://github.com/Elaktrato/qinqin/issues/45) MCP server foundation (design: `specs/2026-11-12-mcp-journal-design.md`)
- [#46](https://github.com/Elaktrato/qinqin/issues/46) Journal plugin with external-AI corrections via MCP
- [#47](https://github.com/Elaktrato/qinqin/issues/47) grammar lessons content type + reader UI
- [#48](https://github.com/Elaktrato/qinqin/issues/48) core activity statistics (server-side aggregation, filters, contributions);
  the Stats page design on `feature/stats` overlaps it

Engineering debt and review follow-ups carry the `deferred` label (issues #1–#22 and
#26); triage them before cutting a release.

Design documents: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
Branching and releases: `docs/git-flow.md`.
