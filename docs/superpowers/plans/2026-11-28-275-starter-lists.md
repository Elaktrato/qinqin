# #275 Starter lists: about 150 words per language — plan (2026-11-28)

Issue #275 (milestone v0.9.0). Owner decisions (2026-11-26): about **150 words per language**, reviewed by
native-language teacher agents now, by the owner later. Starter mode itself is #214
(`docs/superpowers/specs/2026-11-26-starter-mode-design.md`); the lists open section 0 of the course
(`docs/superpowers/specs/2026-11-24-courses-design.md` §5, §9).

## What

- Grow `server/internal/starter/sets/starter-ja.json` (55 words) and `starter-zh.json` (47 words) to about 150
  common, picturable beginner words each, across the course themes (food, drink, family and people, the body,
  animals, nature and weather, numbers, colours, home and everyday objects, clothes, transport, places, school,
  everyday actions). The project chooses them (CC BY 4.0).
- Every word has a picture that the server really serves for it and that a reviewer checked.
- Review by two independent native-teacher agents per language plus an adjudicator; findings applied; notes kept in
  `server/internal/starter/sets/REVIEW.md`; the lists say "reviewed by agents".
- Tests: the lists parse, every word resolves to a dictionary entry and has its picture, no duplicates; an e2e
  check that Starter mode offers the larger set at phone width.
- Docs: sources, licensing, wiki, `NEXT.md`.

## Tasks

1. This plan.
2. Tests first: the shape rules of the shipped sets (size, no duplicate form, picture or gloss) and a resolution
   test that runs in CI against the committed dictionaries (filtered to the set's words) and checks each word's
   entry, its reading, its topic label and the picture the server would serve. See them fail on the old seeds.
3. The new lists (draft), checked by the tests.
4. Teacher-agent review (two per language, adjudicator), findings applied, notes file, "reviewed by agents".
5. Web: the Sources page credit for the Starter words; e2e at phone width.
6. Docs and release notes; gates.

## Rulings

(filled in as the work goes; see below)

## Execution record

(filled in as the work goes)

## Local follow-up

(filled in at the end)
