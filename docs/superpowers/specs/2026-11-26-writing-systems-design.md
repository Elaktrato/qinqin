# Writing-system trainer (#204, kana #63) — design

Status: draft for the owner; built on `feature/writing-systems-204`.

## 1. Intent

Learners of Japanese, Korean and Russian learn the script before the words. One core feature, **Scripts**
(`/scripts`), serves all three: charts with sound and romanisation, practice (recognise, recall, read, type) and
its own progress. It is **not** a flashcard deck: nothing is added to the study queue, the FSRS state or the
decks. Kana (#63) is its first script.

## 2. Parts

| Part | Where |
| --- | --- |
| Script data (charts, example words, key layouts), CC0, project-written | `apps/web/src/lib/features/scripts/data/` (`kana.json`, `hangul.json`, `cyrillic.json`, `ATTRIBUTION.md`) |
| Pure logic: Hangul composition, scoring and scheduling, question building, typing check, chart view | `apps/web/src/lib/features/scripts/*.ts` |
| Progress | derived from `script` study events (`{system, item, mode, ok}`); the server counts them as activity of the feature `scripts` (heatmap, goals, weekly summary) |
| Where it appears | the language profile's `writingSystems` (`ja`: hiragana, katakana; `ko`: hangul; `ru`: cyrillic) |
| Switch | core feature `scripts` (per user, like the other four) |
| Audio | the shared player: audio pack when present (none today), else the device voice (browser speech synthesis, Android native TTS through `lib/native/speech.ts`) |

## 3. Progress and scheduling

One Leitner-style box per item (system + glyph), derived by replaying the workspace's `script` events in time
order (`progress.ts`): a correct answer moves the item up one box (max 5) and sets its next due time from the
box's interval (box 1: 10 min, then 1, 3, 7 and 21 days); a wrong answer sends it to box 0 (asked again after a minute). A correct answer promotes only an item that is due (or new), so repeating one item in a sitting cannot climb. An item is
**known** from box 3. Any mode counts; the mode is kept in the event for later statistics. The queue picks due
items first, then new ones (at most 5 new per round), then the weakest. Distractors prefer items of the same group
and never share the correct answer's romanisation.

## 4. Modes

- **Recognise**: see the glyph, choose the sound (romanisation).
- **Recall**: see the romanisation (and hear the sound), choose the glyph.
- **Read**: Hangul syllable blocks built from initial + vowel (+ final), and example words; choose the romanisation.
- **Type**: the romanisation is shown; type the glyph with the device keyboard (IME for kana and Hangul, the
  ЙЦУКЕН layout for Cyrillic). A layout hint (Hangul 2-set key, Russian key) can be shown.
- **Write** (stroke order): only where stroke data is legally available. Not built: see Rulings.

## 5. Rulings

- Ruling: script data lives in the web build, not in a server pack type — the charts are small, project-written
  reference data used offline in the PWA and the Android shell, and a pack type is ten places of server code for
  no user-installable content — if wrong: moving the JSON into a `script` pack type later (the loader is one
  function).
- Ruling: the three data sets are released CC0, following the issue, although `LICENSING.md` says project-written
  content is CC BY 4.0 — the issue's CC0 text is specific to these packs and CC0 is more permissive than the
  owner's CC BY-SA 4.0 floor — if wrong: relabel to CC BY 4.0 (a notice change, no code).
- Ruling: kana write mode is deferred — KanjiVG is CC BY-SA 3.0, not 4.0 or more permissive, and the project has no
  stroke data of its own for kana — if wrong: a pack of project-authored kana strokes, or an owner exception for KanjiVG.
- Ruling: progress is derived from events, not stored rows — as the issue says and like reviews — if wrong: a
  typed progress table like grammar's.
- Ruling: `ko` and `ru` get language profiles now (script `other`) so the feature can appear for them — a profile
  row is the documented way to add a language — if wrong: the rows change with no data migration.
- Ruling: script answers do not use the review outbox; a failed send waits in a per-workspace list in the browser's
  storage (`pending.ts`), counts in the progress at once and is re-sent with the same event id on the next visit —
  the outbox is review-specific and a script answer is cheap to lose but better kept — if wrong: another device
  does not see an offline answer until that browser comes back online.
- Ruling: read-mode answers (words, Hangul blocks) are events too (activity, statistics) but only chart items fill
  the chart's known/learning colours — a word is not a letter — if wrong: credit each letter of a word.
- Ruling: the nav icon is the existing `words` ("Aa") icon, no new vendored icon — avoids a lucide download for a
  cosmetic choice — if wrong: swap the icon name in `frame/sections.ts`.
- Ruling: the new interface strings exist in English only (the only complete catalogue today, `docs/contracts/i18n`)
  — if wrong: translations arrive with the other catalogues.
