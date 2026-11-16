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
- ~~[#56](https://github.com/Elaktrato/qinqin/issues/56) forgiving writing pad and snapping tone card feel~~ — done (develop)
- ~~[#57](https://github.com/Elaktrato/qinqin/issues/57) level sessions for character-unit schemes (JLPT kanji, Jōyō grades, 通用规范汉字表)~~ — done (v0.3.0; recognition and writing cards, writing unlocks the next learner day; `docs/contracts/levels/`)
- ~~[#26](https://github.com/Elaktrato/qinqin/issues/26) map backfill performance~~ — done (develop)

Order: web first. Most features ship on web before the Android build starts.

## v0.3.0 — journal and AI, web (milestone)

- [#46](https://github.com/Elaktrato/qinqin/issues/46) Journal plugin: AI corrections, overall review, topic suggestions, photo upload with OCR;
  the app calls the AI with the user's own provider API key. Merged to develop; implemented and
  checked against the fake provider, never run against the real API (owner tests with a real key; set `QINQIN_SECRET`).
  Pending: a check with a real key, vertical Japanese OCR (no `jpn_vert` on Alpine), Android parity (v0.4.0).
- [#87](https://github.com/Elaktrato/qinqin/issues/87) Choose any AI provider: Anthropic, OpenAI, Google Gemini, DeepSeek,
  Mistral, xAI, Groq, OpenRouter and admin-registered OpenAI-compatible endpoints (SSRF-guarded), one key per provider and an
  active selection per user. On `feature/ai-providers`; implemented and checked against fake servers only, never against a
  real provider (owner checklist: `docs/superpowers/handoffs/2026-11-15-ai-providers-handoff.md`). Lumo has no public API yet.

## v0.3.0 — shared-data rules for the Android client (done on develop; stretch open)

Direction: `docs/superpowers/directions/2026-11-15-v0.3.0-web-build.md`. Collection branch `feature/v0.3.0`.

- Done on develop (merged via `feature/v0.3.0` and the topic branches): ~~[#86](https://github.com/Elaktrato/qinqin/issues/86) login rate limiting~~, ~~[#84](https://github.com/Elaktrato/qinqin/issues/84) the learner's local day~~, ~~[#57](https://github.com/Elaktrato/qinqin/issues/57) level sessions~~, ~~[#64](https://github.com/Elaktrato/qinqin/issues/64) accounts (sessions, invites, SMTP, MFA)~~, ~~[#65](https://github.com/Elaktrato/qinqin/issues/65) reverse and cloze cards~~, ~~[#90](https://github.com/Elaktrato/qinqin/issues/90) decks view~~ (merge 0764d27), ~~[#88](https://github.com/Elaktrato/qinqin/issues/88) vacation mode and [#89](https://github.com/Elaktrato/qinqin/issues/89) daily limits~~ (merge b3548b2), ~~[#61](https://github.com/Elaktrato/qinqin/issues/61) backup~~ (merge 0a3884f), ~~[#79](https://github.com/Elaktrato/qinqin/issues/79) installable app and offline study~~ (merge 97e0053), ~~[#78](https://github.com/Elaktrato/qinqin/issues/78) reader display settings~~ (merge 3d05ae0).
- `docs/contracts/` for the Android client: done, entry point `docs/contracts/overview.md` (gaps listed there).
- Stretch (`feature/v0.3.0-stretch`, brief `docs/superpowers/directions/2026-11-16-v0.3.0-stretch-agent-brief.md`): ~~[#67](https://github.com/Elaktrato/qinqin/issues/67) daily goals~~ (merge 93f70f9, `docs/contracts/goals/`), ~~[#75](https://github.com/Elaktrato/qinqin/issues/75) frequency-ordered new words and starter decks~~ (merge ed99015, `docs/contracts/frequency/`; no new data bundled, no clearly licensed Chinese word list exists), ~~[#77](https://github.com/Elaktrato/qinqin/issues/77) personal notes and mnemonics~~ (merge ab1352b, `docs/contracts/notes/`).
- Stretch, not started: [#68](https://github.com/Elaktrato/qinqin/issues/68) unknown-word highlighting, [#72](https://github.com/Elaktrato/qinqin/issues/72) lookup history, [#71](https://github.com/Elaktrato/qinqin/issues/71) radical lookup, [#83](https://github.com/Elaktrato/qinqin/issues/83) personal access tokens, [#81](https://github.com/Elaktrato/qinqin/issues/81) weekly summary, [#80](https://github.com/Elaktrato/qinqin/issues/80).

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
  Level sessions of character-unit packs: done with #57.
- ~~[#43](https://github.com/Elaktrato/qinqin/issues/43) audio pronunciation packs~~ — done (design `docs/superpowers/specs/2026-11-15-audio-packs-design.md`; `audio` pack type, play buttons on entries and after the reveal in study, Kanji alive pack fetched into the image, local Commons/Lingua Libre tool). Owner to-do: listen to ~10 Kanji alive clips against `index.tsv`; no Mandarin recordings out of the box (device voice fallback)
- ~~[#44](https://github.com/Elaktrato/qinqin/issues/44) FSRS optimizer UI~~ — done (design `docs/superpowers/specs/2026-11-15-fsrs-optimizer-design.md`; Scheduling page at `/study/scheduling`)
- ~~[#47](https://github.com/Elaktrato/qinqin/issues/47) grammar lessons content type + reader UI~~ — done (design `docs/superpowers/specs/2026-11-15-grammar-lessons-design.md`; page `/p/grammar`, demo pack `zh-grammar-demo`; native-speaker review of the demo sentences open)
- ~~[#48](https://github.com/Elaktrato/qinqin/issues/48) core activity statistics~~ — done (design `docs/superpowers/specs/2026-11-15-core-stats-design.md`; `GET /api/stats/activity`, heatmap filters and combined view). Follow-up: ~~[#84](https://github.com/Elaktrato/qinqin/issues/84) local-time days~~ — done in v0.3.0 (design `docs/superpowers/specs/2026-11-15-v030-study-day-design.md`; per-user zone history, Settings → Study, `docs/contracts/study-day/`)

### Ideas, not scheduled (Future)

Captured 2026-11-14/15; each issue holds the detail. Order is not a commitment.

**Accounts and data**

- [#64](https://github.com/Elaktrato/qinqin/issues/64) accounts: change password, admin user management, password reset, session control (done on `feature/v0.3.0`: sessions, registration modes, invites, SMTP, email verification, reset by mail, TOTP and email-code two-step sign-in, sign-in by code)
- [#83](https://github.com/Elaktrato/qinqin/issues/83) accounts: personal access tokens for scripts and integrations
- [#61](https://github.com/Elaktrato/qinqin/issues/61) backup: export and restore your own data, plus server backup
- [#86](https://github.com/Elaktrato/qinqin/issues/86) auth: login/register rate limiting (done: per-client, per-pair and per-username limits, hash gate, trusted proxies)

**Study**

- [#65](https://github.com/Elaktrato/qinqin/issues/65) reverse and cloze cards (built on `feature/v030-cards-reverse-cloze`: per-deck switch, sibling burying, contract fixtures in `docs/contracts/cards/`)
- [#66](https://github.com/Elaktrato/qinqin/issues/66) leech handling with a per-user policy
- ~~[#67](https://github.com/Elaktrato/qinqin/issues/67) daily goals~~ — done (v0.3.0 stretch)
- ~~[#75](https://github.com/Elaktrato/qinqin/issues/75) frequency-ordered new words and starter decks~~ — done (v0.3.0 stretch)
- [#76](https://github.com/Elaktrato/qinqin/issues/76) focus sessions from weak characters and leeches
- [#74](https://github.com/Elaktrato/qinqin/issues/74) placement test and "I already know this"
- [#60](https://github.com/Elaktrato/qinqin/issues/60) Anki import
- [#81](https://github.com/Elaktrato/qinqin/issues/81) weekly summary and milestones
- [#82](https://github.com/Elaktrato/qinqin/issues/82) level check (experimental)

**Japanese**

- [#62](https://github.com/Elaktrato/qinqin/issues/62) stroke order data from KanjiVG (licence CC BY-SA 3.0; check before bundling)
- [#63](https://github.com/Elaktrato/qinqin/issues/63) kana study, separate from flashcards

**Reader and lookup**

- [#68](https://github.com/Elaktrato/qinqin/issues/68) highlight unknown words, text coverage
- [#69](https://github.com/Elaktrato/qinqin/issues/69) import your own text (paste, txt, epub, subtitles)
- [#70](https://github.com/Elaktrato/qinqin/issues/70) handwriting lookup
- [#71](https://github.com/Elaktrato/qinqin/issues/71) radical and component lookup
- [#72](https://github.com/Elaktrato/qinqin/issues/72) lookup history with add-to-deck
- ~~[#77](https://github.com/Elaktrato/qinqin/issues/77) personal notes and mnemonics~~ — done (v0.3.0 stretch)
- [#78](https://github.com/Elaktrato/qinqin/issues/78) reading display settings, smart hiding of well-known readings

**Journal and platform**

- [#59](https://github.com/Elaktrato/qinqin/issues/59) journal sharing with comments and peer corrections
- [#58](https://github.com/Elaktrato/qinqin/issues/58) browser add-on, reader-like lookup on any site (after the first Android build)
- [#79](https://github.com/Elaktrato/qinqin/issues/79) installable PWA with offline study
- [#73](https://github.com/Elaktrato/qinqin/issues/73) UI languages
- [#80](https://github.com/Elaktrato/qinqin/issues/80) user and API documentation as the GitHub wiki

Engineering debt (#1–#22) was worked through in themed batches (backend hardening, web polish, CI and serving);
what remains open is listed in the handoff `docs/superpowers/handoffs/2026-11-15-web-build-handoff.md`
(#12, #17, #18 leftovers, #55 zombie CI runs; #86 login rate limiting is done on the v0.3.0 branch).

Note: the Android client (v0.4.0) does not read the `fsrs:*` plugin data yet, so once a set is active on the web its due counts differ from Android's until the Kotlin scheduler reads the same rows.

Design documents: `docs/superpowers/specs/`; plans: `docs/superpowers/plans/`.
Branching and releases: `docs/git-flow.md`.
