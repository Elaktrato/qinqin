# Data pack format

A data pack carries content: a dictionary, a level list, a frequency list, sentences, grammar lessons, audio or character components. A pack is a directory (or a `.zip` of one) with a `manifest.json` and the data file its format reads. Parsing and validation: `server/internal/dict/manifest.go` and `pack.go`; dispatch per type: `server/internal/packs/packs.go`. The bundled packs live in `plugins/data/` (see `plugins/data/README.md`); the licence reference is `docs/sources.md`.

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
| `type` | `dictionary`, `levels`, `sentences`, `frequency`, `grammar`, `audio` or `components`. |
| `language` | Required; a code like `es` or `pt-br` (lowercase, `-` separators). |
| `format` | `json`, `cedict`, `unihan`, `jmdict`, `kanjidic2`, `yomitan-freq`, `freq-csv`, `audio-index` or `components-tsv`. Must suit the type, see below. |
| `license` | Required. A pack without licence terms is rejected. |
| `attribution` | Required. A pack without attribution is rejected. |
| `notice` | Optional longer caveat for the Sources page: plain text, links only as `[text](https://...)`, at most 4,000 bytes (`ValidateNotice`). |

## Types, formats and data files

| Type | Format | Data file |
|---|---|---|
| `dictionary` | `json` | `dictionary.json` (entries with `written`, optional `trad`, `kind`, `readings`, `glosses`) |
| `dictionary` | `cedict`, `unihan`, `jmdict`, `kanjidic2` | the upstream file of that format |
| `frequency` | `yomitan-freq` or `freq-csv` | Yomitan frequency export, or `freq.csv` / `freq.csv.gz` |
| `levels` | `json` | `levels.json` |
| `sentences` | `json` | `sentences.json` |
| `grammar` | `json` | `lessons.json` (format described in `plugins/data/README.md`) |
| `audio` | `audio-index` | `index.tsv` plus clips under `audio/` (`.opus`, `.ogg` or `.mp3`) |
| `components` | `components-tsv` | `components.tsv` (`語<TAB>言 口 吾 五 二`) and an optional `parts.tsv` (`言<TAB>7`) |

An audio index has the header `kind	form	reading	file	license	attribution	source`; `kind` is `term` or `syllable`. Empty `license` and `attribution` cells inherit the manifest's; a manifest licence of `per file` requires every row to state its own.

A components pack lists, per character, the parts the radical and part lookup offers. In `components.tsv` each line is one Han character, a tab and its parts separated by spaces; each part is one code point, duplicates are kept once, the character itself is dropped and at most 32 parts remain. `parts.tsv` gives part stroke counts (1 to 64). `#` starts a comment line, a malformed line fails the pack with its line number, and each file is capped at 8 MiB. Packs are matched by glyph, so they import in any order; the lookup uses the union of a language's packs (`GET /api/components`, which also lists the packs it used with their licence and attribution).

## Installing

- **Command line:** `qinqin seed --data <dir> --packs <dir>[,<dir>...]` imports every pack found; re-running replaces each pack's own rows only. Local-only packs go in the gitignored `plugins/data-local/`. See [Backup, recovery and the command line](Admin-backup-and-recovery).
- **Web app (admin, Settings, Data):** stage, licence review, install. The zip is uploaded (`POST /api/admin/packs`) and validated into a stage; the response shows the manifest as the server parsed it and what it would replace. The admin installs by sending the licence string back unchanged (`POST /api/admin/packs/staged/{token}` with `{"license": "..."}`; a mismatch is 409), and the import runs in the background (202). A stage can be discarded (`DELETE`) and expires after 30 minutes. Upload limit 128 MiB; larger packs use `seed`. Audio packs cannot be installed from the web (`packs.Installable`): use `seed`.
- The server does not check that a stated licence is true. It shows the licence "as stated by the pack".

## Sources and credits

Every pack's `license`, `attribution` and `notice` appear on the Sources page. Every bundled pack must also be named in `docs/sources.md`; `node scripts/check-sources.mjs` checks this in CI. Data with an unclear or restrictive licence is never committed: keep it in `plugins/data-local/`. See [Data and licences](Data-and-licences).
