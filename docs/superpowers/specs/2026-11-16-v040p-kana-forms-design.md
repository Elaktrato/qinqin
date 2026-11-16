# Kana display forms for usually-kana words — design (issue #92, v0.4.0 prep item 2)

Status: Draft (2026-11-16), written unattended; every non-obvious call is a
**Ruling: what — why — cost if wrong**. Builds on the starter decks of #75
(`2026-11-16-v030s-frequency-decks-design.md`, contract `docs/contracts/frequency/`).

## Problem

Starter decks list の as 乃. The row resolves to the right entry (JMdict 1469800, the particle), but an
entry's display form today is "the first written form, else the first reading" (`lexicon.Entry.Headword`,
`lookup.headword`, the web's `popupWritten`), and 1469800's only written forms are 乃 and 之, both
search-only (`sK`). The same first-form rule shows 事 for こと, 為る for する and 此れ for これ everywhere a
word is shown: study card fronts, deck detail rows, level and starter deck details, the reader popup
headword after a kana match, the words panel, search results — and it is snapshotted as the card's
`written` when a card is added.

## What the data says (checked on the bundled `plugins/data/jmdict` pack, 2026-11-16)

- 1469800 (の) is **not** `uk`: its six senses carry no `uk` misc. What makes 乃/之 wrong is `sK`. 145 JMdict
  entries have only `sK` written forms.
- 1313580 (事/こと): every sense `uk`. 1157170 (為る/する, `rK`): every sense `uk`. 1628530 (此れ, all forms
  `rK`/`sK`): senses 1–5 `uk`, sense 6 not.
- `uk` is per sense, and many common words carry it on a minor sense only: 犬 (sense 2, derogatory), 見る,
  山, 会う, 携帯, 改善 — 121 common (`ichi1`/`news1`) entries have `uk` on some sense but not the first.
  66 have it on the first sense but not all (分かる/わかる, 無い/ない, 頃/ころ, 此れ/これ).
- Four non-`uk` entries start with an outdated (`oK`) form while a plain one follows (爽凉 → 爽涼).
- The importer already stores everything needed: form flags (`forms.flags`, e.g. `["sK"]`), reading flags
  (`readings.flags`, `["sk"]`), per-sense misc tags (`senses.tags`, `["uk"]`) and the entry-level
  `entries.uk` (= any sense `uk`, used for ranking). Stored since the JMdict lexicon importer of
  2026-11-13, i.e. by every v0.3.0 database.

Ruling: **no import change and no re-seed** — every input of the rule is already in the lexicon rows of
every v0.3.0 database; the change is code only and applies on the next server start (the starter deck cache
is per process) — cost if wrong: an operator re-installs the JMdict pack in Settings, Data.

## The display form rule (`frequency/display-form.json`)

`displayForm(entry, listForm?)` for an entry with `forms` (text, flags), `readings` (type, value, flags),
`senses` (tags, in the entry's sense order) and an optional list form:

1. **List form.** When `listForm` is given, written only in kana (hiragana, katakana, ー) and equal to the
   value of one of the entry's `kana` readings that is not search-only (`sk`), it is the display form.
2. **Usually kana.** When the entry's **first sense** carries the tag `uk` and it has a `kana` reading,
   the display form is its best kana reading.
3. **Written form.** Otherwise the best written form.
4. **Reading.** No written form qualifies: the best kana reading, else the first reading of any type, else
   `""`.

"Best" picks, in stored order, the first item without a rare flag (`rK oK iK sK` for forms, `rk ok ik sk`
for readings), else the first one that is not search-only (`sK` / `sk`); a search-only form is never shown.
For readings step 4 falls back to the first kana reading even when it is search-only (an entry must show
something). Other flags (`ateji`, `gikun`, `trad`, …) do not matter. Chinese and character entries carry
no `uk` sense and no rare flags, so their display form stays the first form.

Ruling: `uk` means **the first sense** carries `uk`, not `entries.uk` (any sense) — with any sense, 犬, 見る,
山 and 携帯 would show in kana; JMdict orders senses by importance and 分かる, 無い, これ, こと, する all
qualify — cost if wrong: a few words (猿, 燕: animal names are `uk` in JMdict) show in kana where a learner
might expect kanji; the entry page still lists every form.

Ruling: the list form counts only when it is one of the entry's own non-search-only kana readings — a
katakana row コレ resolved to これ shows これ, never a spelling the entry does not have; a search-only
reading (ヤる) never wins — cost if wrong: a list's stylistic katakana is lost.

Ruling: the list form is used by starter decks only; the reader keeps the dictionary display form (a text
written in kana does not turn 食べる into たべる) — the issue's kana rule names the frequency list — cost if
wrong: one argument at the popup call.

Ruling: one rule, two implementations: Go `lexicon.Entry.DisplayForm(listForm)` (with `Headword()` =
`DisplayForm("")`) for everything the server picks, TS `displayForm` (`lib/entry/displayForm.ts`) for the
popup snapshot, which the web builds from a lookup result; both decode the same fixture. A second client
that builds headwords from the synced lexicon (`/api/sync/pull`: forms with flags, readings with flags,
senses with tags) implements the same rule — cost if wrong: a third copy later.

## Where it applies

| Surface | Today | After |
|---|---|---|
| Entry bases (`written` of search, entry page, `POST /api/entries/bases`, scheme entries, variants) | first form | `Headword()` = rule |
| Starter deck items (`GET /api/frequency-packs/{id}/top`) and their `written` snapshot | first form | rule with the row's term as list form |
| Level / system deck items and snapshots | entry base | rule (via entry base) |
| Study card fronts (vocab, reverse, sentence, writing fallback) | `entry.written` | rule (via entry) |
| Deck detail rows | entry base, else snapshot | rule, else snapshot |
| Reader popup headword (`term`) | matched form; kana match → first form | matched form, unless it is search-only; kana match → rule |
| Reader popup "add" snapshot (`popupWritten`) | first form | TS rule |
| Words panel (bases) | entry base | rule |
| Journal word suggestions without a snapshot | first form | rule |

Not display, unchanged: audio resolution (`resolveEntry` matches recordings by the stored first form),
backup entry identity (`refs/entries.json` `written` = first stored form, a fallback key), lookup ranking
(`primary`). The characters-under-a-radical list sorts by `Headword()` (characters: unchanged).

Ruling: a lookup that matched a search-only form (之 in a text) shows the display form (の) as its term —
"search-only forms are never a headword" — cost if wrong: a text's archaic spelling is not echoed.
`GET /api/lookup` readings gain `flags` (additive) so the web can apply step 2 and 4.

## Existing cards whose snapshot is 乃

Ruling: **snapshots are not rewritten.** The `written` snapshot is documented as the card's historical form
(`entriesCache.ts`); rewriting rows on view would push hidden writes to every device. Every surface that
has the live entry already prefers it (study card fronts, deck detail rows, starter and level details, words
panel), so they show の at once. Surfaces that show only the snapshot — Settings → card manager labels, the
FSRS preview list, the mastery map's character contributions, writing companion planning — keep 乃 for a card
added before this change; deleting and re-adding the card (or the starter deck) takes the new form — cost if
wrong: a small repair pass later (rule: a vocab card whose snapshot is a search-only form of its entry takes
the display form), pinned by the same fixture.

## Contract

`docs/contracts/frequency/display-form.json` (`rule: "frequency/display-form"`): cases with `forms`,
`readings`, `senses` (tags only), optional `listForm`, `expected`; real JMdict entries abbreviated
(1469800, 1313580, 1157170, 1012980, 1628530, 1606560, 1258330, 1596480, 1358280, 1008490), plus a CEDICT-like
and a KANJIDIC-like entry and edge cases. `starter-resolution.json` expected items gain `written` (the
snapshot). `docs/contracts/reader/popup-written.json`: lookup-result shaped cases for `popupWritten`.
Decoded by Go (`lexicon`, `freq`) and web tests.

## Testing

Go: fixture test of `DisplayForm`; `entryBase`/entry route and lookup (kana match of の → term の, 之 match
→ の, readings carry flags); starter route `written` (の, こと, する on a toy lexicon); journal suggestion.
Web: fixture test of `displayForm`, `popupWritten` fixture; starter add snapshots the served `written`.
Real-app check: built server, real `jmdict` and `jiten-frequency` packs, Top 500 starts の, で, こと…

## Risks

- Learners used to 分かる see わかる in lists; the entry page lists every form and the popup still echoes
  kanji text.
- An entry from a non-JMdict Japanese pack has no `uk` tags or flags: first form as before.
