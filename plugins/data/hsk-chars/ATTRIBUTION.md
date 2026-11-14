# HSK 3.0 character levels (HSK 1–6, HSK 7–9)

The characters to recognise (认读字) of the official HSK syllabus, grouped
by level, easiest first:

- Title: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test,
  part "HSK 汉字大纲" (character syllabus).
- Edition: published 2025-11 (发布), effective 2026-07 (实施).
- Issued by: 中外语言交流合作中心 (Center for Language Education and
  Cooperation, CLEC).
- Distributed by: Chinese Testing International (CTI), https://www.chinesetest.cn
- File: https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf

## Licence and terms

Source: www.chinesetest.cn — reproduced from the Chinese Test Service Website (CTI); syllabus published by CLEC (中外语言交流合作中心).

No reuse licence is granted for the syllabus. It is published by
中外语言交流合作中心 (CLEC) and distributed by Chinese Testing International
(CTI) at https://www.chinesetest.cn. The site's Legal Notice,
https://www.chinesetest.cn/legal-notice, says that the site's content is copyrighted by CTI
or the content providers; that whoever reproduces it must indicate the
source ("Source: www.chinesetest.cn", "reproduced from (or quoted from) the
Chinese Test Service Website"); and that reproducing or quoting it is
permitted only as reasonable, good-faith quoting for news or informative,
free public information. The syllabus PDF carries a copy-protection flag
(copy: no, change: no).

The project includes only two lists from the syllabus: the vocabulary
(word) list and the list of characters to recognise (认读字), as plain lists
of words and characters with their levels (and the words' pinyin, used as
lookup readings). It does not include the syllabus's other content: the
grammar points, the task and topic descriptions, the lists of characters to
write (书写字; only their sizes are reported) and the explanatory text.

The project includes these lists with this attribution at the project
owner's decision. The legal status of including these lists has not been
verified; this is not a legal opinion, and no licence or public-domain
status is claimed. There is no LICENSE file in this directory because
there is no licence text to copy.

## Conversion

`scripts/prepare-hsk-syllabus.mjs` reads the word boxes of
`pdftotext -tsv` (poppler) and takes the numbered lists of the character
syllabus. Each level of this pack is one 认读字 list (HSK（一级）认读字 …
HSK（七—九级）认读字), in list order; every list numbers 1..N with no gap
or repeat. Nothing is added or changed.

Characters: 3,088, each in one list, none repeated.

| Level | 认读字 |
|-------|--------|
| HSK 1 | 246 |
| HSK 2 | 125 |
| HSK 3 | 284 |
| HSK 4 | 441 |
| HSK 5 | 431 |
| HSK 6 | 413 |
| HSK 7–9 | 1,148 |

The syllabus also lists 1,200 characters to write (书写字), which assign
no level here; each is a character to recognise at or below its level:

| List | 书写字 |
|------|--------|
| HSK（一级）~（二级）书写字 | 100 |
| HSK（三级）书写字 | 150 |
| HSK（四级）书写字 | 150 |
| HSK（五级）书写字 | 150 |
| HSK（六级）书写字 | 150 |
| HSK（七—九级）书写字 | 500 |

Input file (SHA-256):

    d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad  syllabus.pdf
