# Chinese grammar (HSK-aligned)

Grammar lessons for Mandarin Chinese, level by level, following the grammar
outline (语法大纲) of the official HSK 3.0 syllabus. Each syllabus 细目 row is
taught by a lesson with 4–8 example sentences, readings, translations and
exercise answers. This file records what the pack is, what it uses from the
syllabus, and the conventions it follows.

## Authorship and licence

- Author: written for qinqin by the project. The lesson grouping and order,
  the explanations, the example sentences, the readings, the translations and
  the wrong answers used in the exercises are original; nothing was copied or
  paraphrased from a textbook, a website or the syllabus.
- Licence of the lessons: CC0 1.0 Universal (public domain dedication),
  https://creativecommons.org/publicdomain/zero/1.0/. See `LICENSE`.
- Licence split: the lessons are CC0; the HSK syllabus is **not** CC0 and no
  reuse licence is granted for it (see below). The Sources page must not imply
  the syllabus is CC0.

## The syllabus as a source (not a licence)

- Title: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test.
- Publisher: 中外语言交流合作中心 (Center for Language Education and
  Cooperation, CLEC), distributed by Chinese Testing International (CTI),
  https://www.chinesetest.cn.
- Edition: published 2025-11, effective 2026-07.
- PDF: https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf
- SHA-256 of the PDF:
  `d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad`.
- What is used: the grammar outline's rows as a **topic index only** — the list
  of grammar points per level, used to decide what each lesson teaches and to
  check completeness. No syllabus prose, task description, topic list or word
  list is reproduced. The CTI Legal Notice
  (https://www.chinesetest.cn/legal-notice) requires the source to be indicated
  and permits only reasonable, good-faith quoting for informative public use;
  the legal status of a topic index is not verified (this is not a legal
  opinion). The PDF and any text extracted from it stay outside the repository.

## Coverage policy

- `COVERAGE.md` maps every syllabus 细目 row to the lesson id (or ids) that
  teach it, one table per level, in syllabus order. It is the reviewer's
  completeness check and is a topic index in qinqin's own words, not a copy of
  the syllabus text.
- One lesson per 细目 row. A row that bundles a list of members (pronouns,
  numerals, measure words, particles) is one lesson: its examples cover the
  row's contrasts and its body names the members. A row that is genuinely
  several independent constructions is split into pattern-family lessons; the
  coverage index then lists every lesson for that row. In HSK 1 the 语气助词
  row is split into two lessons (questions/suggestions with 吗 and 吧;
  sentence-final 了 and 呢).
- The levels are qinqin's estimates ("≈ HSK N"), not official HSK levels.

## Pinyin conventions

- Hanyu Pinyin with tone marks, as in the HSK word list pack (`hsk-words`):
  不 and 一 are written as they are spoken (不是 bú shì, 一个 yí ge),
  third-tone sandhi is not marked (nǐ hǎo), neutral tones are unmarked
  (朋友 péngyou, 桌子 zhuōzi).
- Readings are lower case; only proper nouns (Zhōngguó, Hànyǔ) start with a
  capital. Sentence-final punctuation is kept.

## Vocabulary policy

- Example sentences use words of the level's HSK word list (`hsk-words`) and
  earlier levels where possible, so the "≈ HSK N" badge is honest. A proper
  noun or a necessary word above the level is allowed but kept rare (for
  example the measure word 杯, which the outline itself lists, or 过 in a
  contrast example). The policy is kept by hand; it is not machine-checked,
  because Chinese word segmentation makes a strict check unreliable.

## Contrast and distractor policy

- Every lesson has 1–2 **contrast** examples whose focus is a related point,
  not the lesson's own point (for example 过 in a lesson about 了, or 没 in a
  lesson about 不); the body explains the difference.
- Every example yields a fill-the-gap exercise: its `focus` occurs exactly once
  in the sentence, and it carries 2–4 authored distractors. At least one
  distractor is clearly wrong in that slot; at least one is a similar or
  contrastive point wherever one can be wrong there. No distractor is another
  correct answer, and none is correct under a different reading. Distractors
  are authored, never generated.

## Native-review status

- The content has **NOT** been reviewed by a native speaker; errors are
  possible and corrections are welcome. The pack ships marked unreviewed, and
  no claim of review is made.