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
- Stretch (`feature/v0.3.0-stretch`, brief `docs/superpowers/directions/2026-11-16-v0.3.0-stretch-agent-brief.md`): ~~[#67](https://github.com/Elaktrato/qinqin/issues/67) daily goals~~ (merge 93f70f9, `docs/contracts/goals/`), ~~[#75](https://github.com/Elaktrato/qinqin/issues/75) frequency-ordered new words and starter decks~~ (merge ed99015, `docs/contracts/frequency/`; no new data bundled, no clearly licensed Chinese word list exists), ~~[#77](https://github.com/Elaktrato/qinqin/issues/77) personal notes and mnemonics~~ (merge ab1352b, `docs/contracts/notes/`), ~~[#71](https://github.com/Elaktrato/qinqin/issues/71) radical and component lookup~~ (merge d91bf90, `docs/contracts/radicals/`; KanjiVG components bundled, Chinese components local-only), ~~[#68](https://github.com/Elaktrato/qinqin/issues/68) unknown-word highlighting and text coverage~~ (merge f0ab056, `docs/contracts/reader/`), ~~[#83](https://github.com/Elaktrato/qinqin/issues/83) personal access tokens~~ (merge f10435e, `docs/contracts/auth/tokens*.json`, wiki `API-Access-tokens.md`), ~~[#81](https://github.com/Elaktrato/qinqin/issues/81) weekly summary~~ (merge 78ce8de, in-app only, `docs/contracts/weekly/`; milestones deferred), ~~[#72](https://github.com/Elaktrato/qinqin/issues/72) lookup history~~ (merge ef0e450, `docs/contracts/lookups/`). Handoff: `docs/superpowers/handoffs/2026-11-16-v0.3.0-stretch-handoff.md`.
- Stretch still open: [#80](https://github.com/Elaktrato/qinqin/issues/80) (wiki source kept current in `docs/wiki/`; publishing is the owner's step).

## v0.4.0 prep — web and server ready for Android (done — items 1–8 on develop; handoff `docs/superpowers/handoffs/2026-11-17-v0.4.0-prep-handoff.md`)

Direction: `docs/superpowers/directions/2026-11-16-v0.4.0-prep.md`; takeover brief:
`docs/superpowers/handoffs/2026-11-17-v0.4.0-prep-takeover.md`.

- Done on develop: ~~[#91](https://github.com/Elaktrato/qinqin/issues/91) MFA reset button and admin re-authentication~~ (merge 0c884d8), ~~[#92](https://github.com/Elaktrato/qinqin/issues/92) kana display forms~~ (merge 5b9c18d), ~~[#17](https://github.com/Elaktrato/qinqin/issues/17) entry view and [#12](https://github.com/Elaktrato/qinqin/issues/12) titles/accessibility~~ (merge 2714fc7), ~~[#85](https://github.com/Elaktrato/qinqin/issues/85) flashcards and reader as core features~~ (merge f1c6957, `docs/contracts/study/`, `docs/contracts/library/`).
- Done on develop (continued): ~~[#93](https://github.com/Elaktrato/qinqin/issues/93) data packages and paged sync pull v2~~ (`docs/contracts/packages/`, `docs/contracts/sync/`; stroke data is an installable pack; follow-up [#110](https://github.com/Elaktrato/qinqin/issues/110) pages `GET /api/events`), ~~[#109](https://github.com/Elaktrato/qinqin/issues/109) remaining contract gaps~~ (`docs/contracts/events/`, `scheduler/`, `settings/`, `overlays/` and more; `overview.md` is the Android entry point), a provisional logo with a theme-aware favicon.
- Done: ~~[#94](https://github.com/Elaktrato/qinqin/issues/94) weekly milestones~~ (`docs/contracts/milestones/`, stored seen state as `milestone:<id>` rows).
- Done: ~~[#73](https://github.com/Elaktrato/qinqin/issues/73) translatable interface~~ (English complete, per-user language, `docs/contracts/i18n/`, wiki `Translating-qinqin.md`).

## v0.5.0 — visual rework (web) — done on develop

Design: `docs/superpowers/specs/2026-11-16-visual-rework-design.md`; mockups:
`docs/superpowers/specs/assets/2026-11-16-visual-rework-mockups.html`; epic
[#95](https://github.com/Elaktrato/qinqin/issues/95).

- Done: [#96](https://github.com/Elaktrato/qinqin/issues/96) theme packs and appearance,
  [#97](https://github.com/Elaktrato/qinqin/issues/97) interface font and CJK font packs,
  [#98](https://github.com/Elaktrato/qinqin/issues/98) base components and design rules,
  [#99](https://github.com/Elaktrato/qinqin/issues/99) frame and phone drawer,
  [#100](https://github.com/Elaktrato/qinqin/issues/100) Home and the heatmap layouts,
  [#101](https://github.com/Elaktrato/qinqin/issues/101) flashcards,
  [#102](https://github.com/Elaktrato/qinqin/issues/102) reader,
  [#103](https://github.com/Elaktrato/qinqin/issues/103) journal,
  [#104](https://github.com/Elaktrato/qinqin/issues/104) search and the entry page,
  [#105](https://github.com/Elaktrato/qinqin/issues/105) stats,
  [#106](https://github.com/Elaktrato/qinqin/issues/106) the remaining pages, and
  [#108](https://github.com/Elaktrato/qinqin/issues/108) the qinqin house themes.
- Owner follow-ups of 2026-11-18 are in: Settings tabs wrap instead of showing a scrollbar;
  Search leads the frame menu (after Home); Stats → Characters has a **Level** filter
  (all levels or one installed level scheme's level, remembered per workspace, with its own
  "X of Y learned" count); the starter and level deck dropdowns have one-click **Add**
  copies; the study setup is compact (Start/Study all and the limits at the top, one
  card-type list with per-deck controls under Advanced, **Study all** ignores the limits);
  round checkboxes replace the native marks; and the last native-looking selects, buttons
  and links use the base components and theme tokens.
- Open: [#107](https://github.com/Elaktrato/qinqin/issues/107) the owner's lotus stages, level
  badges and day markers. #95 closes when those drawings land.
- Owner checks: every page at 360 and 1440 px in light and dark and in at least three themes;
  the qinqin Day, Night and Deep themes on a real device; a real screen reader, touch and
  200 % zoom pass.

## v0.4.0 — Android client (milestone)

Native Kotlin (Jetpack Compose, Room), Android only — replaces the earlier Flutter plan.

- [#34](https://github.com/Elaktrato/qinqin/issues/34) Kotlin scaffold, auth, workspaces
- [#35](https://github.com/Elaktrato/qinqin/issues/35) offline-first store and sync engine
- [#36](https://github.com/Elaktrato/qinqin/issues/36) core views parity (entry, search, strokes)
- [#37](https://github.com/Elaktrato/qinqin/issues/37) entry editing
- [#38](https://github.com/Elaktrato/qinqin/issues/38) feature-plugin host (Kotlin) and study parity incl. native writing

## Future (milestone)

- ~~[#39](https://github.com/Elaktrato/qinqin/issues/39) feature-plugin SDK~~ — done (strict manifest contract, permissions, embedded built-in manifests, web SDK, study-event hook; design `docs/superpowers/specs/2026-11-15-plugin-sdk-design.md`). Follow-up: ~~[#85](https://github.com/Elaktrato/qinqin/issues/85) move flashcards and reader onto the SDK~~ — reworked: they became core features (v0.4.0 prep)
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
- ~~[#83](https://github.com/Elaktrato/qinqin/issues/83) accounts: personal access tokens for scripts and integrations~~ — done (v0.3.0 stretch)
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
- ~~[#81](https://github.com/Elaktrato/qinqin/issues/81) weekly summary~~ — done (v0.3.0 stretch, in-app; milestones deferred)
- [#82](https://github.com/Elaktrato/qinqin/issues/82) level check (experimental)

**Japanese**

- [#62](https://github.com/Elaktrato/qinqin/issues/62) stroke order data from KanjiVG (licence CC BY-SA 3.0; check before bundling)
- [#63](https://github.com/Elaktrato/qinqin/issues/63) kana study, separate from flashcards

**Reader and lookup**

- ~~[#68](https://github.com/Elaktrato/qinqin/issues/68) highlight unknown words, text coverage~~ — done (v0.3.0 stretch)
- [#69](https://github.com/Elaktrato/qinqin/issues/69) import your own text (paste, txt, epub, subtitles)
- [#70](https://github.com/Elaktrato/qinqin/issues/70) handwriting lookup
- ~~[#71](https://github.com/Elaktrato/qinqin/issues/71) radical and component lookup~~ — done (v0.3.0 stretch)
- ~~[#72](https://github.com/Elaktrato/qinqin/issues/72) lookup history with add-to-deck~~ — done (v0.3.0 stretch)
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
