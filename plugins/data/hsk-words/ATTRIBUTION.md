# HSK 3.0 word levels (HSK 1–6, HSK 7–9)

The words of the official HSK syllabus, grouped by level, easiest first:

- Title: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test,
  part "HSK 词汇大纲" (vocabulary syllabus).
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

This pack includes only the vocabulary (word) list, as a plain list of
words with their levels and pinyin readings (used as lookup readings). It
does not include the syllabus's descriptions, task and topic lists, or
explanatory text. The sibling `hsk-chars` pack holds the list of characters
to recognise (认读字). The Chinese grammar pack (`zh-grammar`), when
installed, is listed separately in the Sources page's Grammar lessons section
and uses the syllabus's grammar outline as a topic index; it reproduces no
syllabus text.

The project includes these lists with this attribution at the project
owner's decision. The legal status of including these lists has not been
verified; this is not a legal opinion, and no licence or public-domain
status is claimed. There is no LICENSE file in this directory because
there is no licence text to copy.

## Conversion

`scripts/prepare-hsk-syllabus.mjs` reads the word boxes of
`pdftotext -tsv` (poppler) and takes, from each row of the vocabulary
table, the level, the word and its pinyin (the part of speech is not
kept). The level is the first level of the level cell. A cell such as
"1（4）" adds levels in parentheses, which appear to go with the parts of
speech in parentheses (半 "数、（副）": numeral at HSK 1, adverb at HSK 4;
the syllabus does not explain the notation); they are not kept, so a word
takes its first level. A trailing 1 or 2 that numbers
homographs (本1, 本2) is removed. The pinyin is the entry's reading (the
first one where the syllabus gives alternatives, such as "shéi/shuí");
the importer uses it to prefer the dictionary word with that reading.
Nothing else is added or changed.

Rows: 11,000, serial numbers 1–11,000, none missing or repeated.
Homograph-numbered rows: 82; rows with alternative pinyin: 2;
rows whose level cell names further levels: 102.
The same word with the same reading listed twice is kept once, at its lowest level: 41 rows.

| Level | Rows | Entries |
|-------|------|---------|
| HSK 1 | 300 | 300 |
| HSK 2 | 200 | 198 |
| HSK 3 | 500 | 497 |
| HSK 4 | 1,000 | 997 |
| HSK 5 | 1,600 | 1,591 |
| HSK 6 | 1,800 | 1,792 |
| HSK 7–9 | 5,600 | 5,584 |

Input file (SHA-256):

    d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad  syllabus.pdf
