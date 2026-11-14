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
- **Creating.** The language list comes from `GET /api/languages`: the languages
  with at least one installed, live dictionary. Languages already in use stay
  selectable.
- **Defaults.** A user with no workspace gets one unnamed workspace per installed
  language on their first `GET /api/workspaces`. A user who already has a
  workspace is never touched.
- **Switching** happens in the workspace picker in the header (it can also create
  one). **Settings** and **Sources** live in the footer of every signed-in page, not in the nav;
  there you manage workspaces (create and rename). The logo is the home link (there
  is no Home item); every nav item has an icon, and below 720 px the nav becomes a
  bottom tab bar.
- **Navigation and focus.** The first Tab stop on every signed-in page is a
  "Skip to content" link, which moves focus to the page content. The logo is
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
- **The Map** (`/study/map`, its nav link and the Study page link) exists only in
  zh and ja workspaces; in another workspace the page explains this.

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

`/study/map` is the Hanzi/Kanji map for the current workspace language. It lists
every character of the language, studied or not, shaded by mastery.

- **Universe.** Japanese: all 13,108 KANJIDIC2 kanji. Chinese: about 11.1k
  characters, the standard characters list (通用规范汉字表) plus every character
  with a CC-CEDICT reading, single Han characters only. A traditional form shares
  its simplified character's cell: a card written 愛 colours the 爱 cell.
- **Group by.** The choice is remembered per language; the default is Grade
  (Japanese) or Common (Chinese). Japanese: Grade, Frequency, Strokes, "JLPT
  (kanji)" (N5–N1, the bundled `jlpt-kanji` pack) and, when you have installed
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
  as a filter (All, Not studied, Learning, Learned). Search matches the glyph,
  the reading (toneless pinyin works), the meaning, and hiragana or katakana.
  Jump to character opens its section and focuses the cell.
- **Cells.** Colour is the character's mastery band: grey for not studied, then
  red, amber, blue, and green for fresh, learning, mature, and learned. Non-colour
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
`qinqin seed` to install them. HSK words carry an "HSK 3.0 (words)" badge
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
Reading is credited to the book's workspace. Hovering a cell shows the day's points per source,
with reading in minutes. Other study events (sessions, views, lookups) do not
count. Adding a source means emitting a study event with a new type and adding
one entry to `ACTIVITY_SOURCES` in `apps/web/src/lib/activity/activity.ts`.

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
`GET /api/entries/{id}`, `GET /api/search`, `GET /api/languages` and `GET /api/frequency-packs` are public.

| Route | Purpose |
|---|---|
| `GET /api/lookup?lang=&text=&offset=&kind=` | The ranked entries for the text at a code-point offset: `{"results": [...]}`, at most 30. `text` up to 64 code points (the web app sends 16, and the engine reads a 12 code-point window from the offset); `kind` is `word` or `character` and may repeat. Each result has the entry id, forms, readings, the matched text with its `start`/`end`, inflection `reasons`, tags, `frequencies` and `senses` (each with POS). Missing or non-integer params are 400, an unsupported language 400, too long 413; an offset outside the text finds nothing |
| `GET /api/segment/at?lang=&text=&offset=` | Tokenizer: the longest dictionary match at a code-point offset, built on the lookup engine. `text` up to 64 code points. `lemma` is the dictionary form and `reason` the deinflection; only `entries[0]` corresponds to them, later candidates are other readings or entries with the same surface (at most 8 candidates in all). A candidate has `reading: true` when it matched by a kana reading (Japanese) |
| `POST /api/segment` `{lang, text}` | Every match in order, same shape; needs a signed-in user. `text` up to 5000 code points, body up to 256 KiB |
| `GET /api/frequency-packs` | The installed frequency packs in priority order, with `license` and `attribution` (the Sources page lists them) |
| `GET /api/sync/pull?cursor=&collections=` | Changes since the cursor (authenticated). `collections` is an optional comma-separated list of Delta collection names that limits the pull; the others come back empty and an unknown name is 400. The returned cursor is valid only for the collections requested: do not mix subset pulls with one global cursor. The Study page pulls only `pluginData` and `pluginStates` |
| `GET /api/characters?language=` | Public, no user data. The character universe of a language (`ja`, `zh`; another well-formed language gives an empty list, a malformed one 400): `{language, count, stale?, chars}` with compact keys per row: `i` entry id, `c` glyph, `s` strokes, `g` school grade, `f` frequency rank, `t` standard-list flag, `b` GB2312 level (1/2), `h` HK primary grade, `r` reading, `m` meaning, `v` variant forms; absent values are omitted. `stale: true` means the importers' level fields are missing (reseed). Gzip when accepted, weak `ETag` and 304 on `If-None-Match` |
| `GET /api/languages` | Public. The languages with an installed dictionary: `[{code, name, installed}]` sorted by code (`name` is the code unless a `languages` row names it) |
| `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Register (the first user on an empty database becomes the admin without a token; afterwards an admin token is required), log in for a bearer token, read the current user. Login and register bodies up to 4 KiB |
| `GET /healthz` | Liveness check |
| `GET /api/entries/{id}/chars` | Public. The characters classified under a radical entry, ordered by headword; an empty array for a radical without any, 404 for an unknown id |
| `PUT /api/entries/{id}` | Store the caller's own patch of an entry (a `null` field reverts to the shared value); body up to 64 KiB, 401 without a user |
| `POST /api/events/batch`, `GET /api/events?since=&workspace=` | Append offline-recorded study events (idempotent by event id; the workspace must be the caller's, else 404) and list the caller's events, optionally of one workspace |
| `POST /api/sync/push` | Push offline events and plugin data (events idempotent by id, plugin data last-write-wins); an unknown or foreign workspace or plugin is 404 and nothing is applied. Body up to 8 MiB |
| `GET /api/plugins`, `PUT /api/plugins/{id}/state` `{enabled, order}` | The caller's plugins with their state, and the caller's enable flag and home position for one plugin |
| `GET`/`PUT`/`DELETE /api/plugins/{id}/data/{key}?workspace=` | The caller's plugin data row, scoped to the workspace or user-global without `workspace`; `DELETE` tombstones it, a missing or tombstoned key reads 404 |
| `GET /api/dictionaries` | Public. The installed dictionaries |
| `POST /api/admin/dictionaries`, `DELETE /api/admin/dictionaries/{id}`, `DELETE /api/admin/schemes/{id}`, `DELETE /api/admin/sentences/{pack}`, `POST /api/admin/plugins` | Admin only: install a dictionary pack (multipart zip in `pack`), soft-delete a dictionary, a level scheme or a sentence pack (entries survive), register a plugin manifest |
| `GET /api/schemes` | Public. Every installed level scheme with its ordered levels |
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
| `PUT /api/entries/{id}` | 64 KiB |
| `POST /api/library/books/{id}/highlights` | 16 KiB |
| `POST /api/library/books/{id}/bookmarks` | 1 KiB |
| `POST /api/entries/{id}/sentences` | 16 KiB |
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
| [kanjiapi.dev `jlpt.tsv`](https://github.com/onlyskin/kanjiapi.dev) (`jlpt-kanji`) | Japanese: JLPT N5–N1 kanji levels (an unofficial reconstruction of unstated provenance; the JLPT publishes no kanji list; omits 172 jōyō kanji such as 分 and 的, see docs/sources.md) | MIT (© 2023 Iridium Szreter) |

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
| `plugins/data/` | Bundled seed packs (dictionaries, the Jiten frequency list, the HSK 3.0 character and word and JLPT kanji level lists) with their licenses and attribution notices |
| `plugins/data-local/` | Gitignored: local-only packs such as frequency lists with unclear licences |
| `plugins/samples/` | Hand-written samples: dictionaries (`zh-mini`, `ja-mini`) and level packs (`hsk-mini`, `jlpt-mini`), not seeded by default: `qinqin seed --packs plugins/samples` |
| `docs/` | Design notes, data sources, and the git-flow guide |
| `scripts/fetch-seeds.sh` | Refreshes the bundled upstream dictionaries (and, via `fetch-jiten-frequency.sh`, the Jiten list: a manual, licence-checked step) |
| `scripts/prepare-level-packs.mjs` | Rebuilds the JLPT kanji pack from the pinned upstream files; with `--jlpt-vocab`, generates the optional local-only JLPT vocabulary pack into `plugins/data-local/` (download commands in its header; its `--hsk` mode is superseded by the official list) |
| `scripts/prepare-hsk-syllabus.mjs` | Rebuilds the HSK 3.0 packs `hsk-words` and `hsk-chars` from the official syllabus PDF's `pdftotext -tsv` output (steps in its header; the inputs are never committed) |

## Branches

This repository follows git-flow: `main` is production, `develop` is
integration, and work happens on `feature/<name>` branches. See
[docs/git-flow.md](docs/git-flow.md) for branch roles, release/hotfix flows, and
the CI mapping.
