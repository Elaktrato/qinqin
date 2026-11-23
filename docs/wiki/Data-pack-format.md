# Data pack format

A data pack carries content: a dictionary, a level list, a frequency list, sentences, grammar lessons, audio or character components. A pack is a directory (or a `.zip` of one) with a `manifest.json` and the data file its format reads. Parsing and validation: `server/internal/dict/manifest.go` and `pack.go`; the list of pack types: `server/internal/packtype` (shared copy `docs/contracts/packages/pack-types.json`); dispatch per type: `server/internal/packs/packs.go`. The bundled packs live in `plugins/data/` (see `plugins/data/README.md`); the licence reference is [`docs/sources.md`](https://github.com/Elaktrato/qinqin/blob/develop/docs/sources.md).

## Manifest

```json
{
  "id": "es-demo",
  "name": "Spanish demo",
  "version": "1.0",
  "type": "dictionary",
  "language": "es",
  "format": "json",
  "license": "CC0-1.0",
  "attribution": "Who made it, with a link"
}
```

| Field | Rule |
|---|---|
| `id`, `name`, `version` | Required (whitespace is trimmed). |
| `type` | `dictionary`, `levels`, `sentences`, `frequency`, `grammar`, `audio`, `components`, `strokes`, `lemma-rules`, `theme` or `font`. |
| `language` | Required; a code like `es` or `pt-br` (lowercase, `-` separators). A `strokes` pack states `languages` instead; a `theme` or `font` pack states neither. |
| `languages` | `strokes` packs only, and required there: a list of such codes, no duplicates (for example `["zh", "ja"]`). It registers no language. |
| `format` | `json`, `cedict`, `unihan`, `jmdict`, `kanjidic2`, `yomitan-freq`, `freq-csv`, `audio-index`, `components-tsv`, `hanzi-writer-jsonl-gz`, `themes-json`, `font-slices` or `rules-json`. Must suit the type, see below (`themes-json` is for theme packs only and theme packs use only it; the same for `font-slices` and font packs, and for `rules-json` and lemma-rules packs). |
| `license` | Required. A pack without licence terms is rejected. |
| `attribution` | Required. A pack without attribution is rejected. |
| `notice` | Optional longer caveat for the Sources page: plain text, links only as `[text](https://...)`, at most 4,000 bytes (`ValidateNotice`). |

## Types, formats and data files

| Type | Format | Data file |
|---|---|---|
| `dictionary` | `json` | `dictionary.json` (entries with `written`, optional `trad`, `kind`, `readings`, `glosses`) |
| `dictionary` | `cedict`, `unihan`, `jmdict`, `kanjidic2` | the upstream file of that format |
| `frequency` | `yomitan-freq` or `freq-csv` | A Yomitan frequency dictionary (the downloaded `.zip`, or its unpacked `index.json` and `term_meta_bank_*.json`), or `freq.csv` / `freq.csv.gz` with the header `term,reading,rank` |
| `levels` | `json` | `levels.json` |
| `sentences` | `json` | `sentences.json`: `{"entries": [{"word", "sentences": [{"hanzi", "pinyin", "translation"}]}]}`; `hanzi` (the sentence) and `translation` are required, `pinyin` (the reading: pinyin, or kana for Japanese) is optional |
| `grammar` | `json` | `lessons.json` (format described in `plugins/data/README.md`) |
| `audio` | `audio-index` | `index.tsv` plus clips under `audio/` (`.opus`, `.ogg` or `.mp3`) |
| `components` | `components-tsv` | `components.tsv` (`語<TAB>言 口 吾 五 二`) and an optional `parts.tsv` (`言<TAB>7`) |
| `strokes` | `hanzi-writer-jsonl-gz` | `strokes.jsonl.gz`: one line `{"char": "好", "data": {...}}` per character |
| `lemma-rules` | `rules-json` | `rules.json`: one lemmatizer rule table (`docs/contracts/lemma/README.md`) |
| `theme` | `themes-json` | `themes.json`: an array of colour themes (`docs/contracts/themes/README.md`) |
| `font` | `font-slices` | `faces.json` plus `slices/<sha256>.woff2`: a hanzi/kanji face cut into WOFF2 slices by Unicode range (`docs/contracts/fonts/README.md`) |

An audio index has the header `kind	form	reading	file	license	attribution	source`; `kind` is `term` or `syllable`. Empty `license` and `attribution` cells inherit the manifest's; a manifest licence of `per file` requires every row to state its own.

A components pack lists, per character, the parts the radical and part lookup offers. In `components.tsv` each line is one Han character, a tab and its parts separated by spaces; each part is one code point, duplicates are kept once, the character itself is dropped and at most 32 parts remain. `parts.tsv` gives part stroke counts (1 to 64). `#` starts a comment line, a malformed line fails the pack with its line number, a line is at most 4 KiB and each file is capped at 8 MiB. A pack's `language` is stored as its primary subtag (`zh-tw` becomes `zh`). Packs are matched by glyph, so they import in any order; the lookup uses the union of a language's packs (`GET /api/components`, which also lists the packs it used with their licence and attribution).

A strokes pack holds stroke-order data for the stroke player, one hanzi-writer JSON object per character, stored and served byte for byte. `char` is exactly one code point and appears once, `data` is a JSON object, a line is at most 64 KiB, and a malformed line fails the whole pack with its line number. When several strokes packs carry a character, the one installed first serves it. `node scripts/prepare-strokes-pack.mjs --out <dir>` builds the pack `hanzi-writer-strokes` from the pinned `hanzi-writer-data` npm package (run `npm --prefix apps/web ci` first); its Arphic Public License text must equal `apps/web/static/ARPHICPL.TXT`. The server answers `GET /hanzi/U<HEX>.json` (the code point in uppercase hex, the URL the static files had) from the installed packs (`Content-Type: application/json`, `X-Content-Type-Options: nosniff`, cached for a day), and `serve` installs the first strokes pack it finds in the pack roots at startup when none is installed, unless an administrator uninstalled one; `GET /api/stroke-packs` lists the installed packs' credits.

A lemma-rules pack gives one language lemmatization: `rules.json` is a rule table in the format of `docs/contracts/lemma/README.md` (format 2: suffix rewrites with word classes, compounds and ranking hints) for the manifest's `language`. Inflected words in the Reader and lookups then resolve to their dictionary form (食べました → 食べる) with no code change. The table is checked strictly at upload and import: unknown keys, classes, match modes or scripts, a `language` other than the manifest's, a file over 1 MiB and anything over the contract's limits (1,024 rules, 64 classes, 2,048 kept-whole expressions, rule strings of 32 code points, …) reject the pack; the engine also stops one word after 64 candidate forms, so no table can slow the server down. The installed table **replaces** the one built into the server for that language (Japanese has one; uninstalling the pack brings it back) and takes effect at once, without a restart. One live pack per language: a second pack for a language that has one is refused until that one is uninstalled; uploading the same pack id again replaces it. A language with a lemma-rules pack but no language module of its own (a data-only language) also gets segmentation and lookups through the API; Chinese tables are refused, because the Chinese module does not use rule tables. The bundled `ja-lemma` pack is the server's own Japanese table. `GET /api/lemma-packs` lists the installed packs' credits.

A theme pack holds one or more colour themes in `themes.json` (at most 64, 256 KiB): each with an `id`, a `name`, an optional `family`, a `scheme` (`light` or `dark`), the 13 colour tokens as lower-case `#rrggbb`, 1–16 named `accents` and a `defaultAccent`. The file is strict (an unknown or repeated member is refused) and the first problem is reported with a code and a path, for example `themes.json: bad-colour at $[0].colors.panel`; the full rules and error codes are in `docs/contracts/themes/README.md`. Theme ids are unique across the server: a pack may not reuse the id of a built-in theme (qinqin, qinqin extras, Catppuccin, Rosé Pine, Nord, Gruvbox, Dracula, Solarized, Tokyo Night, Everforest and Kanagawa ship inside the binary) or of another installed pack. The upload review shows the measured contrast of every theme (text, secondary text, the error colour and button text on the default accent against 4.5:1, grades and accents against 3:1); a theme below a minimum can still be installed, and an accent below 3:1 is not offered in the accent picker. Installed theme packs are listed under **Themes** in Settings → Data and credited on the Sources page. `GET /api/themes` lists every theme.

A font pack holds one or more hanzi/kanji faces (Sans, Serif or Kai for simplified Chinese, traditional Chinese or Japanese) cut into WOFF2 slices by Unicode range, so a page downloads only the slices of the characters it shows. `faces.json` names each face (`face`, `script`, the `original` face, `weight`, `style`) and its slices (`slices/<sha256>.woff2` with a CSS `unicodeRange`); it is at most 4 MiB and strict like a theme file, and the full rules and error codes are in `docs/contracts/fonts/README.md`. Every slice must start with `wOF2`, be at most 2 MiB and match the sha256 in its name; at most 1,500 slices per pack. Only one installed pack may provide a face (the same face, script and style with overlapping weights): a pack whose face another pack provides is refused until that pack is uninstalled. The slices are stored under `<data>/fonts` and served at `GET /fonts/<sha256>.woff2` (public, cached for a year as immutable); `GET /api/fonts` lists the installed faces for signed-in users. Font packs are uploaded like other packs (the review checks every slice first) or installed with `qinqin seed`; they are never committed: `node scripts/prepare-font-pack.mjs --source <id> --out <dir>` builds one from a pinned upstream face (see [Data and licences](Data-and-licences)).

At import the server keeps each pack's licence files: the regular files at the pack root named `LICENSE*`, `LICENCE*`, `ATTRIBUTION*`, `NOTICE*` or `COPYING*` (case-insensitive, at most 8 files of 256 KiB each, valid UTF-8; others are skipped with a log line). They travel verbatim in the pack's data package under `LICENSES/<pack id>/`, so ship the licence text next to the manifest. A re-import replaces them; an uninstall removes them.

## A frequency pack, for example

A frequency list orders lookup results and shows as a chip in the popup ([Dictionary data model](Dictionary-data-model#frequency-data)). A local one looks like this:

```json
{
  "id": "my-freq",
  "name": "My frequency list",
  "version": "2026-11-12",
  "type": "frequency",
  "language": "ja",
  "license": "as stated by its publisher",
  "attribution": "who made it, with a link",
  "format": "yomitan-freq"
}
```

## Installing

- **Command line:** `qinqin seed --data <dir> --packs <dir>[,<dir>...]` imports every pack found; re-running replaces each pack's own rows only. Local-only packs go in the gitignored `plugins/data-local/`. See [Backup, recovery and the command line](Admin-backup-and-recovery).
- **Web app (Settings → Data, administrators):** stage, licence review, install; the steps as the screen shows them are on [Data packs on the server](Admin-data-packs). A zip may hold at most 2,000 files and 512 MiB unpacked. The zip is uploaded (`POST /api/admin/packs`) and validated into a stage; the response shows the manifest as the server parsed it and what it would replace. The admin installs by sending the licence string back unchanged (`POST /api/admin/packs/staged/{token}` with `{"license": "..."}`; a mismatch is 409), and the import runs in the background (202). A stage can be discarded (`DELETE`) and expires after 30 minutes. Upload limit 128 MiB; larger packs use `seed`. Audio packs cannot be installed from the web (`packs.Installable`): use `seed`. At most 3 stages exist at a time.
- The server does not check that a stated licence is true. It shows the licence "as stated by the pack".

## Sources and credits

Every pack's `license`, `attribution` and `notice` appear on the Sources page. Every bundled pack must also be named in `docs/sources.md`; `node scripts/check-sources.mjs` checks this in CI. Data with an unclear or restrictive licence is never committed: keep it in `plugins/data-local/`. See [Data and licences](Data-and-licences).
