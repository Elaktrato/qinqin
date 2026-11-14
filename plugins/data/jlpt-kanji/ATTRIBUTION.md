# JLPT kanji levels (N5–N1), approximate

Kanji grouped by the current JLPT levels N5 (easiest) to N1. This is an
approximation: the Japan Foundation and JEES have published no official
kanji list since the 2010 revision of the test, so every N5–N1 kanji list is
an unofficial reconstruction, and this pack is one more, built by qinqin
from two sources.

Base list: `jlpt.tsv` of kanjiapi.dev, https://github.com/onlyskin/kanjiapi.dev (commit 76aa080cdf56aa7587304d925e1435bb93469b79).
Licence: MIT, Copyright 2023 Iridium Szreter. See LICENSE in this directory
for the full text, copied verbatim from the upstream repository.
kanjiapi.dev does not say where `jlpt.tsv` comes from. Every kanji it lists
keeps its level here.

Gap fill: KANJIDIC2 (dated 2026-11-11), © Electronic Dictionary Research
and Development Group (EDRDG), https://www.edrdg.org/wiki/index.php/KANJIDIC_Project,
licensed under CC BY-SA 4.0 (EDRDG licence statement:
https://www.edrdg.org/edrdg/licence.html; see LICENSE-KANJIDIC2 in this
directory, copied from the bundled kanjidic2 pack). The levels of the kanji the base list
omits are adapted from KANJIDIC2 data and are licensed under CC BY-SA 4.0;
the base list's levels stay under its MIT licence. Whoever redistributes
this pack follows both: keep both notices and licence texts, and share
changes to the derived levels under CC BY-SA 4.0.

Compared with KANJIDIC2, the base list leaves 172 of the
2136 jōyō kanji in no level, among them the common 分, 可, 無 and 的,
and its N1 holds 247 jinmeiyō (name) kanji such as 伊, 智, 弘 and 彦.
`scripts/prepare-level-packs.mjs` places each kanji the base list omits,
in this order:

a. A kanji with a pre-2010 four-level JLPT level in KANJIDIC2 (`<jlpt>`):
   4 → N5, 3 → N4, 1 → N1; 2 → N3 when its newspaper frequency rank
   (`<freq>`) is 521 or better, else (or with no rank) N2.
   19 kanji.
b. Else a jōyō kanji (`<grade>` 1–8), by school grade:
   grade ≤ 1 → N5, grade ≤ 2 → N4, grade ≤ 4 → N3, grade ≤ 5 → N2,
   higher grades (6, and 8 for the secondary-school jōyō kanji) → N1;
   with no frequency rank → N1. 157 kanji.
c. Anything else (jinmeiyō name kanji, kanji with no grade) is not listed.

The thresholds were calibrated against the base list itself (its
2211 kanji are the reference; 20% held out by code point); the evaluation is recorded
next to the constants in the script and reproduced by
`node scripts/prepare-level-packs.mjs --calibrate <upstream-dir>`. Every
reference kanji also has an old KANJIDIC2 level, so these are measurements
on kanji like the ones rule a places, not like the ones rule b places. On
the held-out kanji the old-level mapping agrees with the base list on about
four in five. The grade rule agrees on about three in five, but that was
measured on kanji that have an old level; rule b places only kanji without
one, 151 of 157 of them grade 8, mostly the 2010 jōyō additions
(such as 誰, 頃, 俺 and 闇), all at N1. How well it does on them is
unmeasured, and probably worse for the common ones: KANJIDIC2's frequency
rank is newspaper data from before 2010 and under-ranks them. Treat a
derived level as a rough guide. Every jōyō kanji now has a level.

Order: each level lists the base kanji in file order, then the added kanji
by frequency rank (none last), then code point. 2387 kanji; levels
(base + added): N5 79 + 1, N4 166 + 0, N3 367 + 10, N2 367 + 2, N1 1232 + 163.

Input files (SHA-256):

    52ff4165bc3bac8d5784c8521c41a2255c0346a580d8f24ab0f259451564ccfe  jlpt.tsv
    8d46c4a0a18ed265ad8824e54c2f2ae672a6c1c8dd01177e3928fb03e45be2c9  kanjiapi.dev-LICENSE
    f3bfc5a832a974e452e186f3f990573dcde61ed63956db71d65fc353e4c4584d  kanjidic2/kanjidic2.xml.gz
    28a9529c7d0bb4dc51f4bf5c116a3d16ef247a052f7591466768ddf563fd1cf5  kanjidic2/LICENSE
