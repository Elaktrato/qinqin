# Script data: attribution and licence

Files: `kana.json` (hiragana and katakana), `hangul.json`, `cyrillic.json`.

**Licence: CC0 1.0 Universal** (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/).
No attribution is required. The project credits itself on the Sources page as "qinqin contributors" anyway.

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

- No stroke order data. KanjiVG (the usual source for kana strokes) is CC BY-SA 3.0, which is below the project's
  floor of CC BY-SA 4.0, so it is not bundled; the project has not written kana, Hangul or Cyrillic stroke data
  yet. The trainer therefore has no write mode.
- No audio. Sounds are spoken by the device voice (the browser's speech synthesis, or Android's text-to-speech in
  the app). Lingua Libre recordings (Wikimedia Commons, licence per file) are a possible later source; each file's
  licence must be checked at download time before anything is bundled.

## Checks

`apps/web/src/lib/features/scripts/packs.test.ts` pins the counts (46, 20, 5 and 33 kana per script, 40 Hangul
jamo, 33 Cyrillic letters), the katakana mirror and that every example word uses letters of its own chart.
