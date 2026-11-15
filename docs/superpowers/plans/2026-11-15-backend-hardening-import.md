# Backend hardening: import, language and data

Batch for issues #2, #4, #5, #6, #7, #8. Branch `feature/backend-hardening-import`
(cut from develop 3245730). One task and one commit per issue, test first. Every
bullet was re-verified against the current code; struck or already-fixed items
are listed as such. No installed-DB data migration is needed (develop ends at
029); none is added.

Decision rule: licensing first, then correctness / best UX, even at higher dev cost.

## Task 1 — #2 pinyin syllable table (`server/internal/pinyin`)

Remaining:
- False accepts: `bou`, `chei`, `len`, `nun`. Fix the table: split `b p` (only `p` keeps `ou`), split `zh ch` (only `zh` keeps `ei`), drop `en` from `l`, drop `uen` from `n`.
- Rejected real syllables: `yo`, `n`/`ng`/`m`/`hm`/`hng` (嗯, 呣, 哼), `ê`/`eh` (欸). Handled as a small `specials` table, valid only as a whole token (never produced by greedy splitting, so `ToNumbered("xiann")` stays an error). Tone marks `ń ň ǹ ḿ ế ề` are read; bopomofo ㄧㄛ / ㄣ ㄫ ㄇ ㄏㄫ ㄏㄇ / ㄝ. `ToNumbered` writes `ê` as `eh` (ASCII, audio-index safe).
- Apostrophes (`xi'an`): `ToBopomofo`/`ToMarked` split on `'`/`’` (apostrophe only, not greedy; space-separated stays the interface). Output is space separated.
- Missing tests: `Plain` apostrophe stripping, `nv3`, 3+ syllables, uppercase input.
- DRY: `initials` derived from `initialBopomofo` keys (longest first).
- Dead early return in `parse`: already gone (verified); nothing to do.
- Guard: audio's `ToNumbered` / `splitSyllables` / erhua tests must stay green; `ToNumbered` relies on `parse`, so the table fixes apply to it too (`len`, `nun` now error, which is correct: they are not syllables).

Ruling: syllabic nasals/interjections are accepted only as whole tokens — greedy splitting would otherwise accept junk like `xiann` — cost if wrong: an unsplit run like `nǐn` stays as today.
Ruling: `ToNumbered` spells ê as `eh` — keeps output ASCII for the audio index — cost if wrong: one more alias to map.

## Task 2 — #4 import pipeline

Remaining:
- Duplicate identical json lines → identical senses: json merge keeps one sense per line; ruling: dedup identical gloss lists within one entry at merge time (an identical sense carries no information).
- Post-import `os.Rename` failure: the legacy `POST /api/admin/dictionaries` returns 500 for an installed dictionary. Ruling: log and answer 201 like the staged flow (which already turns it into a warning); the pack files are a re-install copy, not read at runtime.
- `ExtractZip`: output is already bounded (`DefaultZipLimits.MaxBytes` counts bytes actually written across entries, `LimitReader` per entry). Remaining hole: `io.ReadAll` of the compressed input. Cap the read at `MaxBytes` (a zip larger than the whole unpack budget is invalid).
- CEDICT: `ParseCedict` naming → keep exported name (public API, tests), doc clarifies strict; `cedictKind`: character only when the single rune is a Han ideograph (`unicode.Han`), otherwise word; comment detection: lines whose first non-space byte is `#`.
- Negative tests: truncated gzip, corrupt gzip header, missing required zip member (Unihan.zip), cedict + gz.

## Task 3 — #5 Unihan / KANJIDIC2

Remaining:
- `kangxi.go` comment: Kangxi Radicals block is U+2F00+N−1 but the table stores the unified forms (many differ from the block codepoints); rewrite.
- Radical validation hoisted before any write (and before registration); kanjidic2 too.
- `Result.Entries` "undercount": by design (documented: pack entries only; bare radicals are not pack entries). Ruling: keep, pin by test.
- Errors name the manifest id while the dictionary is keyed `unihan`: name the registry key and, when different, the pack (`unihan (pack <id>)`).
- Untested self-variant guard: add test.
- Default-branch ("format not implemented") test: reachable via `yomitan-freq`/`freq-csv`/`audio-index` formats of a dictionary pack; add test.
- `charEntry` re-calls, unused `replaceSenses` return: already gone.

## Task 4 — #6 Japanese search (`server/internal/lang/ja.go`)

- `ん` before small ゃゅょ (and before や/ゆ/よ and vowels): derivation emits `'` (`shin'ya`), so the derived romaji round-trips through `SearchPlain`. `PhoneticKey` drops apostrophes, so keys do not change.
- Particle は: `SearchPlain("konnichiwa")` → こんにちは, `konbanwa` → こんばんは (whole query only; the common beginner spelling matches the dictionary reading). Ruling: query-side only, no stored data changes — cost if wrong: a stored こんにちわ is no longer found by `konnichiwa` (the kana query still finds it).
- Hepburn ん=m before b/p/m (`sampo`, `kammuri`): accepted in queries; derivation keeps `n`.
- `prolongedVowel`: replace map lookup + byte scan by a precomputed rune→vowel table.

## Task 5 — #7 levels

- `Skipped` de-duplicated (first-seen order).
- Unit error message names `character`.
- Level names, member forms and readings trimmed before uniqueness/lookup/storage.

## Task 6 — #8 sentences

- `ForEntry` order: pack sentences first, then the viewer's own, each by id. Ruling — pack examples are the curated ones; own notes follow.
- User sentences on any entry kind: intentional (the reader saves book sentences on characters and words). Documented in `AddUser` and the handler; no restriction.
- POST read-back: new `sentences.Get(id, viewer)` by-id SELECT.
- Empty sentence arrays in a pack: rejected as invalid (no bundled pack has one).
- `Result.Sentences` counts distinct written rows (duplicates skipped).

## Gates
Go vet/test in docker, `-race` on touched packages, opt-in `RealPacks` test once at the end, `node scripts/check-sources.mjs .`, `git status` / `find -user root`.

## Fix wave (review)

Differential harness (old develop pinyin vs new) over CEDICT readings (numbered, marked, unspaced, unspaced-marked), HSK readings and all 1-4 letter strings x tones. Intended differences only: specials newly accepted (yo, n, ng, m, hm, hng, ê/eh) as whole tokens; bou, chei, len removed; unspaced-marked splits improved (nǔnàwǔtè, gélènuò, dìlèníānhǎi, shàngleniánjì...); `nun` kept (黁 [nun2] is attested) but taken only as a whole piece by the splitter; HSK `ǹg` Plain "g" -> "ng". Specials are lower-case only ("M jin1" stays unconverted). The audio fetch script's SYLLABLES list is checked against the table by a Go test.
