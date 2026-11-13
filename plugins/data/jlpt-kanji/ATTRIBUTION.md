# JLPT kanji levels (N5–N1)

Kanji grouped by the current JLPT levels N5 (easiest) to N1, from `jlpt.tsv`
of kanjiapi.dev, https://github.com/onlyskin/kanjiapi.dev (commit 76aa080cdf56aa7587304d925e1435bb93469b79).

Licence: MIT, Copyright 2023 Iridium Szreter. See LICENSE in this directory
for the full text, copied verbatim from the upstream repository.

The Japan Foundation and JEES have published no official kanji list since
the 2010 revision of the test; like every N5–N1 list, this one is an
unofficial reconstruction. It replaces the pre-2010 four-level scale that
KANJIDIC2 carries, which qinqin no longer imports.

kanjiapi.dev does not say where `jlpt.tsv` comes from. Compared with
KANJIDIC2 (checked when this pack was made): 172 of the 2,136 jōyō kanji
are in no level, among them the common 分, 可, 無 and 的, and N1 holds 247
jinmeiyō (name) kanji such as 伊, 智, 弘 and 彦.

Conversion (`scripts/prepare-level-packs.mjs`): each line `<n>\t<kanji>`
becomes the level "N<n>", ordered N5, N4, N3, N2, N1, one entry per kanji in
file order. Nothing is added or removed. Levels: N5 79, N4 166, N3 367, N2 367, N1 1232.

Input file (SHA-256):

    52ff4165bc3bac8d5784c8521c41a2255c0346a580d8f24ab0f259451564ccfe  jlpt.tsv
    8d46c4a0a18ed265ad8824e54c2f2ae672a6c1c8dd01177e3928fb03e45be2c9  kanjiapi.dev-LICENSE
