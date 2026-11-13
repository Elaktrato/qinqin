# qinqin

qinqin (written 勤勤 in hanzi, pronounced qínqín) is a self-hosted platform for studying Chinese and Japanese. It combines
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
  grading; the flashcards plugin derives FSRS schedules and EXP/levels from the
  event log.
- **Activity heatmap** — the home page shows 13 weeks of learning activity per
  workspace, adding up flashcard reviews and reading time in the Reader.
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

`/study` is the session setup. Choose the decks to draw from, the card types, and
the new-card and review limits. At least one type must be selected, and Vocab is
optional. A session queues only the selected types, so a Tone-only session never
shows a vocab card. The setup is kept for the browser tab when a session starts,
and the card types you last started are preselected in new tabs of the same
workspace (the home widget counts the same types).

| Type | What you do | Needs |
|---|---|---|
| **Vocab** | See the word, its readings and the example sentence with the word blanked, then **Show answer** for the meanings | any word |
| **Word Salad** | Rebuild the example sentence from shuffled tiles: tap a tile to place it, tap a placed tile to remove it, **Undo**, **Check**, or **Show answer** | an example sentence |
| **Writing** | Draw each Han character stroke by stroke (order and direction are checked); **Reveal character** animates it | Han characters with bundled stroke data; kana stay visible |
| **Tone** | Swipe each syllable pad in the tone's shape, use the tone buttons, or press 1–5 | a Chinese word with pinyin (Chinese workspaces only) |

Sentence, writing and tone cards are **companions** of the vocab cards in the
chosen decks. They are planned as virtual cards that share the new-card limit, and
each one is created only when you grade it for the first time. Abandoning a
session therefore creates nothing. A word that does not qualify (no sentence, no
drawable character, no pinyin) is skipped silently when its turn comes, and the
next planned companion takes its place (up to `max(30, 2 × new limit)` times per
session); the tab remembers such words (except a Han word whose stroke data is missing or
failed to load) and skips them in later sessions. Each word
gets at most one sentence card, built from its first example sentence; if that
sentence later disappears, the card shows the word's first sentence instead.
Companions are planned in deck sessions only.

**Word Salad tiers** follow the card's FSRS stability *S*, which is derived and
never stored:

- **T0** (new, or *S* < 4 days): word tiles, translation shown.
- **T1** (*S* < 21 days): word tiles, translation hidden behind a reveal. Revealing
  it counts as a hint.
- **T2** (*S* ≥ 21 days): every word is split into single characters.

Tiles come from the tokenizer (`POST /api/segment`). If that call fails, each
character becomes its own tile.

**Tone swipes:**

- up = 1
- up-right or right = 2
- down then back up = 3
- down-right, down, down-left or left = 4
- a tap = neutral (5)

A polyphone accepts any of its listed readings, so 行 can be háng or xíng.

**Grading.** Grade every card **Again**, **Hard**, **Good** or **Easy** (keys 1–4).
After a check, the exercise suggests a grade: it highlights and focuses that button,
but never submits it. Easy is never suggested.

| Type | Good | Hard | Again |
|---|---|---|---|
| Word Salad | right on the first check | right after 1–2 wrong checks | 3 or more wrong checks, or **Show answer** |
| Writing | no mistakes | mistakes on at most 25 % of the strokes | more mistakes, or any revealed character |
| Tone | all tones right | one tone wrong | two or more wrong |

Writing shows the outline as a hint after 3 misses on one stroke. Each new
character starts again without the outline.

| Card | Keys |
|---|---|
| Vocab | Space or Enter shows the answer, then 1–4 grade |
| Word Salad | Tap tiles or use Tab/Enter, then **Check**; 1–4 grade only once checked |
| Writing | Draw with mouse, pen or touch; 1–4 grade once every character is done |
| Tone | 1–5 set the tone of the highlighted syllable (5 = neutral), ←/→ move, Backspace clears, Enter checks, then 1–4 grade |

Each grade is appended to the study-event log with the card kind as `mode` and
details in `meta` (Word Salad tier, mistakes, hints, duration). FSRS derives the
next due date from the card's whole review history. Schedules are never stored,
so two devices merge cleanly by event id.

**XP, levels and streaks** are derived from the review log per workspace. Each
review is worth base XP by kind plus a grade bonus:

- Base XP: Vocab 10, Word Salad 15, Writing 20, Tone 8.
- Grade bonus: Good +5, Easy +10, Again and Hard +0.
- Daily bonus: +10 for each UTC day with at least one review.

Going from level *L* to *L*+1 costs 100·*L* XP, so level 2 starts at 100 XP,
level 3 at 300 and level 4 at 600. The streak counts consecutive UTC days with a
review. The session summary shows XP by type, the level bar and the streak. A
study-buddy mascot appears in the widget and the summary: its stage grows at levels
5, 10 and 20, and its mood follows the streak. The art is not bundled. Drop
`static/mascot/<stage>-<mood>.svg` files in to replace the built-in placeholder.

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

For each workspace, the flashcards home widget shows:

- what is due and new
- the level and XP progress
- the streak
- the study buddy

Above the plugin widgets, the home page has a core activity heatmap for the
current workspace: one cell per UTC day over the last 13 weeks, coloured by
activity points. A flashcard review is one point. Reading in the Reader is one
point per started 5 minutes; the reader records a `read` event with the active
seconds of each reading burst. A burst under 30 s is not recorded, an idle gap
between inputs counts at most 2 minutes, and a hidden tab does not count.
Reading is credited to the workspace matching the book's language, else to the
selected one. Hovering a cell shows the day's points per source,
with reading in minutes. Other study events (sessions, views, lookups) do not
count. Adding a source means emitting a study event with a new type and adding
one entry to `ACTIVITY_SOURCES` in `apps/web/src/lib/activity/activity.ts`.

Studying adds no bundled data. Decks and cards are workspace plugin data and
reviews are events, so the dictionaries in `plugins/data/` stay unmodified.

See the [design doc](docs/superpowers/specs/2026-11-12-flashcards-design.md) for
the full model and its implementation notes (known limits). Two issues track the
work: [issue #24](https://github.com/Elaktrato/qinqin/issues/24) shipped the level
sessions and mastery map, and
[issue #25](https://github.com/Elaktrato/qinqin/issues/25) the Round 3 exercises.

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
