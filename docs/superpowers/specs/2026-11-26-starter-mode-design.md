# Starter mode ("Baby mode") — design (issue #214)

A learner who is new to a language gets a short **Starter set** of common, picturable words in their own decks. Each
word starts as a picture with its pronunciation and shows more of the real script the better the learner knows that
particular word. Progress is **per word**, derived from the word's own review history. It is a display rule over the
ordinary vocab card, not a card type: card ids, history and schedules are untouched, so nothing is lost when a word
reaches its normal card or the mode is switched off. Contract: `docs/contracts/starter/`. Plan:
`docs/superpowers/plans/2026-11-26-starter-mode.md`. Owner decisions (2026-11-24) are in the issue and are followed as
written: the stage tables, "per word", loanwords in katakana, words usually written in kana stop at stage 4.

## Context found

- #215 built the hint registry for this: `resolveHints({cardKind, settings, entry, forced})`, the one Hint control, the
  grade cap (a hint asked for suggests Hard). Starter mode passes `forced` per stage; no second mechanism.
- The `picture` hint kind was lit by #212 (merged first): `hintsForEntry(entry, {hasPicture})`, `EntryPicture` in `HintShown`, gated by the `visualAids.pictures` switch and the session's picture cache. Starter mode only forces its mode through `resolveHints({forced})`; there is one picture implementation.
- Ruling: with #212 the picture hint is on by default for Recognise cards (the #215 default `hint`); that default is kept — a Hint button that appears only for a word that has a picture and costs nothing until pressed is not a concrete problem, and Starter mode forces its own modes anyway — cost if wrong: a Recognise card of a pictured word offers a Hint it did not before; the setting is one select (Settings > Study > Hints).
- Japanese entries already carry a derived `romaji` reading and the dictionary's kana readings (katakana for loanwords);
  Chinese entries carry `pinyin`. No converter is needed.
- CC-CEDICT's one-character lines are **character** entries in the lexicon (kind `character`), not words, and their
  first gloss is often "surname X" or a variant note. A real seed of JMdict and CC-CEDICT found this (ruling 10).
- Deck rows have a strict `source` shape; a new source type would be an unreadable row for older clients (#167).

## The stage of a word

Replay the card's reviews in time order. A success (Good or Easy) adds a **point** when it comes at least twelve hours
after the last counted review; Hard changes nothing (the word pauses); Again drops the word one stage and starts a new
twelve-hour wait. The stage is the highest one whose threshold the points reach, up to the word's final stage.

| | Thresholds | Final stage |
|---|---|---|
| Japanese | 0, 1, 2, 3, 5, 7 | 6 (4 for a word usually written in kana) |
| Chinese | 0, 1, 2, 4, 6 | 5 |

So the first Good moves a word from stage 1 to 2; with the usual FSRS intervals a Japanese word reaches its normal card
after about seven reviews, a few months. A card that was just promoted shows "New: now with hiragana" once (derived:
the last review advanced it).

- Ruling: the stage is a count of spaced successes with a twelve-hour gap, not an FSRS stability threshold — the rule is
  decodable by any client from the review list alone (no FSRS port needed to show a card), pinned by 21 fixture
  histories, and the gap keeps the learning steps of one sitting from racing a word through stages — cost if wrong: a
  word the learner knows well from outside the app still climbs one stage per day (the Hint control and the answer side
  are always available, and Starter mode can be switched off); a stability-based rule could be added as a second
  contract version.
- Ruling: Again drops one stage, Hard only pauses — a lapse means the word was not known at this stage, and one stage
  back is the gentle undo; the learner keeps the progress of the earlier stages — cost if wrong: a word at the normal
  card briefly shows furigana after one lapse, which some learners will find patronising; `lapse` is one number in the
  contract.
- Ruling: no manual "show me the kanji now" nudge in this change — the issue lists it as a decision; a nudge needs a
  stored row per word (a new keyed row family, sync and backup code), and the two escape hatches that exist are the
  answer side (always complete) and the Starter switch — cost if wrong: a learner who already reads 林檎 cannot skip it;
  the cheap follow-up is a `starter:<entryId>` keyed row holding a minimum stage.

## The front at each stage

`docs/contracts/starter/stages.json` has the table (`main`, `annotation`, `picture`, `forced`). The Japanese stages show
the first `kana` reading as stored (a loanword stays katakana, never converted) and the derived `romaji`; the written
word at stage 5 carries the kana above it as **ruby** (`<ruby>`/`<rt>` with `<rp>` fallback), and the Chinese stages put
pinyin over the hanzi the same way. The romaji of stage 2 sit **under** the kana. An annotation equal to the main text is
dropped; a missing reading falls back to the written form. The play button is on the front at every Starter stage (audio
pack or device voice), where the normal card shows it only after the answer. The "New" note is a polite status above the
word. The picture is the `picture` hint: `always` at stages 1-3 (Japanese) / 1-2 (Chinese), a `hint` behind the Hint
control after that; the reading hint is forced `never` wherever the front already shows a reading.

- Ruling: using the picture hint counts like every other hint (the suggested grade is capped at Hard and `meta.hints` is
  recorded) — the issue says "the same button, the same grading rule" (#215); a word the learner needs the picture for
  is not yet known at that stage — cost if wrong: peeking at a picture the learner knew costs one interval step if they
  accept the suggested Hard (they never have to).
- Ruling: Starter fronts apply to **vocab** (Recognise) cards only; sentence, writing, tone, recall and cloze cards
  keep their normal faces — the stages are tables for a word shown alone; a sentence card would hide the word inside its
  sentence — cost if wrong: a Starter learner sees kanji on a Recall card of a word still at stage 1.
- Ruling: a word without a picture (a learner's own card, or no images pack installed) shows the same text at the same
  stage, only without the picture; there is no stage 0 and nothing waits for a picture — the stages are about the script,
  and the first Starter set only holds words that have one — cost if wrong: stage 1 of a picture-less word is "romaji
  only", easier to ignore than a picture; the owner can still decide for an icon or emoji.
- Ruling: loanwords and kana are not detected by a rule of ours; the dictionary's kana reading is used as it is — the
  server already stores katakana for loanwords — cost if wrong: a loanword that JMdict also lists with a hiragana
  reading first shows hiragana.
- Ruling: Starter mode sets a stage on a card by the **card's own** reviews, so a word's Recall card or sentence cards do
  not advance it — "derived from that card's own review history" (issue) — cost if wrong: none for the stage; a learner
  who only reviews through sentence cards stays at stage 1.

## Where it applies, settings, onboarding

Workspace-settings key `starter` = `{enabled, scope}`, default off and `base`: `base` is the cards in the Starter deck
`d-starter-<ja|zh>`, `all` every vocab card of the workspace (the issue's "option to apply it to the learner's own
cards too"). Settings → Study → **Starter mode**: the switch, the scope, and "Add the Starter words to my decks" (which
also switches the mode on). Home shows a **Starter offer** to a brand-new workspace (no card, no known mark; a language
with stages and a set; mode off; not dismissed), directly under the placement offer (#74).

- Ruling: the Starter words are copied into a plain deck with a fixed id (`d-starter-<profile>`, no `source`) with the
  ordinary add-to-deck plan — **cards stay in the learner's own vocabulary** (the same `c-vocab-<entryId>` ids, so a word
  they already study joins the deck with its history), new cards study in the set's order, no deck row shape changes —
  cost if wrong: renaming or deleting the deck does not remove the Starter set from `base` scope (the id decides, not
  the name); a deleted deck's cards fall back to normal cards.
- Ruling: the two offers on Home do not replace each other: placement is "tell us what you know", Starter is "I know
  none of it"; both use the same "brand new" test, so they appear and vanish together, and each remembers its own "Not
  now" on this device — a single merged card would have to decide for the learner which kind of beginner they are — cost
  if wrong: two cards on a fresh Home.
- Ruling: scope defaults to `base` — a learner who adds their own cards expects them to look normal; "all" is one
  select away — cost if wrong: a learner who wanted the stages on everything finds them only on the Starter words.
- Not done: the **create-workspace** form's "I'm new to this language" checkbox (the issue lists it); Home's offer and
  Settings do the same job one screen later. **The reader and entry pages** do not follow the stage yet (the issue says
  "can").

## The Starter sets

A set is a JSON file per language shipped in the server (`go:embed`), `server/internal/starter/sets/`; the format is
`docs/contracts/starter/set.json`. Words are named like a level or frequency list names them (written form plus an
optional reading) so the existing resolution rules apply; each word names the picture it is expected to have in an images
pack, and a Go test checks every promise against the committed mapping `scripts/images/<pack>/map.tsv`.

- Ruling: sets are embedded in the binary, not installed packs — they are a short list written for this project, not
  third-party data; a pack type would need an installer, a registry, a seed order and a Sources row for two JSON files —
  cost if wrong: changing a set is a release, not a pack upload.
- Ruling: the word choice is released under CC0 1.0 (`set.json` carries `license` and `attribution`) — a list of
  everyday words has no thin-copyright expectation either way, and the issue says "released openly; the word choice is
  our own" — cost if wrong: the owner may prefer MIT like the code; one field per set. **Flagged for the owner.**
  **Superseded 2026-11-26 (owner):** CC BY 4.0 ("qinqin contributors, CC BY 4.0"), no CC0 exception; see `LICENSING.md`.
- Ruling: a single hanzi that is not a word falls back to its **character** entry — CC-CEDICT has no word entry for 狗
  or 水, and these are beginner words; the card is created with `entryKind: "character"` (no sentence or tone
  companions) — cost if wrong: the card's back lists "surname Shui" before "water" (CC-CEDICT orders its lines so); the
  seed keeps these words and the review list below names them.
- Ruling: the first sets are **seeds**: 55 Japanese and 47 Chinese words, every one with a hand-checked picture row in
  `scripts/images/openmoji/manual.tsv` or a high-scoring automatic row, each read against the real JMdict and CC-CEDICT
  entry it resolves to (`TestRealDictionaries`, a seeded database): readings pinned for homographs (月 つき, not げつ),
  entries whose first gloss is a company (苹果 "Apple (American tech company)") or a rude variant (鸟 "variant of 屌")
  left out. `humanReviewed: false` says so in the file and in the API. A person must read the lists, add the missing
  everyday words (numbers, colours, family, verbs) to reach 100-300 per language and decide the ordering — that is a
  content task this change does not claim to finish.
  **Grown 2026-11-28 (#275):** 146 Chinese and 145 Japanese words, reviewed by teacher agents
  (`server/internal/starter/sets/REVIEW.md`, plan `docs/superpowers/plans/2026-11-28-275-starter-lists.md`).

## Contract and clients

Contract 9: `starter/stages.json` (the rule, thresholds, per-stage fronts and forced hints, 21 histories), `starter/set.json`
(file format), the two routes, the settings key. Android decodes the same fixtures; the stage is a pure function of the
card's reviews and two facts about the word (language profile, usually kana).

## Not covered

- The reader and entry pages following the stage; the create-workspace checkbox; per-word nudging.
- Korean and Russian profiles (#199, #201): a profile is a threshold list plus a stage table.
- 100-300 reviewed words per language; the Starter words in the Sources page (the sets carry `license` and `attribution`;
  the API returns them).
- Prefetching the next card's picture (the picture appears when its request returns; on a slow connection stage 1
  shows the romaji first).
