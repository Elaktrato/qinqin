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

On the first run, seed the bundled sample and upstream packs, then create the
admin account:

```bash
docker compose exec qinqin qinqin seed
docker compose exec qinqin qinqin adduser --admin --username you
```

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

- **Hover and selection lookup** — the word under the cursor is resolved by the
  server's longest-match tokenizer (Japanese forms are deinflected), and selecting
  text looks up the selection.
- **Ruby toggle** — furigana in Japanese books can be shown or hidden.
- **Script conversion** — Chinese books can be shown as original, simplified, or
  traditional (converted in the browser with `opencc-js`); lookup works on either.
- **A personal library** — books are stored per user, with the source link and
  attribution shown for each, and the reading position is remembered per book.
- **Import** from Aozora Bunko and Project Gutenberg, or **upload** your own epub.

Open **Reader** in the nav. Import a work from a source (search, then Import) or
upload an epub; for an upload whose epub declares no supported language you pick
Chinese or Japanese. Open a book and hover a word for its entry. Select text to
look it up: a single hanzi or kanji shows the character, longer text shows the
word at the start of the selection. **Escape** closes the popup.

Limits you may hit:

- Epub uploads are capped at 20 MB, and malformed or oversized epubs are rejected.
- One import runs at a time per user; a second one answers "another import is
  already running". A work already in your library is not imported twice.
- Only public-domain Aozora works are offered, and only Chinese and Japanese books
  are supported.
- Webview only for now. Hover needs a mouse; selection lookup also works on touch.

### API

All library and source routes need a signed-in user; the segment routes are public.

| Route | Purpose |
|---|---|
| `GET /api/segment/at?lang=&text=&offset=` | Longest dictionary match at a code-point offset. `text` up to 20000 code points |
| `POST /api/segment` `{lang, text}` | Every match in order. `text` up to 5000 code points, body up to 256 KiB |
| `GET /api/library/books`, `GET`/`DELETE /api/library/books/{id}` | List, read, delete a book |
| `GET /api/library/books/{id}/chapters/{n}` | One chapter's paragraphs |
| `PUT /api/library/books/{id}/position` | Store the reading position |
| `POST /api/library/upload` | Multipart `file` (epub), optional `language` |
| `GET /api/library/sources` | Available sources |
| `GET /api/library/sources/{source}/search?q=&limit=` | Search a source's catalog (limit up to 100) |
| `POST /api/library/sources/{source}/import` `{sourceId}` | Import one work |

`lang` must be `zh` or `ja`, and offsets count Unicode code points, not bytes or
UTF-16 units.

### Operations

Imports run on the server, only when a user asks, one work per request. Requests
to the sources send `User-Agent: qinqin/dev (+https://github.com/Elaktrato/qinqin)`,
are limited to one per second per host, and are cached under `<data>/cache/sources`
(catalogs for 7 days, works for 1 day). Books live under `<data>/books/<user id>/`,
with their metadata and reading position in the SQLite database.

The source client only fetches `https` URLs from a host allow-list (Aozora Bunko
and its GitHub mirror, Gutenberg), checks every redirect hop, and refuses
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

## Bundled data

A fresh install can seed offline; the image ships these upstream dictionaries
under `/opt/qinqin/packs` (source: `plugins/data/`):

| Pack | Provides | License |
|---|---|---|
| [CC-CEDICT](https://cc-cedict.org) | Mandarin–English words and meanings | CC BY-SA 4.0 |
| [Unihan](https://www.unicode.org/reports/tr38/) | Radical-stroke counts, variant mappings, character definitions | Unicode License v3 |
| [JMdict](https://www.edrdg.org/) | Japanese–English words and meanings | CC BY-SA 4.0 (EDRDG) |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) |

The files are redistributed **unmodified**. See
[docs/sources.md](docs/sources.md) for attributions, upstream links, and the
redistribution policy. Stroke-order data (`hanzi-writer-data`, derived from the
Make Me a Hanzi dataset) is licensed under the **Arphic Public License** and is
credited on the app's Sources page.

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

Gates:

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
| `server/` | Go API, SQLite migrations, pack importers, and the `qinqin` CLI (`serve`, `seed`, `adduser`) |
| `apps/web/` | SvelteKit SPA (adapter-static) |
| `plugins/data/` | Bundled seed packs with their licenses and attribution notices |
| `docs/` | Design notes, data sources, and the git-flow guide |
| `scripts/fetch-seeds.sh` | Refreshes the bundled upstream dictionaries |

## Branches

This repository follows git-flow: `main` is production, `develop` is
integration, and work happens on `feature/<name>` branches. See
[docs/git-flow.md](docs/git-flow.md) for branch roles, release/hotfix flows, and
the CI mapping.
