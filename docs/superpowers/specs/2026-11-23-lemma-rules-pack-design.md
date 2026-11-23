# Lemmatizer rule tables as a data pack (#176) — design

Follow-up of #165/#177. The lemmatizer is a language-neutral engine (`server/internal/lemma`) driven by
per-language JSON rule tables (`docs/contracts/lemma/`, format 2). Today the only table, Japanese, is
embedded in the binary. This change adds a data pack type **`lemma-rules`** (format **`rules-json`**) so an
administrator gives a study language lemmatization by installing a pack, with no code change; the table is
validated, licensed and credited like any pack, and served to clients as a data package.

## Scope

- Pack type `lemma-rules` in the pack-type table (`server/internal/packtype`): language shape *one*,
  uploadable, builds the package type `lemma-rules`, no legacy plugin row.
- Pack layout: `manifest.json` (`type: lemma-rules`, `format: rules-json`, `language`) and `rules.json`, one
  rule table in the contract format. The table's `language` must equal the manifest's.
- Store: `internal/lemmapack` (import, uninstall, check, list, reload); registry table `lemma_rule_packs`
  (migration 043) holding the raw table bytes and their sha256.
- Engine: the installed tables overlay the built-in ones (`lemma.SetInstalled`); hard limits on a table, and a
  candidate bound and a work budget on one `Deinflect` call and on one lookup window. A table cannot crash the
  segmenter, and its cost per lookup window is bounded by a fixed number of work units; a table at the limits
  can still make a long text several times slower to segment than Japanese (measured: 5,000 runes of a
  pathological text in about 4 s), not hang it.
- Hot reload: every committed import or uninstall reloads the overlay; `qinqin serve` loads it at start.
- The bundled Japanese table also ships as the seed pack `plugins/data/ja-lemma` (CC0, byte-identical to the
  embedded table), so the package system serves it to Android.
- Package `lemma-rules.<packId>`: one table `lemma_rules (language, rules_json)`.
- Credits: `GET /api/lemma-packs` (public, like `/api/component-packs`) and a Sources page section.
- Settings → Data lists the type ("Lemmatizer rules"); upload, review, install and uninstall use the existing
  staged flow.
- Docs: contract README (lemma + packages), wiki Data-pack-format, Admin-data-packs, API-Routes (generated),
  `docs/sources.md`, `plugins/data/README.md`.

Out of scope: merging two tables, per-user tables, an engine for new scripts (Hangul, Cyrillic: a format
bump), a table editor.

## Precedence

For a language, the table in effect is: the live installed `lemma-rules` pack of that language, else the
built-in table (embedded), else none. An installed pack **replaces** the built-in table wholesale; it never
merges with it. At most one live pack per language: a second pack for a language that already has a live
pack under another id is refused (at the upload review and again inside the import transaction) with a
message naming the installed pack; re-importing the same pack id replaces it. Uninstalling the pack returns
the language to the built-in table (or to none).

Ruling: replace, never merge — a merged table would have rule order, class and `maxDepth` conflicts that no
client could reproduce identically, and an author who wants the built-in rules starts from
`docs/contracts/lemma/ja.rules.json` — cost if wrong: an author must copy the whole table to change one rule
(they do that anyway to test it).

Ruling: one live pack per language, refused rather than "newest wins" — the admin sees which table is in force
without reading timestamps, and a stray upload cannot silently replace a working table — cost if wrong: one
extra uninstall before swapping tables.

Ruling: the table of a language whose code pack does not run rule tables (today `zh`: its pack is not a
`lang.Deinflector`) is refused at import with a clear message — installing it would look successful and do
nothing — cost if wrong: a later Chinese deinflector needs this check relaxed (one line).

Ruling: a `lemma-rules` pack does not auto-register its language (dictionary packs do): rules without a
dictionary of the language change nothing, and the language appears when its first dictionary is installed —
cost if wrong: none visible; the table waits for the dictionary.

## A language without a code pack

`/api/segment`, `/api/segment/at` and `/api/lookup` used to serve only languages with a code pack (zh, ja) and
answer 400 "unsupported language" for every other. They now also serve a language that has a rule table in
effect (`lemma.For(language) != nil`): installing a `lemma-rules` pack for a data-only language (one that has a
dictionary pack but no code pack) gives it segmentation and lookups with deinflection, and uninstalling the pack
takes them away again, at once. The web reader's views stay zh/ja-only (they are CJK-specific: furigana, word
panel); a client of the routes (Android, a later web reader) gets the rest.

Ruling: widen the language gate of the three routes to "code pack or rule table in effect" — without it a pack
for a new language would install, package and do nothing on the server, which contradicts "no code change" —
cost if wrong: a space-delimited language gets the dictionary longest-match segmentation the CJK languages use
(bounded, can match inside an unknown word); reverting is one predicate (`segmentable`).

## Validation and bounds

`lemma.Parse` already rejects unknown keys, classes, match modes, scripts and empty predicates. It now also
enforces limits (contract README "Limits"), on every table including the built-in one:

| Item | Limit |
| --- | --- |
| `rules.json` file (pack import) | 1 MiB |
| `rules` | 1,024 |
| `classes` | 64; a class name ≤ 32 code points; `tags` + `prefixes` of a class ≤ 256, each ≤ 32 |
| `compounds` | 64 |
| `from`, `to`, a compound `suffix`, a `notSuffix` entry | ≤ 32 code points |
| `reason` | ≤ 64 code points |
| `in` of a rule | ≤ 64 classes |
| `hints.keepWhole` | ≤ 2,048 entries, each ≤ 32 code points; `expressionPos`, `particlePos` ≤ 64 each |
| stem predicate | nesting ≤ 4 levels, `notSuffix` ≤ 256, `minRunes` ≤ 64 |
| `language` | a language code (`lang.ValidCode` form); `version` ≤ 64 code points |

The engine has no regular expressions, so there is no regex blow-up; the remaining risk is a combinatorial
one: rules that keep matching what earlier rules produced multiply the candidates at every depth (100 rules
on one suffix, depth 8: 10¹⁶ forms), and predicates that fail late can cost thousands of tests per rule.
**Bounds** (contract README, "Bound" and "Lookup bounds"): one `Deinflect` call stops at **64 candidates** or
after **16,384 work units** (one per (form, rule) pair considered and per predicate leaf, in a fixed order);
the prefixes of one lookup window share **32,768 units**, its compound checks **4,096**, and it keeps at most
**256 probes** with one compound probe per (stem, class) of a prefix. Predicates are capped per table at 16
children per `allOf`/`anyOf`, 4,096 predicates and 4,096 `notSuffix` entries. Measured (fix wave): the review's
worst tables segment 5,000 runes of "a" in about 3.6 s (heavy) and 4.3 s (compounds) instead of 188 s and
51 s; the Japanese table spends at most 4,352 units per call and 11,696 per window, 44 probes.

Ruling (fix wave): a deterministic work budget per call and per window, counted in units every engine counts
the same way (`docs/contracts/lemma/budget.json`), rather than a time limit — a time limit would make results
depend on load and differ between server and Android — cost if wrong: a very productive future language would
need the budgets raised in every client (the Japanese table uses about a quarter of the call budget and a third
of the window budget).

Ruling (fix wave): table-wide predicate caps 16 children per `allOf`/`anyOf`, 4,096 predicates and 4,096
`notSuffix` entries — the Japanese table uses 15 predicates, 2 `notSuffix` entries and 2 children, so the caps
leave two orders of magnitude of headroom while keeping one predicate evaluation small — cost if wrong: a table
needing longer exception lists is refused (raise the cap in every client).

Ruling (fix wave): compound probes are de-duplicated per (stem, class) of one prefix length, not per (stem,
class) of the window as the review suggested — the same stem at a longer prefix is a different probe (勉強し vs
勉強した) and collapsing them broke Japanese lookups (seven tests) — cost if wrong: none; 64 identical compounds
still yield one probe per prefix.

Ruling: the candidate bound is part of the engine contract (every client stops at 64 in the same order),
not a table field, and needs no format bump: no valid table that worked before reaches it — cost if wrong: a
future language with very productive morphology needs the bound raised in every client.

Ruling: the limits apply in `lemma.Parse` to every table, not only to packs: one rule, one implementation for
Android — cost if wrong: a built-in table outgrowing them fails the package tests, not production.

A table that fails validation never reaches the engine: the upload review answers 400 with the parse error
(file, then the engine's message), seed and import fail the same way. A stored table that no longer parses
at reload (a downgraded binary that reads an older format) is skipped and logged; the language falls back to
the built-in table.

Uploads stay admin-only (the existing staged upload, `requireAdmin`).

## Hot reload

`lemma` keeps three layers: the embedded tables, tables registered by tests (`Register`), and the installed
overlay (`SetInstalled(map[language]*Table)`, replaced atomically). `For` reads the overlay first. Nothing
caches a table: `lang.Ja.Rules()` and the generic table pack call `lemma.For` per request, so `/api/segment`,
`/api/segment/at`, `/api/lookup` and the reader (which reads those routes) see a new table on the next
request.

`lemmapack.Reload(ctx, db)` reads every live row, parses it and installs the overlay; it is serialised by a
mutex so two reloads cannot interleave a stale read with a newer one. `lemmapack.Import` and `Uninstall`
call it after their transaction commits, so the admin upload, the admin uninstall, `qinqin seed` and the
first-start auto-seed all take effect immediately in the process that made the change. `qinqin serve` calls it
once before listening, and a watcher (`lemmapack.Watch`, every 30 s) reloads when the live rows differ from what
the last reload installed — `qinqin seed` run as a separate process while the server serves writes only the
database.

Ruling: poll a fingerprint (pack id, hash and stamp of every live row) every 30 s rather than require a restart
after a seed — one cheap query, found missing in the real-app check — cost if wrong: up to 30 s until a seeded
table applies.

Ruling: there is no enabled toggle for a `lemma-rules` pack. Data packs have no server-wide enable flag; the
per-user plugin state exists only for the legacy plugin rows (#169), which no new type gets. A per-user
lemmatizer would make two users see different tokens for the same text and every cache (book coverage) per
user — cost if wrong: an admin disables a table by uninstalling it (the built-in returns), and reinstalls it
from the same zip.

## The built-in table as a pack

`plugins/data/ja-lemma` holds `manifest.json` (`license: CC0-1.0`, attribution "qinqin contributors"),
`rules.json` (byte-identical to `server/internal/lemma/tables/ja.json` and
`docs/contracts/lemma/ja.rules.json`, checked by a test) and `LICENSE` (CC0). It is listed in
`docs/sources.md` (project-authored, CC0). The embedded table stays as the fallback, so a server without the
pack (tests, a fresh database before the seed, an admin who uninstalled it) behaves exactly as before.

Bundled pack sync at start (`qinqin serve`, after the auto-seed): for every bundled `lemma-rules` pack in the
seed roots — if no row of its id exists (live or uninstalled) and no other live pack covers its language, it
is installed; if its id is live and the stored sha256 differs from the bundled `rules.json` (an upgraded
image), it is re-imported; an uninstalled one stays uninstalled.

Ruling: ship the bundled table as a seed pack **and** keep it embedded — the package system then serves the
exact table the server runs, so Android segments offline as the server does, and the embedded copy keeps
every existing code path and test working without a seed — cost if wrong: two copies to keep identical (a
test fails when they drift).

Ruling: the startup sync refreshes a live pack whose id is a bundled pack's id — otherwise an existing instance
would keep a stale copy of the Japanese table forever after an upgrade and mask every table fix in the binary
(the overlay wins). Consequence, documented in Admin-data-packs: an administrator's own table must use its own
pack id; one uploaded as `ja-lemma` is replaced by the bundled copy at the next start — cost if wrong: an admin
loses a customised `ja-lemma` at restart (they still have their zip).

## Package

`lemma-rules.<packId>` (type `lemma-rules`, `languages: [<lang>]`, no `requires`, not optional): the common
tables plus

```sql
CREATE TABLE lemma_rules (language TEXT PRIMARY KEY, rules_json TEXT NOT NULL)
```

with one row: the pack's language and its `rules.json` exactly as imported. A client parses `rules_json` with
its engine (format ≤ its own; otherwise it keeps its bundled copy) and prefers it to a bundled copy of the
same language — the same precedence as the server.

Ruling: the raw bytes, not a re-encoding — the package then holds exactly what the admin reviewed and the
contract fixture can be compared byte for byte — cost if wrong: none (the server validates them on import).

Ruling: no `requires: lexicon.<lang>` — the table is self-contained and useful as soon as any lexicon of the
language arrives; a requirement would block the download order for nothing — cost if wrong: a client may hold
rules for a language whose lexicon it lacks (harmless).

## Credits and admin UI

- `GET /api/lemma-packs` (`accPublic`, token rule `tokReadGlobal`, like `/api/component-packs`): every live
  pack `{packId, name, version, language, license, attribution, notice}` by pack id. The Sources page shows a
  "Lemmatizer rules" section while one is installed.
- Settings → Data groups the type under the label "Lemmatizer rules" (`settings.packs.type.lemmaRules`), after
  stroke data; the upload review card is the generic one (manifest, licence, what it replaces).

Ruling: `tokReadGlobal` on `/api/lemma-packs` — public shared credits, exactly like `/api/component-packs`
(the pinned token route set is amended deliberately) — cost if wrong: a token reads public credits.

## Backup

`lemma_rule_packs` is server data, not per-user data: it is not in the user backup export
(`docs/contracts/backup/`), and it is in the admin whole-server backup because that backup is the whole
database. Ruling: no backup change — the table is reinstallable from its pack and belongs to the instance —
cost if wrong: none for users; a user moving instances keeps their study data, and the target's own tables
apply.

## Tests

- `lemma`: limits (each rejected), candidate bound (an explosive toy table stops at 64, first in order), the
  Japanese table under the bound on the fixture corpora, overlay precedence (installed > registered >
  built-in, clearing restores).
- `lemmapack`: manifest/format checks, file cap, bad table, language mismatch, zh refused, second pack for a
  language refused, re-import no-op and replace, uninstall, reload after import/uninstall, a stored row that
  fails to parse is skipped.
- `packs`: operations and `notFound` (existing table tests), `List` includes the type.
- `api`: a pack installed through `packs.Import` changes `/api/segment` output without a restart and the
  uninstall restores it; the staged upload refuses a bad table and a second pack for a language;
  `/api/lemma-packs` public and listed.
- `datapkg`: the package is planned, built with the schema, holds the raw bytes.
- `cmd/qinqin`: bundled sync (install when absent, refresh when changed, never reinstall an uninstalled one);
  seed of `plugins/data` installs `ja-lemma`.
- Web: pack-type contract test, packages parser, Sources section (unit + dom), i18n lints.
