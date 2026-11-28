# Notice for `scripts/topics/`

- `openmoji-groups.tsv` lists, for each OpenMoji emoji the picture mapping uses (`scripts/images/openmoji/map.tsv`),
  its group and subgroup as given in OpenMoji 17.0.0 `data/openmoji.json` (<https://openmoji.org>, **CC BY-SA 4.0**,
  <https://creativecommons.org/licenses/by-sa/4.0/>; the group names of Unicode emoji are those of the Unicode emoji
  data, Copyright Unicode, Inc., Unicode License v3, `scripts/images/openmoji/LICENSE-UNICODE.txt`). It is made by
  `node scripts/build-topic-labels.mjs --groups <openmoji.json>` from the pinned file (`scripts/images/pins.json`) and
  is distributed under CC BY-SA 4.0.
- `openmoji-topics.tsv` (group and subgroup → topic), `reviewers.json` and the batch files `zh/` and `ja/` (the words
  to label and the answers of the labelling and teacher agents) are written for qinqin (qinqin contributors) and,
  like the labels built from them, are shared under **CC BY-SA 4.0**: the batches are keyed to CC-CEDICT and JMdict
  words (forms, readings and JMdict sequence numbers; no dictionary glosses), both CC BY-SA 4.0.
- The labels files built from them, `server/internal/topics/labels/<lang>.json`, are **CC BY-SA 4.0**: adapted from
  OpenMoji's groups and keyed to CC-CEDICT and JMdict; each file's `attribution` credits them (see `docs/sources.md`,
  "Topic labels", and `LICENSING.md`). Legal code: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>, the
  same text as `plugins/data/cedict/LICENSE`.
