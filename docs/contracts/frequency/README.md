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
- Per deck: the field `newOrder` of the deck's typed `deckSettings` row (`study/README.md`; `null` = added;
  a value the typed shape cannot carry stays in `extra`). In the keyed row `deckcfg:<deckId>` (backups,
  `deckcfg-new-order.json`; the web decodes the `newOrder` member with `parseNewOrder`) it is an optional field: absent or malformed (not an object, an
  unknown `by`, `level` without a non-empty string `packId`) = added. A readable value is normalised to the
  shape (fields beyond it are dropped); an unreadable one (a newer client's) is kept verbatim like every
  other unknown field, so saving the row keeps it, until this client sets an order of its own.
- Per session: `'deck'` (default) resolves to the selected decks' common order, or added when they differ
  (`mixed`); an explicit order wins. Level sessions use level order unless the session says `frequency`.

## Known words (`known.json`)

An entry is known when one of its **live vocab** cards has a schedule whose card score
(`round(100 * log2(1 + stability) / log2(366))`, `decks/README.md`) is at least 80. Other kinds never make
an entry known; a schedule of a card that is not live does not count. The learner's manual mark (#68, a live
`known:<entryId>` row, `reader/README.md`) makes an entry known whatever its cards: a marked word is skipped
by starter decks. The reader passes its own `smartThreshold` to the same predicate (`reader/word-states.json`);
starter decks always use 80.

## Starter decks (`starter-deck-ids.json`, `starter-resolution.json`)

Per installed frequency pack of the workspace language: three computed system decks Top 500, Top 1000,
Top 2000. Owned copy id: `d-frq-<slug(packId)>-<fnv1a32(packId + "\0" + "top-" + size)>` with `slug` and
`fnv1a32` of `decks/README.md`. Deck row `{id, name: "<pack name> · Top <size>", createdAt, source:
{type:"frequency", packId, size}}`.

Resolution (server): walk the pack's rows by `rank`, then row position; resolve each row's term (and
reading, when given) to one word entry. A **kana row** (no reading or the reading equal to the term, the
term written only in hiragana, katakana and ー) first takes the word with no written form whose first
reading is exactly the term and whose priority is above 0, highest priority, then lowest id (so `で` is
the particle, not the usually-kana 出; a kana-only `こと` without priority does not displace 事). Every
other row, and a kana row without such a word, resolves like a level pack word (`BestWordReading`: form +
reading, then the form, then the kana reading fallback; among the entries with the form, one where it is a real
written form comes before one where it is only search-only, `sK`, whatever the priorities: 虹 with にじ is the
rainbow, not 二次, #347); level imports never use the kana step. Skip unresolved rows and entries already taken; stop at `size`
entries or after `4 × size` rows. Fixture: a toy Japanese lexicon (`forms`, optional `formFlags`, kana `readings`, `pri`, `uk`)
and toy packs; `expected` lists entry keys with the rank of the row that took them. Sizes other than 500,
1000, 2000 appear only in this fixture.

Each starter word is served with `written` = its **display form** with the row's term as list form (next
section), and the add snapshots exactly that as the card's `written`: a kana row shows its kana when it is a
reading of the entry. Fixture: `expected[].written`; toy `uk` = `entries.uk` and a first sense tagged `uk`
unless `senseTags` lists the senses' tags.

Adding a starter deck reuses the add-to-deck plan; entries that are known are left out and counted. The add
also writes `deckcfg:<id>` with `newOrder: {by:"frequency"}` only when no live row exists.

## Display form (`display-form.json`, #92)

The text an entry is shown as — entry bases (`written` of search hits, the entry page, `POST
/api/entries/bases`, scheme entries, starter decks), study card fronts, deck lists, the lookup popup's term
after a kana match, the words panel — and the `written` snapshot of a card added from those surfaces.
`displayForm(entry, listForm?)` over the entry's `forms` (`text`, `flags`), `readings` (`type`, `value`,
`flags`) and `senses` (`tags`, in the entry's order):

1. `listForm` (a starter deck row's term), when written only in hiragana, katakana and ー and equal to the
   value of one of the entry's `kana` readings not flagged `sk`;
2. when the **first sense** carries the tag `uk` and the entry has a kana reading: the best kana reading.
   The first sense is the first **live** sense (not tombstoned) of an **installed** dictionary (not
   uninstalled) by `(dictionaryId, ord, id)` — the order `GET /api/entries/{id}` `senseGroups`, lookup
   `senses` and the sync pull's senses (sorted by that key) give;
3. the best written form;
4. the best kana reading (else the first kana reading), else the first reading of any type, else `""`.

Best = the first item (stored order) without a rare flag (forms `rK oK iK sK`, readings `rk ok ik sk`), else
the first that is not search-only (`sK` / `sk`); a search-only form is never shown. Other flags (`ateji`,
`trad`, …) do not matter. Only the first sense counts for `uk`: JMdict tags minor senses of 犬, 見る, 山 or
携帯 `uk`, while `entries.uk` (and the sync wire's `uk`) is "any sense" and only ranks. Examples from JMdict:
の (1469800, forms 乃/之 both `sK`, not `uk`) → の; 事 → こと; 為る → する; 此れ → これ; 分かる → わかる;
犬 → 犬; 爽凉 (`oK`) → 爽涼. Chinese and character entries keep their first form.

A lookup (`GET /api/lookup`) of a Japanese written form shows the matched form as `term` unless it is
search-only (之 → の); a kana match shows the display form. Readings carry `flags`. The reader popup's add
snapshot is `displayForm` of the lookup result without a list form (`reader/popup-written.json`).

No import change: form flags, reading flags and sense tags are stored by the JMdict importer since before
v0.3.0, so existing databases need no re-seed. A card shows `shownWritten(entry, snapshot)`: its snapshot when that is a kana reading of the
entry not flagged `sk` (a starter copy of ところ shows ところ, though 所's display form is 所), else the served
`written` (deck rows, study card fronts). Lists leave the reading beside a word empty when the word is shown as
its first reading. A Japanese written-form search hit shows the searched form unless it is search-only.
Cards added before #92 keep their snapshot (乃): surfaces that
load the entry show the display form; snapshot-only surfaces (card manager labels, the FSRS preview, the
mastery map, writing companion planning) show the old snapshot until the card is re-added.

## Routes

- `GET /api/frequency-packs` (public) carries `packId` (the manifest id).
- `POST /api/entries/frequency-ranks` `{language, ids}` (1..500 ids, body <= 16 KiB), signed in ->
  `{pack: {id, packId, name, license, attribution} | null, ranks: [{id, rank}]}` in request order; entries
  without data in the ranking pack, of another language or unknown are omitted; `pack: null` and `[]`
  without a pack. 401, 400 `bad_request` (ids not 1 to 500 entry ids, or no language), 413 `too_large`.
- `GET /api/frequency-packs/{id}/top?size=500|1000|2000`, signed in -> `{packId, name, size, entries:
  [EntryBase & {rank, gloss}]}` (`gloss`: the first gloss of the entry's first sense, `""` without one; a
  list shows it next to a display form that occurs more than once, e.g. なる 成る / 生る) in deck order; 404 unknown or uninstalled pack, 400 other sizes.

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
20 words are particles and basic words (は, に, を, が, と, も, だ, 為る/する, か, から, …). The first
build resolved `で` to the usually-kana 出 by the level-word rule; the kana-row step (review fix) makes it
the particle で (re-checked: first Top 2000 1.23 s, cached 0.002 s, nested sizes). `の` resolves to JMdict
1469800, the particle, whose written forms 乃 and 之 are search-only (sK); entry bases showed the first form,
so the deck listed it as 乃 — fixed by the display form (#92, above). Ranks of 600 entries in two calls equal the 600 one-by-one answers, in request order, and
are identical for a second user; `language: "zh"` answers `{"pack":null,"ranks":[]}`. The add plan of
Top 500 for a fresh user (planned by the web modules, pushed through `POST /api/sync/push` in 3 requests of
at most 200 rows) wrote 502 rows (deck, `deckcfg` with `newOrder: {by: "frequency"}`, 500 cards), all
accepted; the next plan was empty; another user saw none of the rows.
