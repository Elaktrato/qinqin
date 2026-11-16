# Frequency-ordered new words and starter decks — design (issue #75, v0.3.0 stretch item 2)

Status: Draft (2026-11-16), written unattended; every non-obvious call is a
**Ruling: what — why — cost if wrong**. Nothing is built. Builds on the decks view (#90,
`2026-11-15-v030-decks-view-design.md`), daily limits (`2026-11-15-v030-vacation-and-limits-design.md`),
reverse/cloze `deckcfg:` rows (`2026-11-15-v030-reverse-cloze-cards-design.md`) and level sessions
(`docs/contracts/levels/`). Owner's direction: starter decks appear as **system decks** in the decks view;
frequency data is **licence-checked first** (local only if unclear).

## Intent

Teach the most useful words first. Today a deck session takes new cards in the order they were added
(`queueCandidates`: `createdAt`, then id) and a level session in entry/level order. The frequency packs
(`server/internal/freq`) only rank and decorate lookups. This item lets the learner choose the order of
new cards (added, by frequency, by level) per deck and per session, and offers "Top 500 / 1000 / 2000"
starter decks computed from the installed frequency packs, skipping words the learner already knows.

## Licence check (done first)

What exists today: one bundled frequency pack, `plugins/data/jiten-frequency/` (`freq-csv`, 462k rows,
Japanese), made by `scripts/fetch-jiten-frequency.sh` (manual, refuses to run without
`JITEN_LICENCE_CHECKED` and `JITEN_TERMS_VERSION`), documented in `docs/sources.md` ("Frequency data") and
`docs/wiki/Data-and-licences.md`. **No Chinese frequency pack is bundled.** Local packs go into the
gitignored `plugins/data-local/` (`.gitignore` line `/plugins/data-local/`) or are installed by an
administrator in Settings, Data (`POST /api/admin/packs`). The research of
`2026-11-12-yomitan-lookup-design.md` (line 47) and the "Researched and not bundled" list of
`docs/sources.md` cover the candidates; wordfreq was re-read on 2026-11-16.

| Source | Language | Licence as stated | Bundling | Verdict |
|---|---|---|---|---|
| Jiten global frequency list (`jiten-frequency`) | ja | CC BY-SA 4.0 by its publisher (jiten.moe/frequency-dictionaries; terms art. 6.1, version 2026-08-08; checked 2026-11-12) | already bundled, ranks unmodified, LICENSE + ATTRIBUTION.md | **Compatible with attribution.** Used as is; nothing new is bundled |
| Unihan `kHanyuPinlu` (in the bundled `unihan` pack) | zh | Unicode License v3 | could be derived like `tgh-chars` | Licence clear, but character + reading counts for ~3,800 hanzi, not word ranks. **Not used** (out of scope; possible follow-up for character sessions) |
| KANJIDIC2 `<freq>` (bundled, already imported as the map's `f`) | ja | CC BY-SA 4.0 (EDRDG) | already bundled | Licence clear, newspaper rank of 2,501 kanji. **Not used** here (follow-up: kanji level sessions by frequency) |
| wordfreq (zh) | zh | data "may be redistributed under CC BY-SA 4.0", but its Chinese list includes jieba's wordlist "whose provenance we don't really know" (README) and SUBTLEX under an e-mail permission with its own conditions | no | **Unclear → local only** |
| jieba word counts | zh | MIT code; provenance of the counts unknown | no | **Unclear → local only** |
| SUBTLEX-CH | zh | terms of use unclear | no | **Local only** |
| Leiden Weibo corpus | zh | non-commercial | no | **Not compatible → local only** |
| BCCWJ (NINJAL) | ja | research and education only | no | **Not compatible → local only** |
| JPDB / Innocent / CC100 lists | ja | scraped or no licence from the source | no | **Unclear → local only** |

Ruling: **no new frequency data is bundled**; starter decks and frequency order are computed at runtime
from whatever frequency packs are installed (bundled Jiten, or a local pack the operator added) — the
issue asks for "generated from installed packs, not bundled content" and no Chinese word list has a clearly
compatible licence — cost if wrong: Chinese learners see the "no frequency list" hint until an operator
installs one locally.

Ruling: starter decks are not redistributed data. They are entry ids chosen at request time from the
installed pack; an owned copy stores only deck and card rows (entry ids, no ranks). The UI names the pack
and its licence on every starter deck ("From Jiten frequency list · CC BY-SA 4.0") and links `/sources` —
cost if wrong: one attribution line more or less; no data leaves the instance.

## Non-goals

Bundling any new data, a frequency source for characters, user-chosen deck sizes, a new session mode
for starter decks, a manual "I know this word" mark (#68 adds it), Android.

## Known words

There is **no "known" mark today** (grep for it finds none; #68 will add a manual mark that creates no
card). Ruling: a word is **known** when its live vocab card's memory score is at least
`MASTERY_THRESHOLD` (80, `cardScore`, `lib/study/mastery.ts`) — the decks view's "mastered", the same
score the reader's smart readings use — through one predicate `isKnown(entryId)` (`study/known.ts`) that
#68 extends with its manual mark — cost if wrong: one function. Studied but not mastered words are not
known: they join the starter deck like any existing card.

## New-card order

`NewOrder = {by: 'added'} | {by: 'frequency'} | {by: 'level', packId: string}`.

**The rule (`orderNew`, contract `frequency/new-order.json`):** given the new items in their current
order and a key per entry (`number | null`), sort stably by key ascending; items with a `null` key follow
all keyed ones in their current order. Ties keep the current order. `added` = no key (the current rule).

- `frequency`: key = the entry's rank in the **ranking pack**. Ruling: the ranking pack is the **first
  installed frequency pack of the entry language in priority order** (`frequency_packs.ord`), the same
  priority as lookups, fixed per request — not `rankingRanks`' "first pack with data for any entry of the
  batch", which would make the order depend on how ids are batched — cost if wrong: a pack picker later.
  The entry's rank is `lookup`'s per-entry frequency (`freqGroups` + `BestHits`: forms with readings,
  kana fallback for usually-kana words). Japanese character entries have no word rank (`freqGroups` nil).
- `level`: key = the `ord` of the entry's level in the installed scheme with that manifest `packId`
  (first level when an entry is in several; not in the scheme → `null`). Ruling: `packId`, not the
  numeric scheme id — ids differ between servers and after a restore — cost if wrong: none.
- Only **new** items are reordered: a deck session's never-reviewed real cards (`queueCandidates`'
  `fresh`) and a level session's new bucket (real and virtual). Reviews, the due order, admission and the
  daily limits are unchanged; because admission walks the candidates in order, the new limit takes the
  best-ranked words first. Companion items (sentence, writing, tone, reverse, cloze virtual cards) keep
  their rule. Character level plans keep "unlocked writing first, then recognition"; the key orders
  inside each group.

**Per deck.** `deckcfg:<deckId>` gains the optional field `newOrder` (one of the shapes above); absent or
malformed = `added`. Unknown fields stay verbatim (existing rule). Deck settings: "New cards" select —
"In the order added", "Most frequent first (<pack name>)", "By level: <scheme name>" per installed scheme
of the workspace language.

**Per session.** `StudySessionConfig` gains `newOrder: 'deck' | NewOrder` (default `'deck'`; a stored setup
without it parses as `'deck'`, so existing tabs keep their setup). Ruling: `'deck'` resolves to the
selected decks' common `newOrder`, or `added` when they differ (the setup says "Your decks use different
orders: in the order added") — one queue cannot follow two orders, and silently picking one deck's would
surprise — cost if wrong: one resolver. Level sessions offer "Level order" (default, the current order)
and "Most frequent first"; `'deck'` and `level` mean level order there. Ruling: level decks are system
decks without a `deckcfg` row, so a level session takes its order from the session setup only — cost if
wrong: a per-scheme row later.

**Hidden with a hint.** `GET /api/frequency-packs` (public; gains `packId`, additive) filtered by the
workspace language decides: with no pack the frequency option is not offered and the setup and deck
settings show "No frequency list is installed for <language>. An administrator can add one in Settings,
Data; see Data and licences." A stored `frequency` order with no pack (uninstalled later) behaves as
`added` and says so once. The by-level option is likewise hidden without a scheme. Ruling: frequency is
offered in a level session only for **word-unit** schemes — word frequency does not rank kanji, and a
silent no-op would mislead — cost if wrong: Japanese learners with only bundled data (character schemes)
see no frequency option in level sessions.

**Ranks route.** `POST /api/entries/frequency-ranks` `{language, ids}` (1–500 ids, body ≤ 16 KiB),
`accUser` → `{pack: {id, packId, name, license, attribution} | null, ranks: [{id, rank}]}` in request
order; entries without data in the ranking pack, of another language, or unknown are omitted; `pack` is
null when the language has no pack (then `ranks` is `[]`). 401 without a session, 400
`ids must be 1 to 500 entry ids` / `language is required`, 413 over the cap. It reads the shared lexicon
only (no overlay, no per-user data). The web client asks only for the entries of new items, in chunks of
500 (concurrency 2), and caches per `(language, pack id)` for the page. Ruling: a separate batch route,
not ranks inside `/api/sync/pull` or entry bases — ranks are global data, change only on pack installs,
and a deck session must not pay for them unless asked — cost if wrong: one small route. Ruling: offline,
or when the request fails, the session falls back to the added order with the note "Frequency order
needs a connection; using the order added" — cost if wrong: offline sessions differ in order only.

## Starter decks

**Representation.** Ruling: computed, never stored — like level decks (#90): per installed frequency
pack of the workspace language, three system decks **Top 500, Top 1000, Top 2000** (nested, as the issue
names them; a later band layout is a title change) — cost if wrong: the list needs the server (it does
anyway). They appear in the decks view's system section as a group "Starter decks · <pack name>" above
the level groups, collapsed, with the pack's licence line. Route `system/frequency/<packId>/<size>`.

**Items route.** `GET /api/frequency-packs/{id}/top?size=500|1000|2000`, `accUser` →
`{packId, name, size, entries: [EntryBase & {rank}]}` in deck order; 404 unknown or uninstalled pack, 400
other sizes. **Resolution rule** (Go, contract `frequency/starter-resolution.json` against a fixture
lexicon): walk the pack's rows by `rank`, then row position; resolve each row's term to one word entry
exactly as a level pack's word is resolved — `lexicon.Store.BestWordReading(language, term, reading)`
(form + reading first, then the form, then the kana-reading fallback); skip unresolved rows and entries
already taken by a better row; stop at `size` entries or after `4 × size` rows. A deck can hold fewer
than `size` words; the UI shows the real count. Ruling: reuse the level importer's resolution — one
definition of "this list's word is that entry" across levels and frequency, already tested on JMdict and
CC-CEDICT — cost if wrong: membership differs slightly from lookup ranking for homographs. Ruling: the
server caches the resolved top 2000 per `(pack id, content_hash)` in memory and slices it, and resolves ids
without loading full entries (id-returning variants of `Best`/`BestWord`/`BestWordReading`); no migration
(no rank index): the one sort per pack and process is measured in the real-app check, budget 2 s — cost
if wrong: an index migration later. `accUser` because the first call is expensive, unlike the cached
public scheme lists.

**Known words are skipped**: the detail lists the items with the learner's state and a line "12 known
words skipped"; the known items are not shown and never added. Ruling: membership stays the fixed rank
window (skipping happens after resolution), so a copy's identity is stable — cost if wrong: "next 500
unknown words" would need a moving deck.

**Ids.** Owned copy: `d-frq-<slug(packId)>-<fnv1a32(packId + "\u0000" + "top-" + size)>` with `slug` and
`fnv1a32` of `decks/system-deck-ids.json`. Examples (re-derived in the fixture task):
`jiten-frequency`/500 → `d-frq-jiten-frequency-d4514a31`, /1000 → `d-frq-jiten-frequency-a0d21277`,
/2000 → `d-frq-jiten-frequency-effe0824`. Deck row name "<pack name> · Top 500", `source: {type:
'frequency', packId, size}` (readers that do not know it drop it, existing rule).

**Add to my decks** reuses `planAddToDeck` (create / join / skip, `createdAt = now + i ms` in rank order,
deck row only when none is live, 200-row pushes). New: items for which `isKnown` holds are left out
before planning and counted as `known` in the result ("Added 480 words; 20 you know were skipped").
Ruling: the add also writes `deckcfg:<id>` with `newOrder: {by: 'frequency'}` **only when no live
deckcfg row exists** — joined cards keep their older `createdAt`, so "added" order would put them first —
cost if wrong: one row the learner can change. No Study button on a starter deck before it is added.
Ruling: a starter deck has no session of its own — a "frequency session" mode would duplicate level
sessions for one click saved — cost if wrong: one extra click.

## Data, sync, backup

No new row keys: `newOrder` is a field of `deckcfg:*`, starter copies are ordinary `deck:*`/`card:*`
rows; all are plugin data rows, already in sync and in the backup export (`docs/contracts/backup/`:
plugin data is exported generically — checked in the plan). Session setup stays in `sessionStorage`.
Isolation: both new routes read only shared data; the rows are the caller's workspace rows as today.

## Testing

Pure modules with unit tests and contract fixtures (`docs/contracts/frequency/`: `new-order.json`,
`starter-deck-ids.json`, `starter-resolution.json`, `deckcfg-new-order.json`, `known.json`), decoded by web
tests and, for the resolution, a Go test. Go: both routes (401, 400, 404, 413, order, language filter,
cache invalidation on re-import, two users get identical answers), the route walk, the PWA route fixture
(neither route cacheable), the API docs. jsdom: deck settings select and hint, setup select and hint,
starter group and detail (known skipped, add twice adds nothing). Real-app check on a built server with
the bundled Jiten and JMdict.

## Risks

- Jiten's global list ranks names and fragments; some top items are odd words. The deck shows what the
  pack says; the pack name is visible.
- Homographs: one entry per row; a reading-less local list picks the best-ranked entry (`Best`).
- Big decks: ranks for 5,000 new cards are 10 requests on session start; they are cached per page.
- A pack re-import with new ranks changes starter membership; copies keep what they had (like levels).
