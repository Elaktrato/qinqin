# Card ids, burying and cloze (reverse and cloze cards, #65)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"cards/<name>","cases":[...]}`.

## Card kinds and ids

Kind order everywhere: `vocab, sentence, writing, tone, reverse, cloze`. Opt-in kinds: `reverse`, `cloze`.

| Kind | Stored id | Dedupe `cardKey` | Virtual (planned, not created) id |
|---|---|---|---|
| vocab | `c-vocab-<entryId>` | `vocab:<entryId>` | `level:<entryId>` (level sessions) |
| sentence | `c-sentence-<entryId>` | `sentence:<entryId>:<sentenceId>` | `companion:sentence:<entryId>` |
| writing | `c-writing-<entryId>` | `writing:<entryId>` | `companion:writing:<entryId>` |
| tone | `c-tone-<entryId>` | `tone:<entryId>` | `companion:tone:<entryId>` |
| reverse | `c-reverse-<entryId>` | `reverse:<entryId>` | `companion:reverse:<entryId>` |
| cloze | `c-cloze-<entryId>` | `cloze:<entryId>` | `companion:cloze:<entryId>` |

One cloze card per entry; its id never names a sentence (the sentence is chosen per showing).
Fixture: `card-ids.json` (`kind`, `entryId`, `sentenceId?`, `id`, `cardKey`, `virtualId?`).

## Data

- Deck switch: plugin-data key `deckcfg:<deckId>` -> `{deckId, cardTypes: ["reverse"|"cloze"], updatedAt, ...unknown fields kept}`.
  Absent or unparsable = no opt-in kinds. Works for `general`.
- A vocab row may carry `skipKinds: [kind]` (non-vocab kinds the learner removed for that word); duplicates union it.
- Mastery counts only `vocab, sentence, writing, tone`. Reverse and cloze count as reviews for XP
  (`reverse` 10, `cloze` 15), streaks, heatmap and the optimizer.
- Old clients ignore unknown card kinds and read an unknown review mode as `vocab`.
