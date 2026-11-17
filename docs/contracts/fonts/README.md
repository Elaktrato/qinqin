# Fonts: font packs, `faces.json`, `GET /api/fonts`, `GET /fonts/{file}`

Hanzi and kanji faces (Sans, Serif, Kai) arrive as installable **font packs** (#97). A font pack holds one or more
faces cut into WOFF2 **slices** by Unicode range when the pack is prepared (`scripts/prepare-font-pack.mjs`); the
server stores the slices as content-addressed files and serves them unchanged, so a page downloads only the slices
whose characters it shows. Until a pack is installed every choice maps to the system font stacks. Design:
`docs/superpowers/specs/2026-11-16-visual-rework-design.md` §2, §8; plan and rulings (licences, renaming, why a pack
type of its own): `docs/superpowers/plans/2026-11-17-vr-fonts.md`.

## Pack layout

```
manifest.json      "type": "font", "format": "font-slices", id, name, version, license, attribution, notice;
                   no language and no languages (a font teaches no language)
LICENSE            the licence text of the original face, verbatim (SIL OFL 1.1 for every pinned source)
ATTRIBUTION.md     the original face, its authors, and the modification ("subset, renamed")
faces.json         the faces and their slices (below)
slices/<sha256>.woff2   one file per slice; the name is the sha256 of the file's bytes
```

Any other file in the pack is ignored (the licence files `LICENSE*`, `ATTRIBUTION*`, … are kept as for every pack).
A font pack is installed through the admin upload (`POST /api/admin/packs`, the staged licence review) or `qinqin
seed`; a face sliced for the web is a few MB, well inside the upload limits (128 MiB, 2,000 files).

## `faces.json`

```json
{ "version": 1,
  "faces": [ { "face": "sans", "script": "Hans", "original": "Noto Sans SC", "weight": "200 900", "style": "normal",
               "slices": [ { "file": "slices/<64 hex>.woff2", "unicodeRange": "U+20-7E,U+3000-303F,U+FF01-FF5E" },
                           { "file": "slices/<64 hex>.woff2", "unicodeRange": "U+4E00,U+4E09,U+4E0A" } ] } ] }
```

| Member | Rule |
| --- | --- |
| `version` | `1` |
| `faces` | 1–16 faces |
| `face` | `sans`, `serif` or `kai` |
| `script` | `Hans`, `Hant` or `Jpan` (ISO 15924; the web maps `zh`/`zh-Hans`/`zh-CN` → `Hans`, `zh-Hant`/`zh-TW`/`zh-HK` → `Hant`, `ja` → `Jpan`) |
| `original` | the face the slices were cut from, as its authors name it (credited on the Sources page); 1–128 code points, no control character, no leading or trailing white space |
| `weight` | a CSS weight `N` or range `N M`, integers 1–1000, `N <= M`, no leading zero |
| `style` | `normal` or `italic` |
| `slices` | 1 or more; at most **1,500 slices per pack** in all faces together |
| `file` | `slices/` + 64 lower-case hex + `.woff2`; not repeated anywhere in the pack |
| `unicodeRange` | a comma list (no spaces) of `U+X` or `U+X-Y`: 1–6 upper-case hex digits, no leading zero, `X < Y <= 10FFFF` for a range, `X <= 10FFFF` for one code point. Within one face no code point is in two ranges (in one slice or across slices) |

(`face`, `script`, `style`) with overlapping `weight` ranges may not occur twice in one pack.

Every member is required; an unknown member or one written twice in an object is refused, like theme files. The
file is at most 4 MiB. The **first** problem is reported as a stable `code` and a JSON `path`, checked in this
order: the file (`too-large`, `bad-json`, `not-an-object`, `duplicate-member`, `unknown-member`, `missing-member`
in the order `version`, `faces`; `bad-version`; `no-faces`, `too-many-faces`), then face by face in file order: an
object (`not-an-object`), `duplicate-member`, `unknown-member`, `missing-member` in the order `face`, `script`,
`original`, `weight`, `style`, `slices`; `bad-face`, `bad-script`, `bad-original`, `bad-weight`, `bad-style`,
`duplicate-face` (an earlier face of the same key with an overlapping weight); `no-slices`, `too-many-slices` (the
running total passes 1,500); then slice by slice: `not-an-object`, `duplicate-member`, `unknown-member`,
`missing-member` (`file`, `unicodeRange`), `bad-file`, `duplicate-file`, `bad-range`, `overlapping-range` (a code
point an earlier range of the same face already covers). Fixtures: `faces-valid.json` (documents that pass),
`faces-invalid.json` (`{name, code, path, faces}` cases).

The pack is then checked against its files, in `faces.json` order: each slice file exists as a regular file (not a
symlink), is at most **2 MiB**, starts with `wOF2`, and its sha256 is the one in its name. A pack failing any rule
is refused (`400 invalid pack: faces.json: <code> at <path>` on upload, `invalid pack: <file>: <reason>` for a
file) and nothing is stored.

**One pack per face.** On a server, at most one installed pack provides a given (`face`, `script`, `style`) with
overlapping weights. Installing a pack whose face collides with another pack's is refused with a message naming
that pack; re-installing the same pack id replaces its faces (an update).

## Storage and serving

Slices are stored at `<data>/fonts/<sha[:2]>/<sha>.woff2` (temp file, then rename), the rows in `font_packs` and
`font_slices` (migration 042). A re-import replaces the pack's rows in one transaction; an uninstall soft-deletes
the pack row and deletes its slice rows. Afterwards every file no slice row references any more is removed (a file
two packs share stays). Font packs produce **no data package** (`packages/`): the slices are web assets, fetched
on demand.

### `GET /api/fonts`

Signed in (any session; a read token of any workspace). Fonts are instance-wide: every user gets the same answer.

```json
{ "faces": [ { "packId": "noto-sans-sc", "face": "sans", "script": "Hans", "original": "Noto Sans SC",
               "weight": "200 900", "style": "normal", "license": "OFL-1.1", "attribution": "…",
               "slices": [ { "url": "/fonts/<sha>.woff2", "unicodeRange": "U+20-7E,…" } ] } ],
  "packs": [ { "packId": "noto-sans-sc", "name": "…", "version": "…", "license": "OFL-1.1",
               "attribution": "…", "notice": "…" } ] }
```

- `faces` ordered by `face` (`sans`, `serif`, `kai`), `script` (`Hans`, `Hant`, `Jpan`), `style`, the lower bound of
  `weight`, then `packId`; slices in `faces.json` order. `packs` (the credits the Sources page shows) by name, then
  id. Both are `[]` when no font pack is installed.
- `ETag` from the installed set, `Cache-Control: no-cache`; `If-None-Match` → 304.
- The web registers each slice with the FontFace API under the family `qq-<face>-<script>`
  (`new FontFace('qq-sans-Hans', 'url(/fonts/<sha>.woff2)', {unicodeRange, weight, style, display: 'swap'})`).

Fixture: `fonts-api.json` (the answer for the test pack of the Go tests: member names and order).

### `GET /fonts/{file}`

Public and token-free (browsers fetch `@font-face` URLs without credentials; the `/hanzi/{file}` precedent).
`file` must match `^[0-9a-f]{64}\.woff2$` and be a slice of an installed pack, else `404`. The answer is the file
byte for byte: `Content-Type: font/woff2`, `Cache-Control: public, max-age=31536000, immutable` (the name is the
content's hash), `X-Content-Type-Options: nosniff`, Range requests honoured.

## Choosing a face

A client sets study text in the face of the `appearance` row's `hanziFont` (`sans`, `serif`, `kai`; default `sans`,
docs/contracts/themes/README.md) for the script of the text's `lang`: `zh`, `zh-Hans`, `zh-CN` → `Hans`; `zh-Hant`,
`zh-TW`, `zh-HK`, `zh-MO` → `Hant`; `ja` → `Jpan` (romanisations such as `zh-Latn-pinyin` and `ja-Latn` stay in the
interface font). The installed face of that (`face`, `script`) comes first, then the platform's system fonts for that
face and script (the web: `apps/web/src/lib/fonts/hanzi.ts`; Japanese `kai` is a textbook face, then the serif
fonts). The reader's `reader.font` overrides the choice when it is not `default`. A slice that fails to load falls back
to the system fonts silently. The web registers only the faces the person's choices need, and its service worker keeps
fetched slices in a shared cache (`qinqin-fonts-v1`, at most 4,000, oldest out first; kept on sign-out) and the faces
list with the other per-session reads.

## Android

Android reads `GET /api/fonts` once per sign-in (or on a pack change) and may download the slices it needs for the
characters on screen, or all slices of the chosen face for offline reading; the family names, ranges and files are
the same as the web's. Until then it uses the system CJK fonts.
