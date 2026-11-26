# Hints on every flashcard — design (issue #215)

Every card kind can offer optional hints during a review: the word's reading now, its picture once #212/#216 land.
The learner chooses, per kind of hint and per card type, whether it is always shown, available as a hint, or
never. One Hint control (a button and a key) reveals hints one at a time. Using one is recorded and lowers the
suggested grade. The rules are pure, in the cards contract, with fixtures, so Android grades the same.
Starter mode (#214) uses the same kinds, modes and display.

## Context found

- The Recall card (`reverse`) had a private "Show reading" button: it showed the readings and made a right answer
  Hard (`suggestReverseGrade({readingShown})`) and wrote `meta.hints = 1`. That is the thing being generalised.
- Writing has a stroke hint (a button inside the card, counted in `meta.hints` with revealed characters) and the
  word-order card has the translation behind a tap (counted in `meta.hints`). Neither of them changes the
  suggested grade today (only a revealed character or give-up does, through "Again"). The issue says hints already
  lower the grade there; they do not, apart from Recall. See ruling 3.
- `meta.hints` exists in the event model and in `events/review-parse.json` (integer >= 0).
- Workspace settings (`settings/`) are a JSON object changed by merge patch, synced with the workspace and exported
  in a backup untouched except `hiddenDictionaries`; `gradeHaptics` is the model for a Settings → Study switch.

## Kinds (the registry)

`lib/study/hints.ts` holds `HINT_REGISTRY`, rows in the fixed reveal order: `reading`, `picture`. A row has an id,
`ready` (can it show anything yet), `applies(cardKind)`, `available(entry)` and the default mode per card kind.

- **reading**: the entry's readings (kana, pinyin, zhuyin, romaji, on, kun), shown above the word like furigana on
  Recognise, under the prompt elsewhere. Does not apply to the tone card (it is the answer).
- **picture**: defined, `ready: false`, `available` is `entry.hasPicture`, always false before #212/#216. It is in
  the registry, the settings (with a note that pictures are not available yet) and the display switch
  (`HintShown`), so lighting it up is: make `hintsForEntry` report `hasPicture`, draw the image in `HintShown`,
  set `ready: true`. No contract change.

Starter mode (#214) calls `resolveHints({cardKind, settings, entry, forced})` with the modes of the learner's stage
(for example Japanese stage 4: picture `hint`, reading `always`); `forced` wins over the settings. It needs no
second mechanism and no second control.

## Modes and defaults

Per hint kind and card kind: `always` (part of the front), `hint` (hidden until asked), `never`.

| Kind | Recognise | Build the sentence | Write | Tones | Recall | Fill the gap |
|---|---|---|---|---|---|---|
| reading | hint | hint | always | n/a (never) | hint | hint |
| picture | hint | never | hint | hint | hint | never |

Recognise and Recall follow the issue (reading and picture are hints). Write keeps what it always did (reading
shown). Sentence and cloze are about a sentence: a picture of one word would not help and stays off; the reading of
the word is a hint.

## The control and the key

`HintScope` (one per card, inside the card's `{#key}`) creates the card's `CardHints`: `visible` hints (always, then
the revealed ones), `canReveal`, `used`, `reveal()`. `HintControl` renders the **Hint** button (plain, in the
work area) and handles the key; `HintShown` draws the visible hints. Every card renders both, so the control is the
same everywhere. A kind with nothing to show offers no button (and the key line does not mention it).

Key: `H`; inside a text field (the Recall and Fill-the-gap answer field, where H is a letter) `Alt+H`, matched by the
physical key so it works on a Mac. The key line under the grade buttons says "H shows a hint" while a hint is left.

## Grade rule and recording

`lowerForHints(suggested, used)`: `used = 0` changes nothing; otherwise Again stays Again and anything else
(including no suggestion) becomes Hard. `applyHints(result, used)` also adds `used` to the card's own
`meta.hints`. The session applies it once in `onCardDone` (after the Easy clamp), so no card carries the rule and
it cannot be forgotten by the next card kind. Always-shown hints are not counted.

- Ruling: one cap at Hard, not "one step down" — one rule for every kind and every suggestion, including the
  self-graded Recognise card — cost if wrong: someone who only peeked at a reading they knew sees Hard preselected
  and picks Good themselves (the suggestion is never forced).
- Ruling: no suggestion plus a hint is Hard, not no suggestion — otherwise the hint would have no effect on
  Recognise, the card kind the hint matters most on — cost if wrong: Hard is focused where the learner may have wanted
  to choose freely; Enter confirms it, so a careless Enter costs one interval step.
- Ruling: the stroke hint, the translation and the give-up keep their existing suggestions; only the control's
  hints lower it — those were never grade-lowering and changing them alters pinned writing and word-order
  behaviour; the issue's "as hints already do for writing and word order" is true of `meta.hints` only — cost if
  wrong: a writing card with stroke hints still suggests Good (the learner can lower it).
- Ruling: the Writing card's in-pad button is renamed "Next stroke hint" and stays a separate, card-specific help
  — two buttons both called "Hint" on one card would be ambiguous, and a stroke highlight is not a registry kind
  (it lives inside the pad) — cost if wrong: the writing card has two help buttons.
- Ruling: the reading hint shows all of the entry's readings, with no choice of script (kana versus romaji, pinyin
  versus zhuyin) — a per-script choice is a second setting nobody asked for and the entry's own order already puts
  the main reading first — cost if wrong: a Chinese learner who wants only zhuyin sees pinyin too.

## Setting

Workspace-settings key `hints` = `{<kind>: {<card kind>: <mode>}}`, changed one cell at a time by merge patch from
Settings → Study → Hints (`HintSettings.svelte`: for each kind a list of card types with a select). Per workspace
because the useful defaults differ by language (a Japanese workspace wants kana, a Chinese one pinyin); synced
and exported with the workspace's settings; a restore keeps it (fixture case in `backup/remap.json`).

- Ruling: a workspace setting, not a user-global keyed row — it needs no new row family, sync or backup code and
  follows the language like the audio settings — cost if wrong: a learner with several workspaces sets it once per
  workspace.

## Contract

`docs/contracts/cards/hints.json` (rule `cards/hints`): kinds, modes, `notApplicable`, `defaults`, `settings`
(parse cases), `plans` (resolution with entries `{hasReading, hasPicture}` and `forced`), `grades`, `results`.
CHANGELOG entry `#215 (contract 7)`; `ContractVersion` 7; settings and events READMEs; wiki pages.

## Not covered

- The picture itself (#212, #216): the kind is registered and empty.
- Sentence-card translation as a registry kind (#184): the existing translation reveal stays a card-specific help.
- A per-card or per-word hint override, hint kinds beyond reading and picture (first-character meaning, radical
  hint, the learner's note #77): each is a registry row later.
- Android's widget: the contract defines the plan, rule and recording; Android draws its own control.
