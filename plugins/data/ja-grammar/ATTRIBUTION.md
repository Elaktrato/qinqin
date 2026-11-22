# Japanese grammar (≈ JLPT levels)

Grammar lessons for Japanese in five levels, ≈ JLPT N5 to N1. Each grammar point is taught by a
lesson with 4–8 example sentences, kana readings, English translations and exercise answers. This
file records what the pack is, how its content was chosen, and the conventions it follows.

## Authorship and licence

- Author: written for qinqin by the project. The choice of grammar points, their grouping and
  order, the explanations, the example sentences, the readings, the translations and the wrong
  answers used in the exercises are original; nothing was copied or paraphrased from a textbook,
  a JLPT preparation book, a website or a published grammar list.
- Licence: CC0 1.0 Universal (public domain dedication),
  https://creativecommons.org/publicdomain/zero/1.0/. See `LICENSE`.

## Selection

- The JLPT (Japan Foundation / JEES) has published no grammar list since 2010. The points per
  level are qinqin's own selection, recorded in
  `docs/superpowers/specs/2026-11-21-ja-grammar-pack-design.md`; grammar points are facts of the
  language, the selection and order are the project's.
- `COVERAGE.md` maps every point of that selection to the lesson id (or ids) that teach it. A
  point that cannot be taught in eight examples is split into two lessons.
- The levels are qinqin's estimates ("≈ N3"), not official JLPT levels. The Grammar page shows
  the "≈ N" badge only when the `jlpt-kanji` level pack is installed; that pack is itself an
  approximation of kanji levels.

## Conventions

- Readings: the whole sentence in kana — hiragana for words written with kanji, katakana words
  kept in katakana, Japanese punctuation kept, no spaces. The particles は, へ and を are written
  as such.
- Register: ≈ N5–N4 examples are mostly polite (です / ます) unless a lesson teaches plain forms;
  higher levels mix plain, polite and written style as the pattern needs.
- Vocabulary stays near the level where possible; it is kept by hand, not machine-checked.

## Exercises

- Every example yields a fill-the-gap exercise: its `focus` occurs exactly once in the sentence,
  with 2–4 authored distractors, at least one of them clearly wrong in that slot and, where
  possible, one a similar point. No distractor is another correct answer. Every lesson has 1–2
  contrast examples whose focus is a related point, explained in the body.
- Every example also yields a word-order exercise, except examples marked `noOrder`: their words
  have a second neutral order (a time word before or after the topic, two items or clauses that
  can swap). Scrambled argument orders do not count as a second order.

## Review status

- Every level was checked by the build script (`scripts/build-grammar-pack.mjs --pack ja`) and
  then read in full, example by example, by an AI model prompted as an experienced Japanese
  teacher; its findings were fixed. This is not a native-speaker review.
- The content has **NOT** been reviewed by a native speaker; errors are possible and corrections
  are welcome. The pack ships marked unreviewed, and no claim of review is made.
