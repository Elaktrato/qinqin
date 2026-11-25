# Writing-system trainer Implementation Plan

> Spec: `docs/superpowers/specs/2026-11-26-writing-systems-design.md`. Branch `feature/writing-systems-204`, base `feature/v0.8.0`.

**Goal:** one core feature `scripts` that trains kana, Hangul and Cyrillic: charts, recognise/recall/read/type
practice, progress derived from `script` events, shown in the heatmap and a stats/home widget, only for languages
whose profile lists writing systems.

Scope order: (1) core + data model + kana charts + recognise/recall + progress (delivers #63); (2) Hangul and
Cyrillic data and the read mode; (3) typing; (4) write mode only with legal stroke data (deferred).

## Tasks

- [x] 1. Pure logic, test first: `hangul.ts`, `progress.ts`, `queue.ts` (questions and distractors), `typing.ts`, `chart.ts`, `events.ts` (payload builder and parser).
- [x] 2. Data: `kana.json`, `hangul.json`, `cyrillic.json`, `ATTRIBUTION.md`; a test checks every item (unique ids, romaji, katakana mirror of hiragana, Hangul jamo count, 33 Cyrillic letters).
- [x] 3. Profile `writingSystems` (Go, web, fixture, `ko`/`ru` rows), contract CHANGELOG.
- [x] 4. Server: feature id `scripts`, activity rule `script`, contract fixtures (`features/switches.json`, `events/activity.json`, `events/payloads.json`).
- [x] 5. Web: feature registration, nav (profile-gated), route `/scripts`, views (overview, chart, practice), widget, activity source words, i18n (`scripts.*`, area added to the key list and the contract README).
- [x] 6. dom tests for the page and the practice run; e2e spec is added but only CI can run it.
- [x] 7. Docs: `docs/sources.md`, `LICENSING.md`, ROADMAP, ADR 0006 table row, wiki page, handoff notes.
