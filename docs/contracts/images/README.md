# Pictures for words (#216)

Bundled pictures for flashcards (#214, #215), visual aids (#212) and entry pages: an **images pack** holds SVG
pictures and a word → picture mapping per language; the server finds the picture of a dictionary entry; clients
draw it. Design and rulings: `docs/superpowers/plans/2026-11-26-images-pack.md`. Sources and licences:
`docs/sources.md`, "Pictures".

Fixtures:

- `resolve.json` — which mapping the server picks for an entry (Go: `server/internal/images/contract_test.go`).
- `svg.json` — the picture vocabulary the server accepts, what a client must refuse, and `themeSvg` (Go: the same
  test; web: `lib/api/images.test.ts`).

Owner code: `server/internal/images` (import, validation, resolution), `server/internal/api/handlers_images.go`
(routes). Web: `apps/web/src/lib/api/images.ts` (`entryPicture`, `imagePacks`, `safeSvg`, `themeSvg`,
`pictureCreditLine`).

## The pack (type `images`, format `images-svg`)

A pack is a directory or zip with `manifest.json` (`type: "images"`, `format: "images-svg"`, `languages`: the
languages its map covers, `license`, `attribution`, optional `notice`), the licence text (`LICENSE`,
`ATTRIBUTION.md`) and:

| File | Content |
| --- | --- |
| `pictures.tsv` | header `concept\tfile\tlabel\tcredit`; one row per picture. `concept` is the id in the pack (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`: an emoji code point such as `1F34E`, a Mulberry symbol name), `file` must be `pictures/<concept>.svg`, `label` the English name, `credit` the designer line |
| `pictures/<concept>.svg` | the picture, at most 256 KiB, stored and served byte for byte |
| `map.tsv` | header `language\ttarget\tsense\tconcept\tscore\tbasis\tnote`; one row per mapping |

`map.tsv` columns: `language` (one of the manifest's), `target` (the word: a dictionary entry's key, or one of its
written forms, at most 200 bytes), `sense` (0: the whole entry; N: the 1-based sense the picture shows, in the
entry's sense order), `concept` (a row of `pictures.tsv`), `score` (0–100, how sure the mapping is), `basis` (how it
was found: `name`, `keyword`, `gloss`, `name+gloss`, `manual`; a short lower-case word), `note` (for people, not
stored). A row is unique by language, target, sense and concept. The server refuses a pack with an unknown
concept, language, a bad header or field count, a duplicate, a picture that is missing or not a drawing, and
reads nothing outside the pack directory (a symlink is refused). The pack is one transaction; an unchanged
re-import writes nothing.

Mappings are made by `scripts/build-picture-map.mjs` (Unicode CLDR emoji annotations in the language, English
glosses, hand-made `manual.tsv` overrides; scores: name 90, first-gloss label 80, name and gloss agreeing +10,
manual 100; ambiguous or weak matches are left out) and committed as `scripts/images/<pack>/map.tsv`. The pack
builder `scripts/prepare-images-pack.mjs` adds the pictures from the pinned upstream release.

There is **no data package** for images packs (`pack-types.json`: `package: null`): pictures are fetched from the
server per entry. An offline client keeps what it fetched (a later change may add a package type).

## Pictures are drawings

The server checks every picture when a pack is installed (`images.CheckSVG`; fixture `svg.json`): well-formed
UTF-8 XML, root `<svg>` in the SVG namespace, only drawing elements (`svg g path circle ellipse rect line polyline
polygon defs clipPath mask use linearGradient radialGradient stop title desc`), no DOCTYPE or entities, no
attribute starting with `on`, `href`/`xlink:href` and `url(...)` only to `#fragment`, no `javascript:`/`data:`
value, nesting at most 64. A client that inlines a picture still refuses active content (`safeSvg`).

## `GET /api/images/entries/{id}[?sense=N]`

Signed-in users (not access tokens). `{"picture": {...}}` or `{"picture": null}` (no installed pack maps the entry:
the usual answer; not a 404). A picture:

```jsonc
{"packId": "images-openmoji", "concept": "1F34E", "label": "red apple", "credit": "OpenMoji, Liz Bravo",
 "license": "CC BY-SA 4.0", "attribution": "All emojis designed by OpenMoji ...", "basis": "manual",
 "sense": 0, "score": 100, "svg": "<svg ...>"}
```

`sense` (1–999; otherwise 400 `bad_request`) asks for the picture of that sense. An unknown entry is 404
`not_found`.

### Resolution (`resolve.json`)

The targets are the entry's key, its written forms, and its kana readings when it has no written form. Among the
live packs' mappings of the entry's language for any target:

- with a `sense`: only mappings of that sense and entry-wide ones (sense 0) qualify, the sense's own first;
- without: every mapping qualifies;
- then the higher `score`, the lower `sense`, the pack id and the concept (a stable answer).

An uninstalled pack maps nothing. A client never guesses a picture from the answer's `basis`; it shows what it
gets.

## `GET /api/image-packs`

Public. The live packs: `[{packId, name, version, languages, license, attribution, notice, pictureCount,
mappingCount}]` for the Sources page. Not available to access tokens.

## Showing a picture

- **Credit.** Show `pictureCreditLine(picture)` ("OpenMoji, Liz Bravo, CC BY-SA 4.0") next to the picture where it
  can be read, and the full credit (`attribution`) on the Sources page, which lists every installed pack.
- **Theme.** OpenMoji black outlines are drawn from the theme: `themeSvg` turns black fills, strokes and stop colours
  (`#000`, `#000000`, `black`, as attribute or style declaration) into `currentColor`, so the picture takes the text
  colour of its element. Mulberry symbols keep their colours. The pack's file is never modified; the recoloured copy
  is an adaptation covered by the same licence (below).
- **A learner's own picture** (#212) overrides a bundled one and needs no licence.

## Licence (ShareAlike)

Both bundled sets are CC BY-SA 4.0. Each is its own pack with its licence, notice and credit; the files are never
compiled into the binary and never bundled in the web build or the APK's web assets: a client gets them from the
server. The recoloured copies are shared under the same licence. The code stays MIT.
