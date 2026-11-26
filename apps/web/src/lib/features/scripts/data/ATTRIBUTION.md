# Script data: attribution and licence

Files: `kana.json` (hiragana and katakana), `hangul.json`, `cyrillic.json`.

**Licence: CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/), credit "qinqin contributors, CC BY 4.0 —
https://github.com/Elaktrato/qinqin". The full legal code is `plugins/data/ja-lemma/LICENSE`; see `NOTICE` here.
(Issue #204 asked for CC0; the owner decided on 2026-11-26 that these files follow the project's CC BY 4.0, see
`LICENSING.md`.) The Sources page credits them under the feature.

## Where the data comes from

All of it was written by the qinqin project; no third-party data file was downloaded, copied or converted:

- **Charts** (the glyphs, their order, groups and romanisation): the kana of the standard gojūon, dakuten,
  handakuten and yōon tables in modified Hepburn; the 24 basic Hangul jamo plus the five tense consonants and
  eleven compound vowels in the Revised Romanization of Korean; the 33 letters of the Russian alphabet in a
  plain Latin transliteration. These are facts about writing systems (the characters themselves are not
  copyrightable); the selection and the notes are the project's own text.
- **Katakana** is generated from the hiragana table by the Unicode offset (U+0060) and checked by a test.
- **Example words** (20 to 30 per system) are common everyday words chosen by the project, with an English gloss.
  They are not copied from a dictionary or a word list.
- **Keyboard keys**: the QWERTY key of each Hangul jamo on the Korean 2-set layout and of each Cyrillic letter on
  the Russian ЙЦУКЕН layout. Layout facts, written down by the project.
- **Notes** (look-alike letters, italic and handwriting forms, soft and hard sign) are the project's own sentences.

## What is not here

- No stroke order data in these files. Kana stroke order comes from the separate `kanjivg-strokes` pack (KanjiVG,
  CC BY-SA 3.0, served by the server; `docs/sources.md`). KanjiVG has no Hangul or Cyrillic, so those systems have
  no write mode.
- No audio. Sounds are spoken by the device voice (the browser's speech synthesis, or Android's text-to-speech in
  the app). Lingua Libre recordings (Wikimedia Commons, licence per file) are a possible later source; each file's
  licence must be checked at download time before anything is bundled.

## Checks

`apps/web/src/lib/features/scripts/packs.test.ts` pins the counts (46, 20, 5 and 33 kana per script, 40 Hangul
jamo, 33 Cyrillic letters), the katakana mirror and that every example word uses letters of its own chart.
