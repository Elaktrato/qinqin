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
- **Workspaces** — keep Chinese and Japanese study separate, or split one
  language into several named workspaces; each has its own flag, decks, library
  and statistics (see [Workspaces](#workspaces)).
- **Search** — across written forms, readings, and meanings, scoped to the
  current workspace language.
- **Yomitan-style lookup** — in the Reader, hovering a word shows a ranked stack
  of dictionary entries with frequency chips, and popups open from inside popups.
- **Editing** — correct written forms and readings per user without mutating
  the shared dictionary data.
- **Study mode** — add any word from its entry page and review it with Anki-style
  grading; the flashcards plugin derives FSRS schedules and EXP/levels from the
  event log.
- **Reader library, bookmarks and highlights** — each workspace has its own
  library of imported books, a tabbed importer with daily suggestions, and
  per-book bookmarks, highlights and notes (see [Reader](#reader)).
- **Home widgets** — the home page renders widgets from a per-user layout stored
  on the server (shared by every device and workspace; by default the activity
  heatmap, then the flashcards summary). A widget that does not apply to the
  current language, or whose plugin is disabled, is left out. **Settings → Home**
  (`/settings?tab=home`) chooses and orders them: an "On the home page" switch
  per widget, **Move up** / **Move down** buttons (or drag a row by its handle),
  a preview of the result and **Reset to default**. Changes save at once, to
  your account, so every device and workspace gets them. A widget whose plugin
  is disabled keeps its place in the stored layout and returns when the plugin
  is enabled again; one that does not fit the active workspace's language is
  marked "Not available for <language>" and can still be placed for the others.
- **Activity heatmap** — a home widget showing 13 weeks of learning activity,
  adding up flashcard reviews, reading time in the Reader and journal entries.
  It shows the active workspace by default; "All workspaces" switches to the
  combined view (tooltips then name each workspace), and a chip per activity
  type hides or shows that type. The choice is remembered per user on every
  device. Plugins contribute activity through an `events[].activity` rule in
  their manifest (`label`, `describe`, and optionally `measure` + `pointsPer`
  or `distinctBy`); the server scores it, no core change is needed.
- **Stats** — a nav item for every workspace (`/stats`) with two tabs:
  **Overview** shows every widget that applies to the workspace, in a fixed
  order (core first, then plugins); **Characters** (`/stats/characters`) is the
  mastery map, for Chinese and Japanese workspaces only.
- **Journal and AI** — write dated entries per workspace; with your own
  key for the AI provider you choose (Anthropic, OpenAI, Google Gemini,
  DeepSeek, Mistral, xAI, Groq, OpenRouter or a custom OpenAI-compatible
  endpoint), get a review with underlined corrections, topic ideas, and
  photo import with offline (Tesseract) or AI transcription (see
  [Journal and AI](#journal-and-ai)).
- **Plugin architecture** — dictionaries, level schemes, and example sentences
  are installable data packs; widgets and views come from feature plugins that
  the server registers at startup so Settings can enable them.

## Quick start (Docker Compose / Portainer)

The stack is a single service. For a production deployment on Portainer see [Deploying with Portainer](#deploying-with-portainer). In Portainer, create a stack from
[`docker-compose.yml`](docker-compose.yml); or from this repository (Docker with
the Compose plugin required) run:

```bash
docker compose up -d
```

On the first run, seed the bundled packs (the upstream dictionaries, the Jiten
frequency list and the HSK 3.0 character, HSK 3.0 word and JLPT kanji level lists), then create the admin account:

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

> **Upgrading from the earlier reader.** Migrations 018–023 run in place on an
> existing database and keep all data. 018 rebuilds `workspaces` with an optional
> `name` and `UNIQUE(user_id, language, name)` (ids unchanged, so events and plugin
> data still point at their workspace). 019 adds `library_books.workspace_id`: each
> existing book is linked to its user's oldest workspace of the book's language,
> and one is created when the user has none. 020 adds `library_bookmarks`. 021 adds
> `library_highlights`. 022 and 023 rebuild `workspaces` and `library_books` with
> `AUTOINCREMENT`, so the id of a deleted workspace or book is never handed out
> again (a stale browser tab then gets a 404 instead of silently writing into
> someone else's new workspace or book). The rebuilds keep every row and id.
> All of these migrations are one-way: there is no downgrade, so keep a copy of
> `qinqin.db` before upgrading if you may want to go back.

> **Upgrading to pack notices (migration 024).** 024 adds a `notice` column to
> dictionaries, frequency packs and level schemes, empty for every installed
> pack. The Sources page shows a pack's longer caveats (the HSK lists' CTI terms,
> the approximate JLPT levels, the Jiten note) from that stored copy, so they
> stay missing until you re-seed once after upgrading: `qinqin seed`, or under
> Docker `docker compose exec qinqin qinqin seed`. The re-seed rewrites only the
> registry rows whose terms changed. At start-up `qinqin serve` compares each
> installed pack with its manifest under the pack roots (`$QINQIN_PACKS`, or
> `plugins/data` and `plugins/data-local`) and logs
> `pack <id>: stored license/attribution/notice differs from <manifest>; run "qinqin seed" to refresh`
> for every pack whose stored licence, attribution or notice is out of date. It
> only reads: nothing changes until you seed, and the warning goes away once the
> stored copies match. A pack it cannot read is skipped with a log line.

> **Upgrading from v0.1.0 or an older development database.** Entry ids changed with
> the dictionary rebuild (the lookup rewrite; migration 017 drops the legacy tables
> and moves no data). There is no upgrade path for entry data, including v0.1.0
> databases: **start from a fresh data directory (or at least delete `qinqin.db`)
> and seed again.** On an old database the restart and re-seed
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

## Release images and versions

CI publishes `ghcr.io/elaktrato/qinqin` on pushes to `main` and on `v*` tags
(`develop` pushes only run tests). Tags: `latest` (the newest `main` build),
`v<version>` for a release tag, and `sha-<commit>`. For production pin a `v*`
tag in `QINQIN_IMAGE` rather than `latest`, so a redeploy never changes the
version by surprise. The published image is the full build: Tesseract OCR
(about +193 MB) and the Kanji alive audio (about +70 MB). Self-builds can drop
them with `--build-arg WITH_OCR=0` / `WITH_AUDIO=0`.

## Deploying with Portainer

[`deploy/portainer-stack.yml`](deploy/portainer-stack.yml) differs from the
quick-start `docker-compose.yml`: a named volume instead of `./data`
(relative bind mounts depend on where Portainer checks the stack out), a
required `QINQIN_SECRET` (the deployment fails if it is unset), memory/CPU
limits (1 GiB, 2 CPUs), log rotation (3 x 10 MB) and `no-new-privileges`.
It does not set `user:` or `read_only:`: the image has no `USER` (it runs as
root) and the server writes temporary files to `/tmp` (OCR input, pack
uploads), so a read-only root filesystem is not enabled.

1. **Generate the secret** and store it in your password manager:
   `head -c 32 /dev/urandom | base64`. It encrypts the users' AI API keys.
   Back it up **separately** from the data volume; it is never written to
   `/data`. Lose it and users must enter their keys again.
2. **Add the stack.** Portainer: Stacks, Add stack. Either *Web editor* and
   paste `deploy/portainer-stack.yml`, or *Repository* with URL
   `https://github.com/Elaktrato/qinqin`, reference `refs/heads/main` (or a
   tag) and compose path `deploy/portainer-stack.yml`.
3. **Environment variables** (stack form): `QINQIN_SECRET` (required),
   `QINQIN_IMAGE` (e.g. `ghcr.io/elaktrato/qinqin:v1.2.3`), `QINQIN_PORT`
   (host port, default 8080). Optional: `QINQIN_DATA_VOLUME` as an absolute
   host path (e.g. `/srv/qinqin/data`) to bind-mount a directory instead of the
   named volume; the directory must exist and be writable by root.
   `QINQIN_SECRET_PREVIOUS` only while rotating the secret.
   `QINQIN_AI_PROVIDERS` limits which AI providers users may choose
   (default: all; see [Journal and AI](#journal-and-ai)),
   `QINQIN_AI_ALLOW_PRIVATE=1` lets an admin register AI endpoints on private
   addresses, and `QINQIN_AI_PROVIDER=fake` is for testing only. Deploy the
   stack.
4. **First run, before exposing the port beyond your LAN** (until a user
   exists, the first registration over the API becomes admin). Portainer:
   Containers, `qinqin`, Console, command `/bin/sh`, Connect. Then:

   ```sh
   qinqin seed
   qinqin adduser --username <name> --admin
   ```

   `adduser` prompts for the password and needs a TTY; Portainer's console
   provides one (the typed password is echoed). `seed` installs the bundled
   packs from the image (CC-CEDICT, Unihan, JMdict, KANJIDIC2, Jiten
   frequencies, HSK 3.0 and JLPT kanji level lists, es-demo, and the Kanji
   alive audio when present) into the database; it takes under a minute
   (about 45 s measured) and is idempotent. Run it while nobody uses the app.
5. Put a reverse proxy with HTTPS in front (below), then run the checklist.

### Data directory

Everything lives in `/data` (the volume):

| Path | Content |
|---|---|
| `qinqin.db` (+ `-wal`, `-shm`) | SQLite database: users, entries, dictionaries, flashcards, journal, plugin data |
| `packs/` | packs installed by an admin through the UI |
| `audio/` | audio blobs imported by seed or packs |
| `books/<user id>/` | uploaded and imported library books |
| `journal/<user id>/` | draft photos, deleted when the draft ends |
| `cache/sources/` | cache of the Aozora/Gutenberg imports; safe to delete |

The bundled packs themselves stay in the image (`/opt/qinqin/packs`,
`/opt/qinqin/audio`).

### Backup

The app has no backup command or endpoint yet (open issue
[#61](https://github.com/Elaktrato/qinqin/issues/61)). Copying the live
database can miss the WAL, so: stop the stack's container in Portainer, copy the
whole volume, start it again. For a named volume, with the container stopped:

```sh
docker run --rm -v <stack>_qinqin-data:/data:ro -v "$PWD":/out alpine \
  tar czf /out/qinqin-data-$(date +%F).tgz -C /data .
```

(`docker volume ls` shows the real name; Portainer prefixes the stack name.)
With a host path, copy that directory. Restore by extracting into an empty
volume while the container is stopped. Keep `QINQIN_SECRET` backed up
separately.

### Upgrading

Back up first. Change the tag in `QINQIN_IMAGE` (or pull `latest`) and
redeploy with *Pull latest image* enabled. Migrations are embedded in the
binary and applied automatically at start (`server/internal/db`); they are
one-way. **Downgrading is not supported**: going back to an older image needs
the pre-upgrade backup. After an upgrade the log may say
`pack <id>: stored ... differs`; run `qinqin seed` in the console to refresh.

### Reverse proxy and HTTPS

The app speaks plain HTTP on 8080. Browser features that need a secure context
may not work over plain HTTP from other devices, so serve it over HTTPS. No
WebSocket is used. The server does not read client IPs or
`X-Forwarded-*` headers anywhere (no per-IP limits; limits are per user), so
no trusted-proxy setting exists. Pack uploads go up to 128 MiB and an AI
review can take up to 170 s, so the proxy needs a body limit of at least
130 MB and a read timeout of at least 180 s.

Caddy (defaults are fine: no body limit, 0 response timeout):

```
qinqin.example.com {
    reverse_proxy qinqin:8080
}
```

Traefik labels (container on the proxy's network; no default body limit):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.qinqin.rule=Host(`qinqin.example.com`)
  - traefik.http.routers.qinqin.entrypoints=websecure
  - traefik.http.routers.qinqin.tls.certresolver=letsencrypt
  - traefik.http.services.qinqin.loadbalancer.server.port=8080
```

(Raise Traefik's `respondingTimeouts.readTimeout`/`writeTimeout` on the
entrypoint if you set them below 180 s.) Add `networks:` to the stack to join
the proxy's network; the file does not.

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 130m;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    # Optional: stream uploads instead of buffering them to disk first.
    # proxy_request_buffering off;
}
```

### AI journal

Each user opens Settings, AI, picks a provider and enters their own API key for
it; qinqin ships none. Journal text (up to 5,000 characters), study history
snippets and photos **leave the server for the provider the user made active**
when they press an AI button. Models differ a lot in price: the defaults are
`claude-opus-5-5` for Anthropic and the providers' flagship models elsewhere,
the most expensive choices, so tell users to pick a cheaper model in Settings if
cost matters (calls are limited to 30 per user and hour across all providers).

- `QINQIN_AI_PROVIDERS` is a comma list of the built-in ids (`anthropic`,
  `openai`, `gemini`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter`) and
  `custom`; only those can be chosen. Unset means all. If you pinned
  `QINQIN_AI_PROVIDER=anthropic` before, that now means
  `QINQIN_AI_PROVIDERS=anthropic` (a log line says so), so an upgrade never
  sends text to a provider you did not allow.
- Admins can register OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, a
  company gateway) in Settings, AI. Addresses on a private network are refused
  unless you set `QINQIN_AI_ALLOW_PRIVATE=1`; link-local, cloud-metadata and
  multicast addresses are never allowed. See [Custom endpoints](#custom-ai-endpoints).
- Without a valid `QINQIN_SECRET`, AI shows as disabled with the reason.

### Checklist after deploying

- `curl http://<host>:<port>/healthz` returns `ok`; Portainer shows the
  container `healthy`.
- Log in as the admin created in step 4.
- Search `好`: results appear (the seed ran).
- Create a deck/flashcard.
- Journal: with the fake provider off (`QINQIN_AI_PROVIDER` unset), Settings,
  AI lists the providers and shows a key as storable; save a key (it becomes
  the active provider) and run a review.
- The container log shows `AI: QINQIN_SECRET ok`.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Stack will not deploy: "required variable QINQIN_SECRET is missing" | Set it in the stack's environment variables |
| Container restarting | Read its log. Bad host path in `QINQIN_DATA_VOLUME` or no write permission (`create data directory ...`); fix ownership (the image runs as root) |
| Log: `QINQIN_SECRET ... not 32 bytes of base64` / AI disabled | Regenerate with `head -c 32 /dev/urandom | base64`; without it AI stays off, the app still works |
| AI settings say there is no secret | `QINQIN_SECRET` unset or invalid when the container started; fix and redeploy |
| 413 on upload (pack, book, photo) | Proxy body limit: `client_max_body_size 130m` |
| 502/504 on an AI review | Proxy timeout below 180 s |
| "port is already allocated" | Change `QINQIN_PORT` |
| Unhealthy | `wget` against `127.0.0.1:8080/healthz` inside the container; see the log; a slow first start can exceed the 15 s start period on a slow disk |
| "database is locked" during seed | Seed while the app is idle (5 s busy timeout) |

## Workspaces

A workspace is one study space with its own language, decks, cards, study events
and reader library. A user can have several workspaces of the same language
(for example two Chinese ones, "Novels" and "HSK"); the optional name tells them
apart and is unique per language (at most 40 characters, no control or invisible
characters; ZWJ, ZWNJ and emoji tag sequences are allowed). Without a name, a
workspace shows its language; unnamed workspaces of one language are numbered
("Chinese", "Chinese 2").

- **Flags.** The header picker and Settings show a flag per language: China for
  `zh`, Japan for `ja`, Spain for `es`, a globe for any other language. A single
  unnamed workspace shows only its flag.
- **Creating.** The language list comes from `GET /api/languages`, which lists
  every known language: the code packs (`zh`, `ja`), the languages an admin
  registered and the ones with installed data, as `{code, name, installed, kind}`
  (`kind` is `code` or `data`; `installed` is true only with live dictionary
  data). The create form marks those without a dictionary "(no dictionary
  installed)". Android clients should list the same union, flag or filter on
  `installed`, and label languages from the code, not from `name`.
  `POST /api/workspaces` answers `422` "language must be a code like es or
  pt-br" for a malformed code, and, for a non-admin, `422` "unknown language —
  ask the administrator to add it" for a code that is not known (a code pack, a
  registered language, installed data or any live pack of that language); only an
  admin's request registers a new code. A code that exactly matches a stored one
  keeps its spelling.
- **Hidden dictionaries.** A workspace can hide dictionaries of its language from
  entries and lookups: `settings.hiddenDictionaries` is an array of dictionary ids
  (`GET /api/dictionaries`); malformed values are ignored. The web filters in the
  browser, the server does not.
- **Language administration** (admin token; `403` otherwise):
  `POST /api/admin/languages {code}` registers a data-only language (`201`, or
  `200` if present; `422` for a malformed code; `409` "<code> is built in" for a
  code pack). `DELETE /api/admin/languages/{code}` removes an unused one (`204`;
  `404` unknown; `409` for a code pack or "still used by: <kinds>" naming what
  uses it, never who). `GET /api/admin/languages/usage` returns
  `[{code, workspaces}]`, workspace counts per language across all users
  (aggregate only).
- **Defaults.** A user with no workspace gets one unnamed workspace per installed
  language on their first `GET /api/workspaces`. A user who already has a
  workspace is never touched.
- **Switching** happens in the workspace picker in the header (it can also create
  one). **Settings** and **Sources** live in the footer of every signed-in page, not in the nav;
  Settings has three tabs, Workspaces (create, rename, delete), Home (the home
  page widgets) and Plugins, each with a link of its own (`/settings?tab=home`,
  `?tab=plugins`). The logo is the home link (there
  is no Home item); every nav item has an icon, and below 720 px the nav becomes a
  bottom tab bar. The nav has **Stats** (bar-chart icon) for every workspace; it
  replaced the former **Map** item, which showed only in zh and ja workspaces.
- **Public pages.** The Sources page (`/sources`) is open to everyone, signed in
  or not, so the licence and attribution credits are always reachable. Signed out
  it shows a minimal header (the logo and a **Sign in** link) and the footer, with
  no nav, workspace picker or other private page; signed in it has the usual
  shell. A stale token there signs the user out quietly instead of redirecting.
  `/login` and `/register` are for signed-out visitors only; every other page
  needs a signed-in user. The rules live in `apps/web/src/lib/routeAccess.ts`.
- **Navigation and focus.** The first Tab stop on every signed-in page (and on the
  public Sources page) is a "Skip to content" link, which moves focus to the page content. The logo is
  named "qinqin, home". Below 720 px, while the bottom tab bar is shown, the page
  keeps scroll padding below the focus so a focused control or map cell is not
  hidden behind the bar.
- **Deleting.** Settings shows a **Delete** button on each workspace while the
  user has more than one. A modal dialog lists what goes (books with their
  bookmarks and highlights, flashcards and decks, recorded reviews and the rest
  of the study history, as counts) and asks you to type the workspace label to
  confirm. `DELETE /api/workspaces/{id}` removes the workspace with all
  its study events, its plugin data (including tombstones) and its library books
  with their bookmarks, highlights and content files, in one transaction; the
  response is 204, 404 for an unknown or foreign id, and 409 for the caller's
  last workspace, which cannot be deleted. Data that belongs to the user rather
  than a workspace (your edits, your own example sentences, plugin on/off states
  and user-global plugin data) stays. In another tab that still shows the deleted
  workspace, the next request that answers "workspace not found" shows a notice
  ("This workspace was deleted — switched to ...") and falls back to your first
  workspace; reviews queued offline for it are dropped with a notice.
- **The map** (Stats → Characters, `/stats/characters`, and the Study page link)
  exists only in zh and ja workspaces: the Characters tab is hidden elsewhere,
  and a direct visit explains this and links to the Overview. The old URL
  `/study/map` redirects to `/stats/characters` (the history entry is replaced).

## Reader

The Reader library belongs to a workspace: the library page lists the current
workspace's books only, and a book's reading time counts towards its workspace.
When the current library is empty but other workspaces hold books, the page
lists them with a button to switch there.
An upload or import needs a workspace whose language matches the book (a Chinese
book cannot go into a Japanese workspace; the API answers 422 and the page asks
you to switch). The same epub may live in several workspaces as separate copies.

The importer (**Sources**) has one tab per source. The first source that serves
the workspace language is selected, so a Chinese workspace opens on Gutenberg and
a Japanese one on Aozora.

- **Suggestions.** Each tab shows 12 suggested works, seeded by the UTC date so
  they stay the same all day. **Shuffle** draws another set.
- **Search** matches the title and author as written, and also by reading:
  romaji for Aozora (`tokyo`, `Tōkyō` and `toukyou` find 東京), pinyin for
  Gutenberg Chinese works (`hong lou meng`, `hóng-lóu-mèng`). A matching reading is
  shown under the hit. A reading query needs at least 3 letters (after folding
  long vowels, so `tou` is too short); written-form matches always rank first.
- Romaji folding: kunrei-shiki and Nihon-shiki spellings fold to Hepburn
  (`si`, `tu`, `syu`, `tyuu`, `hu` find the same titles as `shi`, `tsu`, `shu`,
  `chuu`, `fu`), and `wo` folds to `o`. The particles は and へ are read as
  `ha` and `he`, so a standalone, space-separated `wa` or `e` is folded to
  `ha` or `he`, and so are `konnichiwa` and `konbanwa`: `wagahai wa neko de aru`
  finds 吾輩は猫である. Particles are not recognised inside hyphenated pieces
  (`watashi-wa` stays `watashiwa` and does not find わたしは) or inside a
  longer word such as `wagahaiwa`. The minimum of 3 folded characters is
  unchanged.
- Known limits: Gutenberg
  Japanese titles are not searchable by reading, and neither are Gutenberg
  Chinese works whose pinyin could not be indexed in time (the index is built
  when the catalog loads, every 7 days).
- A result in another language shows "Needs a <language> workspace" instead of
  Import.

**Add to study from the popup.** Every entry in the Reader's lookup popup has a
**+** button that adds the word to the General deck of the book's workspace. The
**⋯** deck menu appears only when the workspace has custom decks. The sentence of
the book around the word (up to 200 characters, cut at 。！？ and similar
terminators) is saved as the user's own example sentence on the entry and linked
to the card; an identical sentence is reused. A sentence that cannot be saved
leaves the card without one and says so. Example sentences saved by a user are
private to that user: other users, and anonymous callers, see only the pack's
sentences.

**Side rail.** Beside the text sits a rail with two tabs, **Bookmarks** and
**Highlights**. On screens 1000 px and wider it is a column next to the text that
can be collapsed to a thin tab strip; below 1000 px it is a drawer on the right
edge, opened from a floating button and closed by Escape or a click outside. The
open/closed state and the last tab are remembered in the browser. The reading
toolbar is a plain strip at the top of the page; it is not sticky.

**Bookmarks.** The rail's **Add bookmark here** button (or the `b` key) bookmarks
the first paragraph in view and toggles it off again. The Bookmarks tab lists them
in book order, with jump, inline rename and delete; a bookmarked paragraph gets a
marker in the left margin. A bookmark stores a position (`<chapter>:<paragraph>`)
and a label (the paragraph's beginning, at most 120 characters). Each book holds up
to 200 bookmarks.

**Highlights and notes.** Select text in a paragraph: the popup shows a colour bar
(yellow, green, blue, pink) and a **Note** button. A colour highlights the
selection; **Note** highlights it and opens the note editor. The `h` key
highlights the current selection too, and clicking a highlight opens a small
editor (colour, note, delete). Highlights are listed in the rail's Highlights tab.
A highlight stays within one paragraph, cannot overlap another highlight, and
covers at most 500 characters; a note holds up to 2000 characters, and a book up
to 2000 highlights. A highlight stores its position and the exact text it covered;
when the paragraph no longer matches that text (for example after switching
between simplified and traditional characters) it is marked with a **text changed**
badge instead of being shown in the wrong place. Highlights and notes are private
to the user and go with their book.

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

Stats → Characters (`/stats/characters`, formerly `/study/map`) is the Hanzi/Kanji map for the current workspace language. It lists
every character of the language, studied or not, shaded by mastery.

- **Universe.** Japanese: all 13,108 KANJIDIC2 kanji. Chinese: about 11.1k
  characters, the standard characters list (通用规范汉字表) plus every character
  with a CC-CEDICT reading, single Han characters only. A traditional form shares
  its simplified character's cell: a card written 愛 colours the 爱 cell.
- **Group by.** The choice is remembered per language; the default is Grade
  (Japanese) or Common (Chinese). Japanese: Grade, Frequency, Strokes, "JLPT
  kanji (approximate)" (N5–N1, the bundled `jlpt-kanji` pack) and, when you have installed
  the optional local JLPT vocabulary pack (not bundled, see "Bundled data"),
  "JLPT (vocabulary)" (the N5–N1 word lists of `jlpt-words`). Chinese: Common (GB2312 level 1, level 2,
  other standard, other), HK primary grade, Strokes, "HSK 3.0 (characters)" (the
  bundled `hsk-chars` pack: the official character list of the HSK syllabus,
  each character at the level whose 认读字 list introduces it) and "HSK 3.0
  (words)" (the bundled `hsk-words` pack: the official word list), both HSK 1–6
  and HSK 7–9. A word list is shown as the characters its words are written with,
  each at the lowest level of a word it appears in (爱 is HSK 1 because 爱 is an
  HSK 1 word; 傲 is HSK 4 through 骄傲); for the HSK lists the two groupings
  agree on all but 3 of 3,088 characters. Every installed level scheme
  that is not a sample pack is offered the same way, under its name; characters
  outside it land in "Not in this scheme".
- **Sections** show learned/total and a stacked stage bar. The stage legend doubles
  as a filter (All, Not studied, In progress, Learned). Search matches the glyph,
  the reading (toneless pinyin works), the meaning, and hiragana or katakana.
  Jump to character opens its section and focuses the cell.
- **Cells.** Colour is the character's mastery band: grey for not studied, then
  red, amber, blue, and green for started, growing, solid, and learned. Non-colour
  markers back this up: a tick for learned, a dashed outline for unseen. A popover
  shows reading, meaning, variants, stage, score and card count (hover, focus, or
  first tap on touch). The grid is keyboard-navigable: arrows, Home/End, Ctrl+Home/End;
  Enter opens the entry. Large sections render lazily in batches.
- **Score.** A character's 0–100 score is the mean over every reviewed card whose
  word contains it of how firmly that card's schedule has settled, with a year of
  FSRS stability counting fully; characters at 80 or above count as learned. The
  map is derived from your cards and review events, so nothing schedule-shaped is
  stored for it either.

The grade, frequency and standard-list fields come from the importers. A
database seeded before this change needs `qinqin seed` (under Docker,
`docker compose exec qinqin qinqin seed`) to fill them; until then the page shows a
"Level data missing" banner and lists the characters in one section.

The JLPT kanji levels and the HSK 3.0 character and word levels are bundled level packs
(see "Bundled data"); a database seeded before they were added needs
`qinqin seed` to install them. The JLPT kanji levels are approximate:
kanjiapi.dev's list, plus a level qinqin derives from KANJIDIC2 for the kanji
that list omits (see docs/sources.md); a re-seed of an older database renames
the scheme and updates its levels in place. HSK words carry an "HSK 3.0 (words)" badge
with their level in lookups and on entries; their characters get the
lowest level of the words they are written with (derived at import time). The
pre-2010 four-level JLPT scale that KANJIDIC2 carries is no longer imported or
offered; a re-seed removes it from the character entries. To add another list,
put a level pack under `plugins/data-local/<id>/` (see [docs/sources.md](docs/sources.md),
"Local-only data") and run `qinqin seed`, with `--packs plugins/data,plugins/data-local`
if you name the roots. A pack is a directory with a `manifest.json` (`"type": "levels"`,
`"language": "zh"`, `"format": "json"`, plus `id`, `name`, `version`, `license`,
`attribution`) and a `levels.json` like
`{"unit": "word", "levels": [{"name": "1", "entries": ["你好", "谢谢"]}]}`; `unit` is
`word` or `character`. See `plugins/samples/hsk-mini` for the layout. The sample
`hsk-mini` and `jlpt-mini` packs are not seeded by default and not offered as map groupings.

**Home and Stats widgets.** Five widgets ship. Each one shows the current
workspace. The home page shows the widgets in your layout (Settings → Home; by
default Activity, then Flashcards). Stats → Overview shows every widget that
applies to the workspace, in the order of this table:

| Id | Widget | Owner | Size | Languages |
|---|---|---|---|---|
| `activity-heatmap` | Activity | core | wide | all |
| `character-map-summary` | Characters | core | normal | Chinese, Japanese |
| `flashcards-summary` | Flashcards | `qinqin-flashcards` | normal | all |
| `word-states` | Words | `qinqin-flashcards` | normal | all |
| `reading-time` | Reading time | `qinqin-reader` | normal | all |

A plugin's widgets are shown only while that plugin is enabled.

- **Activity**: one cell per UTC day over the last 13 weeks, coloured by
  activity points. A flashcard review is one point. Reading in the Reader is one
  point per started 5 minutes. The reader records a `read` event with the active
  seconds of each reading burst. A burst under 30 s is not recorded, an idle gap
  between inputs counts at most 2 minutes, and a hidden tab does not count.
  Reading is credited to the workspace of the book. Hover a cell to see the
  day's points per source, with reading in minutes. Other study events
  (sessions, views, lookups) do not count. To add a source, emit a study event
  of a new type and add one entry to `ACTIVITY_SOURCES` in
  `apps/web/src/lib/activity/activity.ts`.
- **Characters**: "N of M learned" for the language's characters (the same
  universe and mastery as the map, see below; learned is a mastery of 80/100
  or more). It also shows the stage bar (Not studied, Started, Growing, Solid,
  Learned) and a link to the full map. Shown only for Chinese and Japanese
  workspaces.
- **Flashcards**: what is due and new (with the limits and card types of your
  study setup), the level and XP progress, the streak and the study buddy.
- **Words**: how far each word has come, from the flashcard schedule. A word is
  one vocabulary card. Sentence, writing and tone cards practise a word that is
  already counted, so they are left out. The states are:
  - **New**: never reviewed.
  - **Learning**: in the FSRS learning or relearning state.
  - **Young**: in review with a stability under 21 days.
  - **Mature**: in review with a stability of 21 days or more.

  These word states are not the character map's stages (Started, Growing, Solid,
  Learned): a word's state follows its flashcard schedule, a character's stage its
  mastery score.

  "N new cards waiting" counts every new vocabulary card, without the session's
  daily new limit. Stats adds a table with one row per deck. A card in several
  decks counts in each deck's row, but only once in the overall numbers. A card
  in no existing deck is not counted.
- **Reading time**: the time tracked by the Reader, from the `read` events of
  the workspace. It shows the total for all time and for the last 7 and 30 days.
  The 7 and 30 days are UTC days that end with today. It also lists the five
  most read books. A reading burst under 30 s is not counted, and one burst
  counts at most 2 hours (the same clamping as the Activity heatmap). A book
  that is no longer in any library is listed as "A removed book".

**Card ids and duplicates.** A new card gets a deterministic id,
`c-<kind>-<entryId>` (for example `c-vocab-42`; a sentence card is
`c-sentence-<entryId>`), so two devices that add the same word offline write the
same plugin-data key and last-write-wins leaves one row. Cards created earlier
have ULID ids and can still exist twice. Every page reads cards through one
loader that merges duplicates at read time: per card key (kind and entry) the
card with the earliest `createdAt` survives, the reviews of the others are
re-pointed to it in memory, and the survivor's decks are the union of the
duplicates' decks. Nothing stored is rewritten or deleted by the merge. Caveat: if
two devices create the same card at the same moment with different ids (the
older ULID format, or a sentence card whose derived id another sentence already
holds and so falls back to another id), both rows are stored until a later write
touches them; only the merged view hides it.

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
`GET /api/entries/{id}`, `GET /api/search`, `GET /api/languages`, `GET /api/frequency-packs`, `GET /api/audio-packs` and `GET /api/audio-packs/{id}/credits` are public. The audio routes (`/api/audio/...`) need a signed-in user.

| Route | Purpose |
|---|---|
| `GET /api/lookup?lang=&text=&offset=&kind=` | The ranked entries for the text at a code-point offset: `{"results": [...]}`, at most 30. `text` up to 64 code points (the web app sends 16, and the engine reads a 12 code-point window from the offset); `kind` is `word` or `character` and may repeat. Each result has the entry id, forms, readings, the matched text with its `start`/`end`, inflection `reasons`, tags, `frequencies` and `senses` (each with POS). Missing or non-integer params are 400, an unsupported language 400, too long 413; an offset outside the text finds nothing |
| `GET /api/segment/at?lang=&text=&offset=` | Tokenizer: the longest dictionary match at a code-point offset, built on the lookup engine. `text` up to 64 code points. `lemma` is the dictionary form and `reason` the deinflection; only `entries[0]` corresponds to them, later candidates are other readings or entries with the same surface (at most 8 candidates in all). A candidate has `reading: true` when it matched by a kana reading (Japanese) |
| `POST /api/segment` `{lang, text}` | Every match in order, same shape; needs a signed-in user. `text` up to 5000 code points, body up to 256 KiB |
| `GET /api/audio/entries/{id}` | Signed-in. The pronunciation clips of one entry: `{terms: [Clip], syllables: [[Clip]\|null]\|null}`. `terms` are recordings of the whole word (matched on written form and first reading); `syllables` (zh entries only, else `null`) has one slot per pinyin reading in the entry's order, each the clips to play in sequence or `null` when a syllable has no recording. `Clip` is `{url, packId, license, attribution, source}`; 404 for an unknown entry |
| `POST /api/audio/resolve` `{entryIds}` | Signed-in. The same resolution for up to 200 entries, keyed by id (unknown ids are left out); more is 422, a body over 16 KiB 413 |
| `GET /api/audio/clips/{file}` | Signed-in. One stored clip, `file` being `<sha256>.<opus\|ogg\|mp3>` exactly as in a clip's `url`; Range and conditional requests work, served `private, max-age=31536000, immutable` with `nosniff`. Any other name, or a clip no installed pack references under that extension, is 404 |
| `GET /api/audio-packs` | The installed audio packs with `license`, `attribution`, `notice`, `language` and `clipCount` (the Sources page lists them) |
| `GET /api/audio-packs/{id}/credits?offset=&limit=` | The per-recording credits of a pack (`{total, offset, limit, clips: [{kind, form, reading, license, attribution, source}]}` (`reading` is the stored match key: hiragana for Japanese, numbered pinyin such as `ni3hao3` for Chinese; empty for a word clip without a reading), text only, `limit` up to 500, default 100); unknown pack 404 |
| `GET /api/frequency-packs` | The installed frequency packs in priority order, with `license`, `attribution` and `notice` (the manifest's caveat, `""` when it has none; the Sources page lists them) |
| `GET /api/sync/pull?cursor=&collections=` | Changes since the cursor (authenticated). `collections` is an optional comma-separated list of Delta collection names that limits the pull; the others come back empty and an unknown name is 400. The returned cursor is valid only for the collections requested: do not mix subset pulls with one global cursor. The Study page pulls only `pluginData` and `pluginStates` |
| `GET /api/characters?language=` | Public, no user data. The character universe of a language (`ja`, `zh`; another well-formed language gives an empty list, a malformed one 400): `{language, count, stale?, chars}` with compact keys per row: `i` entry id, `c` glyph, `s` strokes, `g` school grade, `f` frequency rank, `t` standard-list flag, `b` GB2312 level (1/2), `h` HK primary grade, `r` reading, `m` meaning, `v` variant forms; absent values are omitted. `stale: true` means the importers' level fields are missing (reseed). Gzip when accepted, weak `ETag` and 304 on `If-None-Match` |
| `GET /api/languages` | Public. The languages with an installed dictionary: `[{code, name, installed}]` sorted by code (`name` is the code unless a `languages` row names it) |
| `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Register (the first user on an empty database becomes the admin without a token; afterwards an admin token is required), log in for a bearer token, read the current user. Login and register bodies up to 4 KiB |
| `GET /healthz` | Liveness check |
| `GET /api/entries/{id}/chars` | Public. The characters classified under a radical entry, ordered by headword; an empty array for a radical without any, 404 for an unknown id |
| `PUT /api/entries/{id}` | Store the caller's own patch of an entry (a `null` field reverts to the shared value); body up to 64 KiB, 401 without a user; an unknown or malformed id is 404 (checked before the body, so a bad body on a missing entry is still 404) |
| `POST /api/events/batch`, `GET /api/events?since=&workspace=` | Append offline-recorded study events (idempotent by event id; each event needs a `workspaceId` of 1 or more, else 400; the workspace must be the caller's, else 404) and list the caller's events, optionally of one workspace |
| `POST /api/sync/push` | Push offline events and plugin data (events idempotent by id, plugin data last-write-wins); an unknown or foreign workspace or plugin is 404 and nothing is applied. Body up to 8 MiB |
| `GET /api/stats/activity?from=&to=&workspace=` | The caller's activity by UTC day, workspace and type for the plugins' activity rules: `{from, to, sources, cells}`. `from`/`to` are `YYYY-MM-DD` (default: today and the 90 days before; at most 366 days, else 400); a foreign workspace is 404. `sources` lists every rule (also those without cells) |
| `GET /api/plugins`, `PUT /api/plugins/{id}/state` `{enabled, order}` | The caller's plugins with their state (`hidden: true` marks the app's own surface-less built-ins such as `qinqin-core`; clients leave those out of plugin lists), and the caller's enable flag and (legacy) order for one plugin |
| `GET /api/plugins/{id}/data?workspace=&prefix=` | The caller's live rows of a plugin whose key starts with `prefix`, scoped like the single-row routes, ordered by key, `[]` when none; an unknown plugin or foreign workspace is 404 |
| `GET`/`PUT`/`DELETE /api/plugins/{id}/data/{key}?workspace=` | The caller's plugin data row, scoped to the workspace or user-global without `workspace`; `DELETE` tombstones it, a missing or tombstoned key reads 404 |
| `GET /api/ai/status` | The AI state for the caller: `secret` (`ok`, `missing`, `invalid`), `provider` (the active id, `fake` under the test switch), `fake`, `active` (`{provider, name, model, vision, structured}`), the active provider's key and all stored `keys` (hint, model, state, never the key), the active provider's suggested `models`, this hour's `usage`, `available` and, when not, a `reason` (`no_secret`, `invalid_secret`, `no_provider`, `no_key`, `no_selection`, `provider_disabled`, `key_undecryptable`), plus `disabledProviders` for stored keys of providers the server turned off |
| `GET /api/ai/providers` | The providers the server allows: id, name, kind, key page, default model, suggested models, structured mode, photo reading; custom endpoints with their `host` (admins also get `baseUrl`), `canManageCustom` and `privateAllowed` |
| `PUT /api/ai/keys/{provider}` | `{key?, model?}`: checks a new key with the provider (one call toward the hourly limit), stores it for the caller and answers the status; the first stored key becomes active. Without `key` only the model changes. A model id is 1 to 200 characters of `[A-Za-z0-9._:/@-]` |
| `POST /api/ai/keys/{provider}/test` | Re-checks the stored key (one counted call) |
| `DELETE /api/ai/keys/{provider}` | Removes the caller's key; if it was the active one the selection is cleared, never moved to another provider |
| `PUT /api/ai/active` | `{provider}`: makes a provider with a stored key the active one (409 `no_key` otherwise) |
| `POST /api/ai/custom-providers`, `PATCH`/`DELETE /api/ai/custom-providers/{id}` | Admin only (403 `forbidden`): register, change (default model, photos, structured mode, token cap) and remove an OpenAI-compatible endpoint; removing deletes every user's key for it. 422 `endpoint_blocked` (with the rule), 422 `invalid_endpoint`, 409 `provider_disabled` when `custom` is not in `QINQIN_AI_PROVIDERS`. Errors of all `/api/ai` routes are JSON `{error, message}` and never HTTP 401: 404 `unknown_provider`, 409 (`ai_disabled`, `no_key`, `no_selection`, `no_vision`, `provider_disabled`, `key_undecryptable`, `in_flight`), 422 (`key_rejected`, `quota`, `invalid_key`, `invalid_model`, `model_unavailable`, `bad_request`, ...), 429 `rate_limited` and 503 `busy` with `Retry-After` |
| `POST /api/journal/review` | `{workspaceId, entryId}`: asks the AI to review one journal entry of the caller's workspace and stores `review:<entryId>` (annotations validated and anchored by the server, then the overall review); answers the stored review. Needs an active provider with a stored key. Up to 5,000 characters (413 `too_long`, 422 `empty`), 404 for a foreign workspace or an unknown entry, the same AI errors as above. The call finishes and is stored even if the client disconnects |
| `POST /api/journal/suggestions` | `{workspaceId}`: asks the AI for topic ideas from the workspace's recently reviewed words (at most 60) and the titles and openings (200 characters) of the last 10 entries; stores and answers the `suggestions` document |
| `GET /api/journal/capabilities?workspace=` | `{ai: <status>, ocr: {available, languageReady, language}}` for one workspace |
| `GET /api/dictionaries` | Public. The installed dictionaries, each with `license`, `attribution` and `notice` (`""` when the manifest has none) |
| `POST /api/admin/dictionaries`, `DELETE /api/admin/dictionaries/{id}`, `DELETE /api/admin/schemes/{id}`, `DELETE /api/admin/sentences/{pack}`, `POST /api/admin/plugins` | Admin only: install a dictionary pack (multipart zip in `pack`), soft-delete a dictionary, a level scheme or a sentence pack (entries survive), register a plugin manifest |
| `GET /api/schemes` | Public. Every installed level scheme with its ordered levels, `license`, `attribution` and `notice` (`""` when the manifest has none) |
| `GET /api/schemes/{id}/entries?level=` | Public. The scheme's member entries (words and derived characters), optionally of one level; 404 for an unknown scheme or level |
| `GET /api/schemes/{id}/characters` | Public. The compact per-level character sets the map groups by: `{levels: [{id, name, chars}]}`, `chars` being each Han character of the level's words once, in order of first appearance. Gzip when accepted, weak `ETag` and 304 on `If-None-Match` (revalidated on every visit); 404 for an unknown, uninstalled or malformed id |
| `GET /api/workspaces`, `POST /api/workspaces` `{language, name?}` | List the caller's workspaces (creating the defaults on a first call) and create one; an over-long or invalid name is 422, a duplicate (language, name) 409 |
| `PUT /api/workspaces/{id}` `{name?, settings?}` | Rename and/or merge settings; at least one field is required. The body used to be the bare settings object |
| `DELETE /api/workspaces/{id}` | Delete a workspace and everything scoped to it (see "Workspaces"): 204, 404 for an unknown or foreign id, 409 for the caller's last workspace |
| `GET /api/library/books?workspace=`, `GET`/`DELETE /api/library/books/{id}` | List (without `workspace`: every workspace of the caller), read, delete a book (its bookmarks and highlights go with it) |
| `GET /api/library/books/{id}/chapters/{n}` | One chapter's paragraphs |
| `PUT /api/library/books/{id}/position` | Store the reading position |
| `POST /api/library/upload` | Multipart `file` (epub) and `workspace` (required); `language` only matters for an epub without `dc:language`. 404 for a foreign workspace, 422 when the book's language differs from the workspace's |
| `GET /api/library/sources` | Available sources |
| `GET /api/library/sources/{source}/search?q=&limit=` | Search a source's catalog (limit up to 100) |
| `GET /api/library/sources/{source}/browse?language=&seed=&limit=` | A deterministic assortment for the seed (default: today's UTC date; limit 1–50, default 12). 404 for an unknown source, 501 for one without suggestions |
| `POST /api/library/sources/{source}/import` `{sourceId, workspaceId}` | Import one work into a workspace (both required); a source with no books in the workspace language is refused with 422 before any download, a repeat in the same workspace is 409 |
| `GET`/`POST /api/library/books/{id}/bookmarks`, `PUT`/`DELETE …/bookmarks/{bid}` | List and add `{position, label?}` (201; 200 when one exists at the position; 409 beyond 200 per book) and rename `{label}` or delete |
| `GET`/`POST /api/library/books/{id}/highlights`, `PUT`/`DELETE …/highlights/{hid}` | List and add `{chapter, paragraph, start, end, text, color?, note?}` (201), update `{color?, note?}`, delete. Offsets are code points; `text` must be exactly the paragraph's text in `[start, end)` and at most 500 code points, else 422; a note over 2000 characters is 422. A range overlapping another highlight is 409 `{error, existingId}`, a book with 2000 highlights 409; a body over 16 KiB is 413 `{"error": "highlight too large"}` |
| `POST /api/entries/{id}/sentences` | Add the caller's example sentence; only `hanzi` is required (up to 2000 characters per field, body up to 16 KiB). `GET /api/entries/{id}` returns the pack's sentences plus the caller's own |

**Request body limits.** A body over its limit is a 413, usually with a JSON
`{"error": ...}` (the older routes answer plain text).

| Route | Limit |
|---|---|
| `POST /api/auth/login`, `/register` | 4 KiB |
| `POST /api/workspaces`, `PUT /api/workspaces/{id}` | 16 KiB; the merged workspace settings may total 64 KiB (413 "workspace settings too large") |
| `POST /api/admin/plugins` (manifest) | 64 KiB |
| `PUT /api/plugins/{id}/state` | 64 KiB |
| `PUT /api/plugins/{id}/data/{key}` | 256 KiB per value; the same cap applies to each plugin-data value inside `POST /api/sync/push` |
| `PUT /api/ai/keys/{provider}`, `PUT /api/ai/active`, `POST /api/ai/custom-providers`, `POST /api/journal/review`, `POST /api/journal/suggestions` | 4 KiB |
| `PUT /api/entries/{id}` | 64 KiB |
| `POST /api/library/books/{id}/highlights` | 16 KiB |
| `POST /api/library/books/{id}/bookmarks` | 1 KiB |
| `POST /api/entries/{id}/sentences` | 16 KiB |
| `POST /api/audio/resolve` | 16 KiB (413; more than 200 ids is 422) |
| `POST /api/library/sources/{source}/import` | 1 KiB |
| `PUT /api/library/books/{id}/position` | 2 KiB |
| `POST /api/events/batch` | 4 MiB |
| `POST /api/sync/push` | 8 MiB in total |
| `POST /api/segment` | 256 KiB |
| `POST /api/library/upload` | the epub up to 20 MiB (plus 1 MiB multipart overhead) |

`POST /api/admin/dictionaries` (admin only) has no total cap: uploads beyond
32 MiB spill to a temporary file, since real packs can be large.

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
with their metadata and reading position in the SQLite database. Photos live
under `<data>/journal/<user id>/` only while a draft is open.

The source client only fetches `https` URLs from a host allow-list (Aozora Bunko,
Gutenberg), checks every redirect hop, and refuses
loopback, private, and other non-public addresses. Environment proxies
(`HTTP_PROXY`, `HTTPS_PROXY`) are intentionally **not** used, because a proxy would
bypass that check. A self-hoster behind a mandatory outbound proxy therefore
cannot import from the sources; epub uploads still work.

### Feature plugins

Every built-in feature plugin has one manifest, a JSON file in
`server/internal/plugins/builtin/` that the Go server embeds and validates at
start-up (`plugins.ParseManifest`; unknown fields are rejected) and the web build
imports through the `$builtin` alias. It declares `sdk` (the contract version, 1),
`surfaces` (`home-widget`, `page`, `hook`), `permissions`, `hooks` (`study-event`)
and the study-event types it emits. The four permissions are `owns-data` (keep
plugin data rows; the server refuses data writes without it), `read:entries`,
`read:study-events` and `write:study-events`; Settings shows them for each plugin.
`apps/web/src/lib/plugins/sdk.ts` (`createPluginSdk(manifest)`) wraps plugin data
(per user or per workspace) and study events and throws a `PermissionError` for
anything the manifest did not declare; `sdk.onStudyEvent` delivers posted events
to a plugin while it is enabled. Permissions are a contract that catches mistakes
and tells the user what a plugin does, not a sandbox: all plugin code ships in one
bundle. The journal and the home layout use the SDK.

Server side, `POST /api/admin/plugins` answers 400 with every reason when a manifest
breaks the contract (unknown fields, trailing data and event types another plugin
owns included) and 409 for the id of a built-in plugin. `PUT`/`DELETE
/api/plugins/{id}/data/{key}` answer 403 `plugin does not declare owns-data` for a
plugin whose manifest has an `sdk` but not that permission (a row registered before
the contract has no `sdk` and keeps writing; Settings marks it "legacy"). In a sync
push such a row is skipped, not fatal: the events and every other row still apply,
and the result's `dataRefused` counts the skipped rows next to `dataSkipped`.
A registry row whose manifest no longer parses (for example one registered before
the strict `activity` rule validation of the activity statistics, or with a
malformed rule) keeps writing like a legacy row, but neither claims event types nor
contributes activity; startup logs "plugin registry rows that do not parse as
manifests" with their ids once. This only concerns development databases: re-register
or remove those rows.
SDK data keys may not be empty, `.` or `..`. A plain string value round-trips
(`put('k', 'hello')` reads back `'hello'`); a string that is itself valid JSON text
(`'123'`) reads back decoded, so store objects instead of such strings.

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

A web plugin can also contribute widgets: the optional `widgets` array of its
manifest (`PluginManifest.widgets`, next to `sources`) lists `WidgetDef`s
(`apps/web/src/lib/widgets/types.ts`: id, title, description, owner, size
`normal` or `wide`, optional `appliesTo(language)`, surfaces and a component
without props). The app's own widgets are in `apps/web/src/lib/widgets/core.ts`.
A plugin's widgets exist only while the server lists the plugin and it is
enabled. The home page renders the user's layout, the ordered widget ids in the
user-global plugin data row `qinqin-core` / `home-layout`
(`{"version": 1, "widgets": [...]}`, no workspace; a missing row means the
default layout; a higher version is read leniently, its string ids only, and
saving writes version 1), through `apps/web/src/lib/widgets/layout.ts`. `qinqin-core` is
the core app registered as a plugin without surfaces so its data rows are
accepted and synced; Settings does not list it. The per-plugin `order` in Settings
no longer affects the home page (legacy: it orders the nav links).

### Credits and the Sources page

The Sources page (`/sources`) is public: anyone can open it without signing in,
as the CTI Legal Notice for the bundled HSK lists asks that the source be shown
where the content is, and every credit should be reachable by anyone. Its API
calls (`GET /api/dictionaries`, `/api/frequency-packs`, `/api/schemes`) are
public too. It is built from data, not hard-coded text:

- **Packs**: each installed pack's manifest `license`, `attribution` and optional
  `notice`. The notice is plain text: paragraphs separated by a blank line, links
  only as `[text](https://…)` (https only; anything else stays plain text), at
  most 4,000 bytes. The server validates it on import
  (`server/internal/dict/notice.go`), and
  the page renders it with the parser in `apps/web/src/lib/sources/notice.ts`
  (no HTML). See [plugins/data/README.md](plugins/data/README.md).
- **Plugins**: a web plugin lists the third-party material it ships or fetches in
  the optional `sources` array of its manifest (`PluginManifest.sources` in
  `apps/web/src/lib/plugins/index.ts`), each a `SourceCredit` with `name` and
  optional `url`, `license`, `attribution`, `notice`, `licenseTexts` and `lang`
  (`apps/web/src/lib/sources/credits.ts`); see the Reader's manifest for an
  example. The page shows them under "Plugins".
- **Core**: material built into the app itself, shared by several features
  (stroke-order data, `hanzi-writer`, `ts-fsrs`, ...), is listed in
  `apps/web/src/lib/sources/coreCredits.ts`. Credit it there once rather than in
  every plugin that uses it. A licence text that ships with the app goes into
  `apps/web/static/` and is named in the credit's `licenseTexts`.

To add a credit: for a pack, set `license`/`attribution` (and a `notice` if one
line is not enough) in its `manifest.json` and add a row to
[docs/sources.md](docs/sources.md); for a plugin, add an entry to its manifest's
`sources`; for the app itself, add it to `coreCredits.ts`.

`node scripts/check-sources.mjs` keeps packs and docs honest (every pack has a
non-empty `license` and `attribution`, every bundled pack is named in
`docs/sources.md`, every pack the docs name exists, every `notice` is valid). CI
runs it together with the scripts' tests (`node --test scripts/*.test.mjs`).

## Journal and AI

The Journal is a page plugin (`qinqin-journal`) where you write dated entries per workspace. The AI features (a review with underlined corrections, topic ideas, and turning a photo of a page into an entry) are optional and use **your own API key for the provider you choose**; qinqin ships no key and sends nothing to any provider on its own.

- **What is sent, and when.** Only when you press a button, and only to the provider you made active in Settings → AI: the entry text (up to 5,000 characters) and your guidance for a review, a list of recently studied words and the openings of your last entries for topic ideas, or one re-encoded photo for a transcription. Nothing is sent when you merely open the page or pick a photo. Photos are stripped of metadata (including GPS) and shrunk before they leave the server, are sent only when you press a transcription button, and are deleted when you save or discard the draft (a janitor sweeps forgotten ones within about an hour). Settings → AI shows, wherever you type a key, "Your journal text, guidance and the photos you choose to read with AI are sent to <provider> when you press a button. <provider>'s terms apply."
- **Key storage.** Each user stores one key per provider in Settings → AI and makes one of them active. Keys are encrypted at rest (AES-256-GCM, bound to the user and the provider) with `QINQIN_SECRET` and are never returned by the API, written to logs, or included in sync or backups in plain text. Only the last four characters are shown as a hint. A key opens only for the provider it was stored for; a custom endpoint's key is also bound to the endpoint's address.
- **Providers.** Pick any of these (the learner may type any model id; the registry only suggests):

| Provider | Base URL | Default model (also suggested) | Reads photos | Structured replies |
|---|---|---|---|---|
| Anthropic | `https://api.anthropic.com` | `claude-opus-5-5` (`claude-sonnet-5-5`, `claude-haiku-5-5`) | yes | JSON schema |
| OpenAI | `https://api.openai.com/v1` | `gpt-6-astra` (`gpt-6-luna`) | yes | JSON schema (strict) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.8-flash` (`gemini-3.5-flash-lite`) | yes | JSON schema |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` (`deepseek-v4-pro`: no photos) | `deepseek-flash` only | JSON mode |
| Mistral | `https://api.mistral.ai/v1` | `mistral-large-latest` (`mistral-small-latest`) | yes | JSON schema |
| xAI | `https://api.x.ai/v1` | `grok-4.7` | yes | JSON schema (strict) |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | no | JSON schema |
| OpenRouter | `https://openrouter.ai/api/v1` | `openrouter/auto` | depends on the routed model | JSON schema |
| Custom (admin) | the admin's address | the admin's choice | the admin's choice | JSON mode by default |

  A model that cannot read photos makes Read with AI unavailable ("<model> can't read photos") and the page offers offline reading instead. If a reply is not valid JSON in the expected shape the server asks once more (a second counted call) and otherwise answers "bad reply"; nothing from a malformed reply reaches the page.
- **Models and fallback.** On Anthropic's Opus and Sonnet a safety refusal is retried by the provider's default fallback model, which can answer from another model on your key; the review says which model and provider answered and marks "(fallback)". Other providers have no fallback.
- **Limits.** 30 provider calls per user per rolling hour across all providers (checking a key and a repair request count), one AI call in flight per user, 5,000 characters per review, 10 MiB and 25 megapixels per photo, at most 10 pending photos and 30 uploads per user and hour, provider replies capped at 8 MiB, 150 s per call. Settings → AI shows the calls and tokens used this hour.
- **Offline OCR.** The image bundles Tesseract 5 (with Chinese Simplified and Traditional, Japanese and English data) for reading a photo without any AI; without the `tesseract` binary it shows as unavailable.
- **Image size.** The OCR packages add about 193 MB to the Docker image (Tesseract plus the `chi_sim`, `chi_tra`, `jpn` and `eng` standard models from Alpine's tessdata). The standard models were chosen over the smaller `tessdata_fast` ones for accuracy on handwriting and small print, at the cost of size. To leave them out, build with `docker build --build-arg WITH_OCR=0 .`: the server starts normally, offline reading shows as unavailable and AI reading is unaffected. CI and the published image use the full build.
- **Audio in the image.** The default image build (`WITH_AUDIO=1`) also bakes in the Kanji alive example-word recordings (CC BY 4.0, 10,156 Japanese clips): a build stage runs `scripts/fetch-audio-kanjialive.sh`, which downloads about 69 MB from `media.kanjialive.com` and the data repository (a warm layer cache skips it; a fresh build does not), checks pinned SHA-256 sums and fails the build on a mismatch. The image grows by about 70 MB, and builds that run the stage need that site reachable; the `audio-stage` workflow builds only the stage on pull requests and weekly so a break shows early. Build with `docker build --build-arg WITH_AUDIO=0 .` to leave it out (also the fallback when the download is unavailable): `/opt/qinqin/audio` is then empty and `qinqin seed` still works. See `docs/sources.md`, "Audio".

### Custom AI endpoints

An admin can register an OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, Together, a company gateway, Azure-style gateways, Cohere's compatibility API) in Settings → AI; everyone on the server can then store their own key for it. Because any user can trigger calls to it, the server treats the address as a threat: the address must be `https` (plain `http` only with `QINQIN_AI_ALLOW_PRIVATE=1`, and then only if it resolves to a loopback or private address, for example `http://ollama:11434/v1` on a Docker network), without a user name, query or fragment; the address actually dialled is checked after DNS (so a hostname that resolves to a blocked address is refused, rebinding included); link-local, cloud-metadata, multicast and unspecified addresses are never allowed; redirects are not followed, so a key never travels to another host. The name, address and "needs a key" setting cannot be changed later (remove and re-add), and a name may not look like a built-in provider, so an endpoint cannot pose as "OpenAI" to collect keys. Users see "Added by your admin · <host>" wherever they type a key for it. Custom endpoints never use an HTTP proxy (the check needs the dialled address); the built-in providers honour `HTTPS_PROXY`, and follow no redirects either.

Proton's Lumo has no public API today (their roadmap only announces one), so it is not built in; if Proton ships an OpenAI-compatible API an admin can add it as a custom endpoint.

**The owner's real-key checklist** is in `docs/superpowers/handoffs/2026-11-15-ai-providers-handoff.md`; its appendix lists the official documentation pages checked on 2026-11-15 and what they say. These items are still not confirmed by the providers' own documentation and are marked `UNVERIFIED 2026-11-15` in `server/internal/ai/registry.go`: the REST field Gemini uses for the JSON schema (`generationConfig.responseJsonSchema`; the docs' REST example uses `generationConfig.responseFormat.text` instead), whether `mistral-small-latest` and `openrouter/auto` read photos, and whether Mistral accepts the OpenAI-style `image_url` object (its docs show a plain string). Confirmed from the docs: the ids `gpt-6-luna`, `mistral-large-latest`, `mistral-small-latest` and `grok-4.7`, photo reading for `gpt-6-luna`, `mistral-large-latest` and `grok-4.7`, base64 image data URLs for OpenAI, DeepSeek's `/models` listing, and OpenRouter's `provider.require_parameters`.

### Photo routes

All need a bearer token; a foreign workspace or photo is a 404.

| Route | Meaning |
|---|---|
| `POST /api/journal/photos` | multipart `file` and `workspace`; JPEG, PNG or WebP (sniffed), up to 10 MiB and 25 megapixels. Re-encoded to JPEG (EXIF rotation applied, GPS and all metadata dropped, long edge at most 2576 px, at most 3.75 MB so it stays under the API's 5 MB after base64). 201 `{photoId}`; 413 `photo_too_large`, 415 `unsupported_image`, 422 `image_too_large`, 409 `too_many_photos` (10 pending per user), 429 `rate_limited` (30 uploads per user and hour) |
| `GET /api/journal/photos/{id}` | the stored JPEG (`no-store`) |
| `PUT /api/journal/photos/{id}/keepalive` | 204; keeps an open draft's photo alive |
| `DELETE /api/journal/photos/{id}` | 204 |

A photo is deleted when its draft is saved or discarded, when its workspace is deleted, and by a janitor (at startup and every 15 minutes) when it was not seen for an hour or is over 24 hours old. The janitor also removes files without a row and rows without a file.

### Offline OCR

`POST /api/journal/transcribe` with `{workspaceId, photoId, engine: "ai"|"offline"}` returns `{text, engine, unreadable}`. The `ai` engine sends the stored photo to the provider with the learner's key (it counts toward the 30 calls per hour); `offline` runs Tesseract on the server and sends nothing anywhere. There is no automatic fallback from one to the other. Neither engine stores anything beyond refreshing the photo's last-seen time.

- **Models.** Chinese uses `chi_sim+chi_tra`, Japanese `jpn`, and the Latin-script workspace languages `eng`. Other languages have no offline reading (409 `ocr_language_missing`). The Alpine packages ship no vertical Japanese model (`jpn_vert`), so vertical text is read poorly.
- **Limits.** Tesseract runs with fixed arguments and no shell, 60 s at most per photo, at most 2 processes at once server-wide (a third request waits 5 s, then gets 503 `busy`), and at most 60 offline reads per user per hour (429 `rate_limited`).
- **Without Tesseract.** The server starts and logs `offline OCR: not available (tesseract not found)`; the route answers 409 `ocr_unavailable` and the page shows "Read offline" as unavailable. This is the normal state in local development unless you install `tesseract` (and the `tessdata` models) yourself. `QINQIN_TESSERACT` points to another binary; `TESSDATA_PREFIX` is passed through.
- **CI.** The test job installs `tesseract-ocr` and sets `QINQIN_REQUIRE_TESSERACT=1`, so the OCR test fails instead of skipping when the binary is missing.

### Server secret

Set `QINQIN_SECRET` to 32 random bytes, base64 encoded, to allow storing keys:

```sh
head -c 32 /dev/urandom | base64
```

Without a valid secret the server still starts, AI shows as disabled with the reason (not set, or not 32 bytes of base64), and no key can be stored.

Back up `QINQIN_SECRET` separately from `/data`; without it stored keys cannot be read and users must enter them again; it is never written to `/data`. Rotate it by moving the old value to `QINQIN_SECRET_PREVIOUS` for one restart: on startup the keys sealed with the previous secret are re-encrypted with the new one, after which the previous value can be removed. A key sealed with a secret the server no longer knows shows as "re-enter your key" instead of failing.

| Variable | Meaning |
|---|---|
| `QINQIN_SECRET` | 32 random bytes, base64 (standard or URL form, padded or not). Required to store API keys |
| `QINQIN_SECRET_PREVIOUS` | The old secret for one restart while rotating |
| `QINQIN_TESSERACT` | Path of the `tesseract` binary (default `tesseract` from `PATH`) |
| `QINQIN_AI_PROVIDERS` | Comma list of the providers users may choose: built-in ids (`anthropic`, `openai`, `gemini`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter`) and `custom` for admin-registered endpoints. Default: all. A disabled provider's stored keys stay (shown "turned off by the server", Remove only) and a selection on it reads as unavailable |
| `QINQIN_AI_ALLOW_PRIVATE` | `1` or `true` lets admins register custom endpoints on loopback and private addresses (Ollama on the same host). Off by default; the admin's endpoints can then reach your LAN, so enable it only if you trust every admin |
| `QINQIN_AI_PROVIDER` | Legacy. Unset: real providers, all allowed. `anthropic` (set explicitly) means `QINQIN_AI_PROVIDERS=anthropic`. `fake` is for testing only: a deterministic provider that replaces every adapter, never leaves the server, and is shown in the app as a "Test provider" badge. Anything else disables AI |

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

A fresh install can seed offline; the image ships these upstream dictionaries,
frequency list and level lists under `/opt/qinqin/packs` (source: `plugins/data/`):

| Pack | Provides | License |
|---|---|---|
| [CC-CEDICT](https://cc-cedict.org) | Mandarin–English words and meanings | CC BY-SA 4.0 |
| [Unihan](https://www.unicode.org/reports/tr38/) | Radical-stroke counts, variant mappings, character definitions | Unicode License v3 |
| [JMdict](https://www.edrdg.org/) | Japanese–English words and meanings | CC BY-SA 4.0 (EDRDG) |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) |
| [Jiten frequency list](https://jiten.moe/frequency-dictionaries) | Japanese word frequency ranks (converted to CSV, ranks unmodified) | CC BY-SA 4.0 (Jitensoft) |
| [HSK 考试大纲 (Syllabus for the Chinese Proficiency Test)](https://www.chinesetest.cn) (`hsk-chars`) | Chinese: the official HSK 3.0 character list, the characters to recognise (认读字) per level, HSK 1–6 and HSK 7–9 (3,088 characters; same edition) | No reuse licence granted; see the CTI [Legal Notice](https://www.chinesetest.cn/legal-notice) (source must be indicated; reasonable, good-faith quoting only); included with attribution at the project owner's decision; legal status not verified |
| [HSK 考试大纲 (Syllabus for the Chinese Proficiency Test)](https://www.chinesetest.cn) (`hsk-words`) | Chinese: the official HSK 3.0 word list, HSK 1–6 and HSK 7–9 (11,000 rows, 10,959 entries; edition 2025-11, effective 2026-07; CLEC, distributed by CTI) | No reuse licence granted; see the CTI [Legal Notice](https://www.chinesetest.cn/legal-notice) (source must be indicated; reasonable, good-faith quoting only); included with attribution at the project owner's decision; legal status not verified |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (`joyo-grades`) | Japanese: the 2,136 jōyō kanji by school grade (Grade 1–6, Secondary), derived from the grades recorded in KANJIDIC2 | CC BY-SA 4.0 (EDRDG) |
| [Unihan](https://www.unicode.org/reports/tr38/) (`tgh-chars`) | Chinese: the 通用规范汉字表 (2013) in three levels (3,500 / 3,000 / 1,605), derived from Unihan's `kTGH` serials | Unicode License v3 |
| [kanjiapi.dev `jlpt.tsv`](https://github.com/onlyskin/kanjiapi.dev) + [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (`jlpt-kanji`) | Japanese: approximate JLPT N5–N1 kanji levels (the JLPT has published no official kanji list since 2010): kanjiapi.dev's list, of unstated provenance, plus levels qinqin derives from KANJIDIC2 for the 176 kanji it omits (分, 可, 無, 的 …), see docs/sources.md | MIT (© 2023 Iridium Szreter) and CC BY-SA 4.0 (EDRDG) for the derived levels |

**JLPT vocabulary is not bundled.** Its upstream licence chain could not be
verified: [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)
is labelled MIT (© 2020 Jamie Sinclair), but its README says its data was taken
from chyyran/jlpt-anki-decks, which were based on the tanos.co.uk lists by
Jonathan Waller, described as Creative Commons Attribution (CC BY); the page
could not be reached, so that description is unverified. So the repository ships no
JLPT vocabulary; it is an optional pack you generate for local use only (the
map's "Group by" and the Sources page pick it up once installed). From the
repository root:

```bash
mkdir /tmp/jlpt-vocab && cd /tmp/jlpt-vocab
base=https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0
for n in n5 n4 n3 n2 n1; do curl -fsSLo $n.csv $base/src/$n.csv; done
curl -fsSLo LICENSE $base/LICENSE
cd -
node scripts/prepare-level-packs.mjs --jlpt-vocab /tmp/jlpt-vocab   # writes plugins/data-local/
qinqin seed --packs plugins/data,plugins/data-local
```

Under Docker, mount `plugins/data-local` as described under "Seeding" and run
`docker compose exec qinqin qinqin seed --packs /opt/qinqin/packs,/opt/qinqin/local`.
Details: [plugins/data/README.md](plugins/data/README.md).

**HSK 3.0 characters and words** come from the official syllabus 《HSK 考试大纲》 / Syllabus for
the Chinese Proficiency Test (published 2025-11, effective 2026-07), issued by
中外语言交流合作中心 (CLEC) and distributed by Chinese Testing International
(CTI) at [chinesetest.cn](https://www.chinesetest.cn). No reuse licence is
granted: the site's [Legal Notice](https://www.chinesetest.cn/legal-notice)
says its content is copyrighted by CTI or the content providers, requires
the source to be indicated ("Source: www.chinesetest.cn", "reproduced from
the Chinese Test Service Website"), and permits reproduction only as
reasonable, good-faith quoting for informative public use; the syllabus PDF
carries a copy-protection flag. The project includes only the vocabulary
(word) list and the list of characters to recognise (认读字), as plain lists of
words and characters with their levels (and the words' pinyin as lookup
readings), and none of the syllabus's other content (grammar points,
descriptions, the lists of characters to write, explanatory text). It
includes these lists with attribution at the project owner's decision; the
legal status of including these lists has not been verified (no legal
opinion). The
Sources page and the character map show the required source line. `scripts/prepare-hsk-syllabus.mjs` converts the
PDF's vocabulary table (11,000 rows, HSK 1 300, HSK 2 200, HSK 3 500, HSK 4
1,000, HSK 5 1,600, HSK 6 1,800, HSK 7–9 5,600) into `plugins/data/hsk-words`
and its character lists (认读字: HSK 1 246, HSK 2 125, HSK 3 284, HSK 4 441,
HSK 5 431, HSK 6 413, HSK 7–9 1,148) into `plugins/data/hsk-chars`, in one run;
the PDF and any text extracted from it are never committed. The older,
community-compiled ivankra/hsk30 packs that `prepare-level-packs.mjs --hsk`
generates locally are superseded by the official lists. Details:
[plugins/data/README.md](plugins/data/README.md).

The dictionary files are redistributed **unmodified**; the Jiten list is a
conversion of the published file with unmodified ranks; the level lists are
converted from pinned upstream files by `scripts/prepare-level-packs.mjs` and,
for HSK, from the official syllabus by `scripts/prepare-hsk-syllabus.mjs`. See
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

To work on the web app, start its hot-reload dev server in another terminal. Vite proxies `/api` to
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
| `plugins/data/` | Bundled seed packs (dictionaries, the Jiten frequency list, the HSK 3.0 character and word and JLPT kanji level lists) with their licenses and attribution notices |
| `plugins/data-local/` | Gitignored: local-only packs such as frequency lists with unclear licences |
| `plugins/samples/` | Hand-written samples: dictionaries (`zh-mini`, `ja-mini`) and level packs (`hsk-mini`, `jlpt-mini`), not seeded by default: `qinqin seed --packs plugins/samples` |
| `docs/` | Design notes, data sources, and the git-flow guide |
| `scripts/fetch-seeds.sh` | Refreshes the bundled upstream dictionaries (and, via `fetch-jiten-frequency.sh`, the Jiten list: a manual, licence-checked step) |
| `scripts/prepare-level-packs.mjs` | Rebuilds the approximate JLPT kanji pack from the pinned kanjiapi.dev file and the bundled KANJIDIC2 (`--calibrate` prints the evaluation of its gap-fill thresholds); with `--jlpt-vocab`, generates the optional local-only JLPT vocabulary pack into `plugins/data-local/` (download commands in its header) |
| `scripts/prepare-standard-levels.mjs` | Regenerates `joyo-grades` and `tgh-chars` from the bundled KANJIDIC2 and Unihan (no network) |
| `scripts/prepare-local-levels.mjs` | Converts a TSV you prepared (TBCL, curriculum tables, any private list) into a local-only level pack under `plugins/data-local/`; writes no `LICENSE`, refuses other directories |
| `scripts/check-sources.mjs` | Checks that pack manifests (`license`, `attribution`, `notice`) and `docs/sources.md` agree; run in CI (`node scripts/check-sources.mjs [repo-root]`) |
| `scripts/prepare-hsk-syllabus.mjs` | Rebuilds the HSK 3.0 packs `hsk-words` and `hsk-chars` from the official syllabus PDF's `pdftotext -tsv` output (steps in its header; the inputs are never committed) |

## Branches

This repository follows git-flow: `main` is production, `develop` is
integration, and work happens on `feature/<name>` branches. See
[docs/git-flow.md](docs/git-flow.md) for branch roles, release/hotfix flows, and
the CI mapping.
