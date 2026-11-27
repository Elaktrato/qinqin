# JLPT words (approximate), ≈ N5 to ≈ N1

Japanese words grouped by an estimated JLPT level, ≈ N5 (easiest) to ≈ N1.
This is an estimate, not an official list:
no official JLPT vocabulary list has been published since 2010 (the Japan
Foundation and JEES stopped publishing the test's lists with the 2010
revision). qinqin computes it with `scripts/prepare-jlpt-words.mjs` from
three packs it already bundles:

- the Jiten frequency list (`jiten-frequency`, version 2026-11-12),
  © Jitensoft, https://jiten.moe/frequency-dictionaries, CC BY-SA 4.0;
- JMdict (`jmdict`, version 2026-11-11), © Electronic Dictionary Research
  and Development Group (EDRDG),
  https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project,
  CC BY-SA 4.0 (EDRDG licence statement: https://www.edrdg.org/edrdg/licence.html);
- the approximate JLPT kanji levels (`jlpt-kanji`, version kanjiapi.dev@76aa080+kanjidic2@2026-11-11):
  kanjiapi.dev's list (MIT, Copyright 2023 Iridium Szreter,
  https://github.com/onlyskin/kanjiapi.dev; its licence text is
  LICENSE-kanjiapi.dev here) with gap fill from KANJIDIC2 (CC BY-SA 4.0, EDRDG).

Licence: this pack is an adaptation of the Jiten ranks and JMdict and is
shared under CC BY-SA 4.0 (LICENSE is the legal code, copied from the
bundled jmdict pack). Whoever redistributes it keeps these credits and
shares changes under CC BY-SA 4.0; the MIT notice of kanjiapi.dev stays with
it.

Method (one Jiten rank is one word):

1. Each rank's rows (every form and reading Jiten lists for the word) are
   matched to the JMdict entry that has most of them as a written form
   with that reading, a kana row as a reading. Ties go to the kana-written
   entry, then the one with more priority tags, then the lower sequence
   number (11,636 ranks were ties, most of them beyond the cut below).
   10,944 ranks match no entry; the 11 of them within the cut are
   listed in UNMATCHED.tsv (inflected forms and grammar patterns such as
   はずだ and でした), never guessed. Grammar expressions (JMdict entries
   that are only expressions and start with a particle or the copula, such
   as のだ, として and かもしれない: the JLPT tests them as grammar) are
   left out (160 within the cut).
2. Kanji level: the hardest JLPT kanji level among the kanji of the word's
   written form; a kanji the kanji list has no level for counts as N1.
   Kana-only words and words JMdict marks "usually written using kana
   alone" have none (する is not N1 for 為).
3. Rank level: Jiten rank ≤ 2,203 → ≈ N5, ≤ 3,249 → ≈ N4, ≤ 5,633 → ≈ N3,
   ≤ 8,336 → ≈ N2, ≤ 11,441 → ≈ N1; a word ranked beyond 11,441 is not
   listed.
4. The word's level is the harder of the two.

The rank cuts are fitted so the cumulative size up to each level matches the
commonly cited sizes of the JLPT vocabulary (800, 1,500, 3,700, 6,000, 10,000 words
up to N5 … N1): sizes, not a list. There is no ground truth to measure
accuracy against; the consistency checks are:

- of the 696 one-kanji words, 522 (75.0%) sit at their kanji's own level;
- of the 1,704 JLPT kanji the words use, 1,637 (96.1%) first appear in a word
  at the kanji's own level, 50 one level harder, 17 more;
- no level is empty;
- the share of words JMdict marks with a priority tag (its own commonness
  data, independent of Jiten) per level: ≈ N5 81%, ≈ N4 83%, ≈ N3 81%, ≈ N2 76%, ≈ N1 74%.

A word can be a level off; treat a level as a rough guide.

Each level lists its words by Jiten rank. Entries are {"form", "reading"}
for a word with a kanji form, its kana for a kana-only word. 9,999 words;
levels: ≈ N5 800, ≈ N4 700, ≈ N3 2,200, ≈ N2 2,299, ≈ N1 4,000.
