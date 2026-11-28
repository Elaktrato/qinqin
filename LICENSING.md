# Licensing

qinqin has three kinds of material, and each keeps its own licence.

Licences apply to the copies they accompany. A copy of qinqin published before this file and the licence texts
were added keeps the terms it was published with; nothing here relicenses it.

## The code: MIT

The source code of qinqin (the Go server, the web app, the Android shell, the scripts and the build files) is under the
[MIT licence](LICENSE), Copyright (c) 2026 qinqin contributors. That includes the web app's interface strings
(`apps/web/src/lib/i18n`, they are part of the code) and the test fixtures and contracts under `docs/contracts/`.

**Not everything inside the Go server is MIT.** Two kinds of content are embedded in the server binary and are
CC BY 4.0, see below: the Japanese lemmatizer rule table `server/internal/lemma/tables/` and the project's own colour
themes `server/internal/themes/builtin/qinqin` and `server/internal/themes/builtin/qinqin-extras`. The other themes in
`server/internal/themes/builtin/` (Catppuccin, Dracula, Everforest, Gruvbox, Kanagawa, Nord, Rosé Pine, Solarized, Tokyo
Night) are third-party palettes under their own licences, each with a `LICENSE` file in its folder.

## Content the project writes: CC BY 4.0

Content written by the qinqin project is under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
That covers the grammar packs (`zh-grammar`, `ja-grammar`), the Japanese lemmatizer rule table (`ja-lemma`)
and the qinqin colour themes (`qinqin`, `qinqin-extras`), in the packs under `plugins/data/` and in the copies
embedded in the server (`server/internal/lemma/tables/ja.json`, `server/internal/themes/builtin/qinqin*`). Each pack carries the full legal code in its `LICENSE` file; the lemma table
has a `NOTICE` next to it.

The project's **documentation** (the wiki sources in `docs/wiki/`, the records in `docs/architecture/`, the plans and
specs under `docs/superpowers/`, and this repository's README) is under CC BY 4.0 too, with the credit line below.

If you reuse this content, credit it as:

> qinqin contributors, CC BY 4.0 — https://github.com/Elaktrato/qinqin

and say if you changed it. The same credit line is used on the Sources page.

### The script charts and the Starter word lists: CC BY 4.0

The data of the writing-system trainer (kana, Hangul and Cyrillic charts, their example words and keyboard key hints:
`apps/web/src/lib/features/scripts/data/`) and the Starter word lists (`server/internal/starter/sets/starter-zh.json`
and `starter-ja.json`, #214) are written by the project and are under CC BY 4.0 like the rest of its written content.
Issue #204 asked for CC0 for the charts and an earlier version of this file made them an exception; the owner decided on
2026-11-26 that there is **no exception**: credit "qinqin contributors, CC BY 4.0". The files carry
`"license": "CC-BY-4.0"`; a `NOTICE` next to each (the copies in the web build and in the server binary) names the
licence and points at the legal code in `plugins/data/ja-lemma/LICENSE`, as the lemma table does.
The Starter lists copy no third-party text; the dictionary entries and pictures they point at keep their own
licences. They were reviewed by agents acting as native-speaker teachers (#275, `server/internal/starter/sets/REVIEW.md`),
not yet by a person. `scripts/check-sources.mjs` (rule i) checks the licence field, the credit and the notices.

### The topic labels: CC BY-SA 4.0

The topic labels of words (`server/internal/topics/labels/zh.json` and `ja.json`, #220) are written for the project
(the topics were suggested by an agent and reviewed by agents acting as native-language teachers, or taken from the
group of the word's OpenMoji picture through the project's own group → topic table) and are shared under
**CC BY-SA 4.0**, not the project's CC BY 4.0 (orchestrator ruling, 2026-11-28, under the owner's "licensing first"
rule): they are adapted in part from OpenMoji's emoji groups and are keyed to CC-CEDICT and JMdict words whose senses
the agents read, all CC BY-SA 4.0. Each file's `attribution` credits qinqin contributors, CC-CEDICT or JMdict and
OpenMoji; the group table `scripts/topics/openmoji-groups.tsv`, the group → topic table and the review batches in
`scripts/topics/` are under the same licence (`scripts/topics/NOTICE.md`). The owner may loosen this later. The topic
list itself (`docs/contracts/topics/topics.json`, ids and scopes) is the project's and stays CC BY 4.0.

## Third-party data keeps its own licence

The MIT licence of the code does **not** cover the bundled data. Dictionaries, frequency lists, stroke data,
fonts, audio and the other third-party sources (CC-CEDICT, JMdict, KANJIDIC2, KanjiVG, Unihan, Jiten,
Kanji alive, OpenMoji and more) stay under their own licences, which differ from pack to pack (several are
CC BY-SA, which asks for share-alike). They are listed, with links and pinned versions, in
[`docs/sources.md`](docs/sources.md) and on the app's Sources page, and each pack carries its licence text
and an `ATTRIBUTION.md` in `plugins/data/<pack>/`.

### The estimated JLPT word levels (`jlpt-words`): CC BY-SA 4.0

`plugins/data/jlpt-words` is computed by `scripts/prepare-jlpt-words.mjs` from four bundled packs: the Jiten
frequency ranks (CC BY-SA 4.0), JMdict (CC BY-SA 4.0, EDRDG), the JLPT kanji levels (`jlpt-kanji`: kanjiapi.dev, MIT,
and KANJIDIC2, CC BY-SA 4.0) and the jōyō kanji (`joyo-grades`, KANJIDIC2), and from three short lists the project
writes, `scripts/jlpt-words/core.tsv`, `grammar.tsv` and `anchors.tsv` (CC BY 4.0, credit "qinqin contributors, CC BY
4.0"; `scripts/jlpt-words/NOTICE`). It copies no published JLPT vocabulary list. Being an adaptation of the Jiten
ranks and JMdict, it is shared under **CC BY-SA 4.0**, not under the project's CC BY 4.0 (CC BY 4.0 content may be
adapted into a CC BY-SA 4.0 work), and keeps the credits of its inputs and kanjiapi.dev's MIT notice
(`LICENSE-kanjiapi.dev`). It is a levels pack served on its own, so no CC BY pack embeds it (a course pack refers to
it by pack id). See `docs/sources.md`, "JLPT words (approximate)".

### Pictures (OpenMoji and Mulberry Symbols)

The bundled word pictures are [OpenMoji](https://openmoji.org) 17.0.0 (CC BY-SA 4.0) and
[Mulberry Symbols](https://mulberrysymbols.org) 3.6.1 by Steve Lee (CC BY-SA 4.0). Each is its own data pack
(`images-openmoji`, `images-mulberry`) with its licence text, credit and notice, and the word mapping shipped with it
is distributed under the same licence. ShareAlike reaches the pictures and any adaptation of them, including the
recoloured copy the web app draws (the file itself is never modified); the pack says so. The position this
project takes is that a program which reads a separate data file and shows it, shipped next to it, does not adapt
the data (a collection, as with the dictionaries above), so the MIT code stays MIT. To keep that true the pictures are
never compiled into the binary and never bundled in the web build: the server serves them from the installed packs.
This position is the project owner's to confirm; it is not legal advice. See `docs/sources.md`, "Pictures".

### Stroke-order data (KanjiVG): CC BY-SA 3.0, accepted

The Japanese stroke-order data (`kanjivg-strokes`, #62) and the component index (`kanjivg-components`) are derived from
[KanjiVG](https://kanjivg.tagaini.net) (© Ulrich Apel, CC BY-SA **3.0**). 3.0 is below the project's usual floor of
CC BY-SA 4.0; the owner accepted it for KanjiVG on 2026-11-26 (KanjiVG offers no other licence and the data has no substitute with a clear licence).
Both packs are adaptations of KanjiVG and stay under CC BY-SA 3.0 (the stroke pack says it changed the drawings: the
centre lines were widened into outlines in the stroke-data format). Like every BY-SA pack (OpenMoji, Mulberry,
KanjiVG) each stays its own data pack, served by the running server: never compiled into the Go binary
(`go:embed`), never in the web build and never in the Android APK. See `docs/sources.md`, "Stroke-order data".
Two small test fixtures are KanjiVG data under the same CC BY-SA 3.0, each with a README: six SVG files in
`scripts/testdata/kanjivg/` and the stroke medians of 18 characters in `apps/web/src/lib/writing/fixtures/joins.json`
(an adaptation, made by `apps/web/scripts/make-join-fixtures.mjs`, #292). Tests read them; no app code imports them.

### The HSK lists

The official HSK word and character lists (`hsk-words`, `hsk-chars`) are from the syllabus published by CLEC and
distributed by Chinese Testing International (CTI). No reuse licence is granted for them. CTI's
[Legal Notice](https://www.chinesetest.cn/legal-notice) allows only reasonable, good-faith quoting for free public
information, with the source indicated. The lists are included with attribution at the project owner's decision; the
legal status of including them has not been verified (this is not a legal opinion), and no licence or public-domain
status is claimed. They are not covered by MIT or CC BY 4.0 and qinqin grants no right to reuse them. See
`docs/sources.md` for the details.

---

Nothing here is legal advice.
