# Pictures for words (#216)

Bundled pictures for flashcards (#214, #215), visual aids (#212) and entry pages: an **images pack** holds SVG
pictures and a word → picture mapping per language; the server finds the picture of a dictionary entry; clients
draw it. Design and rulings: `docs/superpowers/plans/2026-11-26-images-pack.md`. Sources and licences:
`docs/sources.md`, "Pictures".

Fixtures:

- `resolve.json` — which mapping the server picks for an entry (Go: `server/internal/images/contract_test.go`).
- `svg.json` — the picture vocabulary the server accepts, what a client must refuse, and `themeSvg` (Go: the same
  test; web: `lib/api/images.dom.test.ts`).
- `package.qqpkg` and `package.json` — an images package the server's builder wrote, and its rows (Go:
  `server/internal/datapkg/images_fixture_test.go`; web: `lib/packages/imagesPackage.contract.test.ts`).

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
| `pictures/<concept>.svg` | the picture, at most 256 KiB; checked and stored in its canonical form (see "Pictures are drawings"), not byte for byte |
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

## Offline: the images package (#274)

Every live images pack builds a data package `images.<packId>` (`../packages/README.md`; format 1, the pack's
`languages`, no `requires`, not optional). Its `data.sqlite` holds

- `map (language, target, sense, concept, score, basis)`: the pack's map rows exactly as the server stores them, keyed
  by the word targets (not entry ids, so a dictionary change does not touch the package);
- `pictures (concept, label, credit, svg)`: only the pictures a map row uses, each in the stored canonical form.

A client that holds the packages finds an entry's picture with the rule of "Resolution" over every package it holds
(a package's pack id is its `packId` in the answer; `license` and `attribution` come from the package's `qq_sources`
row). The targets are the entry answer's `pictureTargets` (below). Measured on the bundled packs (OpenMoji 17.0.0, 962
pictures; Mulberry 3.6.1, 711 pictures): `images.images-openmoji` 510,702 bytes, `images.images-mulberry` 1,569,231
bytes.

## Pictures are drawings

The server checks every picture when a pack is installed (`images.CanonicalSVG`; fixture `svg.json`) and **stores
and serves its canonical form, never the pack's bytes**. Accepted: at most 256 KiB of well-formed UTF-8 XML, root
`<svg>` in the SVG namespace, only drawing elements (`svg g path circle ellipse rect line polyline polygon defs
clipPath mask use linearGradient radialGradient stop title desc`) with only the attributes in the allowlist
(geometry, paint, gradient, clip and mask attributes, `id`, `class`; the list is `allowedAttrs` in
`server/internal/images/svg.go` and `ATTRS` in `apps/web/src/lib/api/svg.ts`), nesting at most 64. Refused: a
comment, processing instruction (the XML header aside), DOCTYPE or entity; a `style` element; an `on*` or any
other attribute; `href`/`xlink:href` that is not a plain `#id`; `url(...)` that is not `#id` or sits outside
`fill`, `stroke`, `clip-path`, `mask`; `javascript:`, `data:`, `@import`, `image-set`, a backslash (CSS escape) in
a value; duplicate ids; text outside `title` and `desc`; more than 64 `<use>`, a `<use>` of a `<use>` or of an
element that holds one (the cost of nested uses cannot multiply). A `style` attribute is not kept: its
declarations for paint properties (`fill`, `stroke`, ...) become attributes of the same name, any other declaration
refuses the picture.

The canonical form is rebuilt from the parsed tree: `<svg xmlns="http://www.w3.org/2000/svg" ...>`, attributes in
source order and double-quoted, `&`, `<`, `>` (and `"` in attributes) escaped, no comment, no XML header, no
whitespace between elements, `xlink:href` written `href`, an element without children written `<x/>`. It cannot
re-parse as HTML into other elements (HTML ends the comment `<!-->` at once, XML does not: that difference made a
comment a stored XSS, v0.8.0 review). `svg.json` gives each valid picture's `canonical` form; Go and web must
produce it byte for byte.

A client **never** puts a picture into `innerHTML`/`{@html}`. It parses the svg as XML, walks it against the same
allowlist, and draws created nodes (`svgElement`), or a canonical string it made itself (`safeSvg`). The route
re-canonicalises what it reads (a pack installed before the canonical form held the pack's bytes); a stored
picture that no longer passes is answered as `{"picture": null}`.

## `GET /api/images/entries/{id}[?sense=N]`

Signed-in users (not access tokens: unlike the audio routes, whose files external players fetch with a read token, nothing but
the web app and the APK draws these pictures, so the route keeps the smaller surface; allowing a read token is one line,
`tokReadGlobal`, when a client needs it). `{"picture": {...}}` or `{"picture": null}` (no installed pack maps the entry:
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
