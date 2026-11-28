# Chinese course (≈ HSK 1–4)

The course skeleton and reading texts for Mandarin Chinese, from a complete beginner to about HSK 4 (design:
`docs/superpowers/specs/2026-11-24-courses-design.md`; plan and rulings: `docs/superpowers/plans/2026-11-28-223-course-content.md`;
format: `docs/contracts/courses/README.md`).

## Authorship and licence

- Author: written for qinqin by the project. The sections, the units and their order, the unit themes, the placement
  of the grammar lessons, the characters each unit introduces, the checkpoints, the reading texts and their English
  translations are original; nothing was copied or paraphrased from a textbook, a course, a website or the HSK
  syllabus.
- Licence: CC BY 4.0 (Creative Commons Attribution 4.0 International),
  https://creativecommons.org/licenses/by/4.0/. See `LICENSE`. Credit: "qinqin contributors, CC BY 4.0",
  https://github.com/Elaktrato/qinqin.
- Review: reviewed by agents acting as native-speaker teachers, not yet by a person (`REVIEW.md`). The owner
  reviews and corrects it in use, as with the grammar lessons.

## What the pack holds, and what it does not

- `course.json` names no words. Each server fills the units from its installed `hsk-words` level list (the HSK 3.0
  word list, which carries no reuse licence and is bundled at the owner's decision; see its manifest), by topic
  (the topic labels, `server/internal/topics`, CC BY-SA 4.0) and in the list's order, so the list never travels
  inside this pack. The fill rule is `docs/contracts/courses/fill.json`.
- The characters a unit introduces are characters of the `hsk-chars` list, levels 1–4 (a plain list of
  characters, the same caveat). Which unit introduces which character is the project's choice.
- The grammar points are lesson ids of the bundled `zh-grammar` pack (CC BY 4.0, the project's own).
- The levels are estimates ("≈ HSK 1"), not official HSK levels.

## Conventions

- Texts are in simplified characters, with full-width Chinese punctuation, no pinyin (the app shows the reading of
  every word the learner has not reached) and no Latin letters.
- A text uses the words of its unit and the units before it, plus at most four new words; the test
  `server/internal/courses/realdata_test.go` checks this against a seeded database.
- Names in the texts are common Chinese given names or forms of address.
