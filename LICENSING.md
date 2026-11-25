# Licensing

qinqin has three kinds of material, and each keeps its own licence.

## The code: MIT

The source code of qinqin (the Go server, the web app, the scripts and the build files) is under the
[MIT licence](LICENSE), Copyright (c) 2026 qinqin contributors.

## Content the project writes: CC BY 4.0

Content written by the qinqin project is under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
That covers the grammar packs (`zh-grammar`, `ja-grammar`), the Japanese lemmatizer rule table (`ja-lemma`)
and the qinqin colour themes (`qinqin`, `qinqin-extras`). Each of these packs carries the full legal code in its
`LICENSE` file.

If you reuse this content, credit it as:

> qinqin contributors, CC BY 4.0 — https://github.com/Elaktrato/qinqin

and say if you changed it. The same credit line is used on the Sources page.

## Third-party data keeps its own licence

The MIT licence of the code does **not** cover the bundled data. Dictionaries, frequency lists, stroke data,
fonts, audio and the other third-party sources (CC-CEDICT, JMdict, KANJIDIC2, KanjiVG, Unihan, Jiten,
Kanji alive, OpenMoji and more) stay under their own licences, which differ from pack to pack (several are
CC BY-SA, which asks for share-alike). They are listed, with links and pinned versions, in
[`docs/sources.md`](docs/sources.md) and on the app's Sources page, and each pack carries its licence text
and an `ATTRIBUTION.md` in `plugins/data/<pack>/`.

### The HSK lists

The official HSK word and character lists (`hsk-words`, `hsk-chars`) carry no reuse licence. They are
included at the project owner's decision, with attribution to their publisher, as the packs' manifests and
`ATTRIBUTION.md` files say. They are not covered by MIT or CC BY 4.0 and no right to reuse them is granted by
qinqin. See `docs/sources.md` for the details.

---

Nothing here is legal advice.
