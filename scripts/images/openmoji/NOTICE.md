# Notice for `map.tsv` and `manual.tsv` (OpenMoji word pictures)

`map.tsv` is the word-to-picture mapping of the `images-openmoji` pack (a row says
which OpenMoji emoji pictures a Chinese or Japanese dictionary word). It is derived
data, made by `scripts/build-picture-map.mjs` (rules in `scripts/picture-match.mjs`),
and it is distributed with the pack under **CC BY-SA 4.0**
(<https://creativecommons.org/licenses/by-sa/4.0/>; legal code:
<https://creativecommons.org/licenses/by-sa/4.0/legalcode>).

It was derived from, and carries words and glosses of:

- **CC-CEDICT** (MDBG and the CC-CEDICT community, <https://cc-cedict.org>,
  CC BY-SA 4.0): the Chinese words (`target` of the `zh` rows) and their English glosses.
- **JMdict** (Electronic Dictionary Research and Development Group,
  <https://www.edrdg.org/>, CC BY-SA 4.0): the Japanese words (`target` and `note` of
  the `ja` rows) and their English glosses.
- **OpenMoji** 17.0.0 (<https://openmoji.org>, CC BY-SA 4.0): the emoji hexcodes
  (`concept`), the English annotations and tags used for matching.
- **Unicode CLDR** 49.0.0 emoji annotations in Chinese and Japanese (names and
  keywords; Copyright Unicode, Inc., licensed under the Unicode License v3; the
  full text is `LICENSE-UNICODE.txt` next to this file, verbatim, SHA-256 as pinned
  in `scripts/images/pins.json`).

`manual.tsv` holds the project's hand-checked overrides (qinqin contributors); the
`note` column is the project's own label. It is distributed with `map.tsv` on the
same terms.

Changes: the words and glosses were matched automatically against the emoji
annotations; the scores and the `basis` column are qinqin's. The mapping may
contain errors.

The pictures themselves are not in this directory: they come from the OpenMoji
release pinned in `scripts/images/pins.json`, credited per emoji in the pack's
`pictures.tsv`. See `docs/sources.md` ("Pictures") for the full account.
