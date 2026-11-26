# Notice for `map.tsv` (Mulberry Symbols word pictures)

`map.tsv` is the word-to-picture mapping of the `images-mulberry` pack (a row says
which Mulberry symbol pictures a Chinese or Japanese dictionary word). It is derived
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
- **Mulberry Symbols** 3.6.1 by Steve Lee (<https://mulberrysymbols.org>, CC BY-SA 4.0):
  the symbol names (`concept`) and the English names and tags used for matching.
- **Unicode CLDR** 49.0.0 annotations (Copyright Unicode, Inc., Unicode License v3; the
  full text is `LICENSE-UNICODE.txt` next to this file, verbatim) where the matching
  rules used them.

For Chinese, a row exists only for a word that is on the HSK 3.0 word list (a gate
applied at build time; no list data is copied into this file).

Changes: the words and glosses were matched automatically against the symbol names;
the scores and the `basis` column are qinqin's. The mapping may contain errors.

The pictures themselves are not in this directory: they come from the Mulberry
release pinned in `scripts/images/pins.json`, credited per symbol in the pack's
`pictures.tsv`. See `docs/sources.md` ("Pictures") for the full account.
