# Data packs on the server

Everything qinqin knows about words and characters comes from **packs**: dictionaries, frequency lists, level lists, sentences, grammar lessons, audio, character components, stroke-order data, colour themes and hanzi/kanji fonts. A pack is a folder (or a zip of one) with a `manifest.json` and its data file ([Data pack format](Data-pack-format)). Installing one writes its rows into the database; the server then turns the installed data into **data packages** that clients download. This page is the administrator's side; what each bundled pack is and how it is licensed is in [Data and licences](Data-and-licences).

## Bundled, built into the image, and local-only

| Where it comes from | What | How it gets installed |
|---|---|---|
| **Bundled** (`plugins/data/` in the repository, `/opt/qinqin/packs` in the image) | CC-CEDICT, Unihan, JMdict, KANJIDIC2, the Jiten frequency list, HSK 3.0 characters and words, jōyō grades, 通用规范汉字表, JLPT kanji, KanjiVG components, a Spanish demo dictionary, the Chinese (HSK-aligned) and Japanese (≈ JLPT) grammar packs, the Japanese lemmatizer rules (`ja-lemma`, see below); the Tatoeba example sentences (`zh-sentences-tatoeba`, `ja-sentences-tatoeba`) once a maintainer has generated them ([Data and licences](Data-and-licences#example-sentences-tatoeba)) | The first start of a fresh instance ([auto-seed](Admin-deploying#the-auto-seed-on-the-first-start); not the two demos), or `qinqin seed` (everything, demos included) |
| **Built into the image** (not committed) | The stroke-order data `hanzi-writer-strokes` (`/opt/qinqin/strokes`) and the Kanji alive audio (`/opt/qinqin/audio`, when the image was built with it) | The first start ([auto-seed](Admin-deploying#the-auto-seed-on-the-first-start)), or `qinqin seed`; the stroke data also installs itself at start when no strokes pack is installed |
| **Built by you** (never committed or bundled) | Font packs, made with `scripts/prepare-font-pack.mjs` from a pinned upstream face ([Data and licences](Data-and-licences#hanzi-and-kanji-font-packs)) | Upload in Settings → Data, or `qinqin seed --packs <folder>` |
| **Local-only** (the gitignored `plugins/data-local/`) | Data with an unclear or restrictive licence: a Chinese frequency list, the JLPT vocabulary pack, a Chinese components pack, your own level lists | `qinqin seed` with the folder mounted and named in `--packs` |

The bundled set is chosen so a fresh server can seed itself offline on its first start and every pack's licence allows redistribution (see `docs/sources.md`). Local-only data stays on your server: it is never part of the repository or the image, and you are responsible for its terms.

**Under Docker** `qinqin seed` sees only the image's pack roots (`/opt/qinqin/packs`, `/opt/qinqin/audio`, `/opt/qinqin/strokes`). To add a host folder, mount it, for example `./plugins/data-local:/opt/qinqin/local:ro`, and name every root:

```sh
docker compose exec qinqin qinqin seed --packs /opt/qinqin/packs,/opt/qinqin/audio,/opt/qinqin/strokes,/opt/qinqin/local
```

**Your own level list** (TBCL, a curriculum table, any private list): put a folder `plugins/data-local/<id>/` with a `manifest.json` (`"type": "levels"`, `"format": "json"`, a `license` and an `attribution`) and a `levels.json`, or let `node scripts/prepare-local-levels.mjs` convert a TSV into one, then run `qinqin seed --packs plugins/data,plugins/data-local` (in a checkout) or the Docker form above. Font packs built into `plugins/data-fonts/` are not a default root either: name the folder in `--packs`, or upload the pack. The hand-written samples in `plugins/samples/` (`zh-mini`, `ja-mini`, `hsk-mini`, `jlpt-mini`) are never seeded unless you name them (`qinqin seed --packs plugins/samples`). `zh-grammar-demo` is the only bundled grammar pack.

**Re-seed after upgrades that add pack data.** A database seeded before the character-map level fields existed shows a "Level data missing" banner on the character map until `qinqin seed` runs. A re-seed also drops the pre-2010 four-level JLPT field that older KANJIDIC2 imports wrote; JLPT levels come only from the `jlpt-kanji` pack.

**Example sentences.** The Tatoeba sentence packs link each sentence to the dictionary words it contains, so they need CC-CEDICT and JMdict installed first; `seed` and the auto-seed take care of the order. A sentence's reading may be missing (it is left out when a word has several readings). Uninstalling a sentence pack removes its sentences from entry pages and from new "Fill the gap" and "Build the sentence" cards; sentences people added stay.

`seed` imports dictionaries first, then frequency lists, levels, sentences and the rest, each group in path order; the order of frequency packs is their priority (the first one with data for an entry decides the "most frequent first" order). Re-running replaces each pack's own rows and touches nothing else.

## Settings → Data (administrators)

The **Data** tab is only shown to administrators. It has two parts: **Packs** and **Languages**.

### Installing a pack from the web

1. Under **Pack zip** choose the zip and press **Upload**. A progress bar shows the upload, then "Uploaded, checking the pack…". The server extracts and validates it into a stage; nothing is installed yet.
2. **Review before installing** shows what the server read: Name, Pack id, Version, Type, Language (or Languages), the **Licence (as stated by the pack)**, Attribution and Notice. When the pack replaces an installed one, the lines say so: "Replaces the installed version 1.0 with 1.1", whether the licence stays or changes, and an attribution change. A licence containing words such as "non-commercial", "research" or "all rights reserved" gets the line "This licence may restrict use or redistribution — check it before installing". A theme pack also shows a **Contrast** table for each of its themes (pair, measured ratio, minimum, "Passes" or "Below"); a theme below a minimum can still be installed.
3. Tick **I have read the licence and attribution above and this server may use the data under these terms**, then **Install**. "Importing… large dictionaries can take a minute" shows while the import runs in the background; the result line says "Installed <name>: …". **Discard** throws the stage away ("Discarded. Nothing was installed.").

Rules behind it:

- Uploads go up to **128 MiB** (a zip of at most 2,000 files and 512 MiB unpacked); larger packs are installed with `qinqin seed`. Your reverse proxy must allow bodies of 130 MB.
- A stage lives 30 minutes, belongs to the administrator who uploaded it, and at most 3 stages exist at a time on the server ("finish or discard a staged pack first"). Abandoned stages are swept every 5 minutes.
- The install sends the licence string back to the server, which compares it with the one it parsed: this proves the licence you were shown is the one being installed. **The server never checks that a stated licence is true**; it shows it "as stated by the pack".
- **Audio packs cannot be uploaded** (thousands of clips exceed the upload limits): install them with the fetch script and `qinqin seed`. Every other type can.
- Installed packs are stored under `/data/packs/<type>/<id>/<version>/`.

The API behind this: `POST /api/admin/packs` (multipart field `pack`), `GET` and `DELETE /api/admin/packs/staged/{token}`, `POST /api/admin/packs/staged/{token}` with `{"license": "..."}` (409 on a mismatch, 202 when the import starts) ([API reference](API-Reference#administration)).

### The installed list

Packs are grouped by type (Dictionaries, Frequency lists, Level lists, Sentences, Grammar lessons, Audio, Character components, Stroke data, Lemmatizer rules, Themes, Fonts). Each shows its licence and attribution as stored ("Licence not recorded — reinstall the pack to record it" for old sentence packs), and one **Package** line per data package built from it, for example "lexicon.zh: revision 3, 15.2 MB, ready", "being built", "build failed" (with the error, which only administrators see) or "removed". "Packages are being built" appears above the list while the server builds. **See all credits on the Sources page** links to `/sources`.

### Uninstalling

**Uninstall** opens a dialog that says what goes and what stays, per type:

- a dictionary: its glosses disappear from lookups and entries; entries, flashcards and edits stay;
- frequency, levels, sentences, grammar, components: their ranks, levels, pack sentences, lessons or parts disappear; study data and sentences people added stay;
- strokes: characters it alone carried show no strokes, and the server will **not** reinstall the bundled stroke data at start any more (run `qinqin seed` to bring it back);
- lemmatizer rules: inflected words of its language are recognised by the table built into the server again (Japanese has one), or not at all; the Reader and lookups follow at once. The server does **not** reinstall an uninstalled bundled `ja-lemma` at start (run `qinqin seed` to bring it back);
- audio: its recordings are deleted from `/data/audio` and play buttons fall back to the device voice;
- a font pack: its faces disappear and Chinese and Japanese text falls back to the device's own fonts;
- a theme pack: its themes disappear from the pickers; anyone who chose one sees their slot's default theme, and their choice comes back if the pack is installed again.

A later `qinqin seed` reinstalls bundled packs. The pack's files under `/data/packs` stay; its data package becomes a tombstone ("removed") so clients delete their copy.

### Languages

The **Languages** table lists every language the server knows: Code, Language, Kind ("built-in" for Chinese and Japanese, which have code support such as pinyin and kana folding; "data only" for the rest), the Packs installed for it and the number of Workspaces using it. **Add a language** with a code of two or three letters, optionally with a region or script (`es`, `pt-br`): it appears in the workspace list and has no dictionary until you install a pack for it. A data-only language can be removed only while nothing uses it; the refusal names what still does ("still used by: 2 workspaces, installed dictionary data"). Built-in languages cannot be removed.

## Data packages: what clients download

Since v0.4.0 dictionary and other shared data no longer travels in the sync pull. The server builds a versioned, checksummed **package** per language lexicon and per installed pack, and clients download those (contract: `docs/contracts/packages/`).

| Package id | Built from |
|---|---|
| `lexicon.<lang>` | Every live entry of the language with the senses of all its live dictionaries (exists while the language has at least one dictionary) |
| `levels.<pack>`, `sentences.<pack>`, `frequency.<pack>`, `components.<pack>`, `grammar.<pack>`, `strokes.<pack>`, `lemma-rules.<pack>` | One installed pack each |
| `audio.<pack>` | One audio pack, its clips included; marked optional, so clients ask before downloading |

Theme and font packs build no package: clients read them from `GET /api/themes`, `GET /api/fonts` and the font slices.

- **The catalogue** is `GET /api/packages` (signed-in users, read tokens allowed): the packages of the caller's workspace languages, or `?languages=zh,ja` or `?languages=all`, each with its revision, content hash, file SHA-256, size, state (`ready`, `building`, `failed`, `deleted`), licences and source packs. `GET /api/packages/{id}/{revision}` is the file, resumable with `Range`. At most 2 downloads per user run at once.
- **What a package holds**: a zip (`<id>-r<revision>.qqpkg`) with `manifest.json`, a `NOTICE.md` (per source pack: name, version, licence, attribution, notice), the pack's own licence files verbatim under `LICENSES/<pack id>/`, and `data.sqlite`, a read-only database. A package contains exactly what the server has installed. Clients verify a file before use and replace it on a new revision; they never merge package rows into their own data.
- **When they are built**: after every pack install or uninstall, and at start (the server builds what is missing, stale or of an old format; about a minute for everything on a fully seeded server, in the background, while the app works). `qinqin seed` builds the packages of the packs it seeded before it returns, and fails with a `package <id>: build failed` line when one fails. One builder runs at a time; `seed` and a running server take turns through the lock file `packages/.lock`.
- **Revisions**: a package gets a new revision only when its content (or its language list or requirements) changes; an unchanged rebuild writes nothing. A replaced revision's file is kept 7 days so clients can finish downloading it (later 410 `package_revision_gone`). A failed build keeps the previous revision downloadable.
- **Disk space**: roughly the size of the installed data compressed: CC-CEDICT's `lexicon.zh` about 15 MB, the stroke data about 13 MB, an audio pack its clips, plus 7 days of replaced revisions.
- **Backups**: `/data/packages` is never backed up. A restored server rebuilds it to the same revisions and content hashes, so clients keep their files.

### Licence texts in packages

At import the server keeps each pack's licence files: the files at the pack root named `LICENSE*`, `LICENCE*`, `ATTRIBUTION*`, `NOTICE*` or `COPYING*` (case-insensitive, at most 8 files of 256 KiB, valid UTF-8; others are skipped with a log line). Packs installed by a release before v0.4.0 have none stored: their packages carry only the licence name and attribution (the catalogue says `licenseTexts: false`) and the log says `pack <id>: no licence texts stored; run "qinqin seed"`. **Re-seed once** after upgrading: `qinqin seed` re-imports the bundled packs with their texts and the packages get a new revision. A pack you uploaded from the web needs to be uploaded again (or seeded from its folder).

## The stroke-order data pack

Stroke animations come from the pack `hanzi-writer-strokes` (data from the `hanzi-writer-data` npm package, derived from Make Me a Hanzi; Arphic Public License). It is built into the image at `/opt/qinqin/strokes` (about 13 MB), not committed and not part of the web app.

- At start the server installs it when no strokes pack is installed, unless an administrator uninstalled one (log: `strokes: installed the bundled stroke data ...`). `qinqin seed` installs it too.
- The server answers `GET /hanzi/U<HEX>.json` (the code point in uppercase hex) from the installed strokes packs, the URL the static files had in v0.3. When several strokes packs carry a character, the one installed first serves it. `GET /api/stroke-packs` lists their credits for the Sources page.
- In a repository checkout, build it with `npm --prefix apps/web ci` and then `node scripts/prepare-strokes-pack.mjs --out plugins/data-strokes/hanzi-writer-strokes`; `qinqin seed` picks up `plugins/data-strokes` when it exists.

## Lemmatizer rule tables

The lemmatizer turns inflected words into dictionary forms (勉強しています → 勉強する) from a per-language rule table. Japanese has one built into the server; a `lemma-rules` pack ([format](Data-pack-format#types-formats-and-data-files)) adds a table for another language or replaces the built-in one, at once and without a restart.

- **Bundled:** `ja-lemma` is the built-in Japanese table as a pack, so clients can download the exact table the server runs (`lemma-rules.ja-lemma`). A fresh instance installs it with the other bundled packs; at every start the server also installs it when it was never installed and no other Japanese table is, and **updates it from the image** when the image's copy differs (log: `lemma-rules: updated the bundled rule table ja-lemma ...`). An uninstalled `ja-lemma` stays uninstalled.
- **Your own table:** give it its own pack id (for example `ja-lemma-custom`), uninstall `ja-lemma` first (one live table per language), then upload it in Settings → Data. A table uploaded under the id `ja-lemma` is replaced by the image's copy at the next start.
- **Seeding while the server runs:** a table installed or removed by `qinqin seed` in a separate process applies within about 30 seconds; uploads and uninstalls in Settings → Data apply at once.
- **Checks:** the review refuses a table that does not parse, breaks the contract's limits, names another language than the manifest, or is for a language that already has a live table. Only administrators can upload.
- **Backup:** installed tables are server data. They are not in a user's backup export; a server backup carries them with the database.

## Related

[Data pack format](Data-pack-format), [Data and licences](Data-and-licences), [Upgrading](Admin-upgrading), [Backup, recovery and the command line](Admin-backup-and-recovery).
