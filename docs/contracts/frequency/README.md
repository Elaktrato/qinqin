# Frequency order and starter decks (#75)

Rules every client implements identically. Spec:
`docs/superpowers/specs/2026-11-16-v030s-frequency-decks-design.md`. Fixtures:
`{"version":1,"rule":"frequency/<name>","cases":[...]}`. Prerequisites: `decks/` (system deck ids, the
add-to-deck plan) and `cards/` (card kinds).

No frequency data is bundled for this feature. Order and starter decks are computed at request time from
the frequency packs installed on the server (`GET /api/frequency-packs`).

## New-card order (`new-order.json`, `deckcfg-new-order.json`)

`NewOrder = {by:"added"} | {by:"frequency"} | {by:"level", packId:string}`.

- `orderNew(items, keyOf)`: sort stably by key ascending; items whose key is `null` follow all keyed
  items in their incoming order; ties keep the incoming order. `added` gives no key (the incoming order).
  Fixture: `items` (`id`, `entryId`), `keys` (entry id -> key; missing or null = no key), `expected` ids.
- `frequency`: key = the entry's rank in the **ranking pack**: the first installed frequency pack of the
  language by `ord, id`, fixed for the request. `level`: key = the `ord` of the entry's first level in the
  installed scheme whose manifest `packId` matches.
- Only new items are reordered (a deck session's never-reviewed cards, a level session's new bucket);
  reviews, due order, admission and daily limits are unchanged.
- Per deck: the optional field `newOrder` of `deckcfg:<deckId>`. Absent or malformed (not an object, an
  unknown `by`, `level` without a non-empty string `packId`) = added. A readable value is normalised to the
  shape (fields beyond it are dropped); an unreadable one (a newer client's) is kept verbatim like every
  other unknown field, so saving the row keeps it, until this client sets an order of its own.
- Per session: `'deck'` (default) resolves to the selected decks' common order, or added when they differ
  (`mixed`); an explicit order wins. Level sessions use level order unless the session says `frequency`.

## Known words (`known.json`)

An entry is known when one of its **live vocab** cards has a schedule whose card score
(`round(100 * log2(1 + stability) / log2(366))`, `decks/README.md`) is at least 80. Other kinds never make
an entry known; a schedule of a card that is not live does not count. A manual mark (#68) will extend this
one predicate.

## Starter decks (`starter-deck-ids.json`, `starter-resolution.json`)

Per installed frequency pack of the workspace language: three computed system decks Top 500, Top 1000,
Top 2000. Owned copy id: `d-frq-<slug(packId)>-<fnv1a32(packId + "\0" + "top-" + size)>` with `slug` and
`fnv1a32` of `decks/README.md`. Deck row `{id, name: "<pack name> · Top <size>", createdAt, source:
{type:"frequency", packId, size}}`.

Resolution (server): walk the pack's rows by `rank`, then row position; resolve each row's term (and
reading, when given) to one word entry. A **kana row** (no reading or the reading equal to the term, the
term written only in hiragana, katakana and ー) first takes the word with no written form whose first
reading is exactly the term and whose priority is above 0, highest priority, then lowest id (so `の` is
the particle, not the usually-kana 乃; a kana-only `こと` without priority does not displace 事). Every
other row, and a kana row without such a word, resolves like a level pack word (`BestWordReading`: form +
reading, then the form, then the kana reading fallback); level imports never use the kana step. Skip unresolved rows and entries already taken; stop at `size`
entries or after `4 × size` rows. Fixture: a toy Japanese lexicon (`forms`, kana `readings`, `pri`, `uk`)
and toy packs; `expected` lists entry keys with the rank of the row that took them. Sizes other than 500,
1000, 2000 appear only in this fixture.

Adding a starter deck reuses the add-to-deck plan; entries that are known are left out and counted. The add
also writes `deckcfg:<id>` with `newOrder: {by:"frequency"}` only when no live row exists.

## Routes

- `GET /api/frequency-packs` (public) carries `packId` (the manifest id).
- `POST /api/entries/frequency-ranks` `{language, ids}` (1..500 ids, body <= 16 KiB), signed in ->
  `{pack: {id, packId, name, license, attribution} | null, ranks: [{id, rank}]}` in request order; entries
  without data in the ranking pack, of another language or unknown are omitted; `pack: null` and `[]`
  without a pack. 401, 400 `ids must be 1 to 500 entry ids` / `language is required`, 413.
- `GET /api/frequency-packs/{id}/top?size=500|1000|2000`, signed in -> `{packId, name, size, entries:
  [EntryBase & {rank}]}` in deck order; 404 unknown or uninstalled pack, 400 other sizes.

Both answers are shared data (no per-user overlay); the service worker does not cache them.

## Derivation

`starter-deck-ids.json` was derived with a throwaway Python script independent of the web code (NFC,
UTF-8, FNV-1a 32; `re.sub("[^a-z0-9-]", "-", lower)` per code point); its first three cases equal the
spec's examples. `known.json` stabilities were chosen with the score formula (108 -> 79, 109 -> 80,
150 -> 85, 200 -> 90). `new-order.json`, `deckcfg-new-order.json` and `starter-resolution.json` are
hand-written from the rules above.

## Real-app check (2026-11-16 build)

Against a server built from a scratch copy (embedded web build; `jmdict`, `jiten-frequency`, `cedict`,
`hsk-words` seeded; 127.0.0.1 on a free port; 4 shared cores): `GET /api/frequency-packs` carries
`packId: "jiten-frequency"`; both new routes answer 401 without a token; the first
`GET /api/frequency-packs/1/top?size=2000` took 1.46 s (1.26 s again after a restart; budget 2 s), the
second 0.10 s from the cache, 2000 entries, 656 KB, byte-identical for two users and after the restart;
Top 500 is the prefix of Top 1000 and Top 1000 of Top 2000; `size=3` is 400, an unknown pack 404. The first
20 words are particles and basic words (は, に, を, が, と, も, だ, 為る/する, か, から, …); two kana rows
resolve to a usually-kana homograph by the shared level-word rule (`の` -> 乃, `で` -> 出), see the spec's
homograph risk. Ranks of 600 entries in two calls equal the 600 one-by-one answers, in request order, and
are identical for a second user; `language: "zh"` answers `{"pack":null,"ranks":[]}`. The add plan of
Top 500 for a fresh user (planned by the web modules, pushed through `POST /api/sync/push` in 3 requests of
at most 200 rows) wrote 502 rows (deck, `deckcfg` with `newOrder: {by: "frequency"}`, 500 cards), all
accepted; the next plan was empty; another user saw none of the rows.
