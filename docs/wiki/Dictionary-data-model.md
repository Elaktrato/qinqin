# Dictionary data model

How the server stores dictionary data, for developers and for anyone writing packs. Clients receive the same data as the `lexicon.<lang>` data package ([Data packs on the server](Admin-data-packs#data-packages-what-clients-download); exact schema in `docs/contracts/packages/schemas.json`).

## Entries, forms, readings, senses

The dictionary is stored as `entries`, `forms`, `readings`, `senses`, `entry_links`, `frequency_packs` and `frequency` (migrations 014 to 017).

- An **entry** is one dictionary headword, identified by its source's key within a language and kind (`word` or `character`).
- Its **forms** are the written forms, with flags.
- Its **readings** carry the reading text plus a normalised `plain` form that lookup matches against (kana, pinyin, bopomofo).
- Its **senses** belong to a dictionary and hold the glosses, cross-references and tags, so several dictionaries can gloss one entry.
- **Entry links** connect characters to their radical and to variants.

Per language:

- **Japanese**: one entry per JMdict word (`ent_seq`), with every form and reading, the part-of-speech tags **per sense**, the `uk` flag (usually written in kana) and a priority score derived from JMdict's priority markers. Homographs are separate entries, so 為る and 刷る are two results for する. An entry is shown by its **display form** (`docs/contracts/frequency/display-form.json`): the kana when its first sense is `uk` (事 → こと, 為る → する), never a search-only (`sK`) form (乃 → の); a starter deck word whose list row is kana shows that kana. Cards keep the form they were added with as their snapshot.
- **Chinese**: one entry per simplified written form; its traditional forms are forms of the same entry (flag `trad`), so 學習 finds 学习. Homograph lines (行 xíng / háng) merge into one entry carrying all readings, with one sense per CC-CEDICT line.
- **Characters** (kanji and hanzi) are `character` entries with `radical` and `variant` links.

Entry ids are stable per server, so user data that names an entry (cards, edits, notes) needs no re-keying when packages get new revisions. A personal backup matches words by dictionary identity, not by id, so it restores onto another server.

## Frequency data

A frequency pack is a word-frequency list whose ranks order lookup results and appear as a chip in the popup. It lives in `frequency`, one row per term (optionally tied to one reading) with its rank, grouped by pack in `frequency_packs`.

Frequency order is optional: with no pack, ranking falls back to the kana fit (a kanji word matched only by its kana reading ranks below a kana word), the inflection chain length and the priority score. Two keys apply with or without a pack: longer matches first, and a dictionary phrase without a written form that is just a same-length inflection of a word of at least its priority (すれば of する) comes after it. Packs are ranked by priority (the order first imported): the first pack that has data for any of the entries decides the frequency order, and every pack's rank is shown. The bundled pack is the Jiten list (Japanese); Chinese frequency packs are local-only ([Data and licences](Data-and-licences#frequency-order-and-starter-decks)). The pack file formats are on [Data pack format](Data-pack-format).

## Inflection rule tables

Deinflection (食べちゃった → 食べる) is data, not code: one engine runs a rule table per language (`server/internal/lemma/tables/<lang>.json`, built into the server; Japanese is the first). A table lists suffix rules with word classes, the dictionary part-of-speech tags of each class, compound suffixes (勉強する found by 勉強) and the tags the ranking reads. A language with a table but no code of its own gets deinflection from the table alone. The format and the Japanese table are shared with other clients in `docs/contracts/lemma/`.

## Character components

The radical and part lookup's data lives in `components` (one row per pack and character: its parts as a JSON array) and `component_parts` (part stroke counts), grouped by pack in `component_packs` (migration 036). They are keyed by glyph, not entry id, so packs import in any order; they are shared lookup data, replaced per pack on import and not synced or exported in a personal backup.

## Importers

Importers live in `server/internal/dict/` (`jmdict`, `cedict`, `kanjidic2`, `unihan` and the `json` pack format) and write through one lexicon importer; frequency packs are in `server/internal/freq`. Imports are idempotent and write nothing when nothing changed. `entries`, `forms`, `readings`, `senses`, `entry_links` and `frequency_packs` soft-delete; `frequency` rows are replaced per pack on import. Since v0.4.0 none of these travel in the sync pull: a change to them builds a new revision of the language's data package.

The `kanjidic2` and `unihan` importers also store the grade, frequency, stroke, GB2312 and standard-list attributes the character map uses (a database seeded earlier needs a re-seed). KANJIDIC2's pre-2010 `<jlpt>` field is not imported.
