# Test data of the Tatoeba sentences tool

Everything here is **hand-made for the tests**: the sentences, ids, user names,
tags, reviews and dictionary lines are invented and are not copied from
Tatoeba, CC-CEDICT or JMdict. Licence: CC0 1.0, like the project's other
hand-written samples.

- `export-src/`: the fixture export as plain tab-separated files, in the column
  layout the tool expects of Tatoeba's export (see the spec,
  `docs/superpowers/specs/2026-11-22-tatoeba-sentences-design.md`).
- `export/`: the same files packed the way the tool reads them (`.tar.bz2`,
  `.bz2` and plain), rebuilt by `./make-export.sh`; `pin.json` holds their
  hashes (update them after rebuilding).
- `rules.json`: the shipped rules with a smaller cap, a deny word and the
  fixture dictionaries.
- `dict/`: tiny dictionaries in the CC-CEDICT and JMdict formats.
- `golden/`: the packs the tool must write from this fixture
  (`UPDATE_GOLDEN=1 go test ./tools/tatoeba` regenerates them).
