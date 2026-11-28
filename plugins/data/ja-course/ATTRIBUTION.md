# Japanese course (≈ JLPT N5–N3)

The course skeleton and reading texts for Japanese, from a complete beginner to about JLPT N3 (design:
`docs/superpowers/specs/2026-11-24-courses-design.md`; plan and rulings: `docs/superpowers/plans/2026-11-28-223-course-content.md`;
format: `docs/contracts/courses/README.md`).

## Authorship and licence

- Author: written for qinqin by the project. The sections, the units and their order, the unit themes, the placement
  of the grammar lessons, the characters each unit introduces, the checkpoints, the reading texts and their English
  translations are original; nothing was copied or paraphrased from a textbook, a course, a website, a JLPT
  preparation book or a published word list.
- Licence: CC BY 4.0 (Creative Commons Attribution 4.0 International),
  https://creativecommons.org/licenses/by/4.0/. See `LICENSE`. Credit: "qinqin contributors, CC BY 4.0",
  https://github.com/Elaktrato/qinqin.
- Review: reviewed by agents acting as native-speaker teachers, not yet by a person (`REVIEW.md`). The owner
  reviews and corrects it in use, as with the grammar lessons.

## What the pack holds, and what it does not

- `course.json` names no words. Each server fills the units from its installed `jlpt-words` level list (qinqin's
  estimated JLPT word list, #219; see its manifest for its sources and licences), by topic (the topic labels,
  `server/internal/topics`, CC BY-SA 4.0) and by the Jiten frequency rank, so the list never travels inside this
  pack. The fill rule is `docs/contracts/courses/fill.json`.
- The kanji a unit introduces are kanji of the `jlpt-kanji` list, ≈ N5 to ≈ N3 (qinqin's estimate). Which unit
  introduces which kanji is the project's choice: a kanji comes with the first unit whose words are written with it.
- The grammar points are lesson ids of the bundled `ja-grammar` pack (CC BY 4.0, the project's own).
- The levels are estimates ("≈ N5"), not official JLPT levels. The JLPT publishes no word or grammar list.

## Conventions

- Texts are in standard Japanese script: kanji where a word is usually written with them, kana otherwise, Japanese
  punctuation, no spaces, no romaji. ≈ N5 texts are polite (です／ます); ≈ N4 texts mix polite and plain forms where
  the grammar of the unit teaches them.
- A text uses the words of its unit and the units before it, plus at most four new words; particles, the copula and
  auxiliaries do not count. The test `server/internal/courses/realdata_test.go` checks this against a seeded
  database.
