# Japanese lemmatizer rules

The rule table the lemmatizer uses for Japanese: suffix rewrites that turn an inflected surface
(食べました, 勉強しています, しちゃった, 行かないでください) into its dictionary form and the chain of
inflections, the word classes they map to JMdict part-of-speech tags, and the ranking hints of the
segmenter. Format: `docs/contracts/lemma/README.md` (format 2).

## Authorship and licence

- Author: written for qinqin by the project (issues #165 and #177). The rules were ported from the
  project's own Go deinflector and extended; no rules were copied from other deinflectors or grammar books.
- Licence: CC BY 4.0 (`LICENSE`). Credit: "qinqin contributors, CC BY 4.0", https://github.com/Elaktrato/qinqin

## Copies

`rules.json` is byte-identical to `server/internal/lemma/tables/ja.json` (the table built into the
server, used when this pack is not installed) and to `docs/contracts/lemma/ja.rules.json`; tests fail
when they drift. Change all three together.
