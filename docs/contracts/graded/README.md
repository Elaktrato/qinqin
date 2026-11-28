# Graded readers (#231)

Short stories, dialogues and informational texts written for qinqin at each level of a word level list: five a level,
≈ HSK 1–4 (`hsk-words`) and ≈ N5–N3 (`jlpt-words`). Plan: `docs/superpowers/plans/2026-11-28-231-graded-readers.md`.
Owner code: `server/internal/library/sources/graded` (Go). The texts are embedded project data
(`server/internal/library/sources/graded/texts/{ja,zh}.json`, CC BY 4.0, `NOTICE`, reviewed by agents acting as
teachers: `REVIEW.md`); no pack type (record 0008; plan Ruling 2). The library source `graded` serves them; a text is
added to a workspace's library as a one-chapter book through `POST /api/library/sources/graded/import`.

| File | Rule | Decoded by |
| --- | --- | --- |
| `format.json` | the text file format: valid files and every refusal | Go: `server/internal/library/sources/graded/contract_test.go` |
| `level-rule.json` | how a text is counted against a word level list; the computed level | Go: `contract_test.go`; web: `apps/web/src/lib/features/reader/graded/levelRule.contract.test.ts` |
| `catalogue.json` | the answer of `GET /api/library/graded` | Go: `server/internal/api/handlers_graded_test.go`; web: `apps/web/src/lib/features/reader/graded/catalogue.contract.test.ts` |

## Text file (format 1)

One file per language: `version` 1, `language` (2–3 lowercase letters), `scheme` (the pack id of the word level list
the levels belong to), `levels` (the scheme's level names as its pack writes them, in order; 1–12, distinct),
`license` `CC-BY-4.0`, `attribution` (not empty), `humanReviewed` (false until the owner has read them), `texts`
(at least one). Unknown keys are refused. A text:

| Key | Rule |
| --- | --- |
| `id` | `<language>-` then lowercase letters, digits and single hyphens, at most 40; unique in the file; stable (the book's `sourceId`) |
| `level` | index into `levels` |
| `kind` | `story`, `dialogue` or `info` |
| `title` | 1–40 characters |
| `paragraphs` | 1–80, each 1–600 characters, not padded; no control characters, **no ASCII letters or digits** (numbers are written in Han or kana numerals; a dialogue line is a paragraph in “…” or 「…」 without a speaker label) |
| `names` | at most 10 proper names (people, places, countries), each 1–20 characters and occurring in the paragraphs |
| `glosses` | at most 8 `{word, reading, meaning}`: the words above the text's level, each key 1–20 / 60 / 120 characters, `word` distinct; `reading` pinyin with tone marks or kana; `meaning` short English |

The text the segmenter and the level rule read is the paragraphs joined by a line break (`\n`). A text's **length** is
the number of letters of its paragraphs (Han, kana; not punctuation or spaces).

## Level rule

Input: the text, its names, its tokens, the number of levels, the declared level and the glossed words. A token is a
segmenter match (`start`/`end` in code points of the text, `surface`, `lemma`, `function`) with `level`: the lowest
level index at which the scheme lists it directly (by any of its entries, or by its written form in the list), or
null.

1. **Names.** Every occurrence of every name (left to right, not overlapping) is a name span. A token that overlaps a
   name span is not counted.
2. **Counted tokens:** the tokens that are no function word and overlap no name, plus one token for every run of
   letters that no token and no name covers (its `lemma` the run, `level` null).
3. A counted token is **within** level L when its level is not null and ≤ L.
4. **Above** level L: the distinct lemmas of the counted tokens that are not within L, in first-occurrence order.
5. The text **fits** level L when `within × 100 ≥ minCoveragePercent × counted` (95: the "read next" target of #183)
   and at most `maxAbove` (6) lemmas are above L. A text with no counted token fits every level.
6. The **computed level** is the lowest level index at which the text fits, else null.
7. **Unglossed:** the lemmas above the declared level whose lemma and surface are both missing from the glosses.
8. A text is **at its level** (`ok`) when its computed level is its declared level and nothing is unglossed.

The shipped texts are held to rule 8 by `server/internal/library/sources/graded/level_test.go`, on the shipped
dictionaries and level lists (always) and on a fully seeded database (`QINQIN_GRADED_DB`). That test reads the tokens
with the server's segmenter (#348, #349) and then reads again, with the lowest-level reading over every dictionary
match, each run of adjacent tokens above the declared level: the segmenter can split a text against its words or keep
an expression of known words as one unlisted entry (#223 ruling 13). A client that counts a text the same way (#183)
uses the segmenter's tokens as they are.

## Catalogue (`GET /api/library/graded`)

Signed-in; `?language=` narrows to one language (`ja`, `zh`; another code is an empty list). The answer is
`{"texts": [...]}` in file order (language, then the file's order: level by level). Each text: `id`, `language`,
`scheme`, `level` (index), `levelName` (the scheme's name for it), `levels` (the number of levels of the file), `kind`,
`title`, `length`, `names`, `glosses` (`{word, reading, meaning}`), `humanReviewed`. No paragraphs: a text is read as a
book (`POST /api/library/sources/graded/import {sourceId, workspaceId}`, the source's import rules).

The book: `title` the text's title, `author` `qinqin`, `source` `graded`, `sourceId` the text's id, `sourceUrl` empty,
`attribution` `qinqin graded readers, <levelName>: written for qinqin and reviewed by agents acting as teachers, not
yet by a person.`, `licenseNote` `CC BY 4.0, qinqin contributors`, one chapter titled with the title, one paragraph a
paragraph (plain runs, no ruby).
