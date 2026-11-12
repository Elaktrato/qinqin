# qinqin

qinqin is a self-hosted platform for studying Chinese and Japanese. It combines
per-dictionary meanings, character readings, stroke-order animation, level
badges, and study statistics in one small Docker stack: a Go API and SQLite
database with a SvelteKit single-page app embedded in the binary.

## Features

- **Hanzi and kanji views** — simplified/traditional variants, readings in
  pinyin/bopomofo or kana/romaji, radicals, and example sentences. Chinese
  character entries add animated stroke order.
- **Meanings with source tags** — every sense keeps its dictionary's name,
  license, and attribution, so multiple dictionaries can coexist without losing
  provenance.
- **Level schemes** — HSK, JLPT, or custom packs add badges; word-based schemes
  derive character badges at import time.
- **Workspaces per language** — keep Chinese and Japanese study separate, with
  a combined view for cross-language statistics.
- **Search** — across written forms, readings, and meanings, scoped to the
  current workspace language.
- **Yomitan-style lookup** — in the Reader, hovering a word shows a ranked stack
  of dictionary entries with frequency chips, and popups open from inside popups.
- **Editing** — correct written forms and readings per user without mutating
  the shared dictionary data.
- **Study mode** — add any word from its entry page and review it with Anki-style
  grading; the flashcards plugin derives FSRS schedules, a review heatmap, and
  EXP/levels from the event log.
- **Plugin architecture** — dictionaries, level schemes, and example sentences
  are installable data packs; home widgets and views are feature plugins that
  the server registers at startup so Settings can enable and order them.

## Quick start (Docker Compose / Portainer)

The stack is a single service. In Portainer, create a stack from
[`docker-compose.yml`](docker-compose.yml); or from this repository (Docker with
the Compose plugin required) run:

```bash
docker compose up -d
```

On the first run, seed the bundled packs (the upstream dictionaries, the Jiten
frequency list and the level samples), then create the admin account:

```bash
docker compose exec qinqin qinqin seed
docker compose exec qinqin qinqin adduser --admin --username you
```

`qinqin seed` takes `--data <dir>` (the data directory; default `$QINQIN_DATA` or
`./data`) and `--packs <dir>[,<dir>...]` (pack roots, comma-separated and/or
repeated; default `$QINQIN_PACKS`, or `plugins/data` plus `plugins/data-local`
when that exists; the image sets `QINQIN_PACKS` to the packs it ships). Under
Docker, `qinqin seed` sees only the image's packs, not the host's
`plugins/data-local`: mount it (for example
`./plugins/data-local:/opt/qinqin/local:ro`) and pass
`--packs /opt/qinqin/packs,/opt/qinqin/local`. The full
bundle seeds in under a minute (about 45 s measured) and is idempotent:
re-running replaces each pack's own rows and touches nothing else (an unchanged
dictionary writes no rows; frequency rows are replaced). Run `qinqin seed` while the server is idle: each pack is
one write transaction, JMdict holds the database write lock for about 20 s, and
the server waits at most 5 s (`busy_timeout`) before a write fails.

> **Upgrading a development database.** Entry ids changed with the dictionary
> rebuild (the lookup rewrite; migration 017 drops the legacy tables). Nothing is
> published, so there is no upgrade path: **delete the data directory (or at
> least `qinqin.db`) and seed again.** On an old database the restart and re-seed
> succeed without an error, but user edits and flashcards created before this
> change keep their old entry ids and now point at different entries.
> `qinqin seed` prints a `WARNING` line whenever the database holds user edits or
> flashcards.

The `adduser` command prompts for a password. Then open
<http://localhost:8080>.

The SQLite database and installed packs live in `./data` next to the compose
file. Set `QINQIN_PORT` to change the published port and `QINQIN_IMAGE` to pin
an image.

> Seed and create the admin account **before** exposing the port beyond your
> LAN: while no user exists, the first registration over the API becomes the
> admin — whoever makes it.

## Studying

Study is a web feature plugin (`qinqin-flashcards`). To add a word, open any
character or word entry and press **Add to study** next to its title; the card
joins the general deck and keeps the entry's first example sentence for context.

`/study` is the session setup: choose the decks to draw from, opt out of card
types (Round 1 ships vocab repetition; sentence, writing, and tone cards follow
in Round 3), and set the new-card and review limits. Starting a session shows the
word, its readings, and the example sentence with the word blanked; **Show
answer** then adds the meanings. Grade each card **Again**, **Hard**, **Good**,
or **Easy** (or press 1–4). The grade is appended to the study-event log and
FSRS derives the next due date from the card's whole review history, so schedules
are never stored and two devices merge cleanly by event id.

Sessions can also draw from a level instead of a deck: choose **By level**, pick
an installed scheme (HSK, JLPT, or a curriculum pack) and one of its levels, and
the session queues that level's words. A word that already has a card reuses it;
the rest get a card in the general deck when you first grade them, so abandoning
a level session creates nothing.

`/study/map` is the Hanzi/Kanji mastery map for the current workspace language.
It shows a grid of the characters in the selected scheme and level — or the whole
scheme — with a filter for each, plus a level-progress list of mastered counts.
Colour is the character's mastery band: grey for not studied, then red, amber,
blue, and green for fresh, learning, mature, and learned. A character's 0–100
score is the mean over every reviewed card whose word contains it of how firmly
that card's schedule has settled, with a year of FSRS stability counting fully;
characters at 80 or above count as mastered. The map is derived from your cards
and review events, so nothing schedule-shaped is stored for it either.

The home page widget shows what is due and new, plus a review-driven heatmap,
daily review counts, and derived EXP/levels per workspace. Studying adds no
bundled data: decks and cards are workspace plugin data and reviews are events,
so the dictionaries in `plugins/data/` stay unmodified.

Round 3 is pending: Word Salad, stroke-checked writing, and tone cards. See the
[design doc](docs/superpowers/specs/2026-11-12-flashcards-design.md) for the full
model; [issue #24](https://github.com/Elaktrato/qinqin/issues/24) shipped the
level sessions and mastery map, and
[issue #25](https://github.com/Elaktrato/qinqin/issues/25) tracks the rest.

## Reading

Reader is a web feature plugin (`qinqin-reader`) for reading Chinese and Japanese
text with dictionary lookup in place. It offers:

- **Hover and selection lookup** — the text under the cursor is looked up on the
  server (`GET /api/lookup`), which returns every plausible entry, ranked. Japanese
  forms are deinflected with part-of-speech gating, and words written in kana —
  する, こと, りんご — are found by their kana readings. Selecting text looks up
  the selection. Hovering Latin letters, digits or a spot with no dictionary word
  shows nothing.
- **Ruby toggle** — furigana in Japanese books can be shown or hidden.
- **Script conversion** — Chinese books can be shown as original, simplified, or
  traditional (converted in the browser with `opencc-js`); lookup works on either.
- **A personal library** — books are stored per user, with the source link and
  attribution shown for each, and the reading position is remembered per book.
- **Import** from Aozora Bunko and Project Gutenberg, or **upload** your own epub.
  Gutenberg books carry the note "Distributed by Project Gutenberg as public domain
  in the USA; copyright status elsewhere may differ." (its catalog has no rights
  column, so qinqin claims nothing more).

Open **Reader** in the nav. Import a work from a source (search, then Import) or
upload an epub; for an upload whose epub declares no supported language you pick
Chinese or Japanese. Open a book and hover a word.

The popup shows the matching entries as a **stack**, best first, not a single
guess. Each entry lists its headword and readings, chips for the inflection
(like "past"), part-of-speech and usage tags, and the **frequency rank** from
each installed frequency pack, then its senses grouped by dictionary. The first
3 entries and the first 3 senses of an entry show; "Show N more entries" and
"Show N more senses" reveal the rest (it is client-side, the server already
returned up to 30 entries). A kana word can be read by many entries (する: 為る,
刷る, 擦る...), and a longer match always beats a shorter one; the order is
described in [the lookup design](docs/superpowers/specs/2026-11-12-yomitan-lookup-design.md).
Roughly: longest match, then frequency (bundled Jiten list for Japanese), then
primary-reading match, inflection chain length, exact-match count, dictionary
order, JMdict priority and usually-kana. Japanese deinflection is gated by part
of speech, so a candidate whose part of speech does not fit the inflection (話する for 話した) is dropped before ranking, and a kana word that is itself an
entry still competes with the deinflection: した shows 為る first (frequent), then
下 and 舌. Without any frequency pack the ranking falls back to the inflection
chain length and the priority score. Chinese words usually give one merged entry
that lists all readings (行: xíng, háng).

**Hold Shift and hover** a word inside a popup to open a nested popup for it
(without Shift nothing opens, so reading a popup never floods the server);
popups nest up to 4 deep. **Escape** closes the topmost popup only; the last one
closes the whole stack, and so does a click outside the popups. Select text to
look it up: a single hanzi or kanji shows the character entry, longer text shows
the entries for the start of the selection.

Limits you may hit:

- Epub uploads are capped at 20 MB, and malformed or oversized epubs are rejected.
- One import runs at a time per user; a second one answers "another import is
  already running". A work already in your library is not imported twice.
- Only public-domain Aozora works are offered, and only Chinese and Japanese books
  are supported.
- A source search shows at most 100 results, best matches first (exact title,
  title prefix, author, then other matches); refine the search when it says the
  list is cut off.
- Webview only for now. Hover needs a mouse; selection lookup also works on touch.

### API

All library and source routes need a signed-in user, and so does
`POST /api/segment`; `GET /api/lookup`, `GET /api/segment/at`,
`GET /api/entries/{id}`, `GET /api/search` and `GET /api/frequency-packs` are public.

| Route | Purpose |
|---|---|
| `GET /api/lookup?lang=&text=&offset=&kind=` | The ranked entries for the text at a code-point offset: `{"results": [...]}`, at most 30. `text` up to 64 code points (the web app sends 16, and the engine reads a 12 code-point window from the offset); `kind` is `word` or `character` and may repeat. Each result has the entry id, forms, readings, the matched text with its `start`/`end`, inflection `reasons`, tags, `frequencies` and `senses` (each with POS). Missing or non-integer params are 400, an unsupported language 400, too long 413; an offset outside the text finds nothing |
| `GET /api/segment/at?lang=&text=&offset=` | Tokenizer: the longest dictionary match at a code-point offset, built on the lookup engine. `text` up to 64 code points. `lemma` is the dictionary form and `reason` the deinflection; only `entries[0]` corresponds to them, later candidates are other readings or entries with the same surface (at most 8 candidates in all). A candidate has `reading: true` when it matched by a kana reading (Japanese) |
| `POST /api/segment` `{lang, text}` | Every match in order, same shape; needs a signed-in user. `text` up to 5000 code points, body up to 256 KiB |
| `GET /api/frequency-packs` | The installed frequency packs in priority order, with `license` and `attribution` (the Sources page lists them) |
| `GET /api/sync/pull?cursor=&collections=` | Changes since the cursor (authenticated). `collections` is an optional comma-separated list of Delta collection names that limits the pull; the others come back empty and an unknown name is 400. The returned cursor is valid only for the collections requested: do not mix subset pulls with one global cursor. The Study page pulls only `pluginData` and `pluginStates` |
| `GET /api/library/books`, `GET`/`DELETE /api/library/books/{id}` | List, read, delete a book |
| `GET /api/library/books/{id}/chapters/{n}` | One chapter's paragraphs |
| `PUT /api/library/books/{id}/position` | Store the reading position |
| `POST /api/library/upload` | Multipart `file` (epub), optional `language` |
| `GET /api/library/sources` | Available sources |
| `GET /api/library/sources/{source}/search?q=&limit=` | Search a source's catalog (limit up to 100) |
| `POST /api/library/sources/{source}/import` `{sourceId}` | Import one work |

`lang` must be a registered language (`zh` or `ja` for the reader), and offsets
count Unicode code points, not bytes or UTF-16 units. `GET /api/search` ranks hits
by tier (exact form, exact reading, reading prefix, bopomofo prefix, then a gloss
substring), at most 50 hits unless `limit` asks for more (up to 200); within a
tier by usually-kana-with-priority, then priority, then id.

### Operations

Imports run on the server, only when a user asks, one work per request. Requests
to the sources send `User-Agent: qinqin/<version> (+https://github.com/Elaktrato/qinqin)`,
where `<version>` is `dev` unless the binary is built with
`go build -ldflags "-X main.version=1.2.3" ./cmd/qinqin`. They wait at most 15 s
for a connection and 15 s for the response headers; a download itself is bounded
only by the import's own deadline. Requests are limited to one per second per host, and are cached under `<data>/cache/sources`
(catalogs for 7 days, works for 1 day). Books live under `<data>/books/<user id>/`,
with their metadata and reading position in the SQLite database.

The source client only fetches `https` URLs from a host allow-list (Aozora Bunko,
Gutenberg), checks every redirect hop, and refuses
loopback, private, and other non-public addresses. Environment proxies
(`HTTP_PROXY`, `HTTPS_PROXY`) are intentionally **not** used, because a proxy would
bypass that check. A self-hoster behind a mandatory outbound proxy therefore
cannot import from the sources; epub uploads still work.

### Extending: plugin pages

A web plugin can contribute pages. Declare the `page` surface and a `pages` list in
`apps/web/src/lib/plugins/index.ts`:

```ts
import MyPage from './my/MyPage.svelte';

export const webPlugins: WebPlugin[] = [
	{
		manifest: { id: 'qinqin-my', name: 'My plugin', surfaces: ['page'] },
		pages: [{ title: 'My page', nav: true, component: MyPage }]
	}
];
```

The page renders at `/p/<slug>/<rest>`, where the slug is the plugin id without
the `qinqin-` prefix; the component receives `rest` as a prop and routes inside it.
`nav: true` adds a link to the shell nav. The page is shown only while the plugin
is registered on the server (built-in manifests are registered at startup in
`server/cmd/qinqin/main.go`) and enabled for the user; the shell and the page route
share one fetch of those states through the `pluginStates` store in
`apps/web/src/lib/plugins/states.ts`.

## Dictionary data model

The dictionary is stored as `entries`, `forms`, `readings`, `senses`,
`entry_links`, `frequency_packs` and `frequency` (migrations 014–017). An entry
is one dictionary headword, identified by its source's key within a language and
kind (`word` or `character`). Its `forms` are the written forms (with flags), its
`readings` carry the reading text plus a normalized `plain` form that lookup
matches against (kana, pinyin, bopomofo), and its `senses` belong to a dictionary
and hold the glosses, cross-references and tags, so several dictionaries can gloss
one entry. `entry_links` connect characters to their radical and to variants.

- **Japanese**: one entry per JMdict word (`ent_seq`), with every form and
  reading, the part-of-speech tags **per sense**, the `uk` flag (usually written
  in kana) and a priority score derived from JMdict's priority markers.
  Homographs are separate entries, so 為る and 刷る are two results for する.
- **Chinese**: one entry per simplified written form; its traditional forms are
  forms of the same entry (flag `trad`), so 學習 finds 学习. Homograph lines
  (行 xíng / háng) merge into one entry carrying all readings, with one sense per
  CC-CEDICT line.
- **Characters** (kanji and hanzi) are `character` entries with `radical` and
  `variant` links.
- **Frequency** lives in `frequency`, one row per term (optionally tied to one
  reading) with its rank, grouped by pack in `frequency_packs`.

Importers live in `server/internal/dict/` (`jmdict`, `cedict`, `kanjidic2`,
`unihan` and the `json` pack format) and write through one lexicon importer;
frequency packs are in `server/internal/freq`. Imports are idempotent and write
nothing when nothing changed. `entries`, `forms`, `readings`, `senses`,
`entry_links` and `frequency_packs` soft-delete and are picked up by the delta
sync; `frequency` rows are replaced per pack on import and are not synced.

## Frequency data

A frequency pack is a word-frequency list whose ranks order lookup results and
appear as a chip in the popup. Frequency order is optional: with no pack, ranking
falls back to the inflection chain length and the priority score. Packs are
ranked by priority (the order first imported): the first pack that has data for
any of the entries decides the frequency order, and every pack's rank is shown.

- **Bundled**: the Jiten global list (`plugins/data/jiten-frequency`, Japanese),
  CC BY-SA 4.0, credited on the Sources page and in `plugins/data/jiten-frequency/ATTRIBUTION.md`.
- **Local-only**: data with an unclear or restrictive licence is never committed.
  Put it in the gitignored `plugins/data-local/`; `qinqin seed` imports it after
  `plugins/data` when the directory exists. A pack is a directory with a
  `manifest.json` and either a Yomitan frequency dictionary (`format`
  `yomitan-freq`: the downloaded `.zip`, or its unpacked `index.json` and
  `term_meta_bank_*.json`) or a CSV (`format` `freq-csv`: `freq.csv` or
  `freq.csv.gz` with the header `term,reading,rank`):

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

`license` and `attribution` are required. Seed with `qinqin seed` (default roots),
or name the roots: `qinqin seed --packs ../plugins/data,../plugins/data-local`.
Chinese frequency packs are local-only: none is bundled. See
[docs/sources.md](docs/sources.md) for the licence decisions.

## Bundled data

A fresh install can seed offline; the image ships these upstream dictionaries
and frequency list under `/opt/qinqin/packs` (source: `plugins/data/`):

| Pack | Provides | License |
|---|---|---|
| [CC-CEDICT](https://cc-cedict.org) | Mandarin–English words and meanings | CC BY-SA 4.0 |
| [Unihan](https://www.unicode.org/reports/tr38/) | Radical-stroke counts, variant mappings, character definitions | Unicode License v3 |
| [JMdict](https://www.edrdg.org/) | Japanese–English words and meanings | CC BY-SA 4.0 (EDRDG) |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) |
| [Jiten frequency list](https://jiten.moe/frequency-dictionaries) | Japanese word frequency ranks (converted to CSV, ranks unmodified) | CC BY-SA 4.0 (Jitensoft) |

The dictionary files are redistributed **unmodified**; the Jiten list is a
conversion of the published file with unmodified ranks. See
[docs/sources.md](docs/sources.md) for attributions, upstream links, and the
redistribution policy. Stroke-order data (`hanzi-writer-data`, derived from the
Make Me a Hanzi dataset) is licensed under the **Arphic Public License** and is
credited on the app's Sources page. The Reader's script converter `opencc-js`
(`MIT AND Apache-2.0`: MIT code, Apache-2.0 dictionary data from `opencc-data`) is
bundled in the web build, credited on the Sources page, and both licence texts ship
with the app (`/OPENCC-JS-LICENSE.TXT`, `/OPENCC-APACHE-2.0.TXT`).

## Development

Prerequisites: Go 1.26+ and Node.js 24+.

Run the API (it also serves the embedded SPA when one has been built):

```bash
cd server
go run ./cmd/qinqin
```

Optional first-run seed and admin user, in a second terminal:

```bash
cd server
go run ./cmd/qinqin seed --packs ../plugins/data
go run ./cmd/qinqin adduser --admin --username you
```

In a second terminal, run the web app with hot reload. Vite proxies `/api` to
the Go server on `127.0.0.1:8080`:

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev
```

Gates (a slow opt-in test seeds the real bundled packs and checks lookups against
them: `QINQIN_REAL_DATA_TESTS=1 go test ./cmd/qinqin -run RealPacks -v` from `server/`):

```bash
npm --prefix apps/web run check
npm --prefix apps/web test
npm --prefix apps/web run build
cd server && go vet ./... && go test ./...
```

`npm --prefix apps/web run build` writes the SPA to `apps/web/build`; the
Dockerfile copies that directory into the Go binary before compiling.

## Project layout

| Path | Contents |
|---|---|
| `server/` | Go API, SQLite migrations, dictionary and frequency importers (`internal/dict`, `internal/freq`), the lookup engine (`internal/lookup`) and tokenizer (`internal/segment`), and the `qinqin` CLI (`serve`, `seed`, `adduser`) |
| `apps/web/` | SvelteKit SPA (adapter-static) |
| `plugins/data/` | Bundled seed packs (dictionaries and the Jiten frequency list) with their licenses and attribution notices |
| `plugins/data-local/` | Gitignored: local-only packs such as frequency lists with unclear licences |
| `plugins/samples/` | Hand-written sample dictionaries (`zh-mini`, `ja-mini`), not seeded by default: `qinqin seed --packs plugins/samples` |
| `docs/` | Design notes, data sources, and the git-flow guide |
| `scripts/fetch-seeds.sh` | Refreshes the bundled upstream dictionaries (and, via `fetch-jiten-frequency.sh`, the Jiten list: a manual, licence-checked step) |

## Branches

This repository follows git-flow: `main` is production, `develop` is
integration, and work happens on `feature/<name>` branches. See
[docs/git-flow.md](docs/git-flow.md) for branch roles, release/hotfix flows, and
the CI mapping.
