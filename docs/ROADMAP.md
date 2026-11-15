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
    events, EXP), Round 2 (level sessions, per-character mastery, the map, since moved to Stats → Characters at `/stats/characters`) and
    Round 3 (Word Salad, writing quiz, tone swipe, card-type opt-out, XP curve, streaks,
    mascot hooks; [#25](https://github.com/Elaktrato/qinqin/issues/25)). Duplicate-proof card ids across devices.
  - Reader and library plugin (Aozora Bunko and Project Gutenberg import, bookmarks,
    highlights, side rail) and Yomitan-style hover lookup (`/api/lookup`, `/api/segment`).
  - Core activity heatmap fed by flashcard reviews and reading.
  - Character grid on the map (grouped by grade and level), the official HSK 3.0 word and
    character lists and approximate JLPT kanji levels.
  - Workspace deletion, kunrei/particle romaji search, request body limits.
  - Sources page built from pack and plugin manifests, public.
  - Stats page with Overview and Characters, home widgets and a Home layout editor in Settings.
  - Writing and tone card feel (own forgiving stroke matcher, snapping tone contours), card management,
    Again re-shows, search filters, Journal with AI review and photo OCR, plugin SDK, FSRS optimizer,
    grammar lessons, core activity statistics, pack and language management, audio packs, Jōyō/通用规范汉字表
    level packs, and the engineering-debt batches above.

## v0.2.0 — study experience (milestone)

- ~~[#30](https://github.com/Elaktrato/qinqin/issues/30) card management~~ — done (develop)
- ~~[#31](https://github.com/Elaktrato/qinqin/issues/31) re-show Again cards within a session~~ — done (develop)
- ~~[#33](https://github.com/Elaktrato/qinqin/issues/33) search filters UI~~ — done (develop)
- ~~[#26](https://github.com/Elaktrato/qinqin/issues/26) map backfill performance~~ — done (develop)

Order: web first. Most features ship on web before the Android build starts.

## v0.3.0 — journal and AI, web (milestone)

- [#46](https://github.com/Elaktrato/qinqin/issues/46) Journal plugin: AI corrections, overall review, topic suggestions, photo upload with OCR;
  the app calls the AI with the user's own provider API key. Merged to develop; implemented and
  checked against the fake provider, never run against the real API (owner tests with a real key; set `QINQIN_SECRET`).
  Pending: a check with a real key, vertical Japanese OCR (no `jpn_vert` on Alpine), Android parity (v0.4.0).

## v0.4.0 — Android client (milestone)

Native Kotlin (Jetpack Compose, Room), Android only — replaces the earlier Flutter plan.

- [#34](https://github.com/Elaktrato/qinqin/issues/34) Kotlin scaffold, auth, workspaces
- [#35](https://github.com/Elaktrato/qinqin/issues/35) offline-first store and sync engine
- [#36](https://github.com/Elaktrato/qinqin/issues/36) core views parity (entry, search, strokes)
- [#37](https://github.com/Elaktrato/qinqin/issues/37) entry editing
- [#38](https://github.com/Elaktrato/qinqin/issues/38) feature-plugin host (Kotlin) and study parity incl. native writing

## Future (milestone)

- ~~[#39](https://github.com/Elaktrato/qinqin/issues/39) feature-plugin SDK~~ — done (strict manifest contract, permissions, embedded built-in manifests, web SDK, study-event hook; design `docs/superpowers/specs/2026-11-15-plugin-sdk-design.md`). Follow-up: [#85](https://github.com/Elaktrato/qinqin/issues/85) move flashcards and reader onto the SDK
- ~~[#40](https://github.com/Elaktrato/qinqin/issues/40) data-plugin management UI~~ — done (Settings → Data: staged upload with licence review, list, uninstall; design `docs/superpowers/specs/2026-11-15-pack-management-design.md`)
- ~~[#41](https://github.com/Elaktrato/qinqin/issues/41) language and workspace management UI~~ — done (Settings → Data → Languages, per-workspace hidden dictionaries, coverage hints, code validation; design `docs/superpowers/specs/2026-11-15-language-management-design.md`)
- [#42](https://github.com/Elaktrato/qinqin/issues/42) Jōyō / TOCFL / curriculum level packs: bundled `joyo-grades` (KANJIDIC2) and
  `tgh-chars` (通用规范汉字表, Unihan `kTGH`); TBCL and curriculum lists are local-only via
  `scripts/prepare-local-levels.mjs`; the old TOCFL 8000 list is rejected (withdrawn).
  Open: level sessions draw words only, so character-unit packs give no study cards
- ~~[#43](https://github.com/Elaktrato/qinqin/issues/43) audio pronunciation packs~~ — done (design `docs/superpowers/specs/2026-11-15-audio-packs-design.md`; `audio` pack type, play buttons on entries and after the reveal in study, Kanji alive pack fetched into the image, local Commons/Lingua Libre tool). Owner to-do: listen to ~10 Kanji alive clips against `index.tsv`; no Mandarin recordings out of the box (device voice fallback)
- ~~[#44](https://github.com/Elaktrato/qinqin/issues/44) FSRS optimizer UI~~ — done (design `docs/superpowers/specs/2026-11-15-fsrs-optimizer-design.md`; Scheduling page at `/study/scheduling`)
- [#45](https://github.com/Elaktrato/qinqin/issues/45) MCP server foundation (not needed by the journal for now)
- ~~[#47](https://github.com/Elaktrato/qinqin/issues/47) grammar lessons content type + reader UI~~ — done (design `docs/superpowers/specs/2026-11-15-grammar-lessons-design.md`; page `/p/grammar`, demo pack `zh-grammar-demo`; native-speaker review of the demo sentences open)
- ~~[#48](https://github.com/Elaktrato/qinqin/issues/48) core activity statistics~~ — done (design `docs/superpowers/specs/2026-11-15-core-stats-design.md`; `GET /api/stats/activity`, heatmap filters and combined view). Follow-up: [#84](https://github.com/Elaktrato/qinqin/issues/84) local-time days

Engineering debt (#1–#22) was worked through in themed batches (backend hardening, web polish, CI and serving);
what remains open is listed in the handoff `docs/superpowers/handoffs/2026-11-15-web-build-handoff.md`
(#12, #17, #18 leftovers, #55 zombie CI runs, #86 login rate limiting).

Note: the Android client (v0.4.0) does not read the `fsrs:*` plugin data yet, so once a set is active on the web its due counts differ from Android's until the Kotlin scheduler reads the same rows.

Design documents: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
Branching and releases: `docs/git-flow.md`.
