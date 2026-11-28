# JLPT words (approximate), ≈ N5 to ≈ N1

Japanese words grouped by an estimated JLPT level, ≈ N5 (easiest) to ≈ N1.
This is an estimate, not an official list:
no official JLPT vocabulary list has been published since 2010 (the Japan
Foundation and JEES stopped publishing the test's lists with the 2010
revision). qinqin computes it with `scripts/prepare-jlpt-words.mjs` from
four packs it already bundles and three short lists written for it:

- the Jiten frequency list (`jiten-frequency`, version 2026-11-12),
  © Jitensoft, https://jiten.moe/frequency-dictionaries, CC BY-SA 4.0;
- JMdict (`jmdict`, version 2026-11-11), © Electronic Dictionary Research
  and Development Group (EDRDG),
  https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project,
  CC BY-SA 4.0 (EDRDG licence statement: https://www.edrdg.org/edrdg/licence.html);
- the approximate JLPT kanji levels (`jlpt-kanji`, version kanjiapi.dev@76aa080+kanjidic2@2026-11-11):
  kanjiapi.dev's list (MIT, Copyright 2023 Iridium Szreter,
  https://github.com/onlyskin/kanjiapi.dev; its licence text is
  LICENSE-kanjiapi.dev here) with gap fill from KANJIDIC2 (CC BY-SA 4.0, EDRDG);
- the jōyō kanji (`joyo-grades`, version kanjidic2@2026-315, from KANJIDIC2, CC BY-SA 4.0, EDRDG);
- `scripts/jlpt-words/core.tsv` (518 N5/N4 textbook words) and
  `grammar.tsv` (grammar pieces left out), written for qinqin:
  qinqin contributors, CC BY 4.0, https://github.com/Elaktrato/qinqin.

Licence: this pack is an adaptation of the Jiten ranks and JMdict and is
shared under CC BY-SA 4.0 (LICENSE is the legal code, copied from the
bundled jmdict pack). Whoever redistributes it keeps these credits and
shares changes under CC BY-SA 4.0; the MIT notice of kanjiapi.dev stays with
it.

Method:

1. Words: one Jiten rank is matched to the JMdict entry that has most of
   its rows (every form and reading Jiten lists under the rank) as a written
   form with that reading, a kana row as a reading. Ties go to the
   kana-written entry, then the one with more priority tags, then the lower
   sequence number. 10,944 ranks match no entry; the 6 within the cut
   below are listed in UNMATCHED.tsv, never guessed. Words on JMdict's basic
   list (ichi1) among its 6,000 most frequent newspaper words (nf01–nf12) are
   in even when Jiten ranks them beyond the cut (郵便局, 切手).
2. The core list sets the level of its 518 words directly.
3. Left out (within the cut): grammar pieces on the project's list and
   grammar expressions (JMdict entries that are only expressions, start
   with a particle or the copula and have no form starting with a kanji:
   のだ, として), set phrases of a word, a particle and a verb (言葉を失う),
   written numbers (５分), repeated-letter noise (あああ) and one-kana
   fragments that are not particles (fragment 12, grammar list 22, grammar 89, noise 5, number 32, phrase 6).
4. Frequency first: Jiten rank ≤ 1,191 → ≈ N5, ≤ 2,053 → ≈ N4, ≤ 4,671 → ≈ N3,
   ≤ 7,321 → ≈ N2, ≤ 9,785 → ≈ N1; beyond that a word is not listed (but see 1).
5. Kanji: when the hardest JLPT kanji level of the word's written form is
   harder, the word goes ONE level harder, never more, and not at all when
   JMdict gives it any priority tag. Kana-only and usually-kana words,
   ateji spellings (綺麗) and spellings with a kanji outside the jōyō set
   count as kana words.
6. JMdict's priority tags lift a word that rank puts at ≈ N3 or harder,
   to ≈ N4 at most: two levels for a word on JMdict's basic list (ichi1)
   among its 3,000 most frequent newspaper words (nf01–nf06), one level for
   one among the 6,000 most frequent (nf07–nf12), or tagged spec1 or gai1.
7. Slang, vulgar and colloquial words and interjections go no easier than
   ≈ N3.

The rank cuts are fitted on the rank alone to the commonly cited cumulative
sizes of the JLPT vocabulary (800, 1,500, 3,700, 6,000, 10,000 words up to N5 … N1;
sizes, not a list), the last one on the whole list; the rules above then move
words, so the easier levels hold more words than those sizes (see the level
counts below). There is no ground truth to measure accuracy against; the
checks are:

- the 518 core words placed by the rules alone (the core switched off):
  251 at their core level, 455 (87.8%) within one level, 14 not listed;
- 81 of 81 anchor words (scripts/jlpt-words/anchors.tsv) at or under
  their allowed level;
- of the 708 one-kanji words, 160 (22.6%) sit at their kanji's own level;
- of the 1,786 JLPT kanji the words use, 193 (10.8%) first appear in a word
  at the kanji's own level, 1,587 in an easier one, 6 in a harder one;
- no level is empty.

A word can be a level off; treat a level as a rough guide.

Each level lists its words by Jiten rank (unranked words last). Entries are
{"form", "reading"} for a word with a kanji form, its kana for a kana-only
word. 9,999 words; levels: ≈ N5 1,185, ≈ N4 1,976, ≈ N3 2,608, ≈ N2 2,626, ≈ N1 1,604.
