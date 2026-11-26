# Visual aids (#212)

Pictures, tone colours and character anatomy: aids that add colour, shape and pictures to words, each switched on or
off per workspace. Spec: `docs/superpowers/specs/2026-11-26-visual-aids-design.md`. Fixtures
`{"version":1,"rule":"aids/<name>", ...}`, decoded by `apps/web/src/lib/aids/aids.contract.test.ts`. There is no new
route and no new row: the data is what a client already has (the images packs of #216, the components packs of #71,
the dictionary's readings and glosses).

## The setting (`visual-aids.json`)

The workspace-settings key `visualAids` (`settings/`): `{<aid>: boolean}` with the aids `pictures`, `toneColors`, `toneContour` and
`anatomy`. **Defaults: all four on** (a picture shows only where an installed images pack maps the word, anatomy
only where a components pack has the character, tone colours only on pinyin). Each switch is read alone: an absent
member, a non-boolean, an unknown member or a non-object value is the default (never an error); one exception: a
stored `toneColors: false` with no stored `toneContour` reads as `toneContour: false` (before the contour had its
own switch, `toneColors` drew both, so a learner who turned it off keeps seeing no tone marks). A client writes one
switch at a time by merge patch (`{"visualAids": {"anatomy": false}}`) and keeps members it does not know. Because it is
a workspace setting it is synced with the workspace and part of a backup (a restore keeps unknown members). Aids that
are not built yet (pitch accent, grammar diagrams, word maps, gender and case colours; spec "Follow-ups") add a key
when they are; an older client ignores it.

## Pictures

An entry's picture is `GET /api/images/entries/{id}` (`images/`). With `pictures` on:

- the **entry page** shows it in the header, with its credit line (`credit, license`) and the picture's English name
  as its accessible name;
- the **answer** of the Recognise, Recall and writing cards shows it with the credit, unless the Picture hint already
  shows it;
- the **Picture hint** (`cards/hints.json`, kind `picture`, now ready) is offered on a card only when the entry has a
  picture and `pictures` is on (`hasPicture`); with `pictures` off no request is made.

A word without a picture, a failed request and a signed-out reader show nothing; the layout never waits for a
picture. A client asks once per entry per session and remembers "none".

## Tone colours (`tones.json`)

With `toneColors` on, every syllable of a **pinyin** reading (type `pinyin`, any screen that shows a reading: the
entry page, the hint, the answer of a card) is drawn in the colour of its tone; with `toneContour` on it is drawn
with the tone's contour under it. The two switches are independent. The contour is the cue that is not a colour.

- **Syllables** (`segments`): the value is split at whitespace and apostrophes (kept, uncoloured); a token made of
  Latin letters and combining marks is cut into syllables, a run-together word (`Běijīng`, `tāmen`) between vowel
  groups: the consonants before the next vowel group belong to the next syllable (`zh`, `ch`, `sh` as one initial),
  the rest (`n`, `ng`, `r`) to the last one; the tone is the tone mark found in the syllable, none = the neutral tone
  (5). A token with anything else (a digit, a symbol) is left plain.
- **Contours** (`contours`): a polyline in a 10 x 10 box, high at the top, drawn left to right: 1 flat high, 2 rising,
  3 falling then rising, 4 falling, 5 a short dot. A tooltip names the tone (`study.aids.tone.*`).
- **Colours** (`spectrum`, `colors`): tones 1-4 start from the colour-blind-safe Okabe-Ito hues (blue, orange, bluish
  green, reddish purple); a hue whose contrast with the theme's `panel` is below 4.5:1 is moved toward the theme's
  `text` colour in 5% steps (channels rounded half up) until it reaches 4.5:1 (`text` itself at the last step); tone 5
  is `muted` when it reaches 4.5:1, else `text`. The set comes from the painted theme's colours, so every theme (and a
  dark one) gets readable colours with no new theme token.
- **Forced colours**: the system's text colour applies and the contour (`currentColor`) keeps the tone readable.
  There is no motion.

## Character anatomy (`anatomy.json`)

With `anatomy` on, the **entry page** (the character, or the character picked in a word's stroke order) and the
**answer of the writing card** (each character of the word) list the parts of one character:

- parts: `GET /api/components` `chars[glyph]` in pack order, each once, without the character itself, at most
  8 (`maxParts`); a character with no parts or none in a pack shows nothing;
- meaning of a part: the first gloss (`m`) of the same glyph in `GET /api/characters`, none when the dictionary does
  not have the part as a character (a radical form such as 氵);
- the character's radical, when the client knows it, is marked `radical`; the meaning is text beside the part, never
  only a colour.

Data in the repository is what the components pack of the language is: Japanese kanji have the bundled
`kanjivg-components` pack (CC BY-SA 3.0, `docs/sources.md`); Chinese has a pack only if the administrator prepared a
local one. Nothing new is bundled for this aid.

## Where the switches are

Settings > Study > Visual aids: one switch per aid, a note, and a preview of the tone colours, of the contour and of an anatomy
example that is drawn whatever the switch says.
