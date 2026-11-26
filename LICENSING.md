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

### The script charts and the Starter word lists: CC0 1.0

The exceptions to CC BY 4.0 are the data of the writing-system trainer (kana, Hangul and Cyrillic charts, their
example words and keyboard key hints: `apps/web/src/lib/features/scripts/data/`) and the Starter word lists
(`server/internal/starter/sets/starter-zh.json` and `starter-ja.json`, #214). The project wrote them and releases
them under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), a public domain dedication with no
attribution requirement, as issue #204 states for the charts (the lists are facts about writing systems). The Starter
lists are the project's own selection of common, picturable words with short glosses and picture pairings; they
copy no third-party text, and the dictionary entries and pictures they point at keep their own licences. Their
extension to CC0 is awaiting the owner's confirmation. Anything else the project writes stays CC BY 4.0.

## Third-party data keeps its own licence

The MIT licence of the code does **not** cover the bundled data. Dictionaries, frequency lists, stroke data,
fonts, audio and the other third-party sources (CC-CEDICT, JMdict, KANJIDIC2, KanjiVG, Unihan, Jiten,
Kanji alive, OpenMoji and more) stay under their own licences, which differ from pack to pack (several are
CC BY-SA, which asks for share-alike). They are listed, with links and pinned versions, in
[`docs/sources.md`](docs/sources.md) and on the app's Sources page, and each pack carries its licence text
and an `ATTRIBUTION.md` in `plugins/data/<pack>/`.

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
