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

## Review fixes (v0.8.0)

Branch `fix/v080-web-correctness`.

- Ruling: Type mode accepts every glyph of the same system that shares the asked `roman` (じ/ぢ "ji", ず/づ "zu", the katakana rows); the asked glyph stays the shown answer — the prompt is only the romanisation, so rejecting the twin marked correct kana wrong — if wrong, a learner could type the "other" glyph and pass (cost: none, same sound).
- Ruling: choice distractors also exclude any item with the same `roman` (belt and braces over `sounds`), so a recognise/recall round never offers two correct options; a test walks every item of every system.
- Ruling: offline answers are flushed by the app shell on start, on `online` and on visibility (one flush per workspace at a time), not only when /scripts opens — answers waited indefinitely for a visit to one page — if wrong, a duplicate post, which the event ids make harmless.
- Ruling: past 2,000 waiting answers the oldest are still dropped, but never silently: a counter is kept and /scripts shows a dismissible warning — compacting is impossible (every answer is a distinct event) and raising the cap only moves the cliff — if wrong, a learner offline for weeks loses progress they are told about.
