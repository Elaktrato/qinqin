# Starter mode (#214)

A gentle start for a learner who is new to a language. A short **Starter set** of common, picturable words is copied
into the learner's own deck; each word starts as a picture with its pronunciation and shows more of the real script
the better the learner knows **that word**. It is a **display rule over the ordinary vocab card**, not a card type: the
card id, its review history and its schedule are the same with Starter mode on or off, so nothing is lost when a word
reaches its normal card or the mode is switched off. Design and rulings:
`docs/superpowers/specs/2026-11-26-starter-mode-design.md`, plan `docs/superpowers/plans/2026-11-26-starter-mode.md`.

Fixtures:

- `stages.json` — the stage of a word (rule `starter/stages`): the points rule and its constants, the thresholds per
  language profile, what the front shows at each stage (and the hint modes the stage forces), and review histories
  with the stage they give. Web: `apps/web/src/lib/study/starter.ts`, decoded by `starter.contract.test.ts`.
- `set.json` — which Starter set files a server accepts (rule `starter/set`). Go: `server/internal/starter/contract_test.go`.

## The stage of a word (`stages.json`)

Derived from **one vocab card's own reviews**, never stored (like schedules and mastery). Replay the card's reviews in
time order (a stable sort on the time; a review with an unreadable time or a grade outside 1-4 is skipped):

1. `points` = 0, `lastAt` = none.
2. A success (grade 3 Good or 4 Easy) adds one point when `lastAt` is none or at least `minGapMinutes` (720, twelve
   hours) have passed since it; then `lastAt` is this review. A success that comes sooner changes nothing, so the
   learning steps of one sitting do not count and a stage takes a real day.
3. Hard (2) changes nothing: the word **pauses**.
4. Again (1) **drops the word one stage** (to the entry point of the previous stage, never below stage 1) and sets
   `lastAt`, so the relearning steps of that sitting do not count either.
5. `stage` = the highest stage whose threshold the points reach, at most the word's final stage.

| Profile | Thresholds (points to enter stage 1, 2, ...) | Final stage (its normal card) |
|---|---|---|
| `ja` | 0, 1, 2, 3, 5, 7 | 6; **4** for a word usually written in kana (JMdict `uk` on the first sense) |
| `zh` | 0, 1, 2, 4, 6 | 5 |

`justAdvanced` is true when the stage after the card's last review is higher than the stage before it: the card shows
a one-time "New: now with hiragana" note (derived, nothing stored: the next review clears it).

The profile of a language is `ja` or `zh` (a language tag's first subtag); a language without one has no Starter mode
until its language profile (#199) defines stages.

## What the front shows

Each stage row names the large text (`main`: `romanisation`, `reading` or `written`), a small `annotation` (`none`,
`romanisation`, `reading`), the picture (`shown`, `hint`, `normal`) and the hint modes it forces
(`forced`, the `forced` argument of `resolveHints` in `cards/hints.json`): the picture is `always` on the front, a `hint`
behind the one Hint control (same button, key and grade rule as every hint, #215), or the settings' own choice
(`normal`); the reading hint is `never` where the front already shows a reading. The meaning is on the back at every
stage. Japanese: 1 picture + romaji, 2 picture + kana with romaji, 3 picture + kana, 4 kana (picture a hint),
5 the word with furigana (picture a hint), 6 the normal card. Chinese: 1 picture + pinyin, 2 picture + hanzi with
pinyin, 3 hanzi with pinyin (picture a hint), 4 hanzi (picture a hint), 5 the normal card.

- **Kana are shown as the dictionary stores them.** A loanword's reading is katakana (コーヒー) and stays katakana: the
  "hiragana" stages show the entry's first `kana` reading, never a conversion.
- An annotation that equals the main text is left out (a loanword at stage 5).
- A reading the entry lacks falls back to the written form, so a front is never empty.
- A word **usually written in kana** has the kana as its normal card at stage 4 (`usuallyKanaLastStage`).
- Starter fronts apply to **vocab** (Recognise) cards only. Other card kinds are as they always were.
- A word without a picture shows the same text at the same stage, only without the picture.

## Settings

Workspace-settings key `starter` = `{"enabled": boolean, "scope": "base" | "all"}`, read member by member with the
defaults `false` and `base` (anything else is the default), changed by merge patch. `base`: the cards that are in the
deck `d-starter-<language profile>` (the deck the Starter set is copied into); `all`: every vocab card of the
workspace. See `settings/workspace-settings.json`.

## The Starter set

A shipped file per language (`set.json` is the format): `{version: 1, id, language, name, license, attribution,
humanReviewed, words: [{form, reading?, gloss, picture: {pack, concept, target?}}]}` in learning order, at most 300
words. A word names an entry the way a level or frequency list does (a written form and an optional reading); the
server resolves it with the starter-deck rule (a kana row takes the kana-only word first), falls back to the
**character entry** of a single hanzi (CC-CEDICT's one-character lines are character entries), leaves out a word no
installed dictionary has and an entry an earlier word already took. `picture` is the picture the word is expected to
have in an images pack (`target` is the mapping's target when it is not the form, a Japanese `j:<ent_seq>` key); a Go
test checks every promise against the committed mapping in `scripts/images/<pack>/map.tsv`. `humanReviewed: false`
marks a seed that only its author checked. The word choice is released under CC0 1.0.

- `GET /api/starter-sets` (public, not access tokens): `[{id, language, name, license, attribution, wordCount,
  humanReviewed}]`.
- `GET /api/starter-sets/{id}` (signed-in users, not access tokens): `{id, language, name, license, attribution,
  humanReviewed, entries: [...]}`, each entry the base fields of `GET /api/schemes/{id}/entries` plus `gloss` (the first
  gloss of the first sense) and `pictureConcept`, in the set's order, `written` as the set lists it (a kana row stays
  kana). 404 `not_found` for an unknown set.

A client copies the entries into the deck `d-starter-<profile>` with the ordinary add-to-deck rule
(`decks/add-to-deck.json`): a plain deck (no `source`), new cards created in the set's order, a word that already has a
card joins the deck with its history, words marked known are left out, a second run adds nothing. A character entry is
added with `entryKind: "character"`. The pictures are fetched per entry (`GET /api/images/entries/{id}`, #216); where
no images pack is installed the cards are Starter cards without pictures.
